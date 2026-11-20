import { isEmptyCell } from '../domain/cells';
import type { Dataset } from '../domain/types';
import { nimKey } from '../matching/identity';

export type IssueSeverity = 'error' | 'warning' | 'info';

export type IssueCode =
  | 'no-nim-column'
  | 'no-name-column'
  | 'numeric-nim'
  | 'nim-length-mismatch'
  | 'invalid-nim'
  | 'empty-nim'
  | 'duplicate-nim';

export interface ValidationIssue {
  code: IssueCode;
  severity: IssueSeverity;
  message: string;
  rowIds?: string[];
}

/**
 * Validates the identity columns of a dataset. Never modifies data.
 * The most important check: NIM values stored as numbers may have lost leading zeros
 * in Excel. That cannot be repaired automatically, so the user is warned.
 */
export function validateDataset(ds: Dataset): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (ds.columns.length === 0) return issues;
  if (!ds.nimColumnId) {
    issues.push({ code: 'no-nim-column', severity: 'error', message: 'Pilih kolom NIM agar mahasiswa dapat dicocokkan.' });
    return issues;
  }
  if (!ds.nameColumnId) {
    issues.push({
      code: 'no-name-column',
      severity: 'warning',
      message: 'Kolom nama belum dipilih; kecocokan nama tidak dapat divalidasi.',
    });
  }
  const nimCol = ds.nimColumnId;
  const numeric: string[] = [];
  const invalid: string[] = [];
  const empty: string[] = [];
  const lengths = new Map<number, number>();
  const keyRows = new Map<string, string[]>();
  for (const row of ds.rows) {
    const v = row.cells[nimCol];
    const k = nimKey(v);
    if (k.status === 'empty') {
      const hasData = Object.values(row.cells).some((x) => !isEmptyCell(x));
      if (hasData) empty.push(row.id);
      continue;
    }
    if (k.status === 'invalid') {
      invalid.push(row.id);
      continue;
    }
    if (typeof v === 'number') numeric.push(row.id);
    lengths.set(k.key.length, (lengths.get(k.key.length) ?? 0) + 1);
    const list = keyRows.get(k.key) ?? [];
    list.push(row.id);
    keyRows.set(k.key, list);
  }

  if (invalid.length) {
    issues.push({
      code: 'invalid-nim',
      severity: 'error',
      message: `${invalid.length} NIM tidak dapat dipastikan ketepatannya (angka terlalu panjang atau notasi ilmiah). Perbaiki di berkas asal dengan format Teks, lalu impor ulang.`,
      rowIds: invalid,
    });
  }

  if (numeric.length) {
    // Dominant NIM length; numeric NIMs shorter than it probably lost leading zeros.
    let dominant = 0;
    let best = -1;
    for (const [len, count] of lengths) {
      if (count > best) {
        best = count;
        dominant = len;
      }
    }
    const shorter = ds.rows
      .filter((r) => numeric.includes(r.id))
      .filter((r) => String(r.cells[nimCol]).length < dominant)
      .map((r) => r.id);
    if (shorter.length) {
      issues.push({
        code: 'nim-length-mismatch',
        severity: 'error',
        message: `${shorter.length} NIM tersimpan sebagai angka dan lebih pendek dari NIM lain (${dominant} digit). Nol di depan kemungkinan hilang di Excel dan tidak dapat dipulihkan otomatis. Periksa dan perbaiki NIM tersebut.`,
        rowIds: shorter,
      });
    } else {
      issues.push({
        code: 'numeric-nim',
        severity: 'warning',
        message: `${numeric.length} NIM tersimpan sebagai angka. Nilainya tetap dipakai sebagai teks, tetapi pastikan tidak ada nol di depan yang hilang.`,
        rowIds: numeric,
      });
    }
  }

  if (empty.length) {
    issues.push({
      code: 'empty-nim',
      severity: 'warning',
      message: `${empty.length} baris berisi data tetapi NIM-nya kosong.`,
      rowIds: empty,
    });
  }

  const dupRows = [...keyRows.values()].filter((l) => l.length > 1);
  if (dupRows.length) {
    issues.push({
      code: 'duplicate-nim',
      severity: 'error',
      message: `${dupRows.length} NIM muncul lebih dari sekali (${dupRows.reduce((n, l) => n + l.length, 0)} baris). Baris tersebut tidak dicocokkan otomatis.`,
      rowIds: dupRows.flat(),
    });
  }
  return issues;
}
