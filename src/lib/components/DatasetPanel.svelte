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
  import { toTable } from '$lib/domain/dataset';
  import type { Dataset } from '$lib/domain/types';
  import { serializeTsv } from '$lib/io/tsv';
  import { datasetToWorkbook, safeFileName, workbookToBytes } from '$lib/io/xlsx';
  import type { RowMatchStatus } from '$lib/matching/engine';
  import { app } from '$lib/state/app.svelte';
  import { ui } from '$lib/state/ui.svelte';
  import { cn, copyText, downloadBlob } from '$lib/utils';
  import { validateDataset } from '$lib/validation/dataset';
  import ImportDialog from './ImportDialog.svelte';
  import Spreadsheet, { type GridSelection } from './Spreadsheet.svelte';
  import Button from './ui/button.svelte';
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

  async function renameDataset() {
    if (!dataset) return;
    const name = await ui.promptText({ title: 'Ganti nama dataset', label: 'Nama dataset', value: dataset.name });
    if (name) app.renameDataset(dataset.id, name);
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
          <button
            role="tab"
            aria-selected={s.id === project.activeSourceId}
            class={cn(
              'shrink-0 rounded-md px-2.5 py-1 text-[13px] whitespace-nowrap transition-colors',
              s.id === project.activeSourceId
                ? 'bg-accent font-medium text-accent-foreground'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
            onclick={() => app.setActiveSource(s.id)}
          >
            {s.name}
          </button>
        {/each}
        <Button variant="ghost" size="icon-xs" aria-label="Tambah dataset Sumber" title="Tambah dataset Sumber" onclick={() => app.addSource()}>
          <Plus />
        </Button>
      </div>
    {:else}
      <span class="min-w-0 flex-1 truncate text-[13px] text-muted-foreground">{dataset?.name}</span>
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
          Impor template SIADO (XLSX) atau tempel datanya. Baris pertama selalu dipakai sebagai header.
        {:else}
          Impor berkas nilai (XLSX) atau tempel data dari Excel/Google Sheets. Anda juga dapat mengetik langsung di grid.
        {/if}
      </div>
    {/if}

    <div class="min-h-0 flex-1">
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
    </div>
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
