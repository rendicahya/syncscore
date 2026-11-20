import * as XLSX from 'xlsx';
import { cellToText } from '../domain/cells';
import type { TableData } from '../domain/dataset';
import type { CellValue, Dataset, ImportWarning } from '../domain/types';

export interface SheetInfo {
  name: string;
  rowCount: number;
  columnCount: number;
}

export interface WorkbookFile {
  fileName: string;
  sheets: SheetInfo[];
  workbook: XLSX.WorkBook;
}

export class ImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImportError';
  }
}

/** Reads an XLSX workbook from bytes. Formulas are not evaluated; cached results are used. */
export function readWorkbook(data: ArrayBuffer | Uint8Array, fileName: string): WorkbookFile {
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(data, {
      type: 'array',
      cellNF: true,
      cellText: true,
      cellDates: false,
      cellFormula: true,
      dense: false,
    });
  } catch {
    throw new ImportError('Berkas tidak dapat dibaca sebagai workbook Excel (.xlsx). Pastikan berkas tidak rusak atau terenkripsi.');
  }
  if (!workbook.SheetNames.length) throw new ImportError('Workbook tidak memiliki worksheet.');
  const sheets = workbook.SheetNames.map((name) => {
    const ws = workbook.Sheets[name];
    const ref = ws?.['!ref'];
    if (!ref) return { name, rowCount: 0, columnCount: 0 };
    const range = XLSX.utils.decode_range(ref);
    return { name, rowCount: Math.max(0, range.e.r - range.s.r), columnCount: range.e.c - range.s.c + 1 };
  });
  return { fileName, sheets, workbook };
}

export interface SheetConversion {
  table: TableData;
  warnings: ImportWarning[];
  columnWarnings: { headerIndex: number; warning: Omit<ImportWarning, 'columnId'> }[];
}

const LEADING_ZERO_DIGITS = /^0\d+$/;

interface ConvertedCell {
  value: CellValue;
  recoveredLeadingZeros?: boolean;
  precisionLost?: boolean;
  formula?: boolean;
}

/** Converts a SheetJS cell into a SyncScore cell value without altering its content. */
export function convertCell(cell: XLSX.CellObject | undefined): ConvertedCell {
  if (!cell) return { value: null };
  const formula = typeof cell.f === 'string' && cell.f.length > 0;
  switch (cell.t) {
    case 's':
      return { value: cell.v == null ? null : String(cell.v), formula };
    case 'b':
      return { value: cell.v ? 'TRUE' : 'FALSE', formula };
    case 'e':
      return { value: cell.w ?? '#ERROR', formula };
    case 'd':
      return { value: cell.w ?? (cell.v instanceof Date ? cell.v.toISOString() : String(cell.v ?? '')), formula };
    case 'z':
      return { value: null };
    case 'n': {
      const v = typeof cell.v === 'number' ? cell.v : Number(cell.v);
      const w = typeof cell.w === 'string' ? cell.w.trim() : undefined;
      const fmt = typeof cell.z === 'string' ? cell.z : undefined;
      if (fmt && XLSX.SSF.is_date(fmt) && w) return { value: w, formula };
      // A number displayed with leading zeros (custom format such as 0000000000) is an
      // identifier: keep the displayed digits so NIM leading zeros are recovered.
      if (w && LEADING_ZERO_DIGITS.test(w) && Number.isInteger(v) && Number(w) === v) {
        return { value: w, recoveredLeadingZeros: true, formula };
      }
      if (Number.isInteger(v) && !Number.isSafeInteger(v)) {
        return { value: v, precisionLost: true, formula };
      }
      return { value: v, formula };
    }
    default:
      return { value: cell.w ?? (cell.v == null ? null : String(cell.v)), formula };
  }
}

/**
 * Converts a worksheet into header + rows. The first row of the used range is always the header.
 */
export function sheetToTable(wb: WorkbookFile, sheetName: string): SheetConversion {
  const ws = wb.workbook.Sheets[sheetName];
  if (!ws) throw new ImportError(`Worksheet "${sheetName}" tidak ditemukan.`);
  const ref = ws['!ref'];
  if (!ref) throw new ImportError(`Worksheet "${sheetName}" kosong.`);
  const range = XLSX.utils.decode_range(ref);
  const header: string[] = [];
  const rows: CellValue[][] = [];
  const recovered = new Map<number, number>();
  const precision = new Map<number, number>();
  let formulas = 0;

  for (let c = range.s.c; c <= range.e.c; c++) {
    const cell = ws[XLSX.utils.encode_cell({ r: range.s.r, c })] as XLSX.CellObject | undefined;
    const conv = convertCell(cell);
    header.push(cellToText(conv.value).trim());
  }
  for (let r = range.s.r + 1; r <= range.e.r; r++) {
    const row: CellValue[] = [];
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })] as XLSX.CellObject | undefined;
      const conv = convertCell(cell);
      const hi = c - range.s.c;
      if (conv.recoveredLeadingZeros) recovered.set(hi, (recovered.get(hi) ?? 0) + 1);
      if (conv.precisionLost) precision.set(hi, (precision.get(hi) ?? 0) + 1);
      if (conv.formula) formulas += 1;
      row.push(conv.value);
    }
    rows.push(row);
  }

  // Drop trailing columns with an empty header and no data.
  let width = header.length;
  while (width > 0 && header[width - 1] === '' && rows.every((r) => r[width - 1] == null || cellToText(r[width - 1]).trim() === '')) {
    width -= 1;
  }
  const table: TableData = { header: header.slice(0, width), rows: rows.map((r) => r.slice(0, width)) };

  const warnings: ImportWarning[] = [];
  const columnWarnings: SheetConversion['columnWarnings'] = [];
  for (const [hi, count] of recovered) {
    if (hi >= width) continue;
    columnWarnings.push({
      headerIndex: hi,
      warning: {
        code: 'numeric-id-recovered',
        message: `${count} sel di kolom "${header[hi] || XLSX.utils.encode_col(hi)}" tersimpan sebagai angka dengan format nol di depan; teks yang ditampilkan Excel (termasuk nol di depan) dipakai.`,
      },
    });
  }
  for (const [hi, count] of precision) {
    if (hi >= width) continue;
    columnWarnings.push({
      headerIndex: hi,
      warning: {
        code: 'numeric-precision-lost',
        message: `${count} sel di kolom "${header[hi] || XLSX.utils.encode_col(hi)}" berisi angka terlalu panjang (>15 digit) sehingga Excel sudah membulatkannya. Jika kolom ini NIM, perbaiki di berkas asal dengan format Teks.`,
      },
    });
  }
  if (formulas > 0) {
    warnings.push({
      code: 'formula-cell',
      message: `${formulas} sel berisi rumus; nilai hasil perhitungan terakhir yang tersimpan di berkas yang diimpor.`,
    });
  }
  return { table, warnings, columnWarnings };
}

/** Canonical decimal text that can be written as a number without changing its value or digits. */
const SAFE_NUMBER_TEXT = /^-?(0|[1-9]\d*)(\.\d+)?$/;

/**
 * Cell value as written to XLSX.
 * - NIM column: always text.
 * - Other columns: numbers stay numbers; canonical numeric text (e.g. pasted "85" or "90.5")
 *   is written as a number with exactly the same digits. Text with leading zeros,
 *   comma decimals, or more than 15 significant digits stays text.
 */
export function exportCell(value: CellValue, isNim: boolean): XLSX.CellObject | null {
  if (value === null || value === undefined) return null;
  if (isNim) return { t: 's', v: cellToText(value), z: '@' };
  if (typeof value === 'number') return { t: 'n', v: value };
  if (SAFE_NUMBER_TEXT.test(value) && value.replace(/[-.]/g, '').length <= 15) {
    const n = Number(value);
    // Only convert when the number prints back to exactly the same text (e.g. "90.50" stays text).
    if (Number.isFinite(n) && String(n) === value) return { t: 'n', v: n };
  }
  return { t: 's', v: value };
}

export function datasetToWorksheet(ds: Dataset): XLSX.WorkSheet {
  const ws: XLSX.WorkSheet = {};
  const cols = ds.columns;
  cols.forEach((col, c) => {
    ws[XLSX.utils.encode_cell({ r: 0, c })] = { t: 's', v: col.name };
  });
  ds.rows.forEach((row, r) => {
    cols.forEach((col, c) => {
      const cell = exportCell(row.cells[col.id] ?? null, col.id === ds.nimColumnId);
      if (cell) ws[XLSX.utils.encode_cell({ r: r + 1, c })] = cell;
    });
  });
  const lastCol = Math.max(cols.length - 1, 0);
  ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: ds.rows.length, c: lastCol } });
  ws['!cols'] = cols.map((col) => (col.width ? { wpx: col.width } : { wch: Math.max(10, col.name.length + 2) }));
  return ws;
}

/** Excel limits sheet names to 31 chars and forbids some characters. */
export function safeSheetName(name: string): string {
  const cleaned = name.replace(/[\\/?*[\]:]/g, ' ').trim().slice(0, 31);
  return cleaned || 'Sheet1';
}

export function datasetToWorkbook(ds: Dataset, sheetName?: string): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, datasetToWorksheet(ds), safeSheetName(sheetName ?? ds.name));
  return wb;
}

export function workbookToBytes(wb: XLSX.WorkBook): Uint8Array<ArrayBuffer> {
  const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx', compression: true }) as ArrayBuffer;
  return new Uint8Array(out);
}

export function safeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim() || 'syncscore';
}
