import { isEmptyCell } from '../domain/cells';
import type { PositionalEdit } from '../domain/dataset';
import type { CellValue, Dataset } from '../domain/types';

/**
 * Converts the grid values of a selected range (rows in display order, each a list of
 * cell values in column order) to a text matrix suitable for TSV serialization.
 * Values are copied verbatim: leading zeros and zero grades are preserved.
 */
export function selectionToMatrix(rows: unknown[][]): string[][] {
  return rows.map((row) =>
    row.map((v) => (v === undefined || v === null ? '' : typeof v === 'number' && Number.isNaN(v) ? '' : String(v))),
  );
}

/**
 * Plans clearing the selected cells. Only existing, non-empty cells produce an edit, so
 * clearing never grows the dataset and never records no-op changes.
 */
export function planClear(dataset: Dataset, rowIndexes: number[], colIndexes: number[]): PositionalEdit[] {
  const edits: PositionalEdit[] = [];
  for (const ri of rowIndexes) {
    const row = dataset.rows[ri];
    if (!row) continue;
    for (const ci of colIndexes) {
      const col = dataset.columns[ci];
      if (!col) continue;
      const value: CellValue | undefined = row.cells[col.id];
      if (!isEmptyCell(value) || (typeof value === 'string' && value !== '')) edits.push({ rowIndex: ri, colIndex: ci, value: null });
    }
  }
  return edits;
}
