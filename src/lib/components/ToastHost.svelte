<script lang="ts">
  import CircleCheck from '@lucide/svelte/icons/circle-check';
  import CircleAlert from '@lucide/svelte/icons/circle-alert';
  import Info from '@lucide/svelte/icons/info';
  import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
  import X from '@lucide/svelte/icons/x';
  import { ui } from '$lib/state/ui.svelte';

  const icon = { success: CircleCheck, error: CircleAlert, info: Info, warning: TriangleAlert };
  const tone = {
    success: 'text-st-match-fg',
    error: 'text-destructive',
    info: 'text-primary',
    warning: 'text-st-mismatch-fg',
  };
</script>

<div
  class="pointer-events-none fixed right-4 bottom-4 z-[60] flex w-[min(380px,calc(100vw-2rem))] flex-col gap-2"
  aria-live="polite"
  role="status"
>
  {#each ui.toasts as t (t.id)}
    {@const Icon = icon[t.kind]}
    <div class="pointer-events-auto flex items-start gap-3 rounded-lg border bg-popover px-3.5 py-3 text-sm shadow-lg">
      <Icon class="mt-0.5 size-4 shrink-0 {tone[t.kind]}" />
      <div class="min-w-0 flex-1">
        <p class="font-medium">{t.title}</p>
        {#if t.message}<p class="mt-0.5 text-[13px] text-muted-foreground">{t.message}</p>{/if}
      </div>
      <button
        class="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
        aria-label="Tutup notifikasi"
        onclick={() => ui.dismiss(t.id)}
      >
        <X class="size-3.5" />
      </button>
    </div>
  {/each}
</div>
