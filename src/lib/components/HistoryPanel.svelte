<script lang="ts">
  import ArrowLeftRight from '@lucide/svelte/icons/arrow-left-right';
  import Pencil from '@lucide/svelte/icons/pencil';
  import Redo2 from '@lucide/svelte/icons/redo-2';
  import Rows3 from '@lucide/svelte/icons/rows-3';
  import Undo2 from '@lucide/svelte/icons/undo-2';
  import type { Operation } from '$lib/domain/types';
  import { app } from '$lib/state/app.svelte';
  import { cn, formatDateTime } from '$lib/utils';
  import Badge from './ui/badge.svelte';
  import Button from './ui/button.svelte';

  let filter = $state<'sync' | 'all'>('sync');
  let expanded = $state<string | null>(null);

  const history = $derived(app.project?.history ?? []);
  const list: Operation[] = $derived(
    [...history].reverse().filter((op) => filter === 'all' || op.type === 'sync'),
  );

  function datasetName(id: string): string {
    return app.datasetById(id)?.name ?? '(dataset dihapus)';
  }
</script>

<div class="flex h-full min-h-0 flex-col">
  <div class="flex items-center gap-2 border-b px-3 py-2">
    <div class="inline-flex rounded-md border bg-muted p-0.5 text-xs" role="tablist" aria-label="Saring riwayat">
      <button role="tab" aria-selected={filter === 'sync'} class={cn('rounded px-2 py-0.5', filter === 'sync' && 'bg-card font-medium shadow-xs')} onclick={() => (filter = 'sync')}>Sinkronisasi</button>
      <button role="tab" aria-selected={filter === 'all'} class={cn('rounded px-2 py-0.5', filter === 'all' && 'bg-card font-medium shadow-xs')} onclick={() => (filter = 'all')}>Semua perubahan</button>
    </div>
    <span class="text-xs text-muted-foreground">{list.length} entri</span>
    <span class="ml-auto hidden text-[11px] text-muted-foreground sm:inline">Ctrl+Z / Ctrl+Y untuk batal / ulang operasi terakhir</span>
  </div>
  <div class="min-h-0 flex-1 overflow-auto">
    {#if list.length === 0}
      <p class="p-4 text-center text-sm text-muted-foreground">Belum ada {filter === 'sync' ? 'sinkronisasi' : 'perubahan'}.</p>
    {:else}
      <ul class="divide-y">
        {#each list as op (op.id)}
          <li class={cn('px-3 py-2', op.status === 'undone' && 'opacity-60')}>
            <div class="flex items-start gap-2">
              <span class="mt-0.5 text-muted-foreground">
                {#if op.type === 'sync'}<ArrowLeftRight class="size-4" />{:else if op.type === 'edit'}<Pencil class="size-4" />{:else}<Rows3 class="size-4" />{/if}
              </span>
              <button class="min-w-0 flex-1 text-left" onclick={() => (expanded = expanded === op.id ? null : op.id)} aria-expanded={expanded === op.id}>
                <p class={cn('text-[13px] font-medium break-words', op.status === 'undone' && 'line-through')}>{op.label}</p>
                <p class="text-xs text-muted-foreground">
                  {formatDateTime(op.timestamp)}
                  {#if op.type !== 'sync'} · {datasetName(op.datasetId)}{/if}
                  {#if op.status === 'undone'} · <span class="font-medium">dibatalkan</span>{/if}
                </p>
                {#if op.type === 'sync'}
                  <div class="mt-1 flex flex-wrap gap-1">
                    <Badge variant="match">{op.stats.filled} diisi</Badge>
                    {#if op.stats.overwritten}<Badge variant="mismatch">{op.stats.overwritten} ditimpa</Badge>{/if}
                    {#if op.stats.skippedEmpty}<Badge variant="unmatched">{op.stats.skippedEmpty} kosong dilewati</Badge>{/if}
                    {#if op.stats.unmatchedSource + op.stats.unmatchedTarget}<Badge variant="unmatched">{op.stats.unmatchedSource + op.stats.unmatchedTarget} tidak berpasangan</Badge>{/if}
                  </div>
                {/if}
              </button>
              {#if op.status === 'applied'}
                <Button variant="ghost" size="xs" onclick={() => app.runHistory('undo', op.id)}><Undo2 /> Batalkan</Button>
              {:else}
                <Button variant="ghost" size="xs" onclick={() => app.runHistory('redo', op.id)}><Redo2 /> Ulangi</Button>
              {/if}
            </div>
            {#if expanded === op.id && op.type === 'sync'}
              <dl class="mt-2 ml-6 grid grid-cols-2 gap-x-4 gap-y-0.5 rounded-md bg-muted/50 px-3 py-2 text-xs sm:grid-cols-3">
                <div><dt class="inline text-muted-foreground">Diproses:</dt> <dd class="inline">{op.stats.processedRecords} mahasiswa</dd></div>
                <div><dt class="inline text-muted-foreground">Diisi baru:</dt> <dd class="inline">{op.stats.filled}</dd></div>
                <div><dt class="inline text-muted-foreground">Ditimpa:</dt> <dd class="inline">{op.stats.overwritten}</dd></div>
                <div><dt class="inline text-muted-foreground">Timpaan ditolak:</dt> <dd class="inline">{op.stats.overwriteDeclined}</dd></div>
                <div><dt class="inline text-muted-foreground">Sudah sama:</dt> <dd class="inline">{op.stats.unchanged}</dd></div>
                <div><dt class="inline text-muted-foreground">Kosong dilewati:</dt> <dd class="inline">{op.stats.skippedEmpty}</dd></div>
                <div><dt class="inline text-muted-foreground">Hanya di Sumber:</dt> <dd class="inline">{op.stats.unmatchedSource}</dd></div>
                <div><dt class="inline text-muted-foreground">Hanya di Target:</dt> <dd class="inline">{op.stats.unmatchedTarget}</dd></div>
                <div><dt class="inline text-muted-foreground">Duplikat:</dt> <dd class="inline">{op.stats.duplicates}</dd></div>
                <div><dt class="inline text-muted-foreground">Beda nama:</dt> <dd class="inline">{op.stats.nameMismatches}</dd></div>
                <div><dt class="inline text-muted-foreground">Konflik:</dt> <dd class="inline">{op.stats.conflicts}</dd></div>
                <div class="col-span-full mt-1">
                  {#each op.sources as s (s.datasetId)}
                    <p><span class="font-medium">{s.datasetName}:</span> {s.pairs.map((p) => `${p.sourceColumnName} → ${p.targetColumnName}`).join(', ')}</p>
                  {/each}
                </div>
              </dl>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</div>
