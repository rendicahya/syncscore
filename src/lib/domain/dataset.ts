import { cellToText, columnLetter, createId, isEmptyCell, normalizeStoredValue, valuesEqual } from './cells';
import type {
  CellChange,
  CellValue,
  Column,
  Dataset,
  DatasetRole,
  DatasetSnapshot,
  ImportOrigin,
  ImportWarning,
  Row,
} from './types';

export function createDataset(role: DatasetRole, name: string): Dataset {
  return {
    id: createId(),
    name,
    role,
    columns: [],
    rows: [],
    nimColumnId: null,
    nameColumnId: null,
    origins: [],
    importWarnings: [],
    revision: 0,
  };
}

/** Plain tabular data: a header row plus data rows. */
export interface TableData {
  header: string[];
  rows: CellValue[][];
}

export interface ColumnBuildResult {
  columns: Column[];
  warnings: ImportWarning[];
}

/** Creates columns from header names, making empty/duplicate names unique and reporting it. */
export function buildColumns(header: string[], existing: Column[] = []): ColumnBuildResult {
  const warnings: ImportWarning[] = [];
  const used = new Set(existing.map((c) => c.name.trim().toLowerCase()));
  const columns: Column[] = [];
  header.forEach((raw, i) => {
    let name = (raw ?? '').toString().trim();
    const id = createId();
    if (name === '') {
      name = `Kolom ${columnLetter(existing.length + i)}`;
      warnings.push({
        code: 'empty-header',
        message: `Header kolom ${columnLetter(existing.length + i)} kosong; diberi nama "${name}".`,
        columnId: id,
      });
    }
    let unique = name;
    let n = 2;
    while (used.has(unique.toLowerCase())) {
      unique = `${name} (${n})`;
      n += 1;
    }
    if (unique !== name) {
      warnings.push({
        code: 'duplicate-header',
        message: `Header "${name}" muncul lebih dari sekali; kolom berikutnya diberi nama "${unique}".`,
        columnId: id,
      });
    }
    used.add(unique.toLowerCase());
    columns.push({ id, name: unique });
  });
  return { columns, warnings };
}

function rowFromValues(columns: Column[], values: CellValue[]): Row {
  const cells: Record<string, CellValue> = {};
  columns.forEach((col, i) => {
    const v = normalizeStoredValue(values[i]);
    if (v !== null) cells[col.id] = v;
  });
  return { id: createId(), cells };
}

/** Drops trailing rows whose cells are all empty. */
export function trimTrailingEmptyRows(rows: CellValue[][]): CellValue[][] {
  let end = rows.length;
  while (end > 0 && rows[end - 1].every((v) => isEmptyCell(v))) end -= 1;
  return rows.slice(0, end);
}

/** Header name matching key used when appending data to an existing dataset. */
function headerKey(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

/** Guesses the NIM and name columns from header names. Never overrides an existing choice. */
export function detectIdentityColumns(columns: Column[]): { nim: string | null; name: string | null } {
  const nimPattern = /^(nim|npm|nrp|no\.?\s*induk(\s*mahasiswa)?|student\s*id|nomor\s*induk(\s*mahasiswa)?)$/i;
  const namePattern = /^(nama(\s*(mahasiswa|lengkap|siswa))?|name|student\s*name|full\s*name)$/i;
  const nim = columns.find((c) => nimPattern.test(c.name.trim())) ?? columns.find((c) => /\bnim\b/i.test(c.name));
  const name =
    columns.find((c) => namePattern.test(c.name.trim())) ?? columns.find((c) => /\bnama\b/i.test(c.name));
  return { nim: nim?.id ?? null, name: name?.id ?? null };
}

export interface ImportApplyOptions {
  mode: 'replace' | 'append';
  origin: Omit<ImportOrigin, 'mode' | 'rowCount' | 'importedAt'>;
  warnings?: ImportWarning[];
  /** Maps header index -> warnings tied to that header (resolved to column ids after build). */
  columnWarnings?: { headerIndex: number; warning: Omit<ImportWarning, 'columnId'> }[];
  importedAt: string;
}

/**
 * Applies imported table data to a dataset.
 * - replace: dataset content is replaced (columns re-created).
 * - append: rows are appended; columns are matched by header name, unknown headers become new columns.
 */
export function applyImportedTable(ds: Dataset, table: TableData, opts: ImportApplyOptions): Dataset {
  const dataRows = trimTrailingEmptyRows(table.rows);
  const warnings: ImportWarning[] = [...(opts.warnings ?? [])];
  let columns: Column[];
  let rows: Row[];
  let headerToColumn: Column[];

  if (opts.mode === 'replace' || ds.columns.length === 0) {
    const built = buildColumns(table.header);
    warnings.push(...built.warnings);
    columns = built.columns;
    headerToColumn = built.columns;
    rows = opts.mode === 'replace' ? [] : [...ds.rows];
  } else {
    columns = [...ds.columns];
    const byKey = new Map(columns.map((c) => [headerKey(c.name), c] as const));
    const newHeaders: { index: number; name: string }[] = [];
    headerToColumn = [];
    table.header.forEach((h, i) => {
      const existing = h.trim() !== '' ? byKey.get(headerKey(h)) : undefined;
      if (existing && !headerToColumn.includes(existing)) {
        headerToColumn[i] = existing;
      } else {
        newHeaders.push({ index: i, name: h });
      }
    });
    if (newHeaders.length) {
      const built = buildColumns(
        newHeaders.map((n) => n.name),
        columns,
      );
      warnings.push(...built.warnings);
      built.columns.forEach((col, k) => {
        headerToColumn[newHeaders[k].index] = col;
        columns.push(col);
      });
    }
    rows = [...ds.rows];
  }

  for (const values of dataRows) {
    const cells: Record<string, CellValue> = {};
    headerToColumn.forEach((col, i) => {
      if (!col) return;
      const v = normalizeStoredValue(values[i]);
      if (v !== null) cells[col.id] = v;
    });
    rows.push({ id: createId(), cells });
  }

  for (const cw of opts.columnWarnings ?? []) {
    const col = headerToColumn[cw.headerIndex];
    warnings.push({ ...cw.warning, columnId: col?.id });
  }

  const keepIdentity = opts.mode === 'append' && ds.columns.length > 0;
  let nimColumnId = keepIdentity ? ds.nimColumnId : null;
  let nameColumnId = keepIdentity ? ds.nameColumnId : null;
  if (!nimColumnId || !nameColumnId) {
    const detected = detectIdentityColumns(columns);
    nimColumnId = nimColumnId ?? detected.nim;
    nameColumnId = nameColumnId ?? detected.name;
  }

  const origin: ImportOrigin = {
    ...opts.origin,
    mode: opts.mode,
    rowCount: dataRows.length,
    importedAt: opts.importedAt,
  };

  return {
    ...ds,
    columns,
    rows,
    nimColumnId,
    nameColumnId,
    origins: opts.mode === 'replace' ? [origin] : [...ds.origins, origin],
    importWarnings: opts.mode === 'replace' ? warnings : [...ds.importWarnings, ...warnings],
    revision: ds.revision + 1,
  };
}

export function datasetFromTable(role: DatasetRole, name: string, table: TableData): Dataset {
  const ds = createDataset(role, name);
  const built = buildColumns(table.header);
  const rows = trimTrailingEmptyRows(table.rows).map((r) => rowFromValues(built.columns, r));
  const detected = detectIdentityColumns(built.columns);
  return {
    ...ds,
    columns: built.columns,
    rows,
    nimColumnId: detected.nim,
    nameColumnId: detected.name,
    importWarnings: built.warnings,
  };
}

export function toTable(ds: Dataset): TableData {
  return {
    header: ds.columns.map((c) => c.name),
    rows: ds.rows.map((r) => ds.columns.map((c) => r.cells[c.id] ?? null)),
  };
}

export function getCell(ds: Dataset, rowId: string, columnId: string): CellValue | undefined {
  const row = ds.rows.find((r) => r.id === rowId);
  if (!row) return undefined;
  if (!ds.columns.some((c) => c.id === columnId)) return undefined;
  return row.cells[columnId] ?? null;
}

export function hasCell(ds: Dataset, rowId: string, columnId: string): boolean {
  return ds.rows.some((r) => r.id === rowId) && ds.columns.some((c) => c.id === columnId);
}

/**
 * Applies cell changes (by id) and returns a new dataset.
 * Changes referencing missing rows/columns are ignored; callers must verify beforehand.
 */
export function applyCellValues(
  ds: Dataset,
  changes: { rowId: string; columnId: string; value: CellValue }[],
): Dataset {
  if (changes.length === 0) return ds;
  const byRow = new Map<string, { columnId: string; value: CellValue }[]>();
  for (const ch of changes) {
    const list = byRow.get(ch.rowId) ?? [];
    list.push({ columnId: ch.columnId, value: ch.value });
    byRow.set(ch.rowId, list);
  }
  const colIds = new Set(ds.columns.map((c) => c.id));
  const rows = ds.rows.map((row) => {
    const list = byRow.get(row.id);
    if (!list) return row;
    const cells = { ...row.cells };
    for (const { columnId, value } of list) {
      if (!colIds.has(columnId)) continue;
      const v = normalizeStoredValue(value);
      if (v === null) delete cells[columnId];
      else cells[columnId] = v;
    }
    return { ...row, cells };
  });
  return { ...ds, rows, revision: ds.revision + 1 };
}

export interface PositionalEdit {
  rowIndex: number;
  colIndex: number;
  value: CellValue;
}

export interface PositionalEditResult {
  dataset: Dataset;
  changes: CellChange[];
  /** True when rows or columns had to be created to fit the edits. */
  structural: boolean;
}

/**
 * Applies edits addressed by position (row/column index), growing the dataset when needed.
 * Unchanged values are not reported as changes.
 */
export function applyPositionalEdits(ds: Dataset, edits: PositionalEdit[]): PositionalEditResult {
  if (edits.length === 0) return { dataset: ds, changes: [], structural: false };
  let maxRow = ds.rows.length - 1;
  let maxCol = ds.columns.length - 1;
  for (const e of edits) {
    if (!isEmptyCell(e.value)) {
      maxRow = Math.max(maxRow, e.rowIndex);
      maxCol = Math.max(maxCol, e.colIndex);
    }
  }
  const columns = [...ds.columns];
  while (columns.length <= maxCol) {
    columns.push({ id: createId(), name: columnLetter(columns.length) });
  }
  const rows = [...ds.rows];
  while (rows.length <= maxRow) rows.push({ id: createId(), cells: {} });
  const structural = columns.length !== ds.columns.length || rows.length !== ds.rows.length;

  const changes: CellChange[] = [];
  const touched = new Map<number, Record<string, CellValue>>();
  for (const e of edits) {
    if (e.rowIndex < 0 || e.colIndex < 0 || e.rowIndex >= rows.length || e.colIndex >= columns.length) continue;
    const row = rows[e.rowIndex];
    const col = columns[e.colIndex];
    const cells = touched.get(e.rowIndex) ?? { ...row.cells };
    const before = cells[col.id] ?? null;
    const after = normalizeStoredValue(e.value);
    if (valuesEqual(before, after) && cellToText(before) === cellToText(after)) continue;
    if (after === null) delete cells[col.id];
    else cells[col.id] = after;
    touched.set(e.rowIndex, cells);
    changes.push({ datasetId: ds.id, rowId: row.id, columnId: col.id, before, after });
  }
  for (const [idx, cells] of touched) rows[idx] = { ...rows[idx], cells };
  if (changes.length === 0 && !structural) return { dataset: ds, changes, structural };
  return {
    dataset: { ...ds, columns, rows, revision: ds.revision + 1 },
    changes,
    structural,
  };
}

export function insertRows(ds: Dataset, index: number, count: number): Dataset {
  const at = Math.max(0, Math.min(index, ds.rows.length));
  const fresh: Row[] = Array.from({ length: count }, () => ({ id: createId(), cells: {} }));
  const rows = [...ds.rows.slice(0, at), ...fresh, ...ds.rows.slice(at)];
  return { ...ds, rows, revision: ds.revision + 1 };
}

export function deleteRows(ds: Dataset, rowIds: string[]): Dataset {
  const set = new Set(rowIds);
  const rows = ds.rows.filter((r) => !set.has(r.id));
  if (rows.length === ds.rows.length) return ds;
  return { ...ds, rows, revision: ds.revision + 1 };
}

export function insertColumns(ds: Dataset, index: number, count: number): Dataset {
  const at = Math.max(0, Math.min(index, ds.columns.length));
  const used = new Set(ds.columns.map((c) => c.name.toLowerCase()));
  const fresh: Column[] = [];
  for (let i = 0; i < count; i++) {
    let n = ds.columns.length + i + 1;
    let name = `Kolom ${n}`;
    while (used.has(name.toLowerCase())) {
      n += 1;
      name = `Kolom ${n}`;
    }
    used.add(name.toLowerCase());
    fresh.push({ id: createId(), name });
  }
  const columns = [...ds.columns.slice(0, at), ...fresh, ...ds.columns.slice(at)];
  return { ...ds, columns, revision: ds.revision + 1 };
}

export function deleteColumns(ds: Dataset, columnIds: string[]): Dataset {
  const set = new Set(columnIds);
  const columns = ds.columns.filter((c) => !set.has(c.id));
  if (columns.length === ds.columns.length) return ds;
  const rows = ds.rows.map((r) => {
    const cells = { ...r.cells };
    for (const id of columnIds) delete cells[id];
    return { ...r, cells };
  });
  return {
    ...ds,
    columns,
    rows,
    nimColumnId: ds.nimColumnId && set.has(ds.nimColumnId) ? null : ds.nimColumnId,
    nameColumnId: ds.nameColumnId && set.has(ds.nameColumnId) ? null : ds.nameColumnId,
    revision: ds.revision + 1,
  };
}

export function renameColumn(ds: Dataset, columnId: string, name: string): Dataset {
  const trimmed = name.trim();
  if (!trimmed) return ds;
  return {
    ...ds,
    columns: ds.columns.map((c) => (c.id === columnId ? { ...c, name: trimmed } : c)),
    revision: ds.revision + 1,
  };
}

export function setColumnWidth(ds: Dataset, columnId: string, width: number): Dataset {
  // Width is a UI preference; it does not bump the content revision.
  return { ...ds, columns: ds.columns.map((c) => (c.id === columnId ? { ...c, width: Math.round(width) } : c)) };
}

export function snapshotDataset(ds: Dataset): DatasetSnapshot {
  return {
    columns: ds.columns,
    rows: ds.rows,
    nimColumnId: ds.nimColumnId,
    nameColumnId: ds.nameColumnId,
    origins: ds.origins,
    importWarnings: ds.importWarnings,
  };
}

export function restoreSnapshot(ds: Dataset, snap: DatasetSnapshot): Dataset {
  return { ...ds, ...snap, revision: ds.revision + 1 };
}

/** Converts NIM cells stored as numbers to text (safe integers only). Returns the number of converted cells. */
export function convertColumnToText(ds: Dataset, columnId: string): { dataset: Dataset; converted: number } {
  let converted = 0;
  const rows = ds.rows.map((r) => {
    const v = r.cells[columnId];
    if (typeof v === 'number' && Number.isSafeInteger(v)) {
      converted += 1;
      return { ...r, cells: { ...r.cells, [columnId]: String(v) } };
    }
    return r;
  });
  if (converted === 0) return { dataset: ds, converted };
  return { dataset: { ...ds, rows, revision: ds.revision + 1 }, converted };
}
