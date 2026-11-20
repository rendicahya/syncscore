<script lang="ts" module>
  import type { Component } from 'svelte';

  export type ContextMenuEntry =
    | {
        kind?: 'item';
        label: string;
        icon?: Component;
        onSelect: () => void;
        disabled?: boolean;
        destructive?: boolean;
        /** Keyboard shortcut hint shown on the right (display only). */
        shortcut?: string;
      }
    | { kind: 'separator' }
    | { kind: 'label'; label: string };

  export type ContextMenuItems = ContextMenuEntry[] | (() => ContextMenuEntry[]);
</script>

<script lang="ts">
  import { ContextMenu } from 'bits-ui';
  import type { Snippet } from 'svelte';
  import { cn } from '$lib/utils';
  import { menuContent, menuItem, menuItemDestructive, menuLabel, menuSeparator } from './menu';

  type Props = {
    /** Menu entries, or a function evaluated each time the menu opens (for selection-dependent menus). */
    items: ContextMenuItems;
    /** Element rendered as the trigger area. */
    as?: string;
    class?: string;
    disabled?: boolean;
    /** Called instead of the default focus restoration when the menu closes. */
    restoreFocus?: () => void;
    children: Snippet;
    [key: string]: unknown;
  };

  let { items, as = 'div', class: className, disabled = false, restoreFocus, children, ...rest }: Props = $props();

  let open = $state(false);
  let entries = $state<ContextMenuEntry[]>([]);

  function resolve(): ContextMenuEntry[] {
    const list = typeof items === 'function' ? items() : items;
    // Drop leading/trailing/double separators produced by conditional entries.
    const out: ContextMenuEntry[] = [];
    for (const e of list) {
      if (e.kind === 'separator' && (out.length === 0 || out[out.length - 1].kind === 'separator')) continue;
      out.push(e);
    }
    while (out.length && out[out.length - 1].kind === 'separator') out.pop();
    return out;
  }

  function onOpenChange(v: boolean) {
    if (v) entries = resolve();
    open = v && entries.length > 0;
  }
</script>

<ContextMenu.Root bind:open {onOpenChange}>
  <ContextMenu.Trigger {disabled}>
    {#snippet child({ props })}
      <svelte:element this={as} {...rest} {...props} class={cn(className)}>
        {@render children()}
      </svelte:element>
    {/snippet}
  </ContextMenu.Trigger>
  <ContextMenu.Portal>
    <ContextMenu.Content
      class={menuContent}
      onCloseAutoFocus={(e) => {
        if (restoreFocus) {
          e.preventDefault();
          restoreFocus();
        }
      }}
    >
      {#each entries as entry, i (i)}
        {#if entry.kind === 'separator'}
          <ContextMenu.Separator class={menuSeparator} />
        {:else if entry.kind === 'label'}
          <div class={menuLabel}>{entry.label}</div>
        {:else}
          {@const Icon = entry.icon}
          <ContextMenu.Item
            class={entry.destructive ? menuItemDestructive : menuItem}
            disabled={entry.disabled}
            onSelect={entry.onSelect}
          >
            {#if Icon}<Icon />{:else}<span class="size-4 shrink-0"></span>{/if}
            <span class="flex-1">{entry.label}</span>
            {#if entry.shortcut}<span class="ml-4 text-xs tracking-wide text-muted-foreground">{entry.shortcut}</span>{/if}
          </ContextMenu.Item>
        {/if}
      {/each}
    </ContextMenu.Content>
  </ContextMenu.Portal>
</ContextMenu.Root>
