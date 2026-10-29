"use client";

import * as React from "react";

import { cn } from "@/lib/utils";
import { TooltipProvider } from "@/lib/tooltip-provider";
import { useScrollingScrollbars } from "@/hooks/use-scrolling-scrollbars";

// A product area on a site page (or a site area in a product): its class sets the scale, and dialogs, menus and
// tooltips opened inside it render inside it too, so they keep that scale instead of the page's. A product area also
// takes the dashboard's base line height. Its named text sizes supply their own compact line heights.
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

/** Where overlays render: the nearest Surface, else the page body. */
export function usePortalContainer() {
  return React.useContext(PortalContainer) ?? undefined;
}
