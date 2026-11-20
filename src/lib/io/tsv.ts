import { cellToText } from '../domain/cells';
import type { CellValue } from '../domain/types';

/**
 * Parses TSV clipboard text as produced by Excel, Google Sheets, LibreOffice and Tabulator.
 *
 * - Fields are separated by tabs, records by LF or CRLF (or lone CR).
 * - A field starting with a double quote is quoted: it may contain tabs and newlines,
 *   and "" represents a literal quote (Excel/Sheets convention for multi-line cells).
 * - A single trailing line break (always added by Excel) does not create an empty row.
 * - All values are returned as strings; no numeric conversion is performed, so
 *   identifiers such as "0123" keep their leading zeros.
 */
export function parseTsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let i = 0;
  const n = text.length;
  let atFieldStart = true;

  while (i < n) {
    const ch = text[i];
    if (atFieldStart && ch === '"') {
      // Quoted field: find the closing quote.
      let j = i + 1;
      let value = '';
      let closed = false;
      while (j < n) {
        const c = text[j];
        if (c === '"') {
          if (text[j + 1] === '"') {
            value += '"';
            j += 2;
            continue;
          }
          closed = true;
          j += 1;
          break;
        }
        value += c;
        j += 1;
      }
      const next = text[j];
      if (closed && (j >= n || next === '\t' || next === '\n' || next === '\r')) {
        field = value;
        i = j;
        atFieldStart = false;
        continue;
      }
      // Not a well-formed quoted field: treat the quote literally.
      field += ch;
      i += 1;
      atFieldStart = false;
      continue;
    }
    if (ch === '\t') {
      row.push(field);
      field = '';
      atFieldStart = true;
      i += 1;
      continue;
    }
    if (ch === '\r' || ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      atFieldStart = true;
      i += ch === '\r' && text[i + 1] === '\n' ? 2 : 1;
      continue;
    }
    field += ch;
    atFieldStart = false;
    i += 1;
  }
  // Final record (no trailing newline).
  if (!atFieldStart || field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** Pads rows so every row has the same number of fields. */
export function normalizeRectangular(rows: string[][]): string[][] {
  const width = rows.reduce((m, r) => Math.max(m, r.length), 0);
  return rows.map((r) => (r.length < width ? [...r, ...Array<string>(width - r.length).fill('')] : r));
}

function quoteField(text: string): string {
  if (/[\t\n\r"]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

/** Serializes a 2D array to TSV, quoting fields that contain tabs, newlines or quotes. */
export function serializeTsv(rows: (CellValue | undefined)[][]): string {
  return rows.map((r) => r.map((v) => quoteField(cellToText(v ?? null))).join('\t')).join('\n');
}
