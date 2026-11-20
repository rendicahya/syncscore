import { datasetFromTable } from './domain/dataset';
import type { CellValue, Dataset, DatasetRole } from './domain/types';

/** Builds a dataset from a header and rows (synthetic test data only). */
export function makeDataset(role: DatasetRole, name: string, header: string[], rows: CellValue[][]): Dataset {
  return datasetFromTable(role, name, { header, rows });
}

export function col(ds: Dataset, name: string): string {
  const c = ds.columns.find((x) => x.name === name);
  if (!c) throw new Error(`column ${name} not found`);
  return c.id;
}

export function cellsOf(ds: Dataset, column: string): CellValue[] {
  const id = col(ds, column);
  return ds.rows.map((r) => r.cells[id] ?? null);
}
