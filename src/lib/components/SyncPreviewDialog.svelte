<script lang="ts">
  import CircleAlert from '@lucide/svelte/icons/circle-alert';
  import { cellToText } from '$lib/domain/cells';
  import type { Dataset } from '$lib/domain/types';
  import { nimText } from '$lib/matching/identity';
  import { app } from '$lib/state/app.svelte';
  import { countPlan, type PlannedCell } from '$lib/sync/engine';
  import { cn } from '$lib/utils';
  import Badge from './ui/badge.svelte';
  import Button from './ui/button.svelte';
  import Dialog from './ui/dialog.svelte';

  type Props = { open: boolean };
  let { open = $bindable(false) }: Props = $props();

  type Tab = 'fill' | 'overwrite' | 'unchanged' | 'skipped' | 'unmatched' | 'duplicate' | 'mismatch' | 'conflict';

  const plan = $derived(app.preview);
  const project = $derived(app.project!);
  const target = $derived(project.target);
  const counts = $derived(plan ? countPlan(plan) : null);
  const LIMIT = 500;

  let tab = $state<Tab>('fill');
  let approved = $state<Set<string>>(new Set());
  let applying = $state(false);

  $effect(() => {
    if (plan) {
      approved = new Set();
      const c = countPlan(plan);
      tab = c.fill ? 'fill' : c.overwrite ? 'overwrite' : c.unchanged ? 'unchanged' : 'unmatched';
    }
  });

  $effect(() => {
    if (!open && app.preview) app.closePreview();
  });

  const fills = $derived(plan?.cells.filter((c) => c.kind === 'fill') ?? []);
  const overwrites = $derived(plan?.cells.filter((c) => c.kind === 'overwrite') ?? []);
  const unchanged = $derived(plan?.cells.filter((c) => c.kind === 'unchanged') ?? []);
  const toApply = $derived(fills.length + overwrites.filter((c) => approved.has(c.key)).length);

  function sourceDs(id: string): Dataset | undefined {
    return project.sources.find((s) => s.id === id);
  }
  function colName(ds: Dataset | undefined, id: string): string {
    return ds?.columns.find((c) => c.id === id)?.name ?? '?';
  }
  function rowInfo(ds: Dataset | undefined, rowId: string): { index: number; nim: string; name: string } {
    if (!ds) return { index: -1, nim: '', name: '' };
    const index = ds.rows.findIndex((r) => r.id === rowId);
    const row = ds.rows[index];
    return {
      index,
      nim: row && ds.nimColumnId ? nimText(row.cells[ds.nimColumnId]) : '',
      name: row && ds.nameColumnId ? cellToText(row.cells[ds.nameColumnId] ?? null) : '',
    };
  }

  function toggle(key: string, on: boolean) {
    const next = new Set(approved);
    if (on) next.add(key);
    else next.delete(key);
    approved = next;
  }

  function toggleAll(on: boolean) {
    approved = on ? new Set(overwrites.map((c) => c.key)) : new Set();
  }

  async function apply() {
    applying = true;
    try {
      const op = await app.applyPreview(approved);
      if (op) open = false;
    } finally {
      applying = false;
    }
  }

  const tabs: { id: Tab; label: string; count: (c: NonNullable<typeof counts>) => number; variant: 'match' | 'mismatch' | 'unmatched' | 'duplicate' | 'changed' | 'outline' }[] = [
    { id: 'fill', label: 'Akan diisi', count: (c) => c.fill, variant: 'match' },
    { id: 'overwrite', label: 'Akan menimpa', count: (c) => c.overwrite, variant: 'mismatch' },
    { id: 'unchanged', label: 'Sudah sama', count: (c) => c.unchanged, variant: 'outline' },
    { id: 'skipped', label: 'Sumber kosong (dilewati)', count: (c) => c.skippedEmpty, variant: 'unmatched' },
    { id: 'unmatched', label: 'Tidak berpasangan', count: (c) => c.sourceOnly + c.targetOnly, variant: 'unmatched' },
    { id: 'duplicate', label: 'NIM duplikat', count: (c) => c.duplicates, variant: 'duplicate' },
    { id: 'mismatch', label: 'Beda nama', count: (c) => c.nameMismatches, variant: 'mismatch' },
    { id: 'conflict', label: 'Konflik antar-Sumber', count: (c) => c.conflicts, variant: 'duplicate' },
  ];
</script>

{#snippet cellTable(list: PlannedCell[], withBefore: boolean, selectable: boolean)}
  <div class="overflow-auto rounded-md border">
    <table class="w-full border-collapse text-[13px]">
      <thead class="sticky top-0 bg-muted text-left text-xs">
        <tr>
          {#if selectable}
            <th class="w-8 border-b px-2 py-1.5">
              <input
                type="checkbox"
                aria-label="Pilih semua untuk ditimpa"
                class="accent-[var(--primary)]"
                checked={approved.size === overwrites.length && overwrites.length > 0}
                onchange={(e) => toggleAll((e.currentTarget as HTMLInputElement).checked)}
              />
            </th>
          {/if}
          <th class="border-b px-2 py-1.5">Baris</th>
          <th class="border-b px-2 py-1.5">NIM</th>
          <th class="border-b px-2 py-1.5">Nama (Target)</th>
          <th class="border-b px-2 py-1.5">Kolom Target</th>
          {#if withBefore}<th class="border-b px-2 py-1.5">Nilai lama</th>{/if}
          <th class="border-b px-2 py-1.5">Nilai baru</th>
          <th class="border-b px-2 py-1.5">Sumber</th>
        </tr>
      </thead>
      <tbody>
        {#each list.slice(0, LIMIT) as c (c.key)}
          {@const info = rowInfo(target, c.targetRowId)}
          {@const src = sourceDs(c.sourceDatasetId)}
          <tr class="border-b last:border-0">
            {#if selectable}
              <td class="px-2 py-1">
                <input
                  type="checkbox"
                  class="accent-[var(--primary)]"
                  aria-label={`Timpa nilai baris ${info.index + 1}`}
                  checked={approved.has(c.key)}
                  onchange={(e) => toggle(c.key, (e.currentTarget as HTMLInputElement).checked)}
                />
              </td>
            {/if}
            <td class="px-2 py-1 tabular-nums text-muted-foreground">{info.index + 1}</td>
            <td class="px-2 py-1 font-mono text-xs">{info.nim}</td>
            <td class="px-2 py-1">{info.name}</td>
            <td class="px-2 py-1">{colName(target, c.targetColumnId)}</td>
            {#if withBefore}<td class="px-2 py-1 text-muted-foreground line-through decoration-1">{cellToText(c.before)}</td>{/if}
            <td class="px-2 py-1 font-medium">{cellToText(c.after)}</td>
            <td class="px-2 py-1 text-xs text-muted-foreground">
              {src?.name} · {colName(src, c.sourceColumnId)}
              {#if c.matchKind === 'manual'}<Badge variant="manual" class="ml-1">manual</Badge>{/if}
              {#if c.nameApproved}<Badge variant="mismatch" class="ml-1">nama disetujui</Badge>{/if}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
  {#if list.length > LIMIT}<p class="mt-1 text-xs text-muted-foreground">Menampilkan {LIMIT} dari {list.length} baris.</p>{/if}
{/snippet}

<Dialog bind:open title="Pratinjau sinkronisasi" description="Periksa perubahan sebelum diterapkan. Tidak ada data yang diubah sampai Anda menekan Terapkan." class="max-w-5xl">
  {#if plan && counts}
    <div class="space-y-3">
      {#if plan.errors.length}
        <div class="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <p class="flex items-center gap-1.5 font-medium"><CircleAlert class="size-4" /> Sinkronisasi tidak dapat diterapkan:</p>
          <ul class="mt-1 list-disc pl-6">{#each plan.errors as e, i (i)}<li>{e}</li>{/each}</ul>
        </div>
      {/if}

      <p class="text-sm text-muted-foreground">
        {counts.processed} mahasiswa diproses dari {plan.sources.map((s) => s.sourceName).join(', ')}.
      </p>

      <div class="flex flex-wrap gap-1.5" role="tablist" aria-label="Kategori pratinjau">
        {#each tabs as t (t.id)}
          {@const n = t.count(counts)}
          <button
            role="tab"
            aria-selected={tab === t.id}
            class={cn(
              'inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[13px] transition-colors',
              tab === t.id ? 'border-primary bg-accent text-accent-foreground' : 'hover:bg-muted',
              n === 0 && tab !== t.id && 'opacity-60',
            )}
            onclick={() => (tab = t.id)}
          >
            {t.label}
            <Badge variant={n ? t.variant : 'outline'}>{n}</Badge>
          </button>
        {/each}
      </div>

      <div class="min-h-40">
        {#if tab === 'fill'}
          {#if fills.length}{@render cellTable(fills, false, false)}{:else}<p class="text-sm text-muted-foreground">Tidak ada sel kosong yang akan diisi.</p>{/if}
        {:else if tab === 'overwrite'}
          {#if overwrites.length}
            <p class="mb-2 rounded-md bg-st-mismatch px-3 py-2 text-[13px] text-st-mismatch-fg">
              Sel ini sudah berisi nilai di Target. Centang hanya sel yang memang ingin ditimpa; sel yang tidak dicentang tidak diubah.
            </p>
            {@render cellTable(overwrites, true, true)}
          {:else}<p class="text-sm text-muted-foreground">Tidak ada nilai Target yang akan ditimpa.</p>{/if}
        {:else if tab === 'unchanged'}
          {#if unchanged.length}{@render cellTable(unchanged, false, false)}{:else}<p class="text-sm text-muted-foreground">Tidak ada.</p>{/if}
        {:else if tab === 'skipped'}
          {#if plan.skippedEmpty.length}
            <ul class="max-h-80 space-y-0.5 overflow-auto text-[13px]">
              {#each plan.skippedEmpty.slice(0, LIMIT) as s, i (i)}
                {@const src = sourceDs(s.sourceDatasetId)}
                {@const info = rowInfo(src, s.sourceRowId)}
                <li>{src?.name} baris {info.index + 1} · <span class="font-mono text-xs">{info.nim}</span> {info.name} — kolom "{colName(src, s.sourceColumnId)}" kosong</li>
              {/each}
            </ul>
          {:else}<p class="text-sm text-muted-foreground">Tidak ada sel Sumber kosong.</p>{/if}
        {:else if tab === 'unmatched'}
          <div class="grid gap-4 md:grid-cols-2">
            {#each plan.sources as s (s.sourceDatasetId)}
              <div>
                <h4 class="mb-1 text-xs font-semibold text-muted-foreground uppercase">Hanya di {s.sourceName} ({s.match.sourceOnly.length})</h4>
                <ul class="max-h-64 space-y-0.5 overflow-auto text-[13px]">
                  {#each s.match.sourceOnly as r (r.rowId)}<li><span class="font-mono text-xs">{r.nim}</span> {r.name}</li>{/each}
                </ul>
              </div>
            {/each}
            <div>
              <h4 class="mb-1 text-xs font-semibold text-muted-foreground uppercase">Hanya di Target ({counts.targetOnly})</h4>
              <ul class="max-h-64 space-y-0.5 overflow-auto text-[13px]">
                {#each plan.sources[0]?.match.targetOnly ?? [] as r (r.rowId)}
                  {#if !plan.sources.some((s) => s.match.targetToSource.has(r.rowId))}
                    <li><span class="font-mono text-xs">{r.nim}</span> {r.name}</li>
                  {/if}
                {/each}
              </ul>
            </div>
          </div>
          <p class="mt-2 text-xs text-muted-foreground">Gunakan tab <span class="font-medium">Pencocokan</span> untuk memasangkan secara manual atau memperbaiki NIM.</p>
        {:else if tab === 'duplicate'}
          {#each plan.sources as s (s.sourceDatasetId)}
            {#if s.match.duplicates.length}
              <ul class="space-y-0.5 text-[13px]">
                {#each s.match.duplicates as d, i (i)}
                  <li><Badge variant="duplicate">{d.side === 'source' ? s.sourceName : 'Target'}</Badge> NIM <span class="font-mono text-xs">{d.nim}</span> muncul {d.rowIds.length}×</li>
                {/each}
              </ul>
            {/if}
          {/each}
          {#if counts.duplicates === 0}<p class="text-sm text-muted-foreground">Tidak ada NIM duplikat.</p>{/if}
        {:else if tab === 'mismatch'}
          {#each plan.sources as s (s.sourceDatasetId)}
            {@const src = sourceDs(s.sourceDatasetId)}
            <ul class="space-y-0.5 text-[13px]">
              {#each s.match.nameMismatches as p (p.sourceRowId)}
                <li>
                  <span class="font-mono text-xs">{p.nim}</span>: "{rowInfo(src, p.sourceRowId).name}" ({s.sourceName}) ≠ "{rowInfo(target, p.targetRowId).name}" (Target)
                </li>
              {/each}
            </ul>
          {/each}
          {#if counts.nameMismatches}
            <p class="mt-2 text-xs text-muted-foreground">Baris ini tidak disinkronkan sampai disetujui di tab Pencocokan.</p>
          {:else}<p class="text-sm text-muted-foreground">Tidak ada perbedaan nama.</p>{/if}
        {:else if tab === 'conflict'}
          {#if plan.conflicts.length}
            <p class="mb-2 text-[13px] text-muted-foreground">Beberapa Sumber memberi nilai berbeda untuk sel yang sama. Sel ini tidak diubah.</p>
            <ul class="space-y-0.5 text-[13px]">
              {#each plan.conflicts as c (c.key)}
                {@const info = rowInfo(target, c.targetRowId)}
                <li>
                  Baris {info.index + 1} (<span class="font-mono text-xs">{info.nim}</span>) · {colName(target, c.targetColumnId)}:
                  {c.candidates.map((x) => `${sourceDs(x.sourceDatasetId)?.name}: ${cellToText(x.value)}`).join(' / ')}
                </li>
              {/each}
            </ul>
          {:else}<p class="text-sm text-muted-foreground">Tidak ada konflik.</p>{/if}
        {/if}
      </div>
    </div>
  {/if}
  {#snippet footer()}
    <span class="mr-auto text-[13px] text-muted-foreground">
      {toApply} sel akan diubah{overwrites.length ? ` (${approved.size} dari ${overwrites.length} timpaan disetujui)` : ''}
    </span>
    <Button variant="outline" onclick={() => (open = false)}>Batal</Button>
    <Button disabled={!plan || plan.errors.length > 0 || toApply === 0 || applying} onclick={apply}>Terapkan</Button>
  {/snippet}
</Dialog>
