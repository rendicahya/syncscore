<script lang="ts">
  import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
  import { ui } from '$lib/state/ui.svelte';
  import Button from './ui/button.svelte';
  import Dialog from './ui/dialog.svelte';
  import Input from './ui/input.svelte';

  let confirmOpen = $state(false);
  let promptOpen = $state(false);
  let promptValue = $state('');

  $effect(() => {
    confirmOpen = ui.confirm !== null;
  });
  $effect(() => {
    promptOpen = ui.prompt !== null;
    if (ui.prompt) promptValue = ui.prompt.value ?? '';
  });

  function submitPrompt(e: SubmitEvent) {
    e.preventDefault();
    const v = promptValue.trim();
    if (v) ui.answerPrompt(v);
  }
</script>

{#if ui.confirm}
  {@const c = ui.confirm}
  <Dialog
    bind:open={confirmOpen}
    title={c.title}
    onOpenChange={(o) => {
      if (!o) ui.answer('cancel');
    }}
  >
    <div class="flex gap-3">
      {#if c.destructive}
        <div class="mt-0.5 rounded-full bg-destructive/10 p-2 text-destructive">
          <TriangleAlert class="size-4" />
        </div>
      {/if}
      <div class="min-w-0 space-y-2 text-sm">
        <p class="text-foreground/90">{c.message}</p>
        {#if c.details?.length}
          <ul class="space-y-1 rounded-md border bg-muted/50 px-3 py-2 text-[13px]">
            {#each c.details as d, i (i)}
              <li class="break-words">{d}</li>
            {/each}
          </ul>
        {/if}
      </div>
    </div>
    {#snippet footer()}
      <Button variant="outline" onclick={() => ui.answer('cancel')}>{c.cancelLabel ?? 'Batal'}</Button>
      {#if c.altLabel}
        <Button variant="secondary" onclick={() => ui.answer('alt')}>{c.altLabel}</Button>
      {/if}
      <Button variant={c.destructive ? 'destructive' : 'default'} onclick={() => ui.answer('confirm')}>
        {c.confirmLabel ?? 'Lanjutkan'}
      </Button>
    {/snippet}
  </Dialog>
{/if}

{#if ui.prompt}
  {@const p = ui.prompt}
  <Dialog
    bind:open={promptOpen}
    title={p.title}
    onOpenChange={(o) => {
      if (!o) ui.answerPrompt(null);
    }}
  >
    <form id="prompt-form" onsubmit={submitPrompt} class="space-y-2">
      <label class="text-sm font-medium" for="prompt-input">{p.label}</label>
      <Input id="prompt-input" bind:value={promptValue} autocomplete="off" maxlength={120} />
    </form>
    {#snippet footer()}
      <Button variant="outline" onclick={() => ui.answerPrompt(null)}>Batal</Button>
      <Button type="submit" form="prompt-form" disabled={!promptValue.trim()}>{p.confirmLabel ?? 'Simpan'}</Button>
    {/snippet}
  </Dialog>
{/if}
