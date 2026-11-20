<script lang="ts">
  import type { HTMLSelectAttributes } from 'svelte/elements';
  import { cn } from '$lib/utils';

  type Props = Omit<HTMLSelectAttributes, 'value'> & { value?: string };
  let { value = $bindable(''), class: className, children, ...rest }: Props = $props();
</script>

<select
  bind:value
  class={cn(
    'h-9 w-full min-w-0 rounded-md border border-input bg-card px-2.5 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40 disabled:opacity-50',
    className as string,
  )}
  {...rest}
>
  {@render children?.()}
</select>
