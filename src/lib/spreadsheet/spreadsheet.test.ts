import { describe, expect, it } from 'vitest';
import { applyPositionalEdits, deleteRows, insertColumns, renameColumn } from '../domain/dataset';
import { parseTsv } from '../io/tsv';
import { cellsOf, makeDataset } from '../test-utils';
import { compareGridValues, diffForGrid, fromGridValue, toSheetData } from './adapter';
import { planPaste } from './paste';

const ds = () =>
  makeDataset('source', 'S', ['NIM', 'Nama', 'Nilai'], [
    ['001', 'Ani', 80],
    ['002', 'Budi', null],
  ]);

describe('spreadsheet adapter', () => {
  it('converts a dataset to sheet rows without the header', () => {
    expect(toSheetData(ds())).toEqual([
      ['001', 'Ani', 80],
      ['002', 'Budi', undefined],
    ]);
  });

  it('maps grid values back to stored values, keeping 0 and leading zeros', () => {
    expect(fromGridValue('')).toBeNull();
    expect(fromGridValue(undefined)).toBeNull();
    expect(fromGridValue(0)).toBe(0);
    expect(fromGridValue('007')).toBe('007');
  });

  it('diffs cell edits and appended rows without a full reload', () => {
    const a = ds();
    const b = applyPositionalEdits(a, [
      { rowIndex: 1, colIndex: 2, value: '0' },
      { rowIndex: 2, colIndex: 0, value: '003' },
    ]).dataset;
    const d = diffForGrid(a, b);
    expect(d.kind).toBe('cells');
    if (d.kind === 'cells') {
      expect(d.updates).toContainEqual({ rowIndex: 1, colIndex: 2, value: '0' });
      expect(d.updates).toContainEqual({ rowIndex: 2, colIndex: 0, value: '003' });
    }
  });

  it('requires a reload when rows are deleted or columns inserted in the middle', () => {
    const a = ds();
    expect(diffForGrid(a, deleteRows(a, [a.rows[0].id])).kind).toBe('reload');
    expect(diffForGrid(a, insertColumns(a, 1, 1)).kind).toBe('reload');
    expect(diffForGrid(a, renameColumn(a, a.columns[0].id, 'X')).kind).toBe('none');
  });

  it('sorts numbers numerically and empty values last', () => {
    const v = ['10', 9, '', '2', 'b', 'a'];
    expect([...v].sort(compareGridValues)).toEqual(['2', 9, '10', 'a', 'b', '']);
  });
});

describe('planPaste (multi-cell paste)', () => {
  const block = parseTsv('0215001\tAni\t85\r\n0215002\tBudi\t0\r\n');

  it('pastes a block from Excel at the selected cell, growing the dataset', () => {
    const start = ds();
    const plan = planPaste(block, {
      displayRows: [0, 1, 2, 3],
      startPosition: 1,
      startColumn: 0,
      selectionRows: 1,
      selectionColumns: 1,
      filtered: false,
    });
    const out = applyPositionalEdits(start, plan.edits);
    expect(out.structural).toBe(true);
    expect(cellsOf(out.dataset, 'NIM')).toEqual(['001', '0215001', '0215002']);
    expect(cellsOf(out.dataset, 'Nilai')).toEqual([80, '85', '0']);
  });

  it('follows display order when the view is sorted', () => {
    const plan = planPaste([['x'], ['y']], {
      displayRows: [3, 1, 0, 2],
      startPosition: 0,
      startColumn: 2,
      selectionRows: 1,
      selectionColumns: 1,
      filtered: false,
    });
    expect(plan.edits.map((e) => e.rowIndex)).toEqual([3, 1]);
  });

  it('fills a larger selection with a single value', () => {
    const plan = planPaste([['5']], {
      displayRows: [0, 1, 2],
      startPosition: 0,
      startColumn: 1,
      selectionRows: 3,
      selectionColumns: 2,
      filtered: false,
    });
    expect(plan.edits).toHaveLength(6);
  });

  it('does not append rows past a filtered view', () => {
    const plan = planPaste(block, {
      displayRows: [4],
      startPosition: 0,
      startColumn: 0,
      selectionRows: 1,
      selectionColumns: 1,
      filtered: true,
    });
    expect(plan.truncatedRows).toBe(1);
    expect(new Set(plan.edits.map((e) => e.rowIndex))).toEqual(new Set([4]));
  });

  it('converts empty pasted cells to null (clears)', () => {
    const plan = planPaste([['', 'a']], {
      displayRows: [0],
      startPosition: 0,
      startColumn: 0,
      selectionRows: 1,
      selectionColumns: 1,
      filtered: false,
    });
    expect(plan.edits[0].value).toBeNull();
  });
});
