import type { CellValue, Dataset, ManualMatch, NameApproval, Row } from '../domain/types';
import { compareNames, nimKey, nimText, normalizeName, type NameComparison } from './identity';

export type RowMatchStatus =
  /** Exact NIM match, names agree (or cannot be compared). */
  | 'matched'
  /** Exact NIM match, names differ and the user approved it. */
  | 'name-approved'
  /** Exact NIM match, names differ: requires manual review, excluded from sync. */
  | 'name-mismatch'
  /** Paired manually by the user. */
  | 'manual'
  /** No counterpart found. */
  | 'unmatched'
  /** NIM appears more than once (in this dataset or the other one): excluded from automatic matching. */
  | 'duplicate'
  | 'empty-nim'
  | 'invalid-nim';

export interface RowRef {
  rowId: string;
  rowIndex: number;
  nim: string;
  name: string;
}

export interface MatchPair {
  sourceRowId: string;
  targetRowId: string;
  kind: 'exact' | 'manual';
  nim: string;
  nameComparison: NameComparison;
  /** Present when the names differ and the user approved this pair. */
  approvalId?: string;
  manualMatchId?: string;
  /** Whether this pair may be used for synchronization. */
  usable: boolean;
}

export interface DuplicateGroup {
  nim: string;
  side: 'source' | 'target';
  rowIds: string[];
}

export interface StaleManualMatch {
  match: ManualMatch;
  reason: 'source-row-missing' | 'target-row-missing' | 'row-already-paired';
}

export interface MatchResult {
  sourceDatasetId: string;
  targetDatasetId: string;
  /** Blocking configuration problems (e.g. NIM column not selected). */
  errors: string[];
  /** Non-blocking notices (e.g. name column missing, so names cannot be validated). */
  notices: string[];
  pairs: MatchPair[];
  sourceOnly: RowRef[];
  targetOnly: RowRef[];
  duplicates: DuplicateGroup[];
  /** Source rows blocked because their NIM is duplicated in either dataset. */
  duplicateSourceRows: RowRef[];
  /** Target rows whose NIM is duplicated in the target. */
  duplicateTargetRows: RowRef[];
  emptyNimSource: RowRef[];
  emptyNimTarget: RowRef[];
  invalidNimSource: RowRef[];
  invalidNimTarget: RowRef[];
  nameMismatches: MatchPair[];
  staleManualMatches: StaleManualMatch[];
  sourceStatus: Map<string, RowMatchStatus>;
  targetStatus: Map<string, RowMatchStatus>;
  /** Partner lookups for both directions. */
  sourceToTarget: Map<string, string>;
  targetToSource: Map<string, string>;
}

function cell(row: Row, columnId: string | null): CellValue | undefined {
  return columnId ? row.cells[columnId] : undefined;
}

function ref(row: Row, index: number, ds: Dataset): RowRef {
  return {
    rowId: row.id,
    rowIndex: index,
    nim: nimText(cell(row, ds.nimColumnId)),
    name: cell(row, ds.nameColumnId) == null ? '' : String(cell(row, ds.nameColumnId)),
  };
}

function emptyResult(source: Dataset, target: Dataset, errors: string[]): MatchResult {
  return {
    sourceDatasetId: source.id,
    targetDatasetId: target.id,
    errors,
    notices: [],
    pairs: [],
    sourceOnly: [],
    targetOnly: [],
    duplicates: [],
    duplicateSourceRows: [],
    duplicateTargetRows: [],
    emptyNimSource: [],
    emptyNimTarget: [],
    invalidNimSource: [],
    invalidNimTarget: [],
    nameMismatches: [],
    staleManualMatches: [],
    sourceStatus: new Map(),
    targetStatus: new Map(),
    sourceToTarget: new Map(),
    targetToSource: new Map(),
  };
}

/** Checks whether a name approval is still valid for the current names. */
export function isApprovalValid(
  approval: NameApproval,
  sourceName: CellValue | undefined,
  targetName: CellValue | undefined,
): boolean {
  return (
    normalizeName(approval.sourceName) === normalizeName(sourceName) &&
    normalizeName(approval.targetName) === normalizeName(targetName)
  );
}

/**
 * Groups rows by NIM key. Manually paired rows are included on purpose:
 * duplicates are a property of the dataset, not of the automatic matching pool.
 */
function groupByNim(ds: Dataset) {
  const groups = new Map<string, Row[]>();
  for (const row of ds.rows) {
    const k = nimKey(cell(row, ds.nimColumnId));
    if (k.status !== 'ok') continue;
    const list = groups.get(k.key) ?? [];
    list.push(row);
    groups.set(k.key, list);
  }
  return groups;
}

/**
 * Matches the rows of one Source dataset against the Target dataset.
 *
 * Rules:
 * - Matching is by exact NIM text only; never by row position.
 * - Any NIM occurring more than once in either dataset is flagged and not matched automatically.
 * - Exact matches whose names differ require review (excluded unless an approval is valid).
 * - Manual matches (user-confirmed) take precedence and remove both rows from automatic matching.
 */
export function matchDatasets(
  source: Dataset,
  target: Dataset,
  manualMatches: ManualMatch[] = [],
  nameApprovals: NameApproval[] = [],
): MatchResult {
  const errors: string[] = [];
  if (!source.nimColumnId) errors.push(`Kolom NIM pada "${source.name}" belum dipilih.`);
  if (!target.nimColumnId) errors.push(`Kolom NIM pada "${target.name}" belum dipilih.`);
  if (errors.length) return emptyResult(source, target, errors);

  const result = emptyResult(source, target, []);
  if (!source.nameColumnId || !target.nameColumnId) {
    result.notices.push('Kolom nama belum dipilih pada salah satu dataset; validasi nama tidak dapat dilakukan.');
  }

  const targetIndex = new Map(target.rows.map((r, i) => [r.id, i] as const));
  const sourceById = new Map(source.rows.map((r) => [r.id, r] as const));
  const targetById = new Map(target.rows.map((r) => [r.id, r] as const));

  // 1. Manual matches for this source.
  const usedSource = new Set<string>();
  const usedTarget = new Set<string>();
  for (const m of manualMatches) {
    if (m.sourceDatasetId !== source.id) continue;
    const s = sourceById.get(m.sourceRowId);
    const t = targetById.get(m.targetRowId);
    if (!s) {
      result.staleManualMatches.push({ match: m, reason: 'source-row-missing' });
      continue;
    }
    if (!t) {
      result.staleManualMatches.push({ match: m, reason: 'target-row-missing' });
      continue;
    }
    if (usedSource.has(s.id) || usedTarget.has(t.id)) {
      result.staleManualMatches.push({ match: m, reason: 'row-already-paired' });
      continue;
    }
    usedSource.add(s.id);
    usedTarget.add(t.id);
    const pair: MatchPair = {
      sourceRowId: s.id,
      targetRowId: t.id,
      kind: 'manual',
      nim: nimText(cell(t, target.nimColumnId)),
      nameComparison: compareNames(cell(s, source.nameColumnId), cell(t, target.nameColumnId)),
      manualMatchId: m.id,
      usable: true,
    };
    result.pairs.push(pair);
    result.sourceStatus.set(s.id, 'manual');
    result.targetStatus.set(t.id, 'manual');
    result.sourceToTarget.set(s.id, t.id);
    result.targetToSource.set(t.id, s.id);
  }

  // 2. Duplicate detection (over the full datasets).
  const sourceGroups = groupByNim(source);
  const targetGroups = groupByNim(target);
  const dupSource = new Set<string>();
  const dupTarget = new Set<string>();
  for (const [nim, rows] of sourceGroups) {
    if (rows.length > 1) {
      dupSource.add(nim);
      result.duplicates.push({ nim, side: 'source', rowIds: rows.map((r) => r.id) });
    }
  }
  for (const [nim, rows] of targetGroups) {
    if (rows.length > 1) {
      dupTarget.add(nim);
      result.duplicates.push({ nim, side: 'target', rowIds: rows.map((r) => r.id) });
    }
  }

  // 3. Target rows classification (those not manually paired).
  const targetByNim = new Map<string, Row>();
  target.rows.forEach((row, i) => {
    if (usedTarget.has(row.id)) return;
    const k = nimKey(cell(row, target.nimColumnId));
    if (k.status === 'empty') {
      result.emptyNimTarget.push(ref(row, i, target));
      result.targetStatus.set(row.id, 'empty-nim');
      return;
    }
    if (k.status === 'invalid') {
      result.invalidNimTarget.push(ref(row, i, target));
      result.targetStatus.set(row.id, 'invalid-nim');
      return;
    }
    if (dupTarget.has(k.key)) {
      result.duplicateTargetRows.push(ref(row, i, target));
      result.targetStatus.set(row.id, 'duplicate');
      return;
    }
    targetByNim.set(k.key, row);
  });

  // 4. Source rows.
  source.rows.forEach((row, i) => {
    if (usedSource.has(row.id)) return;
    const k = nimKey(cell(row, source.nimColumnId));
    if (k.status === 'empty') {
      // Completely empty rows are ignored; rows with other data but no NIM are reported.
      const hasData = Object.values(row.cells).some((v) => v !== null && String(v).trim() !== '');
      if (hasData) result.emptyNimSource.push(ref(row, i, source));
      result.sourceStatus.set(row.id, 'empty-nim');
      return;
    }
    if (k.status === 'invalid') {
      result.invalidNimSource.push(ref(row, i, source));
      result.sourceStatus.set(row.id, 'invalid-nim');
      return;
    }
    if (dupSource.has(k.key) || dupTarget.has(k.key)) {
      result.duplicateSourceRows.push(ref(row, i, source));
      result.sourceStatus.set(row.id, 'duplicate');
      return;
    }
    const t = targetByNim.get(k.key);
    if (!t) {
      result.sourceOnly.push(ref(row, i, source));
      result.sourceStatus.set(row.id, 'unmatched');
      return;
    }
    targetByNim.delete(k.key);
    const sName = cell(row, source.nameColumnId);
    const tName = cell(t, target.nameColumnId);
    const comparison = source.nameColumnId && target.nameColumnId ? compareNames(sName, tName) : 'unknown';
    const pair: MatchPair = {
      sourceRowId: row.id,
      targetRowId: t.id,
      kind: 'exact',
      nim: k.key,
      nameComparison: comparison,
      usable: comparison !== 'different',
    };
    if (comparison === 'different') {
      const approval = nameApprovals.find(
        (a) =>
          a.sourceDatasetId === source.id &&
          a.sourceRowId === row.id &&
          a.targetRowId === t.id &&
          isApprovalValid(a, sName, tName),
      );
      if (approval) {
        pair.approvalId = approval.id;
        pair.usable = true;
      } else {
        result.nameMismatches.push(pair);
      }
    }
    result.pairs.push(pair);
    const status: RowMatchStatus =
      comparison === 'different' ? (pair.usable ? 'name-approved' : 'name-mismatch') : 'matched';
    result.sourceStatus.set(row.id, status);
    result.targetStatus.set(t.id, status);
    result.sourceToTarget.set(row.id, t.id);
    result.targetToSource.set(t.id, row.id);
  });

  // 5. Remaining target rows have no counterpart in this source.
  for (const row of targetByNim.values()) {
    result.targetOnly.push(ref(row, targetIndex.get(row.id) ?? -1, target));
    result.targetStatus.set(row.id, 'unmatched');
  }
  result.targetOnly.sort((a, b) => a.rowIndex - b.rowIndex);

  return result;
}

export interface MatchSummary {
  matched: number;
  manual: number;
  nameMismatch: number;
  nameApproved: number;
  sourceOnly: number;
  targetOnly: number;
  duplicateRows: number;
  emptyOrInvalid: number;
}

export function summarizeMatch(r: MatchResult): MatchSummary {
  return {
    matched: r.pairs.filter((p) => p.kind === 'exact' && p.nameComparison !== 'different').length,
    manual: r.pairs.filter((p) => p.kind === 'manual').length,
    nameMismatch: r.nameMismatches.length,
    nameApproved: r.pairs.filter((p) => p.kind === 'exact' && p.nameComparison === 'different' && p.usable).length,
    sourceOnly: r.sourceOnly.length,
    targetOnly: r.targetOnly.length,
    duplicateRows: r.duplicateSourceRows.length + r.duplicateTargetRows.length,
    emptyOrInvalid:
      r.emptyNimSource.length + r.invalidNimSource.length + r.emptyNimTarget.length + r.invalidNimTarget.length,
  };
}

/**
 * Validates whether a manual pairing is allowed.
 * Returns an error message (Indonesian) or null when allowed.
 */
export function validateManualPair(result: MatchResult, sourceRowId: string, targetRowId: string): string | null {
  const sStatus = result.sourceStatus.get(sourceRowId);
  const tStatus = result.targetStatus.get(targetRowId);
  if (result.errors.length) return result.errors[0];
  if (sStatus === undefined) return 'Baris Sumber tidak ditemukan.';
  if (tStatus === undefined) return 'Baris Target tidak ditemukan.';
  if (result.sourceToTarget.has(sourceRowId)) {
    return 'Baris Sumber ini sudah berpasangan. Hapus pasangannya terlebih dahulu.';
  }
  if (result.targetToSource.has(targetRowId)) {
    return 'Baris Target ini sudah berpasangan dengan baris Sumber lain.';
  }
  return null;
}
