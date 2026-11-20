<script lang="ts">
  import ArrowRight from '@lucide/svelte/icons/arrow-right';
  import Eye from '@lucide/svelte/icons/eye';
  import Plus from '@lucide/svelte/icons/plus';
  import Sparkles from '@lucide/svelte/icons/sparkles';
  import X from '@lucide/svelte/icons/x';
  import type { ColumnPair } from '$lib/domain/types';
  import { summarizeMatch } from '$lib/matching/engine';
  import { app } from '$lib/state/app.svelte';
  import { ui } from '$lib/state/ui.svelte';
  import { validatePairs } from '$lib/sync/engine';
  import Badge from './ui/badge.svelte';
  import Button from './ui/button.svelte';
  import ContextMenu from './ui/context-menu.svelte';
  import Select from './ui/select.svelte';

  type Props = { onPreview: () => void };
  let { onPreview }: Props = $props();

  const project = $derived(app.project!);
  const source = $derived(app.activeSource);
  const target = $derived(project.target);
  const pairs: ColumnPair[] = $derived(source ? (project.mappings[source.id] ?? []) : []);
  const summary = $derived(app.activeMatch ? summarizeMatch(app.activeMatch) : null);

  /** Sources included in the next synchronization (in addition to the active one by default). */
  let included = $state<Record<string, boolean>>({});

  const sourcesWithMapping = $derived(project.sources.filter((s) => (project.mappings[s.id] ?? []).length > 0));
  const selectedSourceIds = $derived(
    sourcesWithMapping.filter((s) => included[s.id] ?? s.id === source?.id).map((s) => s.id),
  );

  const targetCandidates = $derived(
    target.columns.filter((c) => c.id !== target.nimColumnId && c.id !== target.nameColumnId),
  );
  const pairErrors = $derived(source && pairs.length ? validatePairs(source, target, pairs) : []);

  function update(i: number, patch: Partial<ColumnPair>) {
    if (!source) return;
    app.setMapping(
      source.id,
      pairs.map((p, k) => (k === i ? { ...p, ...patch } : p)),
    );
  }

  function remove(i: number) {
    if (!source) return;
    app.setMapping(
      source.id,
      pairs.filter((_, k) => k !== i),
    );
  }

  function addPair() {
    if (!source) return;
    const usedS = new Set(pairs.map((p) => p.sourceColumnId));
    const usedT = new Set(pairs.map((p) => p.targetColumnId));
    const s = source.columns.find(
      (c) => !usedS.has(c.id) && c.id !== source.nimColumnId && c.id !== source.nameColumnId,
    );
    const t = targetCandidates.find((c) => !usedT.has(c.id));
    if (!s || !t) {
      ui.toast('info', 'Tidak ada kolom tersisa', 'Semua kolom yang tersedia sudah dipetakan.');
      return;
    }
    app.setMapping(source.id, [...pairs, { sourceColumnId: s.id, targetColumnId: t.id }]);
  }

  function autoMap() {
    if (!source) return;
    const norm = (n: string) => n.trim().replace(/\s+/g, ' ').toLowerCase();
    const usedT = new Set(pairs.map((p) => p.targetColumnId));
    const usedS = new Set(pairs.map((p) => p.sourceColumnId));
    const added: ColumnPair[] = [];
    for (const s of source.columns) {
      if (s.id === source.nimColumnId || s.id === source.nameColumnId || usedS.has(s.id)) continue;
      const t = targetCandidates.find((c) => !usedT.has(c.id) && norm(c.name) === norm(s.name));
      if (t) {
        added.push({ sourceColumnId: s.id, targetColumnId: t.id });
        usedT.add(t.id);
      }
    }
    if (!added.length) {
      ui.toast('info', 'Tidak ada nama kolom yang sama', 'Petakan kolom secara manual.');
      return;
    }
    app.setMapping(source.id, [...pairs, ...added]);
    ui.toast('success', `${added.length} pasangan kolom ditambahkan`, 'Periksa kembali sebelum sinkronisasi.');
  }

  function preview() {
    if (!selectedSourceIds.length) {
      ui.toast('warning', 'Belum ada pemetaan', 'Tambahkan minimal satu pasangan kolom.');
      return;
    }
    app.createPreview(selectedSourceIds.map((id) => ({ sourceDatasetId: id, pairs: project.mappings[id] ?? [] })));
    onPreview();
  }
</script>

<div class="grid h-full min-h-0 gap-4 overflow-auto p-3 lg:grid-cols-[minmax(0,1fr)_minmax(260px,320px)]">
  <div class="min-w-0 space-y-3">
    {#if !source}
      <p class="text-sm text-muted-foreground">Tambahkan dataset Sumber terlebih dahulu.</p>
    {:else}
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 class="text-sm font-semibold">Pemetaan kolom: {source.name} → {target.name}</h3>
          <p class="text-xs text-muted-foreground">Pilih kolom nilai di Sumber dan kolom tujuannya di Target. Mahasiswa dicocokkan berdasarkan NIM.</p>
        </div>
        <div class="flex gap-1.5">
          <Button variant="ghost" size="xs" onclick={autoMap} disabled={!source.columns.length || !target.columns.length}>
            <Sparkles /> Petakan nama yang sama
          </Button>
          <Button variant="outline" size="xs" onclick={addPair} disabled={!source.columns.length || !targetCandidates.length}>
            <Plus /> Tambah pasangan
          </Button>
        </div>
      </div>

      {#if !source.columns.length || !target.columns.length}
        <p class="rounded-md border border-dashed px-3 py-4 text-center text-sm text-muted-foreground">
          Isi data {!source.columns.length ? 'Sumber' : ''}{!source.columns.length && !target.columns.length ? ' dan ' : ''}{!target.columns.length ? 'Target' : ''} terlebih dahulu.
        </p>
      {:else if pairs.length === 0}
        <p class="rounded-md border border-dashed px-3 py-4 text-center text-sm text-muted-foreground">
          Belum ada pasangan kolom. Klik <span class="font-medium">Tambah pasangan</span>.
        </p>
      {:else}
        <ul class="space-y-1.5">
          {#each pairs as pair, i (i)}
            <ContextMenu
              as="li"
              class="flex items-center gap-2"
              items={[
                { label: 'Tambah pasangan', icon: Plus, onSelect: addPair },
                { label: 'Pratinjau sinkronisasi', icon: Eye, onSelect: preview },
                { kind: 'separator' },
                { label: 'Hapus pasangan ini', icon: X, destructive: true, onSelect: () => remove(i) },
              ]}
            >
              <Select
                class="h-8 text-[13px]"
                aria-label={`Kolom Sumber pasangan ${i + 1}`}
                value={pair.sourceColumnId}
                onchange={(e) => update(i, { sourceColumnId: (e.currentTarget as HTMLSelectElement).value })}
              >
                {#if !source.columns.some((c) => c.id === pair.sourceColumnId)}<option value={pair.sourceColumnId}>(kolom terhapus)</option>{/if}
                {#each source.columns as c (c.id)}<option value={c.id}>{c.name}</option>{/each}
              </Select>
              <ArrowRight class="size-4 shrink-0 text-muted-foreground" />
              <Select
                class="h-8 text-[13px]"
                aria-label={`Kolom Target pasangan ${i + 1}`}
                value={pair.targetColumnId}
                onchange={(e) => update(i, { targetColumnId: (e.currentTarget as HTMLSelectElement).value })}
              >
                {#if !targetCandidates.some((c) => c.id === pair.targetColumnId)}<option value={pair.targetColumnId}>(tidak valid)</option>{/if}
                {#each targetCandidates as c (c.id)}<option value={c.id}>{c.name}</option>{/each}
              </Select>
              <Button variant="ghost" size="icon-xs" aria-label={`Hapus pasangan ${i + 1}`} onclick={() => remove(i)}><X /></Button>
            </ContextMenu>
          {/each}
        </ul>
        {#if pairErrors.length}
          <ul class="space-y-0.5 text-xs text-destructive">
            {#each pairErrors as e, i (i)}<li>{e}</li>{/each}
          </ul>
        {/if}
      {/if}
    {/if}
  </div>

  <aside class="space-y-3 rounded-lg border bg-muted/30 p-3">
    {#if summary}
      <div>
        <h4 class="mb-1.5 text-xs font-semibold text-muted-foreground uppercase">Pencocokan {source?.name}</h4>
        <div class="flex flex-wrap gap-1">
          <Badge variant="match">{summary.matched} cocok</Badge>
          {#if summary.manual}<Badge variant="manual">{summary.manual} manual</Badge>{/if}
          {#if summary.nameApproved}<Badge variant="match">{summary.nameApproved} beda nama disetujui</Badge>{/if}
          {#if summary.nameMismatch}<Badge variant="mismatch">{summary.nameMismatch} beda nama</Badge>{/if}
          {#if summary.sourceOnly}<Badge variant="unmatched">{summary.sourceOnly} hanya di Sumber</Badge>{/if}
          {#if summary.targetOnly}<Badge variant="unmatched">{summary.targetOnly} hanya di Target</Badge>{/if}
          {#if summary.duplicateRows}<Badge variant="duplicate">{summary.duplicateRows} duplikat</Badge>{/if}
        </div>
        {#if app.activeMatch?.errors.length}
          <p class="mt-2 text-xs text-destructive">{app.activeMatch.errors.join(' ')}</p>
        {/if}
      </div>
    {/if}

    {#if sourcesWithMapping.length > 1}
      <fieldset>
        <legend class="mb-1 text-xs font-semibold text-muted-foreground uppercase">Sinkronkan dari</legend>
        {#each sourcesWithMapping as s (s.id)}
          <label class="flex items-center gap-2 py-0.5 text-sm">
            <input
              type="checkbox"
              class="accent-[var(--primary)]"
              checked={included[s.id] ?? s.id === source?.id}
              onchange={(e) => (included = { ...included, [s.id]: (e.currentTarget as HTMLInputElement).checked })}
            />
            {s.name}
            <span class="text-xs text-muted-foreground">({(project.mappings[s.id] ?? []).length} kolom)</span>
          </label>
        {/each}
      </fieldset>
    {/if}

    <Button class="w-full" onclick={preview} disabled={selectedSourceIds.length === 0}>
      <Eye /> Pratinjau sinkronisasi
    </Button>
    <p class="text-[11px] leading-snug text-muted-foreground">
      Tidak ada data yang berubah sebelum Anda menyetujui pratinjau. Nilai Target yang sudah terisi tidak akan ditimpa tanpa konfirmasi.
    </p>
  </aside>
</div>
