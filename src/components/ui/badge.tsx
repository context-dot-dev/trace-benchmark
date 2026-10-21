import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

// The product's status label (the dashboard's StatusBadge): the word in mono caption on a hairline-bordered box, the
// status told by its color alone. `tag` is the dashboard's tag chip (blue on blue 10); `chip` is the site's hairline pill.
const badgeVariants = cva("inline-flex w-fit shrink-0 items-center justify-center gap-1 whitespace-nowrap [&>svg]:pointer-events-none [&>svg]:size-3", {
  variants: {
    variant: {
      default: "rounded-control border border-line px-2 pt-0.75 pb-1 font-mono text-caption leading-none text-fg-subtle",
      brand: "rounded-control border border-line px-2 pt-0.75 pb-1 font-mono text-caption leading-none text-fg-brand",
      success: "rounded-control border border-line px-2 pt-0.75 pb-1 font-mono text-caption leading-none text-success",
      warning: "rounded-control border border-line px-2 pt-0.75 pb-1 font-mono text-caption leading-none text-warning",
      destructive: "rounded-control border border-line px-2 pt-0.75 pb-1 font-mono text-caption leading-none text-danger",
      tag: "h-6 rounded-[calc(var(--ds-radius-control)-0.125rem)] bg-blue-10 px-2.5 text-caption text-fg-brand",
      chip: "rounded-pill px-3 py-1 text-body-sm leading-snug text-fg-nav ring-1 ring-line ring-inset",
    },
  },
  defaultVariants: { variant: "default" },
});

function Badge({ className, variant, asChild = false, ...props }: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "span";
  return <Comp data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge };
