"use client";

import * as React from "react";

import { SegmentedControl } from "@/components/ui/segmented-control";
import { cn } from "@/lib/utils";

// Every option group on the page is one style: the white pill in the gray tray. On phones the tray spans the column,
// each option at least 44px tall and as wide as its label, and a label wraps only when the row cannot hold it.
const PHONE = cn(
  "max-w-full",
  "max-[43.2rem]:flex max-[43.2rem]:w-full max-[43.2rem]:items-stretch",
  "max-[43.2rem]:[&>button]:h-auto max-[43.2rem]:[&>button]:min-h-11 max-[43.2rem]:[&>button]:min-w-0 max-[43.2rem]:[&>button]:flex-auto max-[43.2rem]:[&>button]:justify-center max-[43.2rem]:[&>button]:px-2.5 max-[43.2rem]:[&>button]:py-1.5 max-[43.2rem]:[&>button]:text-center max-[43.2rem]:[&>button]:leading-snug max-[43.2rem]:[&>button]:whitespace-normal",
);

export function Choice<T extends string>({ className, ...props }: Omit<React.ComponentProps<typeof SegmentedControl<T>>, "variant">) {
  return <SegmentedControl<T> variant="segmented" className={cn(PHONE, className)} {...props} />;
}
