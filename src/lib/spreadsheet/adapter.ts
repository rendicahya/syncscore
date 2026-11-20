/**
 * Adapters between the SyncScore dataset model and Tabulator's spreadsheet format.
 *
 * Tabulator spreadsheet mode uses array-of-arrays data, columns keyed by Excel
 * letters (A, B, ...) and rows keyed by a 1-based `_id`. In SyncScore the header
 * row is not part of the grid data: column names are rendered in the column
 * headers (together with the letter), and grid row N is dataset row N.
 */
import { columnLetter, letterToIndex } from '../domain/cells';
import type { CellValue, Dataset } from '../domain/types';
import type { RowMatchStatus } from '../matching/engine';

export const ROW_PADDING = 30;
export const MIN_ROWS = 60;
export const COLUMN_PADDING = 4;
export const MIN_COLUMNS = 12;

export interface GridSize {
  rows: number;
  columns: number;
}

export function gridSize(ds: Dataset): GridSize {
  return {
    rows: Math.max(MIN_ROWS, ds.rows.length + ROW_PADDING),
    columns: Math.max(MIN_COLUMNS, ds.columns.length + COLUMN_PADDING),
  };
}

/** Whether the grid needs to grow to keep spare rows/columns available for typing and pasting. */
export function needsGrow(ds: Dataset, current: GridSize): boolean {
  return ds.rows.length + 5 > current.rows || ds.columns.length + 1 > current.columns;
}

function toGridValue(v: CellValue | undefined): string | number | undefined {
  return v === null || v === undefined ? undefined : v;
}

/** Dataset -> spreadsheet data (array of rows). Empty cells are `undefined`. */
export function toSheetData(ds: Dataset): (string | number | undefined)[][] {
  return ds.rows.map((r) => ds.columns.map((c) => toGridValue(r.cells[c.id])));
}

/** Spreadsheet field (column letter) -> zero-based column index. */
export function fieldToIndex(field: string): number {
  return letterToIndex(field);
}

export function indexToField(index: number): string {
  return columnLetter(index);
}

/** Grid `_id` (1-based) -> zero-based dataset row index. */
export function gridIdToRowIndex(id: unknown): number {
  const n = typeof id === 'number' ? id : Number(id);
  return Number.isInteger(n) && n > 0 ? n - 1 : -1;
}

/** Grid cell value -> stored value. Tabulator editors return strings; cleared cells are undefined/''. */
export function fromGridValue(v: unknown): CellValue {
  if (v === undefined || v === null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = String(v);
  return s === '' ? null : s;
}

export interface GridUpdate {
  rowIndex: number;
  colIndex: number;
  value: string | number | undefined;
}

export type GridDiff = { kind: 'none' } | { kind: 'cells'; updates: GridUpdate[] } | { kind: 'reload' };

/**
 * Compares two versions of a dataset to decide how to refresh the grid without losing
 * the user's scroll position and selection where possible:
 * - 'cells' when existing rows/columns keep their ids and order (rows/columns may be
 *   appended at the end, which in the grid are the spare padding rows/columns);
 * - 'reload' when rows/columns were removed, inserted in the middle or reordered.
 * Column names are rendered in the headers and refreshed separately.
 */
export function diffForGrid(prev: Dataset | null, next: Dataset): GridDiff {
  if (!prev || prev.id !== next.id) return { kind: 'reload' };
  if (prev === next) return { kind: 'none' };
  if (next.columns.length < prev.columns.length || next.rows.length < prev.rows.length) return { kind: 'reload' };
  for (let i = 0; i < prev.columns.length; i++) {
    if (prev.columns[i].id !== next.columns[i].id) return { kind: 'reload' };
  }
  const updates: GridUpdate[] = [];
  for (let r = 0; r < next.rows.length; r++) {
    const a = prev.rows[r];
    const b = next.rows[r];
    if (a && a.id !== b.id) return { kind: 'reload' };
    if (a && (a === b || a.cells === b.cells) && next.columns.length === prev.columns.length) continue;
    next.columns.forEach((c, ci) => {
      const va = a ? (a.cells[c.id] ?? null) : null;
      const vb = b.cells[c.id] ?? null;
      if (va !== vb) updates.push({ rowIndex: r, colIndex: ci, value: toGridValue(vb) });
    });
  }
  return updates.length ? { kind: 'cells', updates } : { kind: 'none' };
}

export function statusClass(status: RowMatchStatus | undefined): string {
  switch (status) {
    case 'matched':
    case 'name-approved':
      return 'st-matched';
    case 'manual':
      return 'st-manual';
    case 'unmatched':
      return 'st-unmatched';
    case 'duplicate':
    case 'invalid-nim':
      return 'st-duplicate';
    case 'name-mismatch':
      return 'st-mismatch';
    default:
      return '';
  }
}

export const STATUS_LABEL: Record<RowMatchStatus, string> = {
  matched: 'Cocok (NIM sama)',
  'name-approved': 'Cocok — beda nama sudah disetujui',
  'name-mismatch': 'NIM sama, nama berbeda — perlu ditinjau',
  manual: 'Dipasangkan manual',
  unmatched: 'Tidak ada pasangan',
  duplicate: 'NIM duplikat — tidak dicocokkan otomatis',
  'empty-nim': 'NIM kosong',
  'invalid-nim': 'NIM tidak valid',
};

/** Compares grid values for sorting: numbers numerically, text with natural order; empty last. */
export function compareGridValues(a: unknown, b: unknown): number {
  const ea = a === undefined || a === null || a === '';
  const eb = b === undefined || b === null || b === '';
  if (ea || eb) return ea === eb ? 0 : ea ? 1 : -1;
  const na = typeof a === 'number' ? a : /^-?\d+(\.\d+)?$/.test(String(a).trim()) ? Number(a) : NaN;
  const nb = typeof b === 'number' ? b : /^-?\d+(\.\d+)?$/.test(String(b).trim()) ? Number(b) : NaN;
  if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
  return String(a).localeCompare(String(b), 'id', { numeric: true, sensitivity: 'base' });
}
