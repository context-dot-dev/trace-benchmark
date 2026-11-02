"use client";

import * as React from "react";

import { cn } from "@/lib/utils";
import { TooltipProvider } from "@/lib/tooltip-provider";
import { useScrollingScrollbars } from "@/hooks/use-scrolling-scrollbars";

const PortalContainer = React.createContext<HTMLElement | null>(null);

export function Surface({ kind, className, children, ...props }: React.ComponentProps<"div"> & { kind: "site" | "product" }) {
  useScrollingScrollbars();
  const [element, setElement] = React.useState<HTMLDivElement | null>(null);
  return (
    <div ref={setElement} data-surface={kind} className={cn("relative", kind === "product" ? "ds-product text-body leading-normal" : "ds-site", className)} {...props}>
      <PortalContainer.Provider value={element}><TooltipProvider>{children}</TooltipProvider></PortalContainer.Provider>
    </div>
  );
}

export function usePortalContainer() {
  return React.useContext(PortalContainer) ?? undefined;
}
