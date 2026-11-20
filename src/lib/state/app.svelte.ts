import { createId, nowIso } from '../domain/cells';
import {
  applyCellValues,
  applyImportedTable,
  applyPositionalEdits,
  deleteColumns,
  deleteRows,
  insertColumns,
  insertRows,
  renameColumn,
  setColumnWidth,
  type PositionalEdit,
  type TableData,
} from '../domain/dataset';
import { addSource, createProject, getDataset, removeSource, replaceDataset } from '../domain/project';
import type {
  CellChange,
  ColumnPair,
  Dataset,
  ImportOrigin,
  ImportWarning,
  ManualMatch,
  NameApproval,
  Operation,
  Project,
  ProjectSummary,
  SyncOperation,
} from '../domain/types';
import {
  createEditOperation,
  createStructureOperation,
  latestRedoable,
  latestUndoable,
  recordOperation,
  runHistory,
  type ConflictMode,
  type Direction,
} from '../history/history';
import { nimText } from '../matching/identity';
import { matchDatasets, validateManualPair, type MatchPair, type MatchResult } from '../matching/engine';
import { backupFileName, createBackup, parseBackup } from '../persistence/backup';
import { ProjectRepository, SyncScoreDB } from '../persistence/db';
import {
  applySyncPlan,
  buildSyncPlan,
  cellKey,
  findRepeatedMappings,
  SyncError,
  type SyncPlan,
  type SyncRequest,
} from '../sync/engine';
import { downloadBlob } from '../utils';
import { ui } from './ui.svelte';

const LAST_PROJECT_KEY = 'lastProjectId';
const SAVE_DELAY_MS = 400;

export type SaveState = 'idle' | 'saving' | 'saved' | 'error';

function errorMessage(e: unknown, fallback: string): string {
  // Error messages produced by SyncScore never contain student data.
  if (e instanceof Error && (e.name === 'SyncError' || e.name === 'MigrationError' || e.name === 'ImportError')) {
    return e.message;
  }
  return fallback;
}

class AppState {
  private repo: ProjectRepository | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingSave: Project | null = null;

  ready = $state(false);
  storageError = $state<string | null>(null);
  project = $state.raw<Project | null>(null);
  projects = $state.raw<ProjectSummary[]>([]);
  saveState = $state<SaveState>('idle');
  preview = $state.raw<SyncPlan | null>(null);

  activeSource: Dataset | null = $derived(
    this.project ? (this.project.sources.find((s) => s.id === this.project!.activeSourceId) ?? null) : null,
  );

  /** Matching results for every Source dataset (recomputed on change). */
  matches: Map<string, MatchResult> = $derived.by(() => {
    const p = this.project;
    const out = new Map<string, MatchResult>();
    if (!p) return out;
    for (const s of p.sources) out.set(s.id, matchDatasets(s, p.target, p.manualMatches, p.nameApprovals));
    return out;
  });

  activeMatch: MatchResult | null = $derived(this.activeSource ? (this.matches.get(this.activeSource.id) ?? null) : null);

  /** Target cells changed by applied synchronization operations. */
  changedTargetCells: Set<string> = $derived.by(() => {
    const set = new Set<string>();
    const p = this.project;
    if (!p) return set;
    for (const op of p.history) {
      if (op.type === 'sync' && op.status === 'applied') for (const c of op.changes) set.add(cellKey(c.rowId, c.columnId));
    }
    return set;
  });

  undoTarget: Operation | undefined = $derived(this.project ? latestUndoable(this.project) : undefined);
  redoTarget: Operation | undefined = $derived(this.project ? latestRedoable(this.project) : undefined);

  // ---------------------------------------------------------------- lifecycle

  async init(): Promise<void> {
    try {
      const db = new SyncScoreDB();
      await db.open();
      this.repo = new ProjectRepository(db);
      this.projects = await this.repo.list();
      const lastId = await this.repo.getMeta<string>(LAST_PROJECT_KEY);
      const toOpen = this.projects.find((p) => p.id === lastId) ?? this.projects[0];
      if (toOpen) {
        await this.openProject(toOpen.id);
      } else {
        await this.newProject('Proyek pertama');
      }
    } catch (e) {
      this.storageError =
        'Penyimpanan lokal (IndexedDB) tidak tersedia di browser ini, misalnya karena mode privat atau pengaturan keamanan. Anda tetap dapat bekerja, tetapi data tidak tersimpan otomatis — gunakan ekspor cadangan.';
      if (!this.project) this.project = createProject('Proyek sementara');
      void e;
    } finally {
      this.ready = true;
    }
    window.addEventListener('beforeunload', () => void this.flushSave());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') void this.flushSave();
    });
  }

  private scheduleSave(project: Project): void {
    if (!this.repo) return;
    this.pendingSave = project;
    this.saveState = 'saving';
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => void this.flushSave(), SAVE_DELAY_MS);
  }

  async flushSave(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    const p = this.pendingSave;
    if (!p || !this.repo) return;
    this.pendingSave = null;
    try {
      const saved = await this.repo.save(p);
      this.projects = upsertSummary(this.projects, saved);
      this.saveState = this.pendingSave ? 'saving' : 'saved';
    } catch {
      this.saveState = 'error';
      ui.toast('error', 'Gagal menyimpan proyek', 'Penyimpanan browser mungkin penuh. Ekspor cadangan untuk mengamankan data Anda.');
    }
  }

  /** Replaces the current project and schedules an automatic save. */
  private commit(next: Project): void {
    this.project = next;
    this.scheduleSave(next);
  }

  private get p(): Project {
    if (!this.project) throw new Error('no-project');
    return this.project;
  }

  // ---------------------------------------------------------------- projects

  async newProject(name: string): Promise<void> {
    await this.flushSave();
    const p = createProject(name.trim() || 'Proyek baru');
    this.project = p;
    this.preview = null;
    if (this.repo) {
      const saved = await this.repo.save(p);
      this.projects = upsertSummary(this.projects, saved);
      await this.repo.setMeta(LAST_PROJECT_KEY, p.id);
      this.saveState = 'saved';
    }
  }

  async openProject(id: string): Promise<void> {
    if (!this.repo) return;
    await this.flushSave();
    try {
      const p = await this.repo.load(id);
      if (!p) {
        ui.toast('error', 'Proyek tidak ditemukan');
        return;
      }
      this.project = p;
      this.preview = null;
      this.saveState = 'saved';
      await this.repo.setMeta(LAST_PROJECT_KEY, id);
    } catch (e) {
      ui.toast('error', 'Proyek tidak dapat dibuka', errorMessage(e, 'Data proyek rusak atau tidak dikenali. Data tidak diubah.'));
    }
  }

  renameProject(name: string): void {
    const n = name.trim();
    if (!n || !this.project) return;
    this.commit({ ...this.p, name: n });
  }

  async renameProjectById(id: string, name: string): Promise<void> {
    if (this.project?.id === id) return this.renameProject(name);
    if (!this.repo) return;
    await this.repo.rename(id, name.trim());
    this.projects = await this.repo.list();
  }

  async deleteProject(id: string): Promise<void> {
    if (!this.repo) return;
    const isCurrent = this.project?.id === id;
    if (isCurrent) {
      if (this.saveTimer) clearTimeout(this.saveTimer);
      this.pendingSave = null;
    }
    await this.repo.remove(id);
    this.projects = await this.repo.list();
    if (isCurrent) {
      if (this.projects[0]) await this.openProject(this.projects[0].id);
      else await this.newProject('Proyek baru');
    }
  }

  exportBackup(project: Project = this.p): void {
    downloadBlob(createBackup(project), backupFileName(project), 'application/json');
  }

  async exportBackupById(id: string): Promise<void> {
    if (this.project?.id === id) return this.exportBackup();
    const p = await this.repo?.load(id);
    if (p) this.exportBackup(p);
  }

  async importBackup(file: File): Promise<void> {
    try {
      const project = parseBackup(await file.text());
      if (!this.repo) {
        this.project = project;
        ui.toast('warning', 'Cadangan dibuka tanpa penyimpanan', 'Penyimpanan lokal tidak tersedia.');
        return;
      }
      const saved = await this.repo.importCopy(project);
      this.projects = await this.repo.list();
      await this.openProject(saved.id);
      ui.toast('success', 'Cadangan berhasil diimpor', `Proyek "${saved.name}" ditambahkan sebagai salinan baru.`);
    } catch (e) {
      ui.toast('error', 'Cadangan tidak dapat diimpor', errorMessage(e, 'Berkas tidak valid.'));
    }
  }

  async clearAllData(): Promise<void> {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.pendingSave = null;
    if (this.repo) await this.repo.clearAll();
    this.projects = [];
    this.project = null;
    this.preview = null;
    await this.newProject('Proyek baru');
    ui.toast('success', 'Semua data lokal SyncScore telah dihapus');
  }

  // ---------------------------------------------------------------- datasets

  setActiveSource(id: string): void {
    if (this.project && this.project.activeSourceId !== id) this.commit({ ...this.p, activeSourceId: id });
  }

  addSource(): string {
    const { project, source } = addSource(this.p);
    this.commit(project);
    return source.id;
  }

  async removeSource(id: string): Promise<void> {
    const s = this.p.sources.find((x) => x.id === id);
    if (!s) return;
    const ok = await ui.confirmAction({
      title: 'Hapus dataset Sumber?',
      message: `Dataset "${s.name}" beserta pemetaan kolom dan pasangan manualnya akan dihapus dari proyek. Riwayat sinkronisasi tetap disimpan. Tindakan ini tidak dapat dibatalkan.`,
      confirmLabel: 'Hapus dataset',
      destructive: true,
    });
    if (ok) this.commit(removeSource(this.p, id));
  }

  renameDataset(id: string, name: string): void {
    const ds = getDataset(this.p, id);
    const n = name.trim();
    if (!ds || !n || ds.name === n) return;
    this.commit(replaceDataset(this.p, { ...ds, name: n }));
  }

  setIdentityColumn(datasetId: string, kind: 'nim' | 'name', columnId: string | null): void {
    const ds = getDataset(this.p, datasetId);
    if (!ds) return;
    const next: Dataset =
      kind === 'nim'
        ? { ...ds, nimColumnId: columnId, nameColumnId: ds.nameColumnId === columnId ? null : ds.nameColumnId }
        : { ...ds, nameColumnId: columnId, nimColumnId: ds.nimColumnId === columnId ? null : ds.nimColumnId };
    this.commit(replaceDataset(this.p, { ...next, revision: ds.revision + 1 }));
  }

  private recordStructure(before: Dataset, after: Dataset, label: string): void {
    const op = createStructureOperation(createId(), before.id, label, before, after);
    this.commit(recordOperation(replaceDataset(this.p, after), op));
  }

  private recordEdit(after: Dataset, changes: CellChange[], label: string): void {
    const op = createEditOperation(after.id, label, changes, createId());
    this.commit(recordOperation(replaceDataset(this.p, after), op));
  }

  /** Edits from the spreadsheet (typing, paste, clear). */
  applyGridEdits(datasetId: string, edits: PositionalEdit[], label: string): boolean {
    const ds = getDataset(this.p, datasetId);
    if (!ds) return false;
    const res = applyPositionalEdits(ds, edits);
    if (res.dataset === ds) return false;
    if (res.structural) this.recordStructure(ds, res.dataset, label);
    else this.recordEdit(res.dataset, res.changes, label);
    return true;
  }

  /** Edits a single cell by id (used by the matching panel to fix NIM/name). */
  editCell(datasetId: string, rowId: string, columnId: string, value: string, label: string): void {
    const ds = getDataset(this.p, datasetId);
    if (!ds) return;
    const row = ds.rows.find((r) => r.id === rowId);
    if (!row) return;
    const before = row.cells[columnId] ?? null;
    const after = value === '' ? null : value;
    if (before === after) return;
    const next = applyCellValues(ds, [{ rowId, columnId, value: after }]);
    this.recordEdit(next, [{ datasetId, rowId, columnId, before, after }], label);
  }

  insertRows(datasetId: string, index: number, count: number): void {
    const ds = getDataset(this.p, datasetId);
    if (!ds) return;
    this.recordStructure(ds, insertRows(ds, index, count), count === 1 ? 'Tambah baris' : `Tambah ${count} baris`);
  }

  async deleteRows(datasetId: string, rowIds: string[]): Promise<void> {
    const ds = getDataset(this.p, datasetId);
    if (!ds || rowIds.length === 0) return;
    const ok = await ui.confirmAction({
      title: `Hapus ${rowIds.length} baris?`,
      message: `${rowIds.length} baris dari "${ds.name}" akan dihapus. Anda dapat membatalkannya dengan Undo selama data belum diubah lagi.`,
      confirmLabel: 'Hapus baris',
      destructive: true,
    });
    if (!ok) return;
    this.recordStructure(ds, deleteRows(ds, rowIds), `Hapus ${rowIds.length} baris`);
  }

  insertColumns(datasetId: string, index: number, count: number): void {
    const ds = getDataset(this.p, datasetId);
    if (!ds) return;
    this.recordStructure(ds, insertColumns(ds, index, count), count === 1 ? 'Tambah kolom' : `Tambah ${count} kolom`);
  }

  async deleteColumns(datasetId: string, columnIds: string[]): Promise<void> {
    const ds = getDataset(this.p, datasetId);
    if (!ds || columnIds.length === 0) return;
    const names = ds.columns.filter((c) => columnIds.includes(c.id)).map((c) => c.name);
    const identity = columnIds.includes(ds.nimColumnId ?? '') || columnIds.includes(ds.nameColumnId ?? '');
    const ok = await ui.confirmAction({
      title: `Hapus ${columnIds.length} kolom?`,
      message: `Kolom ${names.map((n) => `"${n}"`).join(', ')} beserta isinya akan dihapus.${identity ? ' Kolom ini adalah kolom identitas (NIM/nama); pencocokan perlu dikonfigurasi ulang.' : ''}`,
      confirmLabel: 'Hapus kolom',
      destructive: true,
    });
    if (!ok) return;
    this.recordStructure(ds, deleteColumns(ds, columnIds), `Hapus kolom ${names.join(', ')}`);
    // Remove mapping pairs that referenced deleted columns.
    const p = this.p;
    const set = new Set(columnIds);
    const mappings: Project['mappings'] = {};
    for (const [k, pairs] of Object.entries(p.mappings)) {
      mappings[k] = pairs.filter((x) => !set.has(x.sourceColumnId) && !set.has(x.targetColumnId));
    }
    this.commit({ ...p, mappings });
  }

  renameColumn(datasetId: string, columnId: string, name: string): void {
    const ds = getDataset(this.p, datasetId);
    if (!ds) return;
    const col = ds.columns.find((c) => c.id === columnId);
    if (!col || !name.trim() || col.name === name.trim()) return;
    this.recordStructure(ds, renameColumn(ds, columnId, name), `Ganti nama kolom "${col.name}" → "${name.trim()}"`);
  }

  setColumnWidth(datasetId: string, columnId: string, width: number): void {
    const ds = getDataset(this.p, datasetId);
    if (!ds) return;
    this.commit(replaceDataset(this.p, setColumnWidth(ds, columnId, width)));
  }

  importTable(
    datasetId: string,
    table: TableData,
    opts: {
      mode: 'replace' | 'append';
      origin: Omit<ImportOrigin, 'mode' | 'rowCount' | 'importedAt'>;
      warnings?: ImportWarning[];
      columnWarnings?: { headerIndex: number; warning: Omit<ImportWarning, 'columnId'> }[];
    },
  ): void {
    const ds = getDataset(this.p, datasetId);
    if (!ds) return;
    const next = applyImportedTable(ds, table, { ...opts, importedAt: nowIso() });
    const src = opts.origin.kind === 'xlsx' ? `${opts.origin.fileName ?? 'XLSX'}${opts.origin.sheetName ? ` (${opts.origin.sheetName})` : ''}` : 'data tempel';
    const label = `${opts.mode === 'replace' ? 'Impor' : 'Tambahkan'} ${src} ke "${ds.name}"`;
    let project = recordOperation(replaceDataset(this.p, next), createStructureOperation(createId(), ds.id, label, ds, next));
    if (opts.mode === 'replace') {
      // Old column ids are gone: drop mappings, manual matches and approvals that referenced them.
      project = pruneReferences(project);
    }
    this.commit(project);
  }

  /** Converts numeric NIM cells to text (no value change), recorded as an edit. */
  convertNimToText(datasetId: string): number {
    const ds = getDataset(this.p, datasetId);
    if (!ds || !ds.nimColumnId) return 0;
    const colId = ds.nimColumnId;
    const changes: CellChange[] = [];
    for (const r of ds.rows) {
      const v = r.cells[colId];
      if (typeof v === 'number' && Number.isSafeInteger(v)) {
        changes.push({ datasetId: ds.id, rowId: r.id, columnId: colId, before: v, after: String(v) });
      }
    }
    if (!changes.length) return 0;
    const next = applyCellValues(
      ds,
      changes.map((c) => ({ rowId: c.rowId, columnId: c.columnId, value: c.after })),
    );
    this.recordEdit(next, changes, 'Ubah NIM angka menjadi teks');
    return changes.length;
  }

  // ---------------------------------------------------------------- mapping & matching

  setMapping(sourceId: string, pairs: ColumnPair[]): void {
    this.commit({ ...this.p, mappings: { ...this.p.mappings, [sourceId]: pairs } });
  }

  async addManualMatch(sourceId: string, sourceRowId: string, targetRowId: string): Promise<boolean> {
    const p = this.p;
    const source = p.sources.find((s) => s.id === sourceId);
    const match = this.matches.get(sourceId);
    if (!source || !match) return false;
    const err = validateManualPair(match, sourceRowId, targetRowId);
    if (err) {
      ui.toast('error', 'Pasangan tidak dapat dibuat', err);
      return false;
    }
    const sRow = source.rows.find((r) => r.id === sourceRowId)!;
    const tRow = p.target.rows.find((r) => r.id === targetRowId)!;
    const get = (ds: Dataset, row: typeof sRow, col: string | null) => (col ? nimText(row.cells[col]) : '');
    const m: ManualMatch = {
      id: createId(),
      sourceDatasetId: sourceId,
      sourceRowId,
      targetRowId,
      createdAt: nowIso(),
      sourceNim: get(source, sRow, source.nimColumnId),
      targetNim: get(p.target, tRow, p.target.nimColumnId),
      sourceName: get(source, sRow, source.nameColumnId),
      targetName: get(p.target, tRow, p.target.nameColumnId),
    };
    const ok = await ui.confirmAction({
      title: 'Konfirmasi pasangan manual',
      message: 'Pastikan kedua baris ini adalah mahasiswa yang sama. Nilai dari baris Sumber akan dapat disinkronkan ke baris Target ini.',
      details: [
        `Sumber: ${m.sourceNim || '(NIM kosong)'} — ${m.sourceName || '(nama kosong)'}`,
        `Target: ${m.targetNim || '(NIM kosong)'} — ${m.targetName || '(nama kosong)'}`,
      ],
      confirmLabel: 'Ya, pasangkan',
    });
    if (!ok) return false;
    this.commit({ ...p, manualMatches: [...p.manualMatches, m] });
    ui.toast('success', 'Pasangan manual dikonfirmasi');
    return true;
  }

  removeManualMatch(id: string): void {
    this.commit({ ...this.p, manualMatches: this.p.manualMatches.filter((m) => m.id !== id) });
  }

  async approveNameMismatch(sourceId: string, pair: MatchPair): Promise<void> {
    const p = this.p;
    const source = p.sources.find((s) => s.id === sourceId);
    if (!source) return;
    const sRow = source.rows.find((r) => r.id === pair.sourceRowId);
    const tRow = p.target.rows.find((r) => r.id === pair.targetRowId);
    if (!sRow || !tRow) return;
    const sName = source.nameColumnId ? String(sRow.cells[source.nameColumnId] ?? '') : '';
    const tName = p.target.nameColumnId ? String(tRow.cells[p.target.nameColumnId] ?? '') : '';
    const ok = await ui.confirmAction({
      title: 'Setujui perbedaan nama?',
      message: `NIM ${pair.nim} cocok, tetapi namanya berbeda. Setujui hanya jika Anda yakin ini mahasiswa yang sama.`,
      details: [`Sumber: ${sName}`, `Target: ${tName}`],
      confirmLabel: 'Setujui',
    });
    if (!ok) return;
    const approval: NameApproval = {
      id: createId(),
      sourceDatasetId: sourceId,
      sourceRowId: pair.sourceRowId,
      targetRowId: pair.targetRowId,
      sourceName: sName,
      targetName: tName,
      approvedAt: nowIso(),
    };
    this.commit({ ...p, nameApprovals: [...p.nameApprovals, approval] });
  }

  revokeApproval(id: string): void {
    this.commit({ ...this.p, nameApprovals: this.p.nameApprovals.filter((a) => a.id !== id) });
  }

  // ---------------------------------------------------------------- synchronization

  createPreview(requests: SyncRequest[]): SyncPlan {
    const p = this.p;
    const plan = buildSyncPlan(
      { target: p.target, sources: p.sources, manualMatches: p.manualMatches, nameApprovals: p.nameApprovals },
      requests,
    );
    this.preview = plan;
    return plan;
  }

  closePreview(): void {
    this.preview = null;
  }

  /** Applies the current preview. Returns the operation, or null if cancelled/failed (nothing changed). */
  async applyPreview(approvedOverwrites: ReadonlySet<string>): Promise<SyncOperation | null> {
    const plan = this.preview;
    if (!plan) return null;
    const p = this.p;
    const requests = plan.sources.map((s) => ({ sourceDatasetId: s.sourceDatasetId, pairs: s.pairs }));
    const syncOps = p.history.filter((o): o is SyncOperation => o.type === 'sync');
    const repeated = findRepeatedMappings(syncOps, requests);
    if (repeated.length) {
      const ok = await ui.confirmAction({
        title: 'Pemetaan ini sudah pernah diterapkan',
        message:
          'Pemetaan kolom yang sama sudah pernah disinkronkan. Menerapkannya lagi akan dicatat sebagai operasi baru dalam riwayat. Lanjutkan?',
        details: repeated.slice(-3).map((o) => `${new Date(o.timestamp).toLocaleString('id-ID')}: ${o.label}`),
        confirmLabel: 'Terapkan lagi',
      });
      if (!ok) return null;
    }
    try {
      const { target, operation } = applySyncPlan(
        { target: p.target, sources: p.sources, manualMatches: p.manualMatches, nameApprovals: p.nameApprovals },
        plan,
        { approvedOverwrites },
      );
      this.commit(recordOperation(replaceDataset(p, target), operation));
      this.preview = null;
      ui.toast(
        'success',
        'Sinkronisasi diterapkan',
        `${operation.stats.filled} sel diisi, ${operation.stats.overwritten} ditimpa, ${operation.stats.skippedEmpty} dilewati (kosong).`,
      );
      return operation;
    } catch (e) {
      ui.toast('error', 'Sinkronisasi tidak diterapkan', errorMessage(e, 'Terjadi kesalahan; tidak ada data yang diubah.'));
      if (e instanceof SyncError && /berubah/.test(e.message)) this.preview = null;
      return null;
    }
  }

  // ---------------------------------------------------------------- history

  async runHistory(direction: Direction, opId?: string): Promise<void> {
    const p = this.project;
    if (!p) return;
    const op = opId ? p.history.find((o) => o.id === opId) : direction === 'undo' ? latestUndoable(p) : latestRedoable(p);
    if (!op) return;
    const verb = direction === 'undo' ? 'dibatalkan' : 'diulang';
    let mode: ConflictMode = 'check';
    let res = runHistory(p, op.id, direction, mode);
    if (res.blocked) {
      ui.toast('error', `Operasi tidak dapat ${verb}`, res.blocked);
      return;
    }
    if (!res.applied && res.conflicts.length) {
      const modified = res.conflicts.filter((c) => c.reason === 'modified').length;
      const missing = res.conflicts.filter((c) => c.reason === 'missing').length;
      const details: string[] = [];
      if (modified) details.push(`${modified} sel telah diubah lagi setelah operasi ini.`);
      if (missing) details.push(`${missing} sel sudah tidak ada (baris/kolom dihapus) dan akan dilewati.`);
      const answer = await ui.ask({
        title: `Konflik saat operasi ${verb}`,
        message: `"${op.label}" menyentuh sel yang sudah berubah. Pilih cara melanjutkan:`,
        details,
        altLabel: modified ? 'Lewati sel yang berubah' : undefined,
        confirmLabel: modified ? 'Timpa juga sel yang berubah' : 'Lanjutkan',
        destructive: modified > 0,
      });
      if (answer === 'cancel') return;
      mode = answer === 'alt' || !modified ? 'skip-conflicts' : 'force';
      res = runHistory(p, op.id, direction, mode);
    }
    if (!res.applied) return;
    this.commit(res.project);
    ui.toast('info', direction === 'undo' ? 'Dibatalkan' : 'Diulang', op.label);
  }

  // ---------------------------------------------------------------- helpers

  datasetById(id: string): Dataset | undefined {
    return this.project ? getDataset(this.project, id) : undefined;
  }
}

function upsertSummary(list: ProjectSummary[], p: Project): ProjectSummary[] {
  const s: ProjectSummary = { id: p.id, name: p.name, createdAt: p.createdAt, updatedAt: p.updatedAt };
  const rest = list.filter((x) => x.id !== p.id);
  return [s, ...rest].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/**
 * Removes column-mapping pairs that reference columns that no longer exist.
 * Manual matches and name approvals are kept on purpose: if the import is undone
 * the rows come back and the confirmations become valid again; meanwhile the
 * matching engine reports them as stale.
 */
function pruneReferences(p: Project): Project {
  const targetCols = new Set(p.target.columns.map((c) => c.id));
  const mappings: Project['mappings'] = {};
  for (const s of p.sources) {
    const cols = new Set(s.columns.map((c) => c.id));
    mappings[s.id] = (p.mappings[s.id] ?? []).filter((x) => cols.has(x.sourceColumnId) && targetCols.has(x.targetColumnId));
  }
  return { ...p, mappings };
}

export const app = new AppState();
