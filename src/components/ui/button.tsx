import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap font-normal outline-none select-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid focus-visible:outline-focus-ring active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50 motion-reduce:transition-none motion-reduce:active:scale-100 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
  {
    variants: {
      variant: {
        primary: "rounded-control bg-primary text-on-primary hover:bg-neutral-90",
        brand: "rounded-control bg-brand text-on-brand hover:bg-blue-90",
        outline: "rounded-control border border-line-strong text-fg hover:border-fg",
        "outline-brand": "rounded-control border border-brand text-fg-brand hover:bg-blue-10",
        ghost: "rounded-control text-fg-muted hover:bg-wash-hover hover:text-fg data-[state=open]:bg-wash-hover data-[state=open]:text-fg",
        "on-brand": "rounded-control border border-white text-white hover:bg-white/10",
        pill: "rounded-pill border border-black bg-black text-white hover:bg-neutral-80",
        "pill-outline": "rounded-pill border border-brand bg-white text-fg-brand hover:bg-blue-10",
        "pill-on-brand": "rounded-pill border border-white text-white hover:bg-white/12",
      },
      size: {
        sm: "h-8 px-3.5 text-body-sm",
        md: "h-10 px-4.5 text-body-sm",
        icon: "size-8 px-0 [&_svg:not([class*='size-'])]:size-4",
      },
    },
    compoundVariants: [
      { variant: ["primary", "brand", "outline", "outline-brand", "ghost", "on-brand"], className: "transition-[color,background-color,border-color,scale] duration-150 ease-out" },
      { variant: "ghost", size: "icon", className: "text-fg-subtle" },
      { variant: ["pill", "pill-outline", "pill-on-brand"], className: "transition-[color,background-color,border-color,scale] duration-200 ease-out" },
      { variant: ["pill", "pill-outline", "pill-on-brand"], size: "md", className: "h-auto px-5 py-3 text-body leading-snug" },
      { variant: ["pill", "pill-outline", "pill-on-brand"], size: "sm", className: "h-auto px-4 py-2 text-body-sm leading-snug" },
    ],
    defaultVariants: { variant: "outline", size: "md" },
  },
);

type ButtonProps = React.ComponentProps<"button"> & VariantProps<typeof buttonVariants> & { asChild?: boolean };

function Button({ className, variant, size, asChild = false, type, ...props }: ButtonProps) {
  const Comp = asChild ? Slot : "button";
  return <Comp data-slot="button" type={asChild ? type : (type ?? "button")} className={cn(buttonVariants({ variant, size, className }))} {...props} />;
}

export { Button };
