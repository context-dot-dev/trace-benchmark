import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

// The product's card (.glass-card): white, its hairline drawn into the shadow. The site's card sits in a soft blue ring (the ring is
// a spread shadow, so it adds no layout size).
const cardVariants = cva("flex flex-col bg-surface text-fg", {
  variants: {
    variant: {
      default: "gap-4 rounded-card px-5 py-4 shadow-card",
      ring: "gap-4 rounded-card p-6 shadow-[0_0_0_1px_var(--ds-color-border-hairline),0_0_0_var(--ds-space-2)_var(--ds-color-ring-tint)] md:p-8",
    },
  },
  defaultVariants: { variant: "default" },
});

function Card({ className, variant, ...props }: React.ComponentProps<"div"> & VariantProps<typeof cardVariants>) {
  return <div data-slot="card" className={cn(cardVariants({ variant }), className)} {...props} />;
}

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="card-header" className={cn("grid auto-rows-min grid-rows-[auto_auto] items-start gap-1 has-data-[slot=card-action]:grid-cols-[1fr_auto]", className)} {...props} />;
}

function CardTitle({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="card-title" className={cn("text-h5 leading-snug font-normal text-fg", className)} {...props} />;
}

function CardDescription({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="card-description" className={cn("text-body-sm leading-relaxed text-fg-muted", className)} {...props} />;
}

function CardAction({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="card-action" className={cn("col-start-2 row-span-2 row-start-1 self-start justify-self-end", className)} {...props} />;
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="card-content" className={cn("text-body-sm text-fg", className)} {...props} />;
}

function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="card-footer" className={cn("flex items-center gap-2", className)} {...props} />;
}

export { Card, CardHeader, CardFooter, CardTitle, CardAction, CardDescription, CardContent };
