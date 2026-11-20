<script lang="ts">
  import type { HTMLInputAttributes } from 'svelte/elements';
  import { cn } from '$lib/utils';

  type Props = Omit<HTMLInputAttributes, 'value'> & { value?: string; ref?: HTMLInputElement | null };
  let { value = $bindable(''), ref = $bindable(null), class: className, ...rest }: Props = $props();
</script>

<input
  bind:this={ref}
  bind:value
  class={cn(
    'flex h-9 w-full min-w-0 rounded-md border border-input bg-card px-3 py-1 text-sm shadow-xs transition-[color,box-shadow] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-50',
    className as string,
  )}
  {...rest}
/>
