<script lang="ts" module>
  import {
    ClipboardModule,
    EditModule,
    FilterModule,
    FormatModule,
    FrozenColumnsModule,
    InteractionModule,
    KeybindingsModule,
    ResizeColumnsModule,
    ResizeTableModule,
    SelectRangeModule,
    SortModule,
    SpreadsheetModule,
    Tabulator,
  } from 'tabulator-tables';

  // Only the modules SyncScore needs are registered (no Ajax/History/Persistence modules).
  Tabulator.registerModule([
    SpreadsheetModule,
    SelectRangeModule,
    EditModule,
    ClipboardModule,
    KeybindingsModule,
    FormatModule,
    ResizeColumnsModule,
    ResizeTableModule,
    SortModule,
    FilterModule,
    InteractionModule,
    FrozenColumnsModule,
  ]);

  export interface GridSelection {
    /** Dataset row indexes covered by the selection (may include spare rows beyond the data). */
    rowIndexes: number[];
    /** Column indexes covered by the selection. */
    colIndexes: number[];
    /** True when the selection is a single cell. */
    single: boolean;
  }
</script>

<script lang="ts">
  import { onDestroy, onMount, untrack } from 'svelte';
  import type { CellComponent, ColumnComponent, RowComponent } from 'tabulator-tables';
  import type { PositionalEdit } from '$lib/domain/dataset';
  import type { Dataset } from '$lib/domain/types';
  import type { RowMatchStatus } from '$lib/matching/engine';
  import { columnLetter } from '$lib/domain/cells';
  import { parseTsv } from '$lib/io/tsv';
  import {
    compareGridValues,
    diffForGrid,
    fieldToIndex,
    fromGridValue,
    gridIdToRowIndex,
    gridSize,
    indexToField,
    needsGrow,
    STATUS_LABEL,
    statusClass,
    toSheetData,
    type GridSize,
  } from '$lib/spreadsheet/adapter';
  import { planPaste } from '$lib/spreadsheet/paste';

  type Props = {
    dataset: Dataset;
    label: string;
    rowStatus?: Map<string, RowMatchStatus>;
    changedCells?: Set<string>;
    mappedColumns?: Set<string>;
    onEdits: (edits: PositionalEdit[], label: string) => void;
    onRenameColumn?: (colIndex: number) => void;
    onColumnResized?: (columnId: string, width: number) => void;
    onSelectionChange?: (sel: GridSelection) => void;
    onNotice?: (message: string) => void;
  };

  let {
    dataset,
    label,
    rowStatus,
    changedCells,
    mappedColumns,
    onEdits,
    onRenameColumn,
    onColumnResized,
    onSelectionChange,
    onNotice,
  }: Props = $props();

  let host: HTMLDivElement;
  let table: Tabulator | null = null;
  let built = false;
  /** Dataset currently rendered in the grid (plain reference, not reactive). */
  let rendered: Dataset | null = null;
  let size: GridSize = { rows: 0, columns: 0 };
  let searchQuery = '';
  let statusFilter: Set<RowMatchStatus> | null = null;
  let pendingEdits: PositionalEdit[] = [];
  let flushScheduled = false;

  const STATUS_CLASSES = ['st-matched', 'st-manual', 'st-unmatched', 'st-duplicate', 'st-mismatch'];
  const CELL_CLASSES = ['cell-id', 'cell-changed', 'cell-mapped-col', ...STATUS_CLASSES];

  function current(): Dataset {
    return rendered ?? dataset;
  }

  function rowIdAt(index: number): string | undefined {
    return current().rows[index]?.id;
  }

  function colIdAt(index: number): string | undefined {
    return current().columns[index]?.id;
  }

  // ------------------------------------------------------------------ formatters

  function renderTitle(el: HTMLElement, ci: number): void {
    const ds = current();
    const col = ds.columns[ci];
    el.replaceChildren();
    el.className = 'ss-col-title';
    const letter = document.createElement('span');
    letter.className = 'ss-col-letter';
    letter.textContent = columnLetter(ci);
    const name = document.createElement('span');
    name.className = col ? 'ss-col-name' : 'ss-col-name is-empty';
    name.textContent = col ? col.name : '—';
    el.append(letter, name);
    if (col && (col.id === ds.nimColumnId || col.id === ds.nameColumnId)) {
      const tag = document.createElement('span');
      tag.className = 'ss-col-tag';
      tag.textContent = col.id === ds.nimColumnId ? 'NIM' : 'Nama';
      el.append(tag);
    }
    el.title = col ? `${columnLetter(ci)} · ${col.name} (klik ganda untuk mengganti nama)` : columnLetter(ci);
  }

  function titleFormatter(cell: CellComponent): HTMLElement {
    const column = (cell as unknown as { getColumn(): ColumnComponent }).getColumn();
    const el = document.createElement('div');
    el.dataset.field = column.getField();
    renderTitle(el, fieldToIndex(column.getField()));
    return el;
  }

  function refreshHeaders(): void {
    if (!table) return;
    for (const col of table.getColumns()) {
      const field = col.getField();
      if (!field || field === '_id') continue;
      const el = (col.getElement() as HTMLElement).querySelector<HTMLElement>('.ss-col-title');
      if (el) renderTitle(el, fieldToIndex(field));
    }
  }

  function cellFormatter(cell: CellComponent): string | Node {
    const el = cell.getElement() as HTMLElement;
    el.classList.remove(...CELL_CLASSES);
    const ri = gridIdToRowIndex(cell.getRow().getData()._id);
    const ci = fieldToIndex(cell.getField());
    const rowId = rowIdAt(ri);
    const colId = colIdAt(ci);
    if (rowId && colId) {
      const ds = current();
      if (colId === ds.nimColumnId || colId === ds.nameColumnId) {
        const cls = statusClass(rowStatus?.get(rowId));
        el.classList.add('cell-id');
        if (cls) el.classList.add(cls);
      } else if (changedCells?.has(`${rowId}|${colId}`)) {
        el.classList.add('cell-changed');
      } else if (mappedColumns?.has(colId)) {
        el.classList.add('cell-mapped-col');
      }
    }
    const v = cell.getValue();
    // Text nodes: cell contents are never interpreted as HTML.
    return v === undefined || v === null || v === '' ? '' : document.createTextNode(String(v));
  }

  function rowHeaderFormatter(cell: CellComponent): string {
    const el = cell.getElement() as HTMLElement;
    el.classList.remove(...STATUS_CLASSES);
    const id = cell.getRow().getData()._id as number;
    const rowId = rowIdAt(id - 1);
    const status = rowId ? rowStatus?.get(rowId) : undefined;
    const cls = statusClass(status);
    if (cls) el.classList.add(cls);
    el.title = status ? STATUS_LABEL[status] : '';
    return String(id);
  }

  function rowFormatter(row: RowComponent): void {
    const id = row.getData()._id as number;
    (row.getElement() as HTMLElement).classList.toggle('row-padding', id > current().rows.length);
  }

  function sorter(a: unknown, b: unknown, aRow: RowComponent, bRow: RowComponent, _c: unknown, dir: string): number {
    const n = current().rows.length;
    const pa = (aRow.getData()._id as number) > n;
    const pb = (bRow.getData()._id as number) > n;
    // Spare rows always stay at the bottom, regardless of direction.
    if (pa || pb) {
      if (pa && pb) return (aRow.getData()._id as number) - (bRow.getData()._id as number);
      const r = pa ? 1 : -1;
      return dir === 'desc' ? -r : r;
    }
    return compareGridValues(a, b);
  }

  // ------------------------------------------------------------------ edits

  function queueEdit(edit: PositionalEdit): void {
    pendingEdits.push(edit);
    if (flushScheduled) return;
    flushScheduled = true;
    queueMicrotask(() => {
      flushScheduled = false;
      const edits = pendingEdits;
      pendingEdits = [];
      if (!edits.length) return;
      const lbl =
        edits.length === 1
          ? `Ubah sel ${columnLetter(edits[0].colIndex)}${edits[0].rowIndex + 1} di ${label}`
          : edits.every((e) => e.value === null)
            ? `Hapus isi ${edits.length} sel di ${label}`
            : `Ubah ${edits.length} sel di ${label}`;
      onEdits(edits, lbl);
    });
  }

  function onCellEdited(cell: CellComponent): void {
    const ri = gridIdToRowIndex(cell.getRow().getData()._id);
    const ci = fieldToIndex(cell.getField());
    if (ri < 0 || ci < 0) return;
    queueEdit({ rowIndex: ri, colIndex: ci, value: fromGridValue(cell.getValue()) });
  }

  function activeRows(): RowComponent[] {
    return table ? table.getRows('active') : [];
  }

  function handlePaste(block: string[][]): void {
    if (!table) return;
    const ranges = table.getRanges();
    const range = ranges[ranges.length - 1];
    if (!range) return;
    const rows = range.getRows();
    const cols = range.getColumns().filter((c) => c.getField() && c.getField() !== '_id');
    if (!rows.length || !cols.length) return;
    const display = activeRows().map((r) => gridIdToRowIndex(r.getData()._id));
    const startPosition = display.indexOf(gridIdToRowIndex(rows[0].getData()._id));
    const filtered = !!searchQuery || !!statusFilter;
    const plan = planPaste(block, {
      displayRows: display,
      startPosition: Math.max(0, startPosition),
      startColumn: fieldToIndex(cols[0].getField()),
      selectionRows: rows.length,
      selectionColumns: cols.length,
      filtered,
    });
    if (plan.truncatedRows) {
      onNotice?.(`${plan.truncatedRows} baris dari data tempel tidak dimasukkan karena tampilan sedang disaring.`);
    }
    if (plan.edits.length) {
      const n = block.length * Math.max(...block.map((r) => r.length));
      onEdits(plan.edits, `Tempel ${n} sel di ${label}`);
    }
  }

  // ------------------------------------------------------------------ filters

  function applyFilters(): void {
    if (!table) return;
    const q = searchQuery.trim().toLocaleLowerCase('id');
    const statuses = statusFilter;
    if (!q && !statuses) {
      table.clearFilter(true);
      return;
    }
    table.setFilter((data: Record<string, unknown>) => {
      const ri = gridIdToRowIndex(data._id);
      const ds = current();
      if (ri >= ds.rows.length) return false;
      if (statuses) {
        const st = rowStatus?.get(ds.rows[ri].id);
        if (!st || !statuses.has(st)) return false;
      }
      if (q) {
        return Object.entries(data).some(
          ([k, v]) => k !== '_id' && v !== undefined && v !== null && String(v).toLocaleLowerCase('id').includes(q),
        );
      }
      return true;
    });
  }

  // ------------------------------------------------------------------ public API

  export function setSearch(query: string): void {
    searchQuery = query;
    applyFilters();
  }

  export function setStatusFilter(statuses: Set<RowMatchStatus> | null): void {
    statusFilter = statuses && statuses.size ? statuses : null;
    applyFilters();
  }

  export function sortBy(colIndex: number | null, dir: 'asc' | 'desc' = 'asc'): void {
    if (!table) return;
    if (colIndex === null) table.clearSort();
    else table.setSort(indexToField(colIndex), dir);
  }

  export function getSelection(): GridSelection {
    const rowIndexes = new Set<number>();
    const colIndexes = new Set<number>();
    let cells = 0;
    for (const range of table?.getRanges() ?? []) {
      const rs = range.getRows();
      const cs = range.getColumns().filter((c) => c.getField() && c.getField() !== '_id');
      rs.forEach((r) => rowIndexes.add(gridIdToRowIndex(r.getData()._id)));
      cs.forEach((c) => colIndexes.add(fieldToIndex(c.getField())));
      cells += rs.length * cs.length;
    }
    return {
      rowIndexes: [...rowIndexes].filter((i) => i >= 0).sort((a, b) => a - b),
      colIndexes: [...colIndexes].filter((i) => i >= 0).sort((a, b) => a - b),
      single: cells === 1,
    };
  }

  /** Scrolls to a dataset row and selects its first cell. */
  export function revealRow(rowIndex: number): void {
    if (!table) return;
    const id = rowIndex + 1;
    void table.scrollToRow(id, 'center', false).catch(() => undefined);
    const row = table.getRow(id);
    const cell = row?.getCells().find((c) => c.getField() === 'A');
    if (cell) {
      table.getRanges().forEach((r) => r.remove());
      (table as unknown as { addRange(a: CellComponent, b: CellComponent): void }).addRange(cell, cell);
    }
  }

  // ------------------------------------------------------------------ sync from dataset

  function holder(): HTMLElement | null {
    return host?.querySelector<HTMLElement>('.tabulator-tableholder') ?? null;
  }

  function applyWidths(): void {
    if (!table) return;
    current().columns.forEach((c, i) => {
      if (c.width) table!.getColumn(indexToField(i))?.setWidth(c.width);
    });
  }

  function reload(ds: Dataset): void {
    if (!table) return;
    const h = holder();
    const top = h?.scrollTop ?? 0;
    const left = h?.scrollLeft ?? 0;
    rendered = ds;
    size = gridSize(ds);
    table.setSheets([{ title: 'Data', key: 'data', rows: size.rows, columns: size.columns, data: toSheetData(ds) }]);
    applyWidths();
    applyFilters();
    requestAnimationFrame(() => {
      const h2 = holder();
      if (h2) {
        h2.scrollTop = top;
        h2.scrollLeft = left;
      }
    });
  }

  function syncFrom(ds: Dataset): void {
    if (!table || !built) return;
    const prev = rendered;
    if (needsGrow(ds, size)) return reload(ds);
    const diff = diffForGrid(prev, ds);
    if (diff.kind === 'reload') return reload(ds);
    rendered = ds;
    if (diff.kind === 'cells') {
      const byRow = new Map<number, Record<string, unknown>>();
      for (const u of diff.updates) {
        const rowData = byRow.get(u.rowIndex) ?? { _id: u.rowIndex + 1 };
        rowData[indexToField(u.colIndex)] = u.value;
        byRow.set(u.rowIndex, rowData);
      }
      void table.updateData([...byRow.values()]);
    }
    refreshHeaders();
    refreshDecorations();
  }

  function refreshDecorations(): void {
    if (!table) return;
    for (const row of table.getRows()) row.reformat();
  }

  // ------------------------------------------------------------------ keyboard

  function onKeydown(e: KeyboardEvent): void {
    if (!table) return;
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
    const ranges = table.getRanges();
    const range = ranges[ranges.length - 1];
    if (!range) return;
    const bounds = range.getBounds() as unknown as { start?: CellComponent };
    const cell = bounds?.start;
    if (!cell || cell.getField() === '_id') return;
    const printable = e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey;
    if (e.key === 'F2' || e.key === 'Enter' || printable) {
      e.preventDefault();
      e.stopPropagation();
      cell.edit(true);
      if (printable) {
        const key = e.key;
        requestAnimationFrame(() => {
          const input = (cell.getElement() as HTMLElement).querySelector('input');
          if (input) {
            input.value = key;
            input.setSelectionRange(key.length, key.length);
          }
        });
      }
    }
  }

  // ------------------------------------------------------------------ lifecycle

  onMount(() => {
    rendered = dataset;
    size = gridSize(dataset);
    const options = {
      height: '100%',
      spreadsheet: true,
      spreadsheetRows: size.rows,
      spreadsheetColumns: size.columns,
      spreadsheetData: toSheetData(dataset),
      spreadsheetColumnDefinition: {
        editor: 'input',
        resizable: 'header',
        width: 110,
        headerSort: false,
        sorter,
        formatter: cellFormatter,
        titleFormatter,
        headerDblClick: (_e: UIEvent, column: ColumnComponent) => onRenameColumn?.(fieldToIndex(column.getField())),
      },
      rowHeader: {
        field: '_id',
        hozAlign: 'center',
        headerSort: false,
        resizable: false,
        frozen: true,
        width: 52,
        formatter: rowHeaderFormatter,
      },
      rowFormatter,
      editTriggerEvent: 'dblclick',
      selectableRange: 1,
      selectableRangeColumns: true,
      selectableRangeRows: true,
      selectableRangeClearCells: true,
      selectableRangeFill: true,
      clipboard: true,
      clipboardCopyStyled: false,
      clipboardCopyConfig: { rowHeaders: false, columnHeaders: false, columnGroups: false, columnCalcs: false },
      clipboardCopyRowRange: 'range',
      clipboardPasteParser: (text: string) => {
        const block = parseTsv(text);
        return block.length ? block : false;
      },
      clipboardPasteAction: (block: string[][]) => {
        handlePaste(block);
        return [];
      },
      keybindings: { undo: false, redo: false },
      layout: 'fitDataTable',
      renderHorizontal: 'virtual',
    };
    // Tabulator's published typings do not cover all spreadsheet/range options; the
    // option object above follows the Tabulator 6 documentation.
    table = new Tabulator(host, options as unknown as ConstructorParameters<typeof Tabulator>[1]);
    table.on('tableBuilt', () => {
      built = true;
      applyWidths();
      if (rendered !== dataset) syncFrom(dataset);
    });
    table.on('cellEdited', onCellEdited);
    table.on('columnResized', (column: ColumnComponent) => {
      const ci = fieldToIndex(column.getField());
      const id = colIdAt(ci);
      if (id) onColumnResized?.(id, column.getWidth());
    });
    const emitSelection = () => onSelectionChange?.(getSelection());
    // Range events are missing from the published typings.
    const on = table.on.bind(table) as unknown as (event: string, cb: () => void) => void;
    on('rangeChanged', emitSelection);
    on('rangeAdded', emitSelection);
    on('rangeRemoved', emitSelection);
    host.addEventListener('keydown', onKeydown, true);
  });

  onDestroy(() => {
    host?.removeEventListener('keydown', onKeydown, true);
    table?.destroy();
    table = null;
  });

  $effect(() => {
    const ds = dataset;
    untrack(() => syncFrom(ds));
  });

  $effect(() => {
    void rowStatus;
    void changedCells;
    void mappedColumns;
    untrack(() => {
      if (built) {
        refreshDecorations();
        if (statusFilter) applyFilters();
      }
    });
  });
</script>

<div class="ss-grid h-full min-h-0 w-full" role="region" aria-label={`Spreadsheet ${label}`}>
  <div bind:this={host} class="h-full"></div>
</div>
