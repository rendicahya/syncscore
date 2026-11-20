<script lang="ts">
  import { DropdownMenu } from 'bits-ui';
  import ArrowDownUp from '@lucide/svelte/icons/arrow-down-up';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import CircleAlert from '@lucide/svelte/icons/circle-alert';
  import ClipboardCopy from '@lucide/svelte/icons/clipboard-copy';
  import ClipboardPaste from '@lucide/svelte/icons/clipboard-paste';
  import Columns3 from '@lucide/svelte/icons/columns-3';
  import Download from '@lucide/svelte/icons/download';
  import FileUp from '@lucide/svelte/icons/file-up';
  import Filter from '@lucide/svelte/icons/filter';
  import Info from '@lucide/svelte/icons/info';
  import Pencil from '@lucide/svelte/icons/pencil';
  import Plus from '@lucide/svelte/icons/plus';
  import Rows3 from '@lucide/svelte/icons/rows-3';
  import Search from '@lucide/svelte/icons/search';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
  import Type from '@lucide/svelte/icons/type';
  import EllipsisVertical from '@lucide/svelte/icons/ellipsis-vertical';
  import Table2 from '@lucide/svelte/icons/table-2';
  import Target from '@lucide/svelte/icons/target';
  import ArrowDownAZ from '@lucide/svelte/icons/arrow-down-a-z';
  import ArrowDownToLine from '@lucide/svelte/icons/arrow-down-to-line';
  import ArrowLeftToLine from '@lucide/svelte/icons/arrow-left-to-line';
  import ArrowRightToLine from '@lucide/svelte/icons/arrow-right-to-line';
  import ArrowUpToLine from '@lucide/svelte/icons/arrow-up-to-line';
  import ArrowUpZA from '@lucide/svelte/icons/arrow-up-z-a';
  import Copy from '@lucide/svelte/icons/copy';
  import Eraser from '@lucide/svelte/icons/eraser';
  import FolderOpen from '@lucide/svelte/icons/folder-open';
  import IdCard from '@lucide/svelte/icons/id-card';
  import ListRestart from '@lucide/svelte/icons/list-restart';
  import Scissors from '@lucide/svelte/icons/scissors';
  import UserRound from '@lucide/svelte/icons/user-round';
  import { toTable } from '$lib/domain/dataset';
  import type { Dataset } from '$lib/domain/types';
  import { parseTsv, serializeTsv } from '$lib/io/tsv';
  import { datasetToWorkbook, safeFileName, workbookToBytes } from '$lib/io/xlsx';
  import type { RowMatchStatus } from '$lib/matching/engine';
  import { app } from '$lib/state/app.svelte';
  import { ui } from '$lib/state/ui.svelte';
  import { cn, copyText, downloadBlob, readClipboardText } from '$lib/utils';
  import { validateDataset } from '$lib/validation/dataset';
  import ImportDialog from './ImportDialog.svelte';
  import Spreadsheet, { type GridSelection } from './Spreadsheet.svelte';
  import Button from './ui/button.svelte';
  import ContextMenu, { type ContextMenuEntry } from './ui/context-menu.svelte';
  import Select from './ui/select.svelte';
  import { menuContent, menuItem, menuItemDestructive, menuLabel, menuSeparator } from './ui/menu';

  type Props = { role: 'source' | 'target' };
  let { role }: Props = $props();

  const project = $derived(app.project!);
  const dataset: Dataset | null = $derived(role === 'target' ? project.target : app.activeSource);
  const match = $derived(app.activeMatch);
  const rowStatus = $derived(match ? (role === 'target' ? match.targetStatus : match.sourceStatus) : undefined);
  const mappedColumns = $derived.by(() => {
    const src = app.activeSource;
    if (!src) return new Set<string>();
    const pairs = project.mappings[src.id] ?? [];
    return new Set(pairs.map((p) => (role === 'target' ? p.targetColumnId : p.sourceColumnId)));
  });
  const changedCells = $derived(role === 'target' ? app.changedTargetCells : undefined);
  const issues = $derived(dataset ? validateDataset(dataset) : []);
  const importWarnings = $derived(dataset?.importWarnings ?? []);

  let grid = $state<ReturnType<typeof Spreadsheet> | null>(null);
  let selection = $state<GridSelection>({ rowIndexes: [], colIndexes: [], single: true });
  let search = $state('');
  let statusFilter = $state('');
  let sortCol = $state('');
  let sortDir = $state<'asc' | 'desc'>('asc');
  let importOpen = $state(false);
  let importTab = $state<'file' | 'paste'>('file');
  let showIssues = $state(false);

  const FILTERS: { value: string; label: string; statuses: RowMatchStatus[] }[] = [
    { value: 'matched', label: 'Cocok', statuses: ['matched', 'name-approved'] },
    { value: 'manual', label: 'Pasangan manual', statuses: ['manual'] },
    { value: 'mismatch', label: 'Beda nama (perlu tinjau)', statuses: ['name-mismatch'] },
    { value: 'unmatched', label: 'Tidak berpasangan', statuses: ['unmatched'] },
    { value: 'duplicate', label: 'NIM duplikat/tidak valid', statuses: ['duplicate', 'invalid-nim'] },
  ];

  $effect(() => {
    grid?.setSearch(search);
  });
  $effect(() => {
    const f = FILTERS.find((x) => x.value === statusFilter);
    grid?.setStatusFilter(f ? new Set(f.statuses) : null);
  });
  $effect(() => {
    grid?.sortBy(sortCol === '' ? null : Number(sortCol), sortDir);
  });

  // Reset view state when switching dataset.
  let lastId = '';
  $effect(() => {
    const id = dataset?.id ?? '';
    if (id !== lastId) {
      lastId = id;
      search = '';
      statusFilter = '';
      sortCol = '';
    }
  });

  const title = $derived(role === 'target' ? 'Target' : 'Sumber');
  const errorCount = $derived(issues.filter((i) => i.severity === 'error').length);
  const warnCount = $derived(issues.filter((i) => i.severity !== 'error').length + importWarnings.length);

  function openImport(tab: 'file' | 'paste') {
    importTab = tab;
    importOpen = true;
  }

  async function copyAll() {
    if (!dataset) return;
    const t = toTable(dataset);
    try {
      await copyText(serializeTsv([t.header, ...t.rows]));
      ui.toast('success', 'Tabel disalin', `${t.rows.length} baris (termasuk header) siap ditempel di Excel/Google Sheets.`);
    } catch {
      ui.toast('error', 'Tidak dapat menyalin', 'Browser menolak akses clipboard.');
    }
  }

  function exportXlsx() {
    if (!dataset) return;
    if (dataset.columns.length === 0) {
      ui.toast('warning', 'Dataset kosong', 'Tidak ada data untuk diekspor.');
      return;
    }
    const bytes = workbookToBytes(datasetToWorkbook(dataset));
    downloadBlob(
      bytes,
      `${safeFileName(`${project.name} - ${dataset.name}`)}.xlsx`,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
  }

  async function renameColumnAt(ci: number) {
    if (!dataset) return;
    const col = dataset.columns[ci];
    if (!col) {
      ui.toast('info', 'Kolom kosong', 'Ketik data di kolom ini terlebih dahulu, atau gunakan "Tambah kolom".');
      return;
    }
    const name = await ui.promptText({ title: 'Ganti nama kolom', label: `Nama baru untuk kolom "${col.name}"`, value: col.name });
    if (name) app.renameColumn(dataset.id, col.id, name);
  }

  function renameDataset() {
    if (dataset) void renameDatasetById(dataset);
  }

  function selectedRowIds(): string[] {
    if (!dataset) return [];
    return selection.rowIndexes.filter((i) => i < dataset.rows.length).map((i) => dataset.rows[i].id);
  }

  function selectedColIds(): string[] {
    if (!dataset) return [];
    return selection.colIndexes.filter((i) => i < dataset.columns.length).map((i) => dataset.columns[i].id);
  }

  function insertRow(where: 'above' | 'below') {
    if (!dataset) return;
    const rows = selection.rowIndexes;
    const base = rows.length ? (where === 'above' ? rows[0] : rows[rows.length - 1] + 1) : dataset.rows.length;
    app.insertRows(dataset.id, Math.min(base, dataset.rows.length), 1);
  }

  function insertCol(where: 'left' | 'right') {
    if (!dataset) return;
    const cols = selection.colIndexes;
    const base = cols.length ? (where === 'left' ? cols[0] : cols[cols.length - 1] + 1) : dataset.columns.length;
    app.insertColumns(dataset.id, Math.min(base, dataset.columns.length), 1);
  }

  async function copySelection(cut = false) {
    if (!grid) return;
    const matrix = grid.getSelectionMatrix();
    if (!matrix.length) return;
    try {
      await copyText(serializeTsv(matrix));
    } catch {
      ui.toast('error', 'Tidak dapat menyalin', 'Browser menolak akses clipboard. Gunakan Ctrl+C.');
      return;
    }
    if (cut) grid.clearSelected();
  }

  async function pasteFromClipboard() {
    if (!grid) return;
    const text = await readClipboardText();
    if (text === null) {
      ui.toast('info', 'Gunakan Ctrl+V untuk menempel', 'Browser tidak mengizinkan menu membaca clipboard secara langsung.');
      return;
    }
    const block = parseTsv(text);
    if (!block.length) {
      ui.toast('info', 'Clipboard kosong');
      return;
    }
    grid.pasteBlock(block);
  }

  function sortByColumn(ci: number, dir: 'asc' | 'desc') {
    sortCol = String(ci);
    sortDir = dir;
  }

  function gridMenu(): ContextMenuEntry[] {
    if (!dataset || !grid) return [];
    selection = grid.getSelection();
    const ds = dataset;
    const hasSel = selection.rowIndexes.length > 0 && selection.colIndexes.length > 0;
    const rowIds = selectedRowIds();
    const colIds = selectedColIds();
    const singleCol = selection.colIndexes.length === 1 ? ds.columns[selection.colIndexes[0]] : undefined;
    const ci = selection.colIndexes[0];
    const entries: ContextMenuEntry[] = [
      { label: 'Potong', icon: Scissors, shortcut: 'Ctrl+X', disabled: !hasSel, onSelect: () => copySelection(true) },
      { label: 'Salin', icon: Copy, shortcut: 'Ctrl+C', disabled: !hasSel, onSelect: () => copySelection() },
      { label: 'Tempel', icon: ClipboardPaste, shortcut: 'Ctrl+V', disabled: !hasSel, onSelect: pasteFromClipboard },
      { label: 'Hapus isi sel', icon: Eraser, shortcut: 'Del', disabled: !hasSel, onSelect: () => grid?.clearSelected() },
      { kind: 'separator' },
      { label: 'Sisipkan baris di atas', icon: ArrowUpToLine, onSelect: () => insertRow('above') },
      { label: 'Sisipkan baris di bawah', icon: ArrowDownToLine, onSelect: () => insertRow('below') },
      {
        label: rowIds.length > 1 ? `Hapus ${rowIds.length} baris` : 'Hapus baris',
        icon: Trash2,
        destructive: true,
        disabled: rowIds.length === 0,
        onSelect: () => app.deleteRows(ds.id, rowIds),
      },
      { kind: 'separator' },
      { label: 'Sisipkan kolom di kiri', icon: ArrowLeftToLine, onSelect: () => insertCol('left') },
      { label: 'Sisipkan kolom di kanan', icon: ArrowRightToLine, onSelect: () => insertCol('right') },
    ];
    if (singleCol) {
      entries.push(
        { label: `Ganti nama kolom "${singleCol.name}"`, icon: Type, onSelect: () => renameColumnAt(ci) },
        {
          label: 'Jadikan kolom NIM',
          icon: IdCard,
          disabled: ds.nimColumnId === singleCol.id,
          onSelect: () => app.setIdentityColumn(ds.id, 'nim', singleCol.id),
        },
        {
          label: 'Jadikan kolom Nama',
          icon: UserRound,
          disabled: ds.nameColumnId === singleCol.id,
          onSelect: () => app.setIdentityColumn(ds.id, 'name', singleCol.id),
        },
      );
    }
    entries.push(
      {
        label: colIds.length > 1 ? `Hapus ${colIds.length} kolom` : 'Hapus kolom',
        icon: Trash2,
        destructive: true,
        disabled: colIds.length === 0,
        onSelect: () => app.deleteColumns(ds.id, colIds),
      },
      { kind: 'separator' },
    );
    if (singleCol) {
      entries.push(
        { label: 'Urutkan tampilan A→Z', icon: ArrowDownAZ, onSelect: () => sortByColumn(ci, 'asc') },
        { label: 'Urutkan tampilan Z→A', icon: ArrowUpZA, onSelect: () => sortByColumn(ci, 'desc') },
      );
    }
    if (sortCol !== '') entries.push({ label: 'Kembalikan urutan asli', icon: ListRestart, onSelect: () => (sortCol = '') });
    entries.push({ kind: 'separator' }, { label: 'Salin seluruh tabel', icon: ClipboardCopy, onSelect: copyAll });
    return entries;
  }

  function sourceTabMenu(s: Dataset): ContextMenuEntry[] {
    return [
      { label: 'Buka', icon: FolderOpen, disabled: s.id === project.activeSourceId, onSelect: () => app.setActiveSource(s.id) },
      { label: 'Ganti nama', icon: Pencil, onSelect: () => renameDatasetById(s) },
      { label: 'Tambah dataset Sumber', icon: Plus, onSelect: () => app.addSource() },
      { kind: 'separator' },
      { label: 'Hapus dataset ini', icon: Trash2, destructive: true, onSelect: () => app.removeSource(s.id) },
    ];
  }

  async function renameDatasetById(ds: Dataset) {
    const name = await ui.promptText({ title: 'Ganti nama dataset', label: 'Nama dataset', value: ds.name });
    if (name) app.renameDataset(ds.id, name);
  }

  function convertNim() {
    if (!dataset) return;
    const n = app.convertNimToText(dataset.id);
    ui.toast('info', n ? `${n} NIM diubah menjadi teks` : 'Tidak ada NIM berupa angka');
  }

  const sourceTabs = $derived(project.sources);
</script>

<section class="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border bg-card shadow-xs" aria-label={`Panel ${title}`}>
  <header class="flex flex-wrap items-center gap-2 border-b px-3 py-2">
    <div class="flex items-center gap-2">
      <span
        class={cn(
          'flex size-7 items-center justify-center rounded-md',
          role === 'target' ? 'bg-primary/10 text-primary' : 'bg-secondary text-secondary-foreground',
        )}
      >
        {#if role === 'target'}<Target class="size-4" />{:else}<Table2 class="size-4" />{/if}
      </span>
      <h2 class="text-sm font-semibold">{title}</h2>
    </div>

    {#if role === 'source'}
      <div class="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto" role="tablist" aria-label="Dataset Sumber">
        {#each sourceTabs as s (s.id)}
          <ContextMenu items={() => sourceTabMenu(s)} class="shrink-0">
            <button
              role="tab"
              aria-selected={s.id === project.activeSourceId}
              class={cn(
                'rounded-md px-2.5 py-1 text-[13px] whitespace-nowrap transition-colors',
                s.id === project.activeSourceId
                  ? 'bg-accent font-medium text-accent-foreground'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
              onclick={() => app.setActiveSource(s.id)}
            >
              {s.name}
            </button>
          </ContextMenu>
        {/each}
        <Button variant="ghost" size="icon-xs" aria-label="Tambah dataset Sumber" title="Tambah dataset Sumber" onclick={() => app.addSource()}>
          <Plus />
        </Button>
      </div>
    {:else}
      <ContextMenu
        as="span"
        class="min-w-0 flex-1 truncate text-[13px] text-muted-foreground"
        items={[{ label: 'Ganti nama dataset', icon: Pencil, onSelect: renameDataset }]}
      >
        {dataset?.name}
      </ContextMenu>
    {/if}

    {#if dataset}
      <DropdownMenu.Root>
        <DropdownMenu.Trigger class="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground" aria-label="Menu dataset">
          <EllipsisVertical class="size-4" />
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content class={menuContent} align="end" sideOffset={4}>
            <DropdownMenu.Item class={menuItem} onSelect={renameDataset}><Pencil /> Ganti nama dataset</DropdownMenu.Item>
            {#if role === 'source'}
              <DropdownMenu.Item class={menuItem} onSelect={() => app.addSource()}><Plus /> Tambah dataset Sumber</DropdownMenu.Item>
              {#if project.sources.length > 1 || dataset.rows.length > 0}
                <DropdownMenu.Separator class={menuSeparator} />
                <DropdownMenu.Item class={menuItemDestructive} onSelect={() => app.removeSource(dataset!.id)}>
                  <Trash2 /> Hapus dataset ini
                </DropdownMenu.Item>
              {/if}
            {/if}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    {/if}
  </header>

  {#if !dataset}
    <div class="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center text-sm text-muted-foreground">
      <p>Belum ada dataset Sumber.</p>
      <Button size="sm" onclick={() => app.addSource()}><Plus /> Tambah dataset Sumber</Button>
    </div>
  {:else}
    <div class="flex flex-wrap items-center gap-x-3 gap-y-2 border-b px-3 py-2">
      <div class="flex items-center gap-1.5">
        <label for={`${role}-nim`} class="text-xs font-medium text-muted-foreground">Kolom NIM</label>
        <Select
          id={`${role}-nim`}
          class={cn('h-8 w-36 text-[13px]', !dataset.nimColumnId && dataset.columns.length ? 'border-destructive' : '')}
          value={dataset.nimColumnId ?? ''}
          onchange={(e) => app.setIdentityColumn(dataset!.id, 'nim', (e.currentTarget as HTMLSelectElement).value || null)}
        >
          <option value="">— pilih —</option>
          {#each dataset.columns as c (c.id)}<option value={c.id}>{c.name}</option>{/each}
        </Select>
      </div>
      <div class="flex items-center gap-1.5">
        <label for={`${role}-name`} class="text-xs font-medium text-muted-foreground">Kolom Nama</label>
        <Select
          id={`${role}-name`}
          class="h-8 w-36 text-[13px]"
          value={dataset.nameColumnId ?? ''}
          onchange={(e) => app.setIdentityColumn(dataset!.id, 'name', (e.currentTarget as HTMLSelectElement).value || null)}
        >
          <option value="">— tidak ada —</option>
          {#each dataset.columns as c (c.id)}<option value={c.id}>{c.name}</option>{/each}
        </Select>
      </div>
      <span class="text-xs text-muted-foreground tabular-nums">{dataset.rows.length} baris · {dataset.columns.length} kolom</span>
      {#if errorCount || warnCount}
        <button
          class={cn(
            'ml-auto inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium',
            errorCount ? 'bg-destructive/10 text-destructive' : 'bg-st-mismatch text-st-mismatch-fg',
          )}
          aria-expanded={showIssues}
          onclick={() => (showIssues = !showIssues)}
        >
          {#if errorCount}<CircleAlert class="size-3.5" />{:else}<TriangleAlert class="size-3.5" />{/if}
          {errorCount ? `${errorCount} masalah` : ''}{errorCount && warnCount ? ', ' : ''}{warnCount ? `${warnCount} peringatan` : ''}
          <ChevronDown class={cn('size-3.5 transition-transform', showIssues && 'rotate-180')} />
        </button>
      {/if}
    </div>

    {#if showIssues && (issues.length || importWarnings.length)}
      <ul class="max-h-40 space-y-1 overflow-auto border-b bg-muted/40 px-3 py-2 text-[13px]">
        {#each issues as issue, i (i)}
          <li class="flex items-start gap-2">
            {#if issue.severity === 'error'}<CircleAlert class="mt-0.5 size-3.5 shrink-0 text-destructive" />{:else}<TriangleAlert class="mt-0.5 size-3.5 shrink-0 text-st-mismatch-fg" />{/if}
            <span class="flex-1">{issue.message}</span>
            {#if (issue.code === 'numeric-nim' || issue.code === 'nim-length-mismatch') && issue.rowIds?.length}
              <Button variant="outline" size="xs" onclick={convertNim}>Ubah ke teks</Button>
            {/if}
            {#if issue.rowIds?.length}
              <Button
                variant="ghost"
                size="xs"
                onclick={() => {
                  const idx = dataset!.rows.findIndex((r) => r.id === issue.rowIds![0]);
                  if (idx >= 0) grid?.revealRow(idx);
                }}>Lihat</Button
              >
            {/if}
          </li>
        {/each}
        {#each importWarnings as w, i (i)}
          <li class="flex items-start gap-2"><Info class="mt-0.5 size-3.5 shrink-0 text-muted-foreground" /><span>{w.message}</span></li>
        {/each}
      </ul>
    {/if}

    <div class="flex flex-wrap items-center gap-1.5 border-b px-3 py-1.5">
      <Button variant="outline" size="xs" onclick={() => openImport('file')}><FileUp /> Impor XLSX</Button>
      <Button variant="outline" size="xs" onclick={() => openImport('paste')}><ClipboardPaste /> Tempel data</Button>
      <Button variant="ghost" size="xs" onclick={copyAll} title="Salin seluruh tabel (dengan header) ke clipboard"><ClipboardCopy /> Salin semua</Button>
      <Button variant={role === 'target' ? 'secondary' : 'ghost'} size="xs" onclick={exportXlsx}><Download /> Ekspor XLSX</Button>

      <DropdownMenu.Root>
        <DropdownMenu.Trigger class="inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium hover:bg-accent" aria-label="Baris dan kolom">
          <Rows3 class="size-4" /> Baris/Kolom <ChevronDown class="size-3" />
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content class={menuContent} sideOffset={4}>
            <div class={menuLabel}>Baris</div>
            <DropdownMenu.Item class={menuItem} onSelect={() => insertRow('above')}><Plus /> Sisipkan baris di atas</DropdownMenu.Item>
            <DropdownMenu.Item class={menuItem} onSelect={() => insertRow('below')}><Plus /> Sisipkan baris di bawah</DropdownMenu.Item>
            <DropdownMenu.Item class={menuItemDestructive} disabled={selectedRowIds().length === 0} onSelect={() => app.deleteRows(dataset!.id, selectedRowIds())}>
              <Trash2 /> Hapus baris terpilih
            </DropdownMenu.Item>
            <DropdownMenu.Separator class={menuSeparator} />
            <div class={menuLabel}>Kolom</div>
            <DropdownMenu.Item class={menuItem} onSelect={() => insertCol('left')}><Columns3 /> Sisipkan kolom di kiri</DropdownMenu.Item>
            <DropdownMenu.Item class={menuItem} onSelect={() => insertCol('right')}><Columns3 /> Sisipkan kolom di kanan</DropdownMenu.Item>
            <DropdownMenu.Item class={menuItem} disabled={selection.colIndexes.length !== 1} onSelect={() => renameColumnAt(selection.colIndexes[0])}>
              <Type /> Ganti nama kolom
            </DropdownMenu.Item>
            <DropdownMenu.Item class={menuItemDestructive} disabled={selectedColIds().length === 0} onSelect={() => app.deleteColumns(dataset!.id, selectedColIds())}>
              <Trash2 /> Hapus kolom terpilih
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>

      <div class="ml-auto flex flex-wrap items-center gap-1.5">
        <div class="relative">
          <Search class="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            bind:value={search}
            placeholder="Cari…"
            aria-label={`Cari di ${title}`}
            class="h-7 w-32 rounded-md border border-input bg-card pr-2 pl-7 text-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40 sm:w-40"
          />
        </div>
        <div class="relative">
          <Filter class="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <select
            bind:value={statusFilter}
            aria-label="Saring berdasarkan status pencocokan"
            class="h-7 rounded-md border border-input bg-card pr-1 pl-7 text-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40"
          >
            <option value="">Semua baris</option>
            {#each FILTERS as f (f.value)}<option value={f.value}>{f.label}</option>{/each}
          </select>
        </div>
        <div class="relative flex items-center">
          <ArrowDownUp class="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <select
            bind:value={sortCol}
            aria-label="Urutkan tampilan"
            class="h-7 max-w-36 rounded-l-md border border-input bg-card pr-1 pl-7 text-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40"
          >
            <option value="">Urutan asli</option>
            {#each dataset.columns as c, i (c.id)}<option value={String(i)}>{c.name}</option>{/each}
          </select>
          <button
            class="h-7 rounded-r-md border border-l-0 border-input bg-card px-2 text-xs disabled:opacity-50"
            disabled={sortCol === ''}
            aria-label={sortDir === 'asc' ? 'Urut naik' : 'Urut turun'}
            onclick={() => (sortDir = sortDir === 'asc' ? 'desc' : 'asc')}>{sortDir === 'asc' ? 'A→Z' : 'Z→A'}</button
          >
        </div>
      </div>
    </div>

    {#if dataset.columns.length === 0}
      <div class="border-b bg-accent/40 px-3 py-2 text-[13px] text-accent-foreground">
        {#if role === 'target'}
          Impor berkas Target (XLSX) atau tempel datanya. Baris pertama selalu dipakai sebagai header.
        {:else}
          Impor berkas nilai (XLSX) atau tempel data dari Excel/Google Sheets. Anda juga dapat mengetik langsung di grid.
        {/if}
      </div>
    {/if}

    <ContextMenu class="min-h-0 flex-1" items={gridMenu} restoreFocus={() => grid?.focusGrid()}>
      {#key dataset.id}
        <Spreadsheet
          bind:this={grid}
          {dataset}
          label={dataset.name}
          {rowStatus}
          {changedCells}
          {mappedColumns}
          onEdits={(edits, label) => app.applyGridEdits(dataset!.id, edits, label)}
          onRenameColumn={renameColumnAt}
          onColumnResized={(colId, w) => app.setColumnWidth(dataset!.id, colId, w)}
          onSelectionChange={(s) => (selection = s)}
          onNotice={(m) => ui.toast('warning', 'Sebagian data tidak ditempel', m)}
        />
      {/key}
    </ContextMenu>
    {#if sortCol !== '' || search || statusFilter}
      <div class="border-t bg-muted/40 px-3 py-1 text-[11px] text-muted-foreground">
        Pengurutan dan penyaringan hanya mengubah tampilan; urutan baris data tidak berubah.
      </div>
    {/if}
  {/if}
</section>

{#if dataset}
  <ImportDialog bind:open={importOpen} datasetId={dataset.id} initialTab={importTab} />
{/if}
