import { describe, expect, it } from 'vitest';
import { normalizeRectangular, parseTsv, serializeTsv } from './tsv';

describe('parseTsv', () => {
  it('parses a multi-cell block copied from Excel (CRLF, trailing newline)', () => {
    const text = 'NIM\tNama\tUTS\r\n0215001\tAni\t85\r\n0215002\tBudi\t0\r\n';
    expect(parseTsv(text)).toEqual([
      ['NIM', 'Nama', 'UTS'],
      ['0215001', 'Ani', '85'],
      ['0215002', 'Budi', '0'],
    ]);
  });

  it('keeps leading zeros and does not convert numbers', () => {
    expect(parseTsv('007\t0\t00.50')).toEqual([['007', '0', '00.50']]);
  });

  it('handles quoted fields with embedded tabs, newlines and quotes (Google Sheets)', () => {
    const text = 'a\t"line1\nline2"\t"say ""hi"""\nb\t"x\ty"\tz';
    expect(parseTsv(text)).toEqual([
      ['a', 'line1\nline2', 'say "hi"'],
      ['b', 'x\ty', 'z'],
    ]);
  });

  it('keeps empty cells and empty trailing fields', () => {
    expect(parseTsv('a\t\tc\n\t\t\n')).toEqual([
      ['a', '', 'c'],
      ['', '', ''],
    ]);
  });

  it('treats a stray quote inside a field literally', () => {
    expect(parseTsv('5" monitor\tx')).toEqual([['5" monitor', 'x']]);
    expect(parseTsv('"abc"def\tx')).toEqual([['"abc"def', 'x']]);
  });

  it('returns no rows for empty text', () => {
    expect(parseTsv('')).toEqual([]);
  });

  it('pads ragged rows', () => {
    expect(normalizeRectangular([['a'], ['b', 'c']])).toEqual([
      ['a', ''],
      ['b', 'c'],
    ]);
  });
});

describe('serializeTsv', () => {
  it('round-trips through parseTsv, including special characters', () => {
    const data = [
      ['NIM', 'Nama', 'Catatan'],
      ['0123', 'Ani "A"', 'baris1\nbaris2'],
      ['0456', 'Budi', 'a\tb'],
    ];
    expect(parseTsv(serializeTsv(data))).toEqual(data);
  });

  it('writes numbers and nulls as text', () => {
    expect(serializeTsv([[0, null, 85.5]])).toBe('0\t\t85.5');
  });
});
