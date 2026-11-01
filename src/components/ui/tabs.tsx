"use client";

import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { cva } from "class-variance-authority";

import { cn } from "@/lib/utils";

type Variant = "default" | "segmented" | "pill";
type Size = "sm" | "md";

const INNER_RADIUS = "rounded-[calc(var(--ds-radius-control)-0.125rem)]";
const SELF_SURFACE: Record<Variant, string> = {
  default: "data-[state=active]:bg-wash-pill",
  segmented: "data-[state=active]:bg-surface data-[state=active]:shadow-[0_1px_3px_rgb(0_0_0/0.08),0_0_0_1px_rgb(0_0_0/0.03)]",
  pill: "data-[state=active]:border-brand data-[state=active]:bg-surface",
};

const tabsTriggerVariants = cva(
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid focus-visible:outline-focus-ring disabled:pointer-events-none disabled:opacity-50 transition-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "text-fg-subtle hover:text-fg data-[state=active]:text-fg",
        segmented: "text-fg-muted hover:text-fg data-[state=active]:text-fg",
        pill: "rounded-pill border border-transparent px-5 py-2.5 text-body leading-snug text-fg-muted hover:bg-blue-10 hover:text-fg data-[state=active]:text-fg-brand data-[state=active]:hover:bg-transparent",
      },
      size: { sm: "", md: "" },
    },
    compoundVariants: [
      { variant: "default", size: "md", className: "h-9 rounded-control px-4 text-body-sm" },
      { variant: "default", size: "sm", className: `h-7 px-3 text-caption ${INNER_RADIUS}` },
      { variant: "segmented", size: "md", className: `h-8 px-3.5 text-body-sm ${INNER_RADIUS}` },
      { variant: "segmented", size: "sm", className: `h-7 px-3 text-caption ${INNER_RADIUS}` },
    ],
    defaultVariants: { variant: "default", size: "md" },
  },
);

const ListState = React.createContext<{ variant: Variant; size: Size }>({ variant: "default", size: "md" });

function Tabs({ className, value, defaultValue, onValueChange, ...props }: React.ComponentProps<typeof TabsPrimitive.Root>) {
  const [uncontrolled, setUncontrolled] = React.useState(defaultValue);
  const active = value ?? uncontrolled;
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      value={active}
      onValueChange={(next) => {
        setUncontrolled(next);
        onValueChange?.(next);
      }}
      className={cn("flex flex-col gap-4", className)}
      {...props}
    />
  );
}

function TabsList({
  className,
  variant = "default",
  size = "md",
  children,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List> & {
  variant?: Variant;
  size?: Size;
}) {
  const listState = React.useMemo(() => ({ variant, size }), [variant, size]);

  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn(
        "relative isolate inline-flex w-fit items-center",
        variant === "pill" ? "gap-2" : variant === "segmented" ? "gap-0.5 rounded-control bg-neutral-5 p-0.5" : size === "sm" ? "gap-0.5" : "gap-1",
        className,
      )}
      {...props}
    >
      <ListState.Provider value={listState}>{children}</ListState.Provider>
    </TabsPrimitive.List>
  );
}

function TabsTrigger({ className, value, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  const { variant, size } = React.useContext(ListState);
  return <TabsPrimitive.Trigger data-slot="tabs-trigger" data-tab-id={value} value={value} className={cn(tabsTriggerVariants({ variant, size }), SELF_SURFACE[variant], className)} {...props} />;
}

function TabsContent({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return <TabsPrimitive.Content data-slot="tabs-content" className={cn("flex-1 outline-none", className)} {...props} />;
}

export { Tabs, TabsList, TabsTrigger, TabsContent };
