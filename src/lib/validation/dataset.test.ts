import { describe, expect, it } from 'vitest';
import { makeDataset } from '../test-utils';
import { validateDataset } from './dataset';

describe('validateDataset', () => {
  it('requires a NIM column', () => {
    const ds = makeDataset('source', 'S', ['ID', 'Nilai'], [['1', 2]]);
    expect(validateDataset(ds)[0].code).toBe('no-nim-column');
  });

  it('warns when numeric NIMs are shorter than others (lost leading zeros)', () => {
    const ds = makeDataset('source', 'S', ['NIM', 'Nama'], [
      ['0215001', 'Ani'],
      ['0215002', 'Budi'],
      [215003, 'Citra'],
    ]);
    const issue = validateDataset(ds).find((i) => i.code === 'nim-length-mismatch');
    expect(issue?.severity).toBe('error');
    expect(issue?.rowIds).toEqual([ds.rows[2].id]);
  });

  it('reports invalid and duplicate NIMs, and rows without NIM', () => {
    const ds = makeDataset('source', 'S', ['NIM', 'Nama'], [
      ['2.15E+14', 'A'],
      ['01', 'B'],
      ['01', 'C'],
      [null, 'D'],
    ]);
    const codes = validateDataset(ds).map((i) => i.code);
    expect(codes).toEqual(expect.arrayContaining(['invalid-nim', 'duplicate-nim', 'empty-nim']));
  });

  it('accepts clean text NIMs', () => {
    const ds = makeDataset('source', 'S', ['NIM', 'Nama'], [['01', 'A']]);
    expect(validateDataset(ds)).toEqual([]);
  });
});
