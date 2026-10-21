"use client";

import * as React from "react";
import { ChevronDown, ChevronUp } from "lucide-react";

import { cn } from "@/lib/utils";

const EDGE_FADE_PX = 28;

/**
 * The dashboard's scroll area, which says when there's more: no scrollbar taking room on one side (so the padding stays
 * even), the content fading out at whichever edge has more past it, and a small chevron at each available edge that
 * scrolls in that direction. The chevrons fade and rise in 200ms ease-out.
 */
function ScrollArea({ className, children, ...props }: React.ComponentProps<"div">) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [edges, setEdges] = React.useState({ more: false, above: false, below: false });

  React.useLayoutEffect(() => {
    const area = ref.current;
    if (!area) return;
    const measure = () => {
      const more = area.scrollHeight > area.clientHeight + 1;
      const above = more && area.scrollTop > 1;
      const below = more && area.scrollTop + area.clientHeight < area.scrollHeight - 1;
      setEdges((previous) => (previous.more === more && previous.above === above && previous.below === below ? previous : { more, above, below }));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(area);
    for (const child of Array.from(area.children)) observer.observe(child);
    area.addEventListener("scroll", measure, { passive: true });
    return () => {
      observer.disconnect();
      area.removeEventListener("scroll", measure);
    };
  }, []);

  const mask = `linear-gradient(to bottom, ${edges.above ? "transparent" : "black"}, black ${EDGE_FADE_PX}px, black calc(100% - ${EDGE_FADE_PX}px), ${edges.below ? "transparent" : "black"})`;

  return (
    <div data-slot="scroll-area" className="relative flex h-full min-h-0 flex-col">
      <div
        ref={ref}
        data-slot="scroll-area-viewport"
        className={cn("min-h-0 flex-1 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden", className)}
        style={edges.more ? { maskImage: mask, WebkitMaskImage: mask } : undefined}
        {...props}
      >
        {children}
      </div>
      <button
        type="button"
        tabIndex={-1}
        aria-hidden
        onClick={() => ref.current?.scrollBy({ top: -ref.current.clientHeight * 0.8, behavior: "smooth" })}
        className={cn(
          "absolute top-1 left-1/2 grid size-6 -translate-x-1/2 place-items-center rounded-pill bg-surface text-fg-muted shadow-card transition-[opacity,translate] duration-200 ease-out hover:text-fg motion-reduce:transition-[opacity]",
          edges.above ? "opacity-100" : "pointer-events-none -translate-y-1 opacity-0",
        )}
      >
        <ChevronUp className="size-3.5" strokeWidth={1.75} />
      </button>
      <button
        type="button"
        tabIndex={-1}
        aria-hidden
        onClick={() => ref.current?.scrollBy({ top: ref.current.clientHeight * 0.8, behavior: "smooth" })}
        className={cn(
          "absolute bottom-1 left-1/2 grid size-6 -translate-x-1/2 place-items-center rounded-pill bg-surface text-fg-muted shadow-card transition-[opacity,translate] duration-200 ease-out hover:text-fg motion-reduce:transition-[opacity]",
          edges.below ? "opacity-100" : "pointer-events-none translate-y-1 opacity-0",
        )}
      >
        <ChevronDown className="size-3.5" strokeWidth={1.75} />
      </button>
    </div>
  );
}

export { ScrollArea };
