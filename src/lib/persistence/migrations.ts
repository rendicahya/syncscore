import { CURRENT_SCHEMA_VERSION } from '../domain/project';
import type { CellValue, Column, Dataset, Operation, Project, Row } from '../domain/types';

export class MigrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MigrationError';
  }
}

type Obj = Record<string, unknown>;

function isObj(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}

function cellValue(v: unknown): CellValue {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  return null;
}

function migrateDataset(raw: unknown, role: 'source' | 'target', label: string): Dataset {
  if (!isObj(raw)) throw new MigrationError(`Data ${label} tidak valid.`);
  if (typeof raw.id !== 'string') throw new MigrationError(`Data ${label} tidak memiliki id.`);
  const columns: Column[] = (Array.isArray(raw.columns) ? raw.columns : []).map((c, i) => {
    if (!isObj(c) || typeof c.id !== 'string') throw new MigrationError(`Kolom ke-${i + 1} pada ${label} tidak valid.`);
    const col: Column = { id: c.id, name: str(c.name, `Kolom ${i + 1}`) };
    if (typeof c.width === 'number' && c.width > 0) col.width = c.width;
    return col;
  });
  const colIds = new Set(columns.map((c) => c.id));
  const rows: Row[] = (Array.isArray(raw.rows) ? raw.rows : []).map((r, i) => {
    if (!isObj(r) || typeof r.id !== 'string') throw new MigrationError(`Baris ke-${i + 1} pada ${label} tidak valid.`);
    const cells: Record<string, CellValue> = {};
    if (isObj(r.cells)) {
      for (const [k, v] of Object.entries(r.cells)) {
        const cv = cellValue(v);
        if (cv !== null && colIds.has(k)) cells[k] = cv;
      }
    }
    return { id: r.id, cells };
  });
  const nim = typeof raw.nimColumnId === 'string' && colIds.has(raw.nimColumnId) ? raw.nimColumnId : null;
  const name = typeof raw.nameColumnId === 'string' && colIds.has(raw.nameColumnId) ? raw.nameColumnId : null;
  return {
    id: raw.id,
    name: str(raw.name, role === 'target' ? 'Target' : 'Sumber'),
    role,
    columns,
    rows,
    nimColumnId: nim,
    nameColumnId: name,
    origins: Array.isArray(raw.origins) ? (raw.origins as Dataset['origins']) : [],
    importWarnings: Array.isArray(raw.importWarnings) ? (raw.importWarnings as Dataset['importWarnings']) : [],
    revision: typeof raw.revision === 'number' ? raw.revision : 0,
  };
}

/**
 * Upgrades a stored or backed-up project to the current schema.
 * Each schema version gets its own step; data is never dropped silently.
 */
export function migrateProject(raw: unknown): Project {
  if (!isObj(raw)) throw new MigrationError('Data proyek tidak valid.');
  const version = typeof raw.schemaVersion === 'number' ? raw.schemaVersion : 1;
  if (version > CURRENT_SCHEMA_VERSION) {
    throw new MigrationError(
      `Proyek ini dibuat oleh versi SyncScore yang lebih baru (skema ${version}). Perbarui aplikasi (muat ulang halaman) lalu coba lagi.`,
    );
  }
  let data: Obj = { ...raw };

  // --- Future migrations go here, e.g.:
  // if (version < 2) data = migrateV1toV2(data);

  if (typeof data.id !== 'string') throw new MigrationError('Proyek tidak memiliki id.');
  const target = migrateDataset(data.target, 'target', 'Target');
  const sources = (Array.isArray(data.sources) ? data.sources : []).map((s, i) =>
    migrateDataset(s, 'source', `Sumber ${i + 1}`),
  );
  const sourceIds = new Set(sources.map((s) => s.id));
  const mappings: Project['mappings'] = {};
  if (isObj(data.mappings)) {
    for (const [k, v] of Object.entries(data.mappings)) {
      if (!sourceIds.has(k) || !Array.isArray(v)) continue;
      mappings[k] = v
        .filter((p): p is Obj => isObj(p) && typeof p.sourceColumnId === 'string' && typeof p.targetColumnId === 'string')
        .map((p) => ({ sourceColumnId: p.sourceColumnId as string, targetColumnId: p.targetColumnId as string }));
    }
  }
  for (const s of sources) if (!mappings[s.id]) mappings[s.id] = [];
  const settings = isObj(data.settings) ? data.settings : {};
  data = {
    ...data,
    schemaVersion: CURRENT_SCHEMA_VERSION,
  };
  const history = Array.isArray(data.history) ? (data.history as Operation[]).filter((op) => isObj(op) && typeof op.id === 'string') : [];
  const historyIds = new Set(history.map((h) => h.id));
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: data.id as string,
    name: str(data.name, 'Proyek tanpa nama'),
    createdAt: str(data.createdAt, new Date().toISOString()),
    updatedAt: str(data.updatedAt, new Date().toISOString()),
    target,
    sources,
    activeSourceId:
      typeof data.activeSourceId === 'string' && sourceIds.has(data.activeSourceId)
        ? data.activeSourceId
        : (sources[0]?.id ?? null),
    mappings,
    manualMatches: Array.isArray(data.manualMatches)
      ? (data.manualMatches as Project['manualMatches']).filter((m) => isObj(m) && sourceIds.has(m.sourceDatasetId))
      : [],
    nameApprovals: Array.isArray(data.nameApprovals)
      ? (data.nameApprovals as Project['nameApprovals']).filter((a) => isObj(a) && sourceIds.has(a.sourceDatasetId))
      : [],
    history,
    redoStack: Array.isArray(data.redoStack)
      ? (data.redoStack as unknown[]).filter((id): id is string => typeof id === 'string' && historyIds.has(id))
      : [],
    settings: { defaultOverwrite: settings.defaultOverwrite === 'ask' ? 'ask' : 'skip' },
  };
}
