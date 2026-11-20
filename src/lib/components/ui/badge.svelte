<script lang="ts" module>
  import { tv, type VariantProps } from 'tailwind-variants';
  export const badgeVariants = tv({
    base: 'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs font-medium whitespace-nowrap [&_svg]:size-3',
    variants: {
      variant: {
        default: 'border-transparent bg-primary text-primary-foreground',
        secondary: 'border-transparent bg-secondary text-secondary-foreground',
        outline: 'text-foreground',
        match: 'border-transparent bg-st-match text-st-match-fg',
        manual: 'border-transparent bg-st-manual text-st-manual-fg',
        unmatched: 'border-transparent bg-st-unmatched text-st-unmatched-fg',
        duplicate: 'border-transparent bg-st-duplicate text-st-duplicate-fg',
        mismatch: 'border-transparent bg-st-mismatch text-st-mismatch-fg',
        changed: 'border-transparent bg-st-changed text-st-changed-fg',
        destructive: 'border-transparent bg-destructive text-destructive-foreground',
      },
    },
    defaultVariants: { variant: 'default' },
  });
  export type BadgeVariant = VariantProps<typeof badgeVariants>['variant'];
</script>

<script lang="ts">
  import type { HTMLAttributes } from 'svelte/elements';
  import { cn } from '$lib/utils';
  type Props = HTMLAttributes<HTMLSpanElement> & { variant?: BadgeVariant };
  let { variant = 'default', class: className, children, ...rest }: Props = $props();
</script>

<span class={cn(badgeVariants({ variant }), className as string)} {...rest}>{@render children?.()}</span>
