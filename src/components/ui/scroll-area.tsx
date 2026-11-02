"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

const EDGE_FADE_PX = 28;

export function ScrollArea({ className, children, ...props }: React.ComponentProps<"div">) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [edges, setEdges] = React.useState({ more: false, above: false, below: false });

  React.useLayoutEffect(() => {
    const area = ref.current;
    if (!area) return;
    const measure = () => {
      const more = area.scrollHeight > area.clientHeight + 1;
      const above = more && area.scrollTop > 1;
      const below = more && area.scrollTop + area.clientHeight < area.scrollHeight - 1;
      setEdges((previous) => previous.more === more && previous.above === above && previous.below === below ? previous : { more, above, below });
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
    <div data-slot="scroll-area" className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] grid-rows-[minmax(0,1fr)]">
      <div
        ref={ref}
        data-slot="scroll-area-viewport"
        className={cn("col-start-1 row-start-1 min-h-0 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden", className)}
        style={edges.more ? { maskImage: mask, WebkitMaskImage: mask } : undefined}
        {...props}
      >
        {children}
      </div>
      <button
        type="button"
        tabIndex={-1}
        aria-hidden="true"
        data-slot="scroll-area-more"
        onPointerDown={(event) => {
          if (event.pointerType === "mouse") event.preventDefault();
        }}
        onClick={() => ref.current?.scrollBy({ top: ref.current.clientHeight * 0.8, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" })}
        className={cn(
          "z-10 col-start-1 row-start-1 mb-1 grid size-6 self-end justify-self-center place-items-center rounded-pill bg-surface text-fg-muted shadow-card transition-[opacity,translate] duration-200 ease-out hover:text-fg motion-reduce:transition-none",
          edges.below ? "opacity-100" : "pointer-events-none translate-y-1 opacity-0",
        )}
      >
        <svg aria-hidden="true" viewBox="0 0 16 16" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
          <path d="m4 6 4 4 4-4" />
        </svg>
      </button>
    </div>
  );
}
