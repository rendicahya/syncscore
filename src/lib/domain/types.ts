/**
 * Core domain model for SyncScore.
 *
 * This model is independent of Svelte and Tabulator. Spreadsheet adapters
 * translate between this model and the grid representation.
 */

/** A single spreadsheet cell value. Booleans/dates are stored as their displayed text. */
export type CellValue = string | number | null;

export interface Column {
  id: string;
  name: string;
  /** Optional display width in pixels (UI preference only). */
  width?: number;
}

export interface Row {
  id: string;
  /** Cell values keyed by column id. Missing keys mean empty cells. */
  cells: Record<string, CellValue>;
}

export type DatasetRole = 'source' | 'target';

export interface ImportOrigin {
  kind: 'xlsx' | 'paste';
  fileName?: string;
  sheetName?: string;
  mode: 'replace' | 'append';
  importedAt: string;
  rowCount: number;
}

export type ImportWarningCode =
  | 'numeric-id-recovered'
  | 'numeric-precision-lost'
  | 'scientific-notation'
  | 'duplicate-header'
  | 'empty-header'
  | 'formula-cell'
  | 'ragged-rows';

export interface ImportWarning {
  code: ImportWarningCode;
  message: string;
  columnId?: string;
  rowId?: string;
}

export interface Dataset {
  id: string;
  name: string;
  role: DatasetRole;
  columns: Column[];
  rows: Row[];
  /** Column holding the student NIM (identifier). */
  nimColumnId: string | null;
  /** Column holding the student name (validation only). */
  nameColumnId: string | null;
  origins: ImportOrigin[];
  importWarnings: ImportWarning[];
  /** Incremented on every content change; used to detect stale previews and undo conflicts. */
  revision: number;
}

/** One Source column mapped to one Target column. */
export interface ColumnPair {
  sourceColumnId: string;
  targetColumnId: string;
}

/** A user-confirmed pairing between a Source row and a Target row. */
export interface ManualMatch {
  id: string;
  sourceDatasetId: string;
  sourceRowId: string;
  targetRowId: string;
  createdAt: string;
  /** Snapshot of identity values at confirmation time (for display/audit). */
  sourceNim: string;
  targetNim: string;
  sourceName: string;
  targetName: string;
}

/**
 * Explicit approval of an exact-NIM match whose names differ.
 * Valid only while both names still equal the approved snapshot.
 */
export interface NameApproval {
  id: string;
  sourceDatasetId: string;
  sourceRowId: string;
  targetRowId: string;
  sourceName: string;
  targetName: string;
  approvedAt: string;
}

export interface CellChange {
  datasetId: string;
  rowId: string;
  columnId: string;
  before: CellValue;
  after: CellValue;
}

export type OperationStatus = 'applied' | 'undone';

interface OperationBase {
  id: string;
  timestamp: string;
  label: string;
  status: OperationStatus;
  /** Timestamp of the latest undo/redo, if any. */
  statusChangedAt?: string;
}

export interface SyncSourceSummary {
  datasetId: string;
  datasetName: string;
  pairs: {
    sourceColumnId: string;
    sourceColumnName: string;
    targetColumnId: string;
    targetColumnName: string;
  }[];
}

export interface SyncStats {
  processedRecords: number;
  filled: number;
  overwritten: number;
  overwriteDeclined: number;
  unchanged: number;
  skippedEmpty: number;
  unmatchedSource: number;
  unmatchedTarget: number;
  duplicates: number;
  nameMismatches: number;
  conflicts: number;
}

export interface SyncOperation extends OperationBase {
  type: 'sync';
  targetDatasetId: string;
  sources: SyncSourceSummary[];
  stats: SyncStats;
  changes: CellChange[];
}

export interface EditOperation extends OperationBase {
  type: 'edit';
  datasetId: string;
  changes: CellChange[];
}

/** Snapshot of the structural part of a dataset. */
export interface DatasetSnapshot {
  columns: Column[];
  rows: Row[];
  nimColumnId: string | null;
  nameColumnId: string | null;
  origins: ImportOrigin[];
  importWarnings: ImportWarning[];
}

/**
 * Structural change (rows/columns added or removed, import). Stored as before/after snapshots.
 * It can be undone only while the dataset content still equals `after` (and redone only while
 * it equals `before`), so unrelated later edits are never destroyed.
 */
export interface StructureOperation extends OperationBase {
  type: 'structure';
  datasetId: string;
  before: DatasetSnapshot;
  after: DatasetSnapshot;
}

export type Operation = SyncOperation | EditOperation | StructureOperation;

export interface ProjectSettings {
  /** Default overwrite behaviour pre-selected in the preview dialog. */
  defaultOverwrite: 'skip' | 'ask';
}

export interface Project {
  schemaVersion: number;
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  target: Dataset;
  sources: Dataset[];
  activeSourceId: string | null;
  /** Column mapping configuration per Source dataset id. */
  mappings: Record<string, ColumnPair[]>;
  manualMatches: ManualMatch[];
  nameApprovals: NameApproval[];
  history: Operation[];
  /** Operation ids that can be redone, most recent last. */
  redoStack: string[];
  settings: ProjectSettings;
}

export interface ProjectSummary {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}
