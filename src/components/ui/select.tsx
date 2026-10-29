"use client";

import * as React from "react";
import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown, ChevronsUpDown, ChevronUp } from "lucide-react";
import { cva, type VariantProps } from "class-variance-authority";

import { usePortalContainer } from "@/lib/surface";
import { cn } from "@/lib/utils";

// The dashboard's single-choice dropdown (SelectMenu): a quiet bordered button in toolbars (`ghost`), a full field beside
// inputs (`field`, `compact` for dense panels), or a small gray chip in a card's footer (`chip`); the list is the same
// menu panel growing from its trigger's corner, the selected row black with a blue check.
const triggerVariants = cva(
  "flex items-center gap-1.5 whitespace-nowrap outline-none transition-colors duration-150 ease-out focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid focus-visible:outline-focus-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-3.5 [&_svg]:shrink-0 [&_svg]:text-fg-subtle",
  {
    variants: {
      appearance: {
        ghost: "h-8 rounded-control border border-line px-3 text-body-sm text-fg-muted hover:border-line-strong hover:text-fg data-[state=open]:border-line-strong data-[state=open]:text-fg",
        field: "w-full rounded-control border border-line bg-surface text-fg hover:border-line-strong data-[state=open]:border-brand data-placeholder:text-fg-subtle [&>span]:flex-1 [&>span]:text-left",
        chip: "h-7 rounded-[calc(var(--ds-radius-control)-0.125rem)] bg-wash-hover px-2.5 text-caption text-fg-muted hover:bg-wash-pill hover:text-fg data-[state=open]:bg-wash-pill data-[state=open]:text-fg",
      },
      // A shorter field, for dense panels.
      compact: { true: "", false: "" },
    },
    compoundVariants: [
      { appearance: "field", compact: false, className: "h-10 px-3.5 text-body-sm" },
      { appearance: "field", compact: true, className: "h-7 px-2.5 text-caption" },
    ],
    defaultVariants: { appearance: "ghost", compact: false },
  },
);

function Select(props: React.ComponentProps<typeof SelectPrimitive.Root>) {
  return <SelectPrimitive.Root data-slot="select" {...props} />;
}

function SelectGroup(props: React.ComponentProps<typeof SelectPrimitive.Group>) {
  return <SelectPrimitive.Group data-slot="select-group" {...props} />;
}

function SelectValue(props: React.ComponentProps<typeof SelectPrimitive.Value>) {
  return <SelectPrimitive.Value data-slot="select-value" {...props} />;
}

function SelectTrigger({ className, appearance, compact, children, ...props }: React.ComponentProps<typeof SelectPrimitive.Trigger> & VariantProps<typeof triggerVariants>) {
  return (
    <SelectPrimitive.Trigger data-slot="select-trigger" className={cn(triggerVariants({ appearance, compact }), className)} {...props}>
      {children}
      <SelectPrimitive.Icon asChild>
        <ChevronsUpDown strokeWidth={1.5} />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}

function SelectContent({ className, children, position = "popper", ...props }: React.ComponentProps<typeof SelectPrimitive.Content>) {
  return (
    <SelectPrimitive.Portal container={usePortalContainer()}>
      <SelectPrimitive.Content
        data-slot="select-content"
        position={position}
        sideOffset={6}
        className={cn(
          "relative z-50 max-h-80 min-w-52 origin-(--radix-select-content-transform-origin) animate-pop-in overflow-hidden rounded-shell bg-surface p-(--ds-space-frame) shadow-floating",
          position === "popper" && "w-full min-w-(--radix-select-trigger-width)",
          className,
        )}
        {...props}
      >
        <SelectPrimitive.ScrollUpButton className="flex h-6 items-center justify-center text-fg-subtle">
          <ChevronUp className="size-3.5" />
        </SelectPrimitive.ScrollUpButton>
        <SelectPrimitive.Viewport className="flex flex-col gap-0.5">{children}</SelectPrimitive.Viewport>
        <SelectPrimitive.ScrollDownButton className="flex h-6 items-center justify-center text-fg-subtle">
          <ChevronDown className="size-3.5" />
        </SelectPrimitive.ScrollDownButton>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
}

function SelectLabel({ className, ...props }: React.ComponentProps<typeof SelectPrimitive.Label>) {
  return <SelectPrimitive.Label data-slot="select-label" className={cn("px-2.5 pt-1 pb-1.5 text-caption text-fg-subtle", className)} {...props} />;
}

function SelectItem({ className, children, description, ...props }: React.ComponentProps<typeof SelectPrimitive.Item> & { description?: React.ReactNode }) {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={cn(
        "relative flex w-full cursor-default items-start gap-2 rounded-control py-1.5 pr-8 pl-2.5 text-body-sm leading-5 text-fg-muted outline-none select-none transition-colors duration-150 data-[disabled]:pointer-events-none data-[disabled]:opacity-40 data-[highlighted]:bg-wash-hover data-[state=checked]:text-fg",
        className,
      )}
      {...props}
    >
      <span className="min-w-0 flex-1">
        <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
        {description && <span className="mt-0.5 block text-caption text-fg-subtle">{description}</span>}
      </span>
      <SelectPrimitive.ItemIndicator className="absolute top-2 right-2.5 text-brand">
        <Check className="size-3.5" strokeWidth={1.75} />
      </SelectPrimitive.ItemIndicator>
    </SelectPrimitive.Item>
  );
}

function SelectSeparator({ className, ...props }: React.ComponentProps<typeof SelectPrimitive.Separator>) {
  return <SelectPrimitive.Separator data-slot="select-separator" className={cn("-mx-1.5 my-1 h-px bg-line-subtle", className)} {...props} />;
}

export { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue };
