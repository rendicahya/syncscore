import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';
import { applyImportedTable, createDataset } from '../domain/dataset';
import { cellsOf, makeDataset } from '../test-utils';
import { convertCell, datasetToWorkbook, exportCell, readWorkbook, sheetToTable, workbookToBytes } from './xlsx';

function workbookBytes(build: (wb: XLSX.WorkBook) => void): Uint8Array {
  const wb = XLSX.utils.book_new();
  build(wb);
  return new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer);
}

describe('XLSX import', () => {
  it('lists worksheets and reads the selected one with the first row as header', () => {
    const bytes = workbookBytes((wb) => {
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['x'], [1]]), 'Lain');
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.aoa_to_sheet([
          ['NIM', 'Nama', 'UTS'],
          ['0215001', 'Ani', 85],
          ['0215002', 'Budi', 0],
        ]),
        'Nilai',
      );
    });
    const file = readWorkbook(bytes, 'nilai.xlsx');
    expect(file.sheets.map((s) => s.name)).toEqual(['Lain', 'Nilai']);
    const conv = sheetToTable(file, 'Nilai');
    expect(conv.table.header).toEqual(['NIM', 'Nama', 'UTS']);
    expect(conv.table.rows).toEqual([
      ['0215001', 'Ani', 85],
      ['0215002', 'Budi', 0],
    ]);
  });

  it('recovers leading zeros from numeric NIM cells with a custom number format', () => {
    const ws = XLSX.utils.aoa_to_sheet([['NIM'], [215001]]);
    ws['A2'].z = '0000000';
    const bytes = workbookBytes((wb) => XLSX.utils.book_append_sheet(wb, ws, 'S'));
    const file = readWorkbook(bytes, 'f.xlsx');
    const conv = sheetToTable(file, 'S');
    expect(conv.table.rows[0][0]).toBe('0215001');
    expect(conv.columnWarnings[0].warning.code).toBe('numeric-id-recovered');
  });

  it('flags numbers beyond safe integer precision', () => {
    expect(convertCell({ t: 'n', v: 2 ** 60 }).precisionLost).toBe(true);
  });

  it('keeps numeric grades as numbers and never changes their value', () => {
    expect(convertCell({ t: 'n', v: 85.5, w: '85.5' }).value).toBe(85.5);
    expect(convertCell({ t: 'n', v: 0, w: '0' }).value).toBe(0);
    expect(convertCell({ t: 'n', v: 0.855, w: '86%', z: '0%' }).value).toBe(0.855);
  });

  it('combines pasted data and imported data by header name (append)', () => {
    let ds = createDataset('source', 'S');
    ds = applyImportedTable(ds, { header: ['NIM', 'Nama'], rows: [['01', 'Ani']] }, {
      mode: 'replace',
      origin: { kind: 'xlsx', fileName: 'a.xlsx', sheetName: 'S' },
      importedAt: '2026-01-01',
    });
    ds = applyImportedTable(ds, { header: ['nama', 'NIM', 'UTS'], rows: [['Budi', '02', '70']] }, {
      mode: 'append',
      origin: { kind: 'paste' },
      importedAt: '2026-01-02',
    });
    expect(ds.columns.map((c) => c.name)).toEqual(['NIM', 'Nama', 'UTS']);
    expect(cellsOf(ds, 'NIM')).toEqual(['01', '02']);
    expect(cellsOf(ds, 'Nama')).toEqual(['Ani', 'Budi']);
    expect(cellsOf(ds, 'UTS')).toEqual([null, '70']);
    expect(ds.origins).toHaveLength(2);
  });
});

describe('XLSX export', () => {
  it('writes NIM as text and preserves headers and values', () => {
    const ds = makeDataset('target', 'Target', ['NIM', 'Nama', 'UTS', 'Ket'], [
      ['0215001', 'Ani', 85, 'baik'],
      ['0215002', 'Budi', '90', '007'],
      ['0215003', 'Citra', 0, '90.50'],
    ]);
    const bytes = workbookToBytes(datasetToWorkbook(ds));
    const wb = XLSX.read(bytes, { type: 'array' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    expect(ws['A1'].v).toBe('NIM');
    expect(ws['A2'].t).toBe('s');
    expect(ws['A2'].v).toBe('0215001');
    expect(ws['C2'].v).toBe(85);
    expect(ws['C3']).toMatchObject({ t: 'n', v: 90 });
    expect(ws['C4']).toMatchObject({ t: 'n', v: 0 });
    expect(ws['D3']).toMatchObject({ t: 's', v: '007' });
    expect(ws['D4']).toMatchObject({ t: 's', v: '90.50' });
  });

  it('round-trips export -> import without altering values', () => {
    const ds = makeDataset('target', 'Target', ['NIM', 'Nama', 'Nilai'], [
      ['0011', 'Ani', 0],
      ['0022', 'Budi', 77.25],
    ]);
    const file = readWorkbook(workbookToBytes(datasetToWorkbook(ds)), 'x.xlsx');
    const conv = sheetToTable(file, file.sheets[0].name);
    expect(conv.table.rows).toEqual([
      ['0011', 'Ani', 0],
      ['0022', 'Budi', 77.25],
    ]);
  });

  it('exportCell keeps long digit strings as text', () => {
    expect(exportCell('1234567890123456', false)).toMatchObject({ t: 's' });
    expect(exportCell('85,5', false)).toMatchObject({ t: 's' });
    expect(exportCell(123, true)).toMatchObject({ t: 's', v: '123' });
  });
});
