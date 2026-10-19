"use client";

import { cn } from "@/lib/utils";
import { useEffect, useRef, useState } from "react";

const DEFAULT_PITCH = 14;
const DEFAULT_RING_RADIUS = 3.5;
const RING_STROKE = 1;
// Opaque content inside the backdrop that should have whole rings around it rather than rings sliced by its edges.
export const RING_CLEAR_ATTRIBUTE = "data-ring-clear";

interface Ring {
  cx: number;
  cy: number;
}

interface ClipShape {
  left: number;
  top: number;
  right: number;
  bottom: number;
  radius: number;
}

// A ring is kept only when all of it, stroke included, lies inside the rounded box, so no ring is ever sliced by a corner.
function fitsInside(ring: Ring, clip: ClipShape, ringRadius: number) {
  const reach = ringRadius + RING_STROKE / 2;
  const left = clip.left + reach;
  const right = clip.right - reach;
  const top = clip.top + reach;
  const bottom = clip.bottom - reach;
  if (ring.cx < left || ring.cx > right || ring.cy < top || ring.cy > bottom) return false;
  const corner = Math.max(0, clip.radius - reach);
  const nearestX = Math.min(Math.max(ring.cx, left + corner), right - corner);
  const nearestY = Math.min(Math.max(ring.cy, top + corner), bottom - corner);
  return Math.hypot(ring.cx - nearestX, ring.cy - nearestY) <= corner;
}

// The nearest ancestor that clips, whose rounded outline the rings have to stay inside.
function clippingAncestor(element: HTMLElement) {
  let node = element.parentElement;
  while (node && getComputedStyle(node).overflow === "visible") node = node.parentElement;
  return node;
}

const overlaps = (ring: Ring, box: ClipShape, reach: number) => ring.cx + reach > box.left && ring.cx - reach < box.right && ring.cy + reach > box.top && ring.cy - reach < box.bottom;

/**
 * A faint grid of rings, spaced evenly like a `space`-repeated tile, that leaves out every ring something would cut:
 * this element's own rounded corners, those of the nearest clipping ancestor (a card with rounded corners), and the
 * edges of any sibling content marked with RING_CLEAR_ATTRIBUTE that sits on top of it. The rings take the text color
 * (white on the hero's blue panel, brand blue on white) at `opacity`: 0.22 on blue, 0.14 on white, as on the site.
 */
export function RingBackdrop({ opacity = 0.22, pitch = DEFAULT_PITCH, ringRadius = DEFAULT_RING_RADIUS, className }: { opacity?: number; pitch?: number; ringRadius?: number; className?: string }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [rings, setRings] = useState<Ring[]>([]);

  useEffect(() => {
    const element = boxRef.current;
    if (!element) return;
    const layout = () => {
      const box = element.getBoundingClientRect();
      const columns = Math.floor(box.width / pitch);
      const rows = Math.floor(box.height / pitch);
      if (columns < 1 || rows < 1) return setRings([]);
      const gapX = (box.width - columns * pitch) / columns;
      const gapY = (box.height - rows * pitch) / rows;
      const ownRadius = parseFloat(getComputedStyle(element).borderTopLeftRadius) || 0;
      const clips: ClipShape[] = [{ left: 0, top: 0, right: box.width, bottom: box.height, radius: ownRadius }];
      const ancestor = clippingAncestor(element);
      if (ancestor) {
        const outer = ancestor.getBoundingClientRect();
        clips.push({ left: outer.left - box.left, top: outer.top - box.top, right: outer.right - box.left, bottom: outer.bottom - box.top, radius: parseFloat(getComputedStyle(ancestor).borderTopLeftRadius) || 0 });
      }
      const covers = Array.from(element.parentElement?.querySelectorAll(`[${RING_CLEAR_ATTRIBUTE}]`) ?? [], (cover) => {
        const rect = cover.getBoundingClientRect();
        return { left: rect.left - box.left, top: rect.top - box.top, right: rect.right - box.left, bottom: rect.bottom - box.top, radius: 0 };
      });
      const reach = ringRadius + RING_STROKE / 2 + 1;
      const next: Ring[] = [];
      for (let row = 0; row < rows; row++) {
        for (let column = 0; column < columns; column++) {
          const ring = { cx: column * (pitch + gapX) + (pitch + gapX) / 2, cy: row * (pitch + gapY) + (pitch + gapY) / 2 };
          if (clips.every((clip) => fitsInside(ring, clip, ringRadius)) && !covers.some((cover) => overlaps(ring, cover, reach))) next.push(ring);
        }
      }
      setRings(next);
    };
    layout();
    const observer = new ResizeObserver(layout);
    observer.observe(element);
    for (const cover of element.parentElement?.querySelectorAll(`[${RING_CLEAR_ATTRIBUTE}]`) ?? []) observer.observe(cover);
    return () => observer.disconnect();
  }, [pitch, ringRadius]);

  const path = rings.map((ring) => `M${ring.cx + ringRadius} ${ring.cy}a${ringRadius} ${ringRadius} 0 1 0 ${-2 * ringRadius} 0a${ringRadius} ${ringRadius} 0 1 0 ${2 * ringRadius} 0`).join("");
  return (
    <div ref={boxRef} aria-hidden="true" className={cn("pointer-events-none absolute", className)}>
      <svg className="absolute inset-0 size-full">
        <path d={path} fill="none" stroke="currentColor" strokeOpacity={opacity} strokeWidth={RING_STROKE} />
      </svg>
    </div>
  );
}
