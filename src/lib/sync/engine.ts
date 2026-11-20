import { createId, isEmptyCell, nowIso, valuesEqual } from '../domain/cells';
import { applyCellValues } from '../domain/dataset';
import type {
  CellChange,
  CellValue,
  ColumnPair,
  Dataset,
  ManualMatch,
  NameApproval,
  SyncOperation,
  SyncSourceSummary,
  SyncStats,
} from '../domain/types';
import { matchDatasets, type MatchResult } from '../matching/engine';

export interface SyncRequest {
  sourceDatasetId: string;
  pairs: ColumnPair[];
}

export type PlannedKind = 'fill' | 'overwrite' | 'unchanged';

export interface PlannedCell {
  /** `${targetRowId}|${targetColumnId}` */
  key: string;
  kind: PlannedKind;
  targetRowId: string;
  targetRowIndex: number;
  targetColumnId: string;
  sourceDatasetId: string;
  sourceRowId: string;
  sourceColumnId: string;
  before: CellValue;
  after: CellValue;
  matchKind: 'exact' | 'manual';
  nameApproved: boolean;
}

export interface SkippedCell {
  sourceDatasetId: string;
  sourceRowId: string;
  sourceColumnId: string;
  targetRowId: string;
  targetColumnId: string;
}

export interface ConflictCell {
  key: string;
  targetRowId: string;
  targetRowIndex: number;
  targetColumnId: string;
  candidates: { sourceDatasetId: string; sourceRowId: string; sourceColumnId: string; value: CellValue }[];
}

export interface SourcePlan {
  sourceDatasetId: string;
  sourceName: string;
  pairs: ColumnPair[];
  match: MatchResult;
  /** Matched records that contributed to this plan. */
  processedRecords: number;
}

export interface SyncPlan {
  id: string;
  createdAt: string;
  targetDatasetId: string;
  /** Target revision at planning time; applying a plan to a changed target is refused. */
  targetRevision: number;
  /** Source revisions at planning time. */
  sourceRevisions: Record<string, number>;
  /** Blocking problems. When non-empty, the plan cannot be applied. */
  errors: string[];
  sources: SourcePlan[];
  cells: PlannedCell[];
  skippedEmpty: SkippedCell[];
  conflicts: ConflictCell[];
}

export interface PlanContext {
  target: Dataset;
  sources: Dataset[];
  manualMatches: ManualMatch[];
  nameApprovals: NameApproval[];
}

export function cellKey(rowId: string, columnId: string): string {
  return `${rowId}|${columnId}`;
}

/** Validates a column mapping for one source. Returns Indonesian error messages. */
export function validatePairs(source: Dataset, target: Dataset, pairs: ColumnPair[]): string[] {
  const errors: string[] = [];
  if (pairs.length === 0) errors.push(`Belum ada pemetaan kolom untuk "${source.name}".`);
  const seenTarget = new Set<string>();
  for (const p of pairs) {
    const s = source.columns.find((c) => c.id === p.sourceColumnId);
    const t = target.columns.find((c) => c.id === p.targetColumnId);
    if (!s) errors.push(`Kolom Sumber pada pemetaan "${source.name}" tidak ditemukan (mungkin sudah dihapus).`);
    if (!t) errors.push(`Kolom Target pada pemetaan "${source.name}" tidak ditemukan (mungkin sudah dihapus).`);
    if (t && (t.id === target.nimColumnId || t.id === target.nameColumnId)) {
      errors.push(`Kolom Target "${t.name}" adalah kolom identitas (NIM/nama) dan tidak boleh ditimpa oleh sinkronisasi.`);
    }
    if (t) {
      if (seenTarget.has(t.id)) errors.push(`Kolom Target "${t.name}" dipetakan lebih dari sekali untuk "${source.name}".`);
      seenTarget.add(t.id);
    }
  }
  return errors;
}

/**
 * Builds a synchronization preview. Pure: does not modify any dataset.
 *
 * - Empty Source cells are skipped; 0 is a valid value.
 * - Existing non-empty Target values become 'overwrite' entries (require confirmation).
 * - Equal values become 'unchanged'.
 * - When several sources write different values into the same Target cell, the cell is a
 *   conflict and is excluded from the plan.
 * - Only usable matches (exact with agreeing/approved names, or manual) contribute.
 */
export function buildSyncPlan(ctx: PlanContext, requests: SyncRequest[]): SyncPlan {
  const { target } = ctx;
  const errors: string[] = [];
  const sources: SourcePlan[] = [];
  const targetRowIndex = new Map(target.rows.map((r, i) => [r.id, i] as const));
  const targetRows = new Map(target.rows.map((r) => [r.id, r] as const));
  const sourceRevisions: Record<string, number> = {};

  if (requests.length === 0) errors.push('Pilih minimal satu dataset Sumber untuk disinkronkan.');

  type Candidate = PlannedCell;
  const candidates = new Map<string, Candidate[]>();
  const skippedEmpty: SkippedCell[] = [];

  for (const req of requests) {
    const source = ctx.sources.find((s) => s.id === req.sourceDatasetId);
    if (!source) {
      errors.push('Dataset Sumber tidak ditemukan.');
      continue;
    }
    sourceRevisions[source.id] = source.revision;
    const pairErrors = validatePairs(source, target, req.pairs);
    const match = matchDatasets(source, target, ctx.manualMatches, ctx.nameApprovals);
    errors.push(...pairErrors, ...match.errors);
    const sourceRows = new Map(source.rows.map((r) => [r.id, r] as const));
    let processed = 0;
    if (pairErrors.length === 0 && match.errors.length === 0) {
      for (const pair of match.pairs) {
        if (!pair.usable) continue;
        const sRow = sourceRows.get(pair.sourceRowId);
        const tRow = targetRows.get(pair.targetRowId);
        if (!sRow || !tRow) continue;
        processed += 1;
        for (const cp of req.pairs) {
          const value = sRow.cells[cp.sourceColumnId] ?? null;
          if (isEmptyCell(value)) {
            skippedEmpty.push({
              sourceDatasetId: source.id,
              sourceRowId: sRow.id,
              sourceColumnId: cp.sourceColumnId,
              targetRowId: tRow.id,
              targetColumnId: cp.targetColumnId,
            });
            continue;
          }
          const before = tRow.cells[cp.targetColumnId] ?? null;
          const kind: PlannedKind = isEmptyCell(before) ? 'fill' : valuesEqual(before, value) ? 'unchanged' : 'overwrite';
          const key = cellKey(tRow.id, cp.targetColumnId);
          const entry: PlannedCell = {
            key,
            kind,
            targetRowId: tRow.id,
            targetRowIndex: targetRowIndex.get(tRow.id) ?? -1,
            targetColumnId: cp.targetColumnId,
            sourceDatasetId: source.id,
            sourceRowId: sRow.id,
            sourceColumnId: cp.sourceColumnId,
            before,
            after: value,
            matchKind: pair.kind,
            nameApproved: pair.approvalId !== undefined,
          };
          const list = candidates.get(key) ?? [];
          list.push(entry);
          candidates.set(key, list);
        }
      }
    }
    sources.push({
      sourceDatasetId: source.id,
      sourceName: source.name,
      pairs: req.pairs,
      match,
      processedRecords: processed,
    });
  }

  const cells: PlannedCell[] = [];
  const conflicts: ConflictCell[] = [];
  for (const [key, list] of candidates) {
    const first = list[0];
    const allSame = list.every((c) => valuesEqual(c.after, first.after));
    if (allSame) {
      cells.push(first);
    } else {
      conflicts.push({
        key,
        targetRowId: first.targetRowId,
        targetRowIndex: first.targetRowIndex,
        targetColumnId: first.targetColumnId,
        candidates: list.map((c) => ({
          sourceDatasetId: c.sourceDatasetId,
          sourceRowId: c.sourceRowId,
          sourceColumnId: c.sourceColumnId,
          value: c.after,
        })),
      });
    }
  }
  const order = new Map(target.columns.map((c, i) => [c.id, i] as const));
  const byPosition = (a: { targetRowIndex: number; targetColumnId: string }, b: typeof a) =>
    a.targetRowIndex - b.targetRowIndex || (order.get(a.targetColumnId) ?? 0) - (order.get(b.targetColumnId) ?? 0);
  cells.sort(byPosition);
  conflicts.sort(byPosition);

  return {
    id: createId(),
    createdAt: nowIso(),
    targetDatasetId: target.id,
    targetRevision: target.revision,
    sourceRevisions,
    errors: [...new Set(errors)],
    sources,
    cells,
    skippedEmpty,
    conflicts,
  };
}

export interface PlanCounts {
  fill: number;
  overwrite: number;
  unchanged: number;
  skippedEmpty: number;
  conflicts: number;
  sourceOnly: number;
  targetOnly: number;
  duplicates: number;
  nameMismatches: number;
  processed: number;
}

export function countPlan(plan: SyncPlan): PlanCounts {
  const targetOnly = new Set<string>();
  // A target row counts as unmatched only if no selected source matched it.
  const matchedTargets = new Set<string>();
  for (const s of plan.sources) for (const p of s.match.pairs) matchedTargets.add(p.targetRowId);
  for (const s of plan.sources) for (const r of s.match.targetOnly) if (!matchedTargets.has(r.rowId)) targetOnly.add(r.rowId);
  return {
    fill: plan.cells.filter((c) => c.kind === 'fill').length,
    overwrite: plan.cells.filter((c) => c.kind === 'overwrite').length,
    unchanged: plan.cells.filter((c) => c.kind === 'unchanged').length,
    skippedEmpty: plan.skippedEmpty.length,
    conflicts: plan.conflicts.length,
    sourceOnly: plan.sources.reduce((n, s) => n + s.match.sourceOnly.length, 0),
    targetOnly: targetOnly.size,
    duplicates: countDuplicateRows(plan),
    nameMismatches: plan.sources.reduce((n, s) => n + s.match.nameMismatches.length, 0),
    processed: plan.sources.reduce((n, s) => n + s.processedRecords, 0),
  };
}

/** Number of distinct rows (Source and Target) blocked by duplicate NIMs. */
function countDuplicateRows(plan: SyncPlan): number {
  const ids = new Set<string>();
  for (const s of plan.sources) {
    for (const r of s.match.duplicateSourceRows) ids.add(`s:${s.sourceDatasetId}:${r.rowId}`);
    for (const r of s.match.duplicateTargetRows) ids.add(`t:${r.rowId}`);
  }
  return ids.size;
}

export interface ApplyOptions {
  /** Keys of 'overwrite' cells the user explicitly confirmed. All other overwrites are skipped. */
  approvedOverwrites: ReadonlySet<string>;
  label?: string;
}

export interface ApplyResult {
  target: Dataset;
  operation: SyncOperation;
}

export class SyncError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SyncError';
  }
}

/**
 * Applies a plan atomically: all changes are computed first and written into a new
 * Target dataset in one step. If anything is inconsistent, nothing is applied.
 * Row order is never changed; only the planned Target cells are updated.
 */
export function applySyncPlan(ctx: PlanContext, plan: SyncPlan, opts: ApplyOptions): ApplyResult {
  const { target } = ctx;
  if (plan.errors.length) throw new SyncError('Pratinjau masih memiliki kesalahan sehingga tidak dapat diterapkan.');
  if (target.id !== plan.targetDatasetId) throw new SyncError('Dataset Target berbeda dari pratinjau.');
  if (target.revision !== plan.targetRevision) {
    throw new SyncError('Data Target telah berubah sejak pratinjau dibuat. Buat pratinjau ulang.');
  }
  for (const [id, rev] of Object.entries(plan.sourceRevisions)) {
    const s = ctx.sources.find((x) => x.id === id);
    if (!s || s.revision !== rev) {
      throw new SyncError('Data Sumber telah berubah sejak pratinjau dibuat. Buat pratinjau ulang.');
    }
  }

  const changes: CellChange[] = [];
  let filled = 0;
  let overwritten = 0;
  let overwriteDeclined = 0;
  let unchanged = 0;
  for (const c of plan.cells) {
    if (c.kind === 'unchanged') {
      unchanged += 1;
      continue;
    }
    if (c.kind === 'overwrite' && !opts.approvedOverwrites.has(c.key)) {
      overwriteDeclined += 1;
      continue;
    }
    // Verify the cell still holds the value seen in the preview (defence in depth).
    const row = target.rows.find((r) => r.id === c.targetRowId);
    if (!row || !target.columns.some((col) => col.id === c.targetColumnId)) {
      throw new SyncError('Sel Target pada pratinjau tidak lagi ditemukan. Buat pratinjau ulang.');
    }
    if (!valuesEqual(row.cells[c.targetColumnId] ?? null, c.before)) {
      throw new SyncError('Nilai Target telah berubah sejak pratinjau dibuat. Buat pratinjau ulang.');
    }
    changes.push({
      datasetId: target.id,
      rowId: c.targetRowId,
      columnId: c.targetColumnId,
      before: c.before,
      after: c.after,
    });
    if (c.kind === 'fill') filled += 1;
    else overwritten += 1;
  }

  if (changes.length === 0) throw new SyncError('Tidak ada sel yang akan diubah.');

  const newTarget = applyCellValues(
    target,
    changes.map((c) => ({ rowId: c.rowId, columnId: c.columnId, value: c.after })),
  );
  const counts = countPlan(plan);
  const stats: SyncStats = {
    processedRecords: counts.processed,
    filled,
    overwritten,
    overwriteDeclined,
    unchanged,
    skippedEmpty: counts.skippedEmpty,
    unmatchedSource: counts.sourceOnly,
    unmatchedTarget: counts.targetOnly,
    duplicates: counts.duplicates,
    nameMismatches: counts.nameMismatches,
    conflicts: counts.conflicts,
  };

  const summaries: SyncSourceSummary[] = plan.sources.map((s) => {
    const src = ctx.sources.find((x) => x.id === s.sourceDatasetId);
    return {
      datasetId: s.sourceDatasetId,
      datasetName: s.sourceName,
      pairs: s.pairs.map((p) => ({
        sourceColumnId: p.sourceColumnId,
        sourceColumnName: src?.columns.find((c) => c.id === p.sourceColumnId)?.name ?? '?',
        targetColumnId: p.targetColumnId,
        targetColumnName: target.columns.find((c) => c.id === p.targetColumnId)?.name ?? '?',
      })),
    };
  });

  const operation: SyncOperation = {
    id: createId(),
    type: 'sync',
    timestamp: nowIso(),
    label: opts.label ?? defaultSyncLabel(summaries),
    status: 'applied',
    targetDatasetId: target.id,
    sources: summaries,
    stats,
    changes,
  };
  return { target: newTarget, operation };
}

function defaultSyncLabel(sources: SyncSourceSummary[]): string {
  const cols = sources.flatMap((s) => s.pairs.map((p) => `${p.sourceColumnName} → ${p.targetColumnName}`));
  const names = sources.map((s) => s.datasetName).join(', ');
  return `Sinkronisasi ${names}: ${cols.join(', ')}`;
}

/** Canonical signature of a mapping, used to detect repeated mappings. */
export function mappingSignature(sourceDatasetId: string, pairs: ColumnPair[]): string {
  return `${sourceDatasetId}::${pairs
    .map((p) => `${p.sourceColumnId}>${p.targetColumnId}`)
    .sort()
    .join(',')}`;
}

/** Finds previously applied sync operations that used the same source and column mapping. */
export function findRepeatedMappings(history: SyncOperation[], requests: SyncRequest[]): SyncOperation[] {
  const wanted = new Set(requests.map((r) => mappingSignature(r.sourceDatasetId, r.pairs)));
  return history.filter(
    (op) =>
      op.status === 'applied' &&
      op.sources.some((s) =>
        wanted.has(
          mappingSignature(
            s.datasetId,
            s.pairs.map((p) => ({ sourceColumnId: p.sourceColumnId, targetColumnId: p.targetColumnId })),
          ),
        ),
      ),
  );
}
