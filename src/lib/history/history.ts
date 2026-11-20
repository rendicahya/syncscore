import { cellToText, nowIso, valuesEqual } from '../domain/cells';
import { applyCellValues, getCell, restoreSnapshot, snapshotDataset } from '../domain/dataset';
import { getDataset, replaceDataset } from '../domain/project';
import type {
  CellChange,
  CellValue,
  Dataset,
  DatasetSnapshot,
  EditOperation,
  Operation,
  Project,
  StructureOperation,
} from '../domain/types';

/** Appends an operation to the history. A new user action clears the redo stack. */
export function recordOperation(project: Project, op: Operation): Project {
  return { ...project, history: [...project.history, op], redoStack: [] };
}

export type Direction = 'undo' | 'redo';

export interface CellConflict {
  change: CellChange;
  reason: 'missing' | 'modified';
  current: CellValue;
}

/**
 * - 'check': apply only if there are no conflicts; otherwise report them and change nothing.
 * - 'skip-conflicts': apply non-conflicting cells, leave conflicting cells untouched.
 * - 'force': also overwrite cells modified after the operation (missing cells are always skipped).
 */
export type ConflictMode = 'check' | 'skip-conflicts' | 'force';

export interface HistoryResult {
  project: Project;
  /** False when nothing was changed (blocked or conflicts in 'check' mode). */
  applied: boolean;
  cellsChanged: number;
  conflicts: CellConflict[];
  /** Reason the operation cannot be undone/redone at all. */
  blocked?: string;
}

function strictlyEqual(a: CellValue | undefined, b: CellValue | undefined): boolean {
  return valuesEqual(a, b) && cellToText(a ?? null) === cellToText(b ?? null);
}

function contentKey(snap: DatasetSnapshot): string {
  return JSON.stringify({
    c: snap.columns.map((c) => [c.id, c.name]),
    r: snap.rows.map((r) => [
      r.id,
      Object.keys(r.cells)
        .sort()
        .map((k) => [k, r.cells[k]]),
    ]),
  });
}

/** Whether a dataset's content equals a snapshot (ignores UI-only properties such as widths). */
export function datasetMatchesSnapshot(ds: Dataset, snap: DatasetSnapshot): boolean {
  return contentKey(snapshotDataset(ds)) === contentKey(snap);
}

function applyCellOperation(
  project: Project,
  changes: CellChange[],
  direction: Direction,
  mode: ConflictMode,
): { project: Project; cellsChanged: number; conflicts: CellConflict[]; applied: boolean } {
  const conflicts: CellConflict[] = [];
  const toApply = new Map<string, { rowId: string; columnId: string; value: CellValue }[]>();
  for (const change of changes) {
    const ds = getDataset(project, change.datasetId);
    const from = direction === 'undo' ? change.after : change.before;
    const to = direction === 'undo' ? change.before : change.after;
    const current = ds ? getCell(ds, change.rowId, change.columnId) : undefined;
    if (!ds || current === undefined) {
      conflicts.push({ change, reason: 'missing', current: null });
      continue;
    }
    if (strictlyEqual(current, to)) continue; // already in the desired state
    if (!strictlyEqual(current, from)) {
      conflicts.push({ change, reason: 'modified', current });
      if (mode !== 'force') continue;
    }
    const list = toApply.get(ds.id) ?? [];
    list.push({ rowId: change.rowId, columnId: change.columnId, value: to });
    toApply.set(ds.id, list);
  }
  if (mode === 'check' && conflicts.length > 0) {
    return { project, cellsChanged: 0, conflicts, applied: false };
  }
  let next = project;
  let cellsChanged = 0;
  for (const [dsId, list] of toApply) {
    const ds = getDataset(next, dsId);
    if (!ds) continue;
    next = replaceDataset(next, applyCellValues(ds, list));
    cellsChanged += list.length;
  }
  return { project: next, cellsChanged, conflicts, applied: true };
}

function applyStructureOperation(
  project: Project,
  op: StructureOperation,
  direction: Direction,
): { project: Project; blocked?: string } {
  const ds = getDataset(project, op.datasetId);
  if (!ds) return { project, blocked: 'Dataset untuk operasi ini sudah tidak ada.' };
  const expected = direction === 'undo' ? op.after : op.before;
  const restore = direction === 'undo' ? op.before : op.after;
  if (!datasetMatchesSnapshot(ds, expected)) {
    return {
      project,
      blocked:
        direction === 'undo'
          ? `"${ds.name}" telah diubah setelah operasi ini. Batalkan dulu perubahan yang lebih baru agar data lain tidak hilang.`
          : `"${ds.name}" telah diubah sejak operasi ini dibatalkan, sehingga tidak dapat diulang dengan aman.`,
    };
  }
  // Keep current column widths where columns still exist (UI preference only).
  // Identity column choices are settings, not content: keep the current ones if still valid.
  const widths = new Map(ds.columns.map((c) => [c.id, c.width] as const));
  const restoredIds = new Set(restore.columns.map((c) => c.id));
  const restored = restoreSnapshot(ds, {
    ...restore,
    columns: restore.columns.map((c) => (widths.get(c.id) ? { ...c, width: widths.get(c.id) } : c)),
    nimColumnId: ds.nimColumnId && restoredIds.has(ds.nimColumnId) ? ds.nimColumnId : restore.nimColumnId,
    nameColumnId: ds.nameColumnId && restoredIds.has(ds.nameColumnId) ? ds.nameColumnId : restore.nameColumnId,
  });
  return { project: replaceDataset(project, restored) };
}

function setStatus(project: Project, opId: string, direction: Direction): Project {
  const history = project.history.map((op) =>
    op.id === opId
      ? ({ ...op, status: direction === 'undo' ? 'undone' : 'applied', statusChangedAt: nowIso() } as Operation)
      : op,
  );
  const redoStack = project.redoStack.filter((id) => id !== opId);
  if (direction === 'undo') redoStack.push(opId);
  return { ...project, history, redoStack };
}

/**
 * Undoes or redoes a single operation (selective undo).
 * Cells changed by later operations are reported as conflicts and never overwritten
 * silently. Structural operations are only reversible when nothing changed after them.
 */
export function runHistory(
  project: Project,
  opId: string,
  direction: Direction,
  mode: ConflictMode = 'check',
): HistoryResult {
  const op = project.history.find((o) => o.id === opId);
  if (!op) return { project, applied: false, cellsChanged: 0, conflicts: [], blocked: 'Operasi tidak ditemukan.' };
  if (direction === 'undo' && op.status !== 'applied') {
    return { project, applied: false, cellsChanged: 0, conflicts: [], blocked: 'Operasi ini sudah dibatalkan.' };
  }
  if (direction === 'redo' && op.status !== 'undone') {
    return { project, applied: false, cellsChanged: 0, conflicts: [], blocked: 'Operasi ini masih aktif.' };
  }
  if (op.type === 'structure') {
    const r = applyStructureOperation(project, op, direction);
    if (r.blocked) return { project, applied: false, cellsChanged: 0, conflicts: [], blocked: r.blocked };
    return { project: setStatus(r.project, op.id, direction), applied: true, cellsChanged: 0, conflicts: [] };
  }
  const r = applyCellOperation(project, op.changes, direction, mode);
  if (!r.applied) return { project, applied: false, cellsChanged: 0, conflicts: r.conflicts };
  return {
    project: setStatus(r.project, op.id, direction),
    applied: true,
    cellsChanged: r.cellsChanged,
    conflicts: r.conflicts,
  };
}

/** The most recent operation that is still applied (target of Ctrl+Z). */
export function latestUndoable(project: Project): Operation | undefined {
  for (let i = project.history.length - 1; i >= 0; i--) {
    if (project.history[i].status === 'applied') return project.history[i];
  }
  return undefined;
}

/** The most recently undone operation that can be redone (target of Ctrl+Y). */
export function latestRedoable(project: Project): Operation | undefined {
  for (let i = project.redoStack.length - 1; i >= 0; i--) {
    const op = project.history.find((o) => o.id === project.redoStack[i]);
    if (op && op.status === 'undone') return op;
  }
  return undefined;
}

export function createEditOperation(datasetId: string, label: string, changes: CellChange[], id: string): EditOperation {
  return { id, type: 'edit', timestamp: nowIso(), label, status: 'applied', datasetId, changes };
}

export function createStructureOperation(
  id: string,
  datasetId: string,
  label: string,
  before: Dataset,
  after: Dataset,
): StructureOperation {
  return {
    id,
    type: 'structure',
    timestamp: nowIso(),
    label,
    status: 'applied',
    datasetId,
    before: snapshotDataset(before),
    after: snapshotDataset(after),
  };
}
