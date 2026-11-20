import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { applyImportedTable } from '../domain/dataset';
import { createProject, CURRENT_SCHEMA_VERSION, replaceDataset } from '../domain/project';
import { backupFileName, createBackup, parseBackup } from './backup';
import { ProjectRepository, SyncScoreDB } from './db';
import { migrateProject, MigrationError } from './migrations';

let counter = 0;
let db: SyncScoreDB;
function repo() {
  counter += 1;
  db = new SyncScoreDB(`syncscore-test-${counter}`);
  return new ProjectRepository(db);
}

afterEach(async () => {
  if (db) await db.delete();
});

function sampleProject() {
  const p = createProject('Kelas Algoritma');
  const target = applyImportedTable(p.target, { header: ['NIM', 'Nama'], rows: [['0215001', 'Ani']] }, {
    mode: 'replace',
    origin: { kind: 'paste' },
    importedAt: '2026-01-01',
  });
  return replaceDataset(p, target);
}

describe('ProjectRepository', () => {
  it('saves, lists, loads, renames and deletes projects', async () => {
    const r = repo();
    const p = sampleProject();
    await r.save(p);
    expect((await r.list()).map((x) => x.name)).toEqual(['Kelas Algoritma']);
    const loaded = await r.load(p.id);
    expect(loaded?.target.rows[0].cells[loaded.target.nimColumnId!]).toBe('0215001');
    await r.rename(p.id, 'Baru');
    expect((await r.load(p.id))?.name).toBe('Baru');
    await r.remove(p.id);
    expect(await r.list()).toEqual([]);
    expect(await r.load(p.id)).toBeUndefined();
  });

  it('imports a backup as a new copy without overwriting', async () => {
    const r = repo();
    const p = sampleProject();
    await r.save(p);
    const copy = await r.importCopy(parseBackup(createBackup(p)));
    expect(copy.id).not.toBe(p.id);
    expect(await r.list()).toHaveLength(2);
  });

  it('clears all local data', async () => {
    const r = repo();
    await r.save(sampleProject());
    await r.setMeta('lastProjectId', 'x');
    await r.clearAll();
    expect(await r.list()).toEqual([]);
    expect(await r.getMeta('lastProjectId')).toBeUndefined();
  });
});

describe('backup and migration', () => {
  it('round-trips a project through a backup, keeping NIM text', () => {
    const p = sampleProject();
    const restored = parseBackup(createBackup(p));
    expect(restored).toEqual(p);
    expect(backupFileName(p)).toMatch(/\.json$/);
  });

  it('rejects files that are not SyncScore backups', () => {
    expect(() => parseBackup('not json')).toThrow(MigrationError);
    expect(() => parseBackup('{"format":"other"}')).toThrow(/bukan cadangan/);
  });

  it('rejects projects from a newer schema instead of discarding data', () => {
    const p = { ...sampleProject(), schemaVersion: CURRENT_SCHEMA_VERSION + 1 };
    expect(() => migrateProject(p)).toThrow(/lebih baru/);
  });

  it('fills defaults for older/partial documents and drops dangling references safely', () => {
    const p = sampleProject();
    const raw = JSON.parse(JSON.stringify(p));
    delete raw.schemaVersion;
    delete raw.settings;
    raw.redoStack = ['missing-op'];
    raw.mappings = { ...raw.mappings, 'unknown-source': [] };
    const m = migrateProject(raw);
    expect(m.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(m.settings.defaultOverwrite).toBe('skip');
    expect(m.redoStack).toEqual([]);
    expect(Object.keys(m.mappings)).toEqual(p.sources.map((s) => s.id));
    expect(m.target.rows).toEqual(p.target.rows);
  });
});
