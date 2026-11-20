<script lang="ts" module>
  import { tv, type VariantProps } from 'tailwind-variants';

  export const buttonVariants = tv({
    base: 'inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md text-sm font-medium transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*=size-])]:size-4',
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground shadow-xs hover:bg-primary/90',
        destructive: 'bg-destructive text-destructive-foreground shadow-xs hover:bg-destructive/90',
        outline: 'border bg-card shadow-xs hover:bg-accent hover:text-accent-foreground',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
        ghost: 'hover:bg-accent hover:text-accent-foreground',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-9 px-4 py-2',
        sm: 'h-8 px-3 text-[13px]',
        xs: 'h-7 px-2 text-xs',
        lg: 'h-10 px-6',
        icon: 'size-9',
        'icon-sm': 'size-8',
        'icon-xs': 'size-7',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  });

  export type ButtonVariant = VariantProps<typeof buttonVariants>['variant'];
  export type ButtonSize = VariantProps<typeof buttonVariants>['size'];
</script>

<script lang="ts">
  import type { HTMLButtonAttributes } from 'svelte/elements';
  import { cn } from '$lib/utils';

  type Props = HTMLButtonAttributes & {
    variant?: ButtonVariant;
    size?: ButtonSize;
    ref?: HTMLButtonElement | null;
  };

  let {
    variant = 'default',
    size = 'default',
    class: className,
    type = 'button',
    ref = $bindable(null),
    children,
    ...rest
  }: Props = $props();
</script>

<button bind:this={ref} {type} class={cn(buttonVariants({ variant, size }), className as string)} {...rest}>
  {@render children?.()}
</button>
