import type { CellValue } from '../domain/types';

export type NimKey =
  | { status: 'ok'; key: string }
  | { status: 'empty' }
  /** The value cannot be turned into a reliable NIM (e.g. precision lost in a numeric cell). */
  | { status: 'invalid'; reason: string };

/**
 * Derives the exact NIM matching key from a cell value.
 *
 * NIM is always treated as text. The only normalization applied is trimming
 * leading/trailing whitespace. Numeric cells are accepted only when they are
 * non-negative safe integers (their decimal text is used verbatim); any other
 * number cannot be trusted as an identifier and is reported as invalid.
 * Leading zeros in text values are preserved and significant ("012" ≠ "12").
 */
export function nimKey(value: CellValue | undefined): NimKey {
  if (value === null || value === undefined) return { status: 'empty' };
  if (typeof value === 'number') {
    if (Number.isNaN(value)) return { status: 'empty' };
    if (!Number.isSafeInteger(value) || value < 0) {
      return { status: 'invalid', reason: 'NIM tersimpan sebagai angka yang tidak dapat dipastikan ketepatannya.' };
    }
    return { status: 'ok', key: String(value) };
  }
  const key = value.trim();
  if (key === '') return { status: 'empty' };
  if (/^\d(\.\d+)?e\+\d+$/i.test(key)) {
    return { status: 'invalid', reason: 'NIM tertulis dalam notasi ilmiah (mis. 2.1E+14); digit aslinya tidak dapat dipulihkan.' };
  }
  return { status: 'ok', key };
}

/** Display text for a NIM cell. */
export function nimText(value: CellValue | undefined): string {
  if (value === null || value === undefined) return '';
  return typeof value === 'number' ? String(value) : value.trim();
}

/**
 * Normalizes a student name for comparison only (never for identification):
 * Unicode NFKC, case-insensitive, whitespace collapsed. Punctuation is significant,
 * so "Muh. Rizki" and "Muh Rizki" are considered different and require review.
 */
export function normalizeName(value: CellValue | undefined): string {
  if (value === null || value === undefined) return '';
  return String(value).normalize('NFKC').replace(/\s+/g, ' ').trim().toLocaleLowerCase('id');
}

export type NameComparison = 'same' | 'different' | 'unknown';

export function compareNames(a: CellValue | undefined, b: CellValue | undefined): NameComparison {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (na === '' || nb === '') return 'unknown';
  return na === nb ? 'same' : 'different';
}
