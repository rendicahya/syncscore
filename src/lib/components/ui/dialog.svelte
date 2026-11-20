<script lang="ts">
  import { Dialog } from 'bits-ui';
  import X from '@lucide/svelte/icons/x';
  import type { Snippet } from 'svelte';
  import { cn } from '$lib/utils';

  type Props = {
    open: boolean;
    title: string;
    description?: string;
    class?: string;
    /** Prevent closing via Escape/outside click (e.g. while a task is running). */
    dismissible?: boolean;
    onOpenChange?: (open: boolean) => void;
    children?: Snippet;
    footer?: Snippet;
  };

  let {
    open = $bindable(false),
    title,
    description,
    class: className,
    dismissible = true,
    onOpenChange,
    children,
    footer,
  }: Props = $props();
</script>

<Dialog.Root
  bind:open
  onOpenChange={(v) => {
    onOpenChange?.(v);
  }}
>
  <Dialog.Portal>
    <Dialog.Overlay
      class="fixed inset-0 z-50 bg-black/40 backdrop-blur-[1px] data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0"
    />
    <Dialog.Content
      escapeKeydownBehavior={dismissible ? 'close' : 'ignore'}
      interactOutsideBehavior={dismissible ? 'close' : 'ignore'}
      class={cn(
        'fixed top-1/2 left-1/2 z-50 flex max-h-[min(90dvh,900px)] w-[calc(100vw-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl border bg-popover text-popover-foreground shadow-lg outline-none data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95',
        className,
      )}
    >
      <div class="flex items-start gap-3 border-b px-5 py-4">
        <div class="min-w-0 flex-1">
          <Dialog.Title class="text-base font-semibold">{title}</Dialog.Title>
          {#if description}
            <Dialog.Description class="mt-1 text-sm text-muted-foreground">{description}</Dialog.Description>
          {/if}
        </div>
        {#if dismissible}
          <Dialog.Close
            class="-mr-1 rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
            aria-label="Tutup"
          >
            <X class="size-4" />
          </Dialog.Close>
        {/if}
      </div>
      <div class="min-h-0 flex-1 overflow-auto px-5 py-4">
        {@render children?.()}
      </div>
      {#if footer}
        <div class="flex flex-wrap items-center justify-end gap-2 border-t px-5 py-3">
          {@render footer()}
        </div>
      {/if}
    </Dialog.Content>
  </Dialog.Portal>
</Dialog.Root>
