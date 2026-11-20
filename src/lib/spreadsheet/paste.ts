import type { PositionalEdit } from '../domain/dataset';

export interface PasteTarget {
  /** Dataset row indexes in display order (after sorting/filtering). */
  displayRows: number[];
  /** Position (within displayRows) of the top-left selected cell. */
  startPosition: number;
  /** Zero-based column index of the top-left selected cell. */
  startColumn: number;
  /** Size of the selected range (rows x columns), used for Excel-style fill. */
  selectionRows: number;
  selectionColumns: number;
  /** When the view is filtered, pasting stops at the last visible row instead of appending. */
  filtered: boolean;
}

export interface PastePlan {
  edits: PositionalEdit[];
  /** Number of clipboard rows that could not be placed (only when filtered). */
  truncatedRows: number;
}

/**
 * Plans where pasted cells go.
 * - Values are placed starting at the top-left selected cell, following the display order.
 * - If a single value is pasted into a larger selection, the whole selection is filled (Excel behaviour).
 * - If the block is pasted into a selection that is an exact multiple of its size, it is tiled.
 * - Rows past the end of the display are appended after the last dataset row (unless filtered).
 */
export function planPaste(block: string[][], target: PasteTarget): PastePlan {
  if (block.length === 0) return { edits: [], truncatedRows: 0 };
  const height = block.length;
  const width = Math.max(...block.map((r) => r.length));
  let outRows = height;
  let outCols = width;
  const canTile =
    target.selectionRows >= height &&
    target.selectionColumns >= width &&
    target.selectionRows % height === 0 &&
    target.selectionColumns % width === 0;
  if (canTile && (target.selectionRows > height || target.selectionColumns > width)) {
    outRows = target.selectionRows;
    outCols = target.selectionColumns;
  }

  const edits: PositionalEdit[] = [];
  let truncatedRows = 0;
  const maxDisplayed = target.displayRows.reduce((m, r) => Math.max(m, r), -1);
  let appendCursor = maxDisplayed + 1;
  for (let i = 0; i < outRows; i++) {
    const pos = target.startPosition + i;
    let rowIndex: number;
    if (pos < target.displayRows.length) {
      rowIndex = target.displayRows[pos];
    } else if (!target.filtered) {
      rowIndex = appendCursor;
      appendCursor += 1;
    } else {
      truncatedRows += 1;
      continue;
    }
    const src = block[i % height];
    for (let j = 0; j < outCols; j++) {
      const value = src[j % width] ?? '';
      edits.push({ rowIndex, colIndex: target.startColumn + j, value: value === '' ? null : value });
    }
  }
  return { edits, truncatedRows };
}
