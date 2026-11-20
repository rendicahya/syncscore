/** Shared class names for bits-ui DropdownMenu parts (shadcn-svelte style). */
export const menuContent =
  'z-50 min-w-[12rem] overflow-hidden rounded-lg border bg-popover p-1 text-popover-foreground shadow-md outline-none data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0';
export const menuItem =
  'relative flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted-foreground';
export const menuItemDestructive = `${menuItem} text-destructive data-[highlighted]:bg-destructive/10 data-[highlighted]:text-destructive [&_svg]:!text-destructive`;
export const menuSeparator = '-mx-1 my-1 h-px bg-border';
export const menuLabel = 'px-2 py-1.5 text-xs font-medium text-muted-foreground';
