<script lang="ts">
  import Check from '@lucide/svelte/icons/check';
  import Link2 from '@lucide/svelte/icons/link-2';
  import Pencil from '@lucide/svelte/icons/pencil';
  import Undo2 from '@lucide/svelte/icons/undo-2';
  import Unlink from '@lucide/svelte/icons/unlink';
  import { cellToText } from '$lib/domain/cells';
  import type { Dataset } from '$lib/domain/types';
  import type { RowRef } from '$lib/matching/engine';
  import { nimText } from '$lib/matching/identity';
  import { app } from '$lib/state/app.svelte';
  import { ui } from '$lib/state/ui.svelte';
  import { cn } from '$lib/utils';
  import Badge from './ui/badge.svelte';
  import Button from './ui/button.svelte';
  import ContextMenu, { type ContextMenuEntry } from './ui/context-menu.svelte';
  import MousePointerClick from '@lucide/svelte/icons/mouse-pointer-click';
  import X from '@lucide/svelte/icons/x';

  const project = $derived(app.project!);
  const source = $derived(app.activeSource);
  const target = $derived(project.target);
  const match = $derived(app.activeMatch);

  type View = 'pair' | 'mismatch' | 'duplicate' | 'manual';
  let view = $state<View>('pair');
  let selSource = $state<string | null>(null);
  let selTarget = $state<string | null>(null);
  let qSource = $state('');
  let qTarget = $state('');

  interface Candidate extends RowRef {
    reason: string;
  }

  const sourceCandidates: Candidate[] = $derived.by(() => {
    if (!match) return [];
    return [
      ...match.sourceOnly.map((r) => ({ ...r, reason: 'Tidak ada di Target' })),
      ...match.duplicateSourceRows.map((r) => ({ ...r, reason: 'NIM duplikat' })),
      ...match.invalidNimSource.map((r) => ({ ...r, reason: 'NIM tidak valid' })),
      ...match.emptyNimSource.map((r) => ({ ...r, reason: 'NIM kosong' })),
    ].sort((a, b) => a.rowIndex - b.rowIndex);
  });

  const targetCandidates: Candidate[] = $derived.by(() => {
    if (!match) return [];
    return [
      ...match.targetOnly.map((r) => ({ ...r, reason: 'Tidak ada di Sumber' })),
      ...match.duplicateTargetRows.map((r) => ({ ...r, reason: 'NIM duplikat' })),
      ...match.invalidNimTarget.map((r) => ({ ...r, reason: 'NIM tidak valid' })),
      ...match.emptyNimTarget.map((r) => ({ ...r, reason: 'NIM kosong' })),
    ].sort((a, b) => a.rowIndex - b.rowIndex);
  });

  function filterList(list: Candidate[], q: string): Candidate[] {
    const s = q.trim().toLocaleLowerCase('id');
    if (!s) return list;
    return list.filter((r) => r.nim.toLocaleLowerCase('id').includes(s) || r.name.toLocaleLowerCase('id').includes(s));
  }

  const manualForSource = $derived(source ? project.manualMatches.filter((m) => m.sourceDatasetId === source.id) : []);
  const approvalsForSource = $derived(source ? project.nameApprovals.filter((a) => a.sourceDatasetId === source.id) : []);

  function rowName(ds: Dataset, rowId: string): { nim: string; name: string; index: number } {
    const index = ds.rows.findIndex((r) => r.id === rowId);
    const row = ds.rows[index];
    return {
      index,
      nim: row && ds.nimColumnId ? nimText(row.cells[ds.nimColumnId]) : '',
      name: row && ds.nameColumnId ? cellToText(row.cells[ds.nameColumnId] ?? null) : '',
    };
  }

  async function pair() {
    if (!source || !selSource || !selTarget) return;
    const ok = await app.addManualMatch(source.id, selSource, selTarget);
    if (ok) {
      selSource = null;
      selTarget = null;
    }
  }

  async function editIdentity(ds: Dataset, rowId: string, kind: 'nim' | 'name') {
    const colId = kind === 'nim' ? ds.nimColumnId : ds.nameColumnId;
    if (!colId) {
      ui.toast('warning', `Kolom ${kind === 'nim' ? 'NIM' : 'nama'} belum dipilih pada "${ds.name}"`);
      return;
    }
    const row = ds.rows.find((r) => r.id === rowId);
    if (!row) return;
    const current = kind === 'nim' ? nimText(row.cells[colId]) : cellToText(row.cells[colId] ?? null);
    const value = await ui.promptText({
      title: kind === 'nim' ? 'Perbaiki NIM' : 'Perbaiki nama',
      label: `${kind === 'nim' ? 'NIM' : 'Nama'} baru di "${ds.name}" (pencocokan dijalankan ulang otomatis)`,
      value: current,
    });
    if (value === null || value === current) return;
    app.editCell(ds.id, rowId, colId, value, `Perbaiki ${kind === 'nim' ? 'NIM' : 'nama'} di ${ds.name}`);
  }

  function candidateMenu(side: 'source' | 'target', ds: Dataset, rowId: string, selected: boolean): ContextMenuEntry[] {
    const other = side === 'source' ? selTarget : selSource;
    const select = () => {
      if (side === 'source') selSource = selected ? null : rowId;
      else selTarget = selected ? null : rowId;
    };
    return [
      { label: selected ? 'Batalkan pilihan' : 'Pilih baris ini', icon: selected ? X : MousePointerClick, onSelect: select },
      {
        label: `Pasangkan dengan baris ${side === 'source' ? 'Target' : 'Sumber'} terpilih`,
        icon: Link2,
        disabled: !other,
        onSelect: () => {
          if (side === 'source') selSource = rowId;
          else selTarget = rowId;
          void pair();
        },
      },
      { kind: 'separator' },
      { label: 'Perbaiki NIM', icon: Pencil, onSelect: () => editIdentity(ds, rowId, 'nim') },
      { label: 'Perbaiki nama', icon: Pencil, onSelect: () => editIdentity(ds, rowId, 'name') },
    ];
  }

  const counts = $derived({
    pair: sourceCandidates.length + targetCandidates.length,
    mismatch: match?.nameMismatches.length ?? 0,
    duplicate: match?.duplicates.length ?? 0,
    manual: manualForSource.length + approvalsForSource.length,
  });

  const views: { id: View; label: string }[] = [
    { id: 'pair', label: 'Tidak berpasangan' },
    { id: 'mismatch', label: 'Beda nama' },
    { id: 'duplicate', label: 'Duplikat' },
    { id: 'manual', label: 'Pasangan manual & persetujuan' },
  ];
</script>

<div class="flex h-full min-h-0 flex-col">
  {#if !source || !match}
    <p class="p-3 text-sm text-muted-foreground">Tambahkan dataset Sumber terlebih dahulu.</p>
  {:else if match.errors.length}
    <div class="m-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
      {#each match.errors as e, i (i)}<p>{e}</p>{/each}
    </div>
  {:else}
    <div class="flex flex-wrap items-center gap-1.5 border-b px-3 py-2" role="tablist" aria-label="Kategori pencocokan">
      {#each views as v (v.id)}
        <button
          role="tab"
          aria-selected={view === v.id}
          class={cn(
            'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[13px]',
            view === v.id ? 'bg-accent font-medium text-accent-foreground' : 'text-muted-foreground hover:bg-muted',
          )}
          onclick={() => (view = v.id)}
        >
          {v.label}
          <Badge variant={counts[v.id] ? (v.id === 'duplicate' ? 'duplicate' : v.id === 'mismatch' ? 'mismatch' : 'secondary') : 'outline'}>{counts[v.id]}</Badge>
        </button>
      {/each}
      {#each match.notices as n, i (i)}<span class="ml-auto text-xs text-st-mismatch-fg">{n}</span>{/each}
    </div>

    <div class="min-h-0 flex-1 overflow-auto p-3">
      {#if view === 'pair'}
        <p class="mb-2 text-xs text-muted-foreground">
          Pilih satu baris Sumber dan satu baris Target, lalu klik <span class="font-medium">Pasangkan</span>. Atau perbaiki NIM-nya — pencocokan dijalankan ulang otomatis.
        </p>
        <div class="grid gap-3 md:grid-cols-[1fr_auto_1fr]">
          {#each [{ side: 'source', ds: source, list: filterList(sourceCandidates, qSource), all: sourceCandidates }, { side: 'target', ds: target, list: filterList(targetCandidates, qTarget), all: targetCandidates }] as col, ci (col.side)}
            {#if ci === 1}
              <div class="flex items-center justify-center md:flex-col">
                <Button size="sm" disabled={!selSource || !selTarget} onclick={pair}><Link2 /> Pasangkan</Button>
              </div>
            {/if}
            <div class="min-w-0 rounded-lg border">
              <div class="flex items-center gap-2 border-b bg-muted/40 px-2 py-1.5">
                <span class="text-xs font-semibold">{col.side === 'source' ? `Sumber: ${source.name}` : 'Target'} ({col.all.length})</span>
                {#if col.side === 'source'}
                  <input type="search" bind:value={qSource} placeholder="Cari NIM/nama" aria-label="Cari baris Sumber" class="ml-auto h-6 w-32 rounded border border-input bg-card px-2 text-xs" />
                {:else}
                  <input type="search" bind:value={qTarget} placeholder="Cari NIM/nama" aria-label="Cari baris Target" class="ml-auto h-6 w-32 rounded border border-input bg-card px-2 text-xs" />
                {/if}
              </div>
              <ul class="max-h-56 overflow-auto" role="listbox" aria-label={col.side === 'source' ? 'Baris Sumber tanpa pasangan' : 'Baris Target tanpa pasangan'}>
                {#each col.list as r (r.rowId)}
                  {@const selected = (col.side === 'source' ? selSource : selTarget) === r.rowId}
                  <ContextMenu
                    as="li"
                    role="option"
                    aria-selected={selected}
                    class={cn('flex items-center gap-2 border-b px-2 py-1 text-[13px] last:border-0', selected ? 'bg-accent' : 'hover:bg-muted/60')}
                    items={() => candidateMenu(col.side as 'source' | 'target', col.ds, r.rowId, selected)}
                  >
                    <button
                      class="flex min-w-0 flex-1 items-center gap-2 text-left"
                      onclick={() => {
                        if (col.side === 'source') selSource = selected ? null : r.rowId;
                        else selTarget = selected ? null : r.rowId;
                      }}
                    >
                      <span class="w-8 shrink-0 text-right text-xs text-muted-foreground tabular-nums">{r.rowIndex + 1}</span>
                      <span class="shrink-0 font-mono text-xs">{r.nim || '—'}</span>
                      <span class="min-w-0 flex-1 truncate">{r.name}</span>
                      <Badge variant={r.reason === 'NIM duplikat' ? 'duplicate' : 'unmatched'}>{r.reason}</Badge>
                    </button>
                    <button class="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground" title="Perbaiki NIM" aria-label="Perbaiki NIM" onclick={() => editIdentity(col.ds, r.rowId, 'nim')}>
                      <Pencil class="size-3.5" />
                    </button>
                  </ContextMenu>
                {:else}
                  <li class="px-2 py-3 text-center text-xs text-muted-foreground">Tidak ada.</li>
                {/each}
              </ul>
            </div>
          {/each}
        </div>
      {:else if view === 'mismatch'}
        {#if match.nameMismatches.length === 0}
          <p class="text-sm text-muted-foreground">Tidak ada NIM cocok dengan nama berbeda.</p>
        {:else}
          <p class="mb-2 text-xs text-muted-foreground">NIM sama tetapi nama berbeda. Baris ini tidak disinkronkan sampai Anda menyetujuinya atau memperbaiki nama.</p>
          <ul class="divide-y rounded-lg border">
            {#each match.nameMismatches as p (p.sourceRowId)}
              {@const s = rowName(source, p.sourceRowId)}
              {@const t = rowName(target, p.targetRowId)}
              <ContextMenu
                as="li"
                class="flex flex-wrap items-center gap-2 px-3 py-2 text-[13px]"
                items={[
                  { label: 'Setujui beda nama', icon: Check, onSelect: () => app.approveNameMismatch(source.id, p) },
                  { kind: 'separator' },
                  { label: 'Perbaiki nama Sumber', icon: Pencil, onSelect: () => editIdentity(source, p.sourceRowId, 'name') },
                  { label: 'Perbaiki nama Target', icon: Pencil, onSelect: () => editIdentity(target, p.targetRowId, 'name') },
                ]}
              >
                <span class="font-mono text-xs">{p.nim}</span>
                <span class="min-w-0 flex-1">
                  <span class="text-muted-foreground">Sumber:</span> {s.name}
                  <span class="mx-1 text-muted-foreground">·</span>
                  <span class="text-muted-foreground">Target:</span> {t.name}
                </span>
                <Button variant="ghost" size="xs" onclick={() => editIdentity(source, p.sourceRowId, 'name')}><Pencil /> Nama Sumber</Button>
                <Button variant="outline" size="xs" onclick={() => app.approveNameMismatch(source.id, p)}><Check /> Setujui</Button>
              </ContextMenu>
            {/each}
          </ul>
        {/if}
      {:else if view === 'duplicate'}
        {#if match.duplicates.length === 0}
          <p class="text-sm text-muted-foreground">Tidak ada NIM duplikat.</p>
        {:else}
          <p class="mb-2 text-xs text-muted-foreground">
            NIM yang muncul lebih dari sekali tidak dicocokkan otomatis. Hapus baris ganda, perbaiki NIM-nya, atau pasangkan baris yang benar secara manual.
          </p>
          <ul class="space-y-2">
            {#each match.duplicates as d, i (i)}
              {@const ds = d.side === 'source' ? source : target}
              <li class="rounded-lg border">
                <div class="border-b bg-st-duplicate/60 px-3 py-1.5 text-[13px] text-st-duplicate-fg">
                  NIM <span class="font-mono">{d.nim}</span> — {d.rowIds.length}× di {d.side === 'source' ? source.name : 'Target'}
                </div>
                <ul class="divide-y">
                  {#each d.rowIds as rid (rid)}
                    {@const info = rowName(ds, rid)}
                    <ContextMenu
                      as="li"
                      class="flex items-center gap-2 px-3 py-1 text-[13px]"
                      items={[
                        { label: 'Perbaiki NIM', icon: Pencil, onSelect: () => editIdentity(ds, rid, 'nim') },
                        { label: 'Perbaiki nama', icon: Pencil, onSelect: () => editIdentity(ds, rid, 'name') },
                      ]}
                    >
                      <span class="w-10 text-xs text-muted-foreground tabular-nums">baris {info.index + 1}</span>
                      <span class="flex-1">{info.name}</span>
                      <Button variant="ghost" size="xs" onclick={() => editIdentity(ds, rid, 'nim')}><Pencil /> NIM</Button>
                    </ContextMenu>
                  {/each}
                </ul>
              </li>
            {/each}
          </ul>
        {/if}
      {:else}
        <div class="grid gap-4 md:grid-cols-2">
          <div>
            <h4 class="mb-1.5 text-xs font-semibold text-muted-foreground uppercase">Pasangan manual ({manualForSource.length})</h4>
            {#if manualForSource.length === 0}
              <p class="text-[13px] text-muted-foreground">Belum ada.</p>
            {:else}
              <ul class="divide-y rounded-lg border">
                {#each manualForSource as m (m.id)}
                  {@const stale = match.staleManualMatches.find((x) => x.match.id === m.id)}
                  <ContextMenu
                    as="li"
                    class="flex items-center gap-2 px-3 py-1.5 text-[13px]"
                    items={[{ label: 'Hapus pasangan manual', icon: Unlink, destructive: true, onSelect: () => app.removeManualMatch(m.id) }]}
                  >
                    <Badge variant={stale ? 'duplicate' : 'manual'}>{stale ? 'usang' : 'manual'}</Badge>
                    <span class="min-w-0 flex-1 truncate">
                      <span class="font-mono text-xs">{m.sourceNim || '—'}</span> {m.sourceName} → <span class="font-mono text-xs">{m.targetNim || '—'}</span> {m.targetName}
                    </span>
                    <Button variant="ghost" size="icon-xs" aria-label="Hapus pasangan manual" title="Hapus pasangan" onclick={() => app.removeManualMatch(m.id)}><Unlink /></Button>
                  </ContextMenu>
                {/each}
              </ul>
            {/if}
          </div>
          <div>
            <h4 class="mb-1.5 text-xs font-semibold text-muted-foreground uppercase">Beda nama disetujui ({approvalsForSource.length})</h4>
            {#if approvalsForSource.length === 0}
              <p class="text-[13px] text-muted-foreground">Belum ada.</p>
            {:else}
              <ul class="divide-y rounded-lg border">
                {#each approvalsForSource as a (a.id)}
                  <ContextMenu
                    as="li"
                    class="flex items-center gap-2 px-3 py-1.5 text-[13px]"
                    items={[{ label: 'Cabut persetujuan', icon: Undo2, destructive: true, onSelect: () => app.revokeApproval(a.id) }]}
                  >
                    <span class="min-w-0 flex-1 truncate">"{a.sourceName}" ≈ "{a.targetName}"</span>
                    <Button variant="ghost" size="icon-xs" aria-label="Cabut persetujuan" title="Cabut persetujuan" onclick={() => app.revokeApproval(a.id)}><Undo2 /></Button>
                  </ContextMenu>
                {/each}
              </ul>
            {/if}
          </div>
        </div>
      {/if}
    </div>
  {/if}
</div>
