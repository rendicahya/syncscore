<script lang="ts">
  import FileSpreadsheet from '@lucide/svelte/icons/file-spreadsheet';
  import ClipboardPaste from '@lucide/svelte/icons/clipboard-paste';
  import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
  import Upload from '@lucide/svelte/icons/upload';
  import { cellToText } from '$lib/domain/cells';
  import type { TableData } from '$lib/domain/dataset';
  import type { ImportWarning } from '$lib/domain/types';
  import { normalizeRectangular, parseTsv } from '$lib/io/tsv';
  import { ImportError, readWorkbook, sheetToTable, type SheetConversion, type WorkbookFile } from '$lib/io/xlsx';
  import { app } from '$lib/state/app.svelte';
  import { ui } from '$lib/state/ui.svelte';
  import { cn } from '$lib/utils';
  import Button from './ui/button.svelte';
  import Dialog from './ui/dialog.svelte';
  import Select from './ui/select.svelte';

  type Props = { open: boolean; datasetId: string; initialTab?: 'file' | 'paste' };
  let { open = $bindable(false), datasetId, initialTab = 'file' }: Props = $props();

  let tab = $state<'file' | 'paste'>('file');
  let workbook = $state.raw<WorkbookFile | null>(null);
  let sheetName = $state('');
  let conversion = $state.raw<SheetConversion | null>(null);
  let pasteText = $state('');
  let mode = $state<'replace' | 'append'>('replace');
  let error = $state<string | null>(null);
  let busy = $state(false);
  let dragOver = $state(false);
  let fileInput = $state<HTMLInputElement | null>(null);

  const dataset = $derived(app.datasetById(datasetId));
  const hasData = $derived((dataset?.rows.length ?? 0) > 0 || (dataset?.columns.length ?? 0) > 0);

  $effect(() => {
    if (open) {
      tab = initialTab;
      workbook = null;
      conversion = null;
      sheetName = '';
      pasteText = '';
      error = null;
      mode = hasData ? 'append' : 'replace';
    }
  });

  const pasted: TableData | null = $derived.by(() => {
    if (!pasteText.trim()) return null;
    const rows = normalizeRectangular(parseTsv(pasteText));
    if (rows.length === 0) return null;
    return { header: rows[0].map((h) => h.trim()), rows: rows.slice(1) };
  });

  const table: TableData | null = $derived(tab === 'file' ? (conversion?.table ?? null) : pasted);
  const warnings: Omit<ImportWarning, 'columnId'>[] = $derived(
    tab === 'file' && conversion ? [...conversion.warnings, ...conversion.columnWarnings.map((c) => c.warning)] : [],
  );

  async function loadFile(file: File) {
    error = null;
    busy = true;
    try {
      if (file.size > 50 * 1024 * 1024) throw new ImportError('Berkas terlalu besar (maksimal 50 MB).');
      const wb = readWorkbook(new Uint8Array(await file.arrayBuffer()), file.name);
      workbook = wb;
      const first = wb.sheets.find((s) => s.rowCount > 0) ?? wb.sheets[0];
      selectSheet(first.name);
    } catch (e) {
      workbook = null;
      conversion = null;
      error = e instanceof ImportError ? e.message : 'Berkas tidak dapat dibaca.';
    } finally {
      busy = false;
    }
  }

  function selectSheet(name: string) {
    if (!workbook) return;
    sheetName = name;
    try {
      conversion = sheetToTable(workbook, name);
      error = null;
    } catch (e) {
      conversion = null;
      error = e instanceof ImportError ? e.message : 'Worksheet tidak dapat dibaca.';
    }
  }

  function onFileChange(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const f = input.files?.[0];
    if (f) void loadFile(f);
    input.value = '';
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    dragOver = false;
    const f = e.dataTransfer?.files?.[0];
    if (f) void loadFile(f);
  }

  async function doImport() {
    if (!table || !dataset) return;
    if (table.header.every((h) => h === '')) {
      error = 'Baris pertama (header) kosong. Baris pertama selalu dipakai sebagai nama kolom.';
      return;
    }
    if (mode === 'replace' && hasData) {
      const ok = await ui.confirmAction({
        title: `Ganti isi "${dataset.name}"?`,
        message:
          'Seluruh isi dataset saat ini akan diganti dengan data baru. Anda masih dapat membatalkannya dengan Undo selama dataset belum diubah lagi.',
        confirmLabel: 'Ganti data',
        destructive: true,
      });
      if (!ok) return;
    }
    app.importTable(dataset.id, table, {
      mode,
      origin:
        tab === 'file' ? { kind: 'xlsx', fileName: workbook?.fileName, sheetName } : { kind: 'paste' },
      warnings: tab === 'file' ? conversion?.warnings : undefined,
      columnWarnings: tab === 'file' ? conversion?.columnWarnings : undefined,
    });
    ui.toast('success', 'Data diimpor', `${table.rows.length} baris dimasukkan ke "${dataset.name}".`);
    open = false;
  }

  const previewRows = $derived(table ? table.rows.slice(0, 6) : []);
</script>

<Dialog bind:open title={`Impor data ke "${dataset?.name ?? ''}"`} class="max-w-3xl">
  <div class="space-y-4">
    <div class="inline-flex rounded-lg border bg-muted p-0.5" role="tablist" aria-label="Sumber data">
      <button
        role="tab"
        aria-selected={tab === 'file'}
        class={cn('inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm', tab === 'file' ? 'bg-card shadow-xs font-medium' : 'text-muted-foreground')}
        onclick={() => (tab = 'file')}
      >
        <FileSpreadsheet class="size-4" /> Berkas Excel
      </button>
      <button
        role="tab"
        aria-selected={tab === 'paste'}
        class={cn('inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm', tab === 'paste' ? 'bg-card shadow-xs font-medium' : 'text-muted-foreground')}
        onclick={() => (tab = 'paste')}
      >
        <ClipboardPaste class="size-4" /> Tempel data
      </button>
    </div>

    {#if tab === 'file'}
      <div
        role="button"
        tabindex="0"
        aria-label="Pilih atau jatuhkan berkas Excel"
        class={cn(
          'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-6 text-center transition-colors',
          dragOver ? 'border-primary bg-accent' : 'hover:bg-muted/60',
        )}
        onclick={() => fileInput?.click()}
        onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && fileInput?.click()}
        ondragover={(e) => {
          e.preventDefault();
          dragOver = true;
        }}
        ondragleave={() => (dragOver = false)}
        ondrop={onDrop}
      >
        <Upload class="size-6 text-muted-foreground" />
        <p class="text-sm">
          {#if workbook}
            <span class="font-medium">{workbook.fileName}</span> — klik untuk memilih berkas lain
          {:else}
            Klik untuk memilih berkas <span class="font-medium">.xlsx</span>, atau seret ke sini
          {/if}
        </p>
        <p class="text-xs text-muted-foreground">Berkas dibaca di browser Anda dan tidak diunggah ke mana pun.</p>
        <input
          bind:this={fileInput}
          type="file"
          accept=".xlsx,.xlsm,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          class="hidden"
          onchange={onFileChange}
        />
      </div>
      {#if workbook && workbook.sheets.length > 1}
        <div class="flex flex-wrap items-center gap-2">
          <label for="sheet-select" class="text-sm font-medium">Worksheet</label>
          <Select id="sheet-select" class="w-auto min-w-56" value={sheetName} onchange={(e) => selectSheet((e.currentTarget as HTMLSelectElement).value)}>
            {#each workbook.sheets as s (s.name)}
              <option value={s.name}>{s.name} ({s.rowCount} baris)</option>
            {/each}
          </Select>
        </div>
      {/if}
    {:else}
      <div class="space-y-1.5">
        <label for="paste-area" class="text-sm font-medium">Tempel sel dari Excel atau Google Sheets (baris pertama = header)</label>
        <textarea
          id="paste-area"
          bind:value={pasteText}
          rows="7"
          spellcheck="false"
          placeholder={'NIM\tNama\tNilai\n0215001\tAni\t85'}
          class="w-full rounded-md border border-input bg-card px-3 py-2 font-mono text-xs shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40"
        ></textarea>
      </div>
    {/if}

    {#if error}
      <p class="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
    {/if}

    {#if table}
      <div class="space-y-2">
        <p class="text-sm">
          <span class="font-medium">{table.header.length} kolom</span>,
          <span class="font-medium">{table.rows.length} baris data</span>. Pratinjau:
        </p>
        <div class="max-h-56 overflow-auto rounded-md border">
          <table class="w-full border-collapse text-xs">
            <thead class="sticky top-0 bg-muted">
              <tr>
                {#each table.header as h, i (i)}
                  <th class="border-b px-2 py-1.5 text-left font-semibold whitespace-nowrap">{h || '(kosong)'}</th>
                {/each}
              </tr>
            </thead>
            <tbody>
              {#each previewRows as r, ri (ri)}
                <tr class="odd:bg-card even:bg-muted/30">
                  {#each table.header as _h, ci (ci)}
                    <td class="border-b px-2 py-1 whitespace-nowrap">{cellToText(r[ci] ?? null)}</td>
                  {/each}
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      </div>
      {#if warnings.length}
        <ul class="space-y-1 rounded-md border border-st-mismatch-fg/30 bg-st-mismatch/50 px-3 py-2 text-[13px]">
          {#each warnings as w, i (i)}
            <li class="flex gap-2"><TriangleAlert class="mt-0.5 size-3.5 shrink-0 text-st-mismatch-fg" />{w.message}</li>
          {/each}
        </ul>
      {/if}
      {#if hasData}
        <fieldset class="space-y-1.5">
          <legend class="text-sm font-medium">Cara memasukkan data</legend>
          <label class="flex items-start gap-2 text-sm">
            <input type="radio" bind:group={mode} value="append" class="mt-1 accent-[var(--primary)]" />
            <span>
              <span class="font-medium">Gabungkan</span> — tambahkan baris di bawah data yang ada. Kolom dicocokkan berdasarkan nama header; header baru menjadi kolom baru.
            </span>
          </label>
          <label class="flex items-start gap-2 text-sm">
            <input type="radio" bind:group={mode} value="replace" class="mt-1 accent-[var(--primary)]" />
            <span><span class="font-medium">Ganti</span> — hapus isi dataset saat ini dan gunakan data baru.</span>
          </label>
        </fieldset>
      {/if}
    {/if}
  </div>
  {#snippet footer()}
    <Button variant="outline" onclick={() => (open = false)}>Batal</Button>
    <Button disabled={!table || busy} onclick={doImport}>Impor {table ? `${table.rows.length} baris` : ''}</Button>
  {/snippet}
</Dialog>
