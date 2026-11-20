import type { CellValue } from './types';

/**
 * A cell is empty when it holds no value or only whitespace.
 * Numeric zero (0) and the string "0" are valid values and NOT empty.
 */
export function isEmptyCell(value: CellValue | undefined): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'number') return Number.isNaN(value);
  return value.trim() === '';
}

/** Text representation of a cell, as shown to the user. */
export function cellToText(value: CellValue | undefined): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return Number.isNaN(value) ? '' : String(value);
  return value;
}

/**
 * Compares two cell values by their text content (trimmed).
 * 85 and "85" are considered equal; "085" and 85 are not.
 */
export function valuesEqual(a: CellValue | undefined, b: CellValue | undefined): boolean {
  const ea = isEmptyCell(a);
  const eb = isEmptyCell(b);
  if (ea || eb) return ea && eb;
  return cellToText(a).trim() === cellToText(b).trim();
}

/** Normalizes a value before storing it: empty strings become null, other strings are kept verbatim. */
export function normalizeStoredValue(value: CellValue | undefined): CellValue {
  if (value === undefined || value === null) return null;
  if (typeof value === 'number') return Number.isNaN(value) ? null : value;
  return value === '' ? null : value;
}

let fallbackCounter = 0;

export function createId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  fallbackCounter += 1;
  return `id-${Date.now().toString(36)}-${fallbackCounter.toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

/** Converts a zero-based column index to Excel letters (0 -> A, 25 -> Z, 26 -> AA). */
export function columnLetter(index: number): string {
  let n = index + 1;
  let out = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

/** Converts Excel letters to a zero-based column index (A -> 0). Returns -1 for invalid input. */
export function letterToIndex(letters: string): number {
  if (!/^[A-Z]+$/.test(letters)) return -1;
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}
