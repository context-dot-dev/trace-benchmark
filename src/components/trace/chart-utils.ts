"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

import { OURS } from "./provider-logo";

export const MONO = "font-mono uppercase tracking-wide";
export const AXIS = cn(MONO, "text-axis tabular-nums text-fg-muted");
export const AXIS_TITLE = cn(MONO, "text-axis text-fg-muted");
export const DOT_STAGGER_MS = 14;

export type Tone = { solid: string; label: string; stroke: string };

export function useReducedMotion() {
  const [reduced, setReduced] = React.useState(false);
  React.useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return reduced;
}

function useSeenOnce<T extends Element>(ref: React.RefObject<T | null>) {
  const [seen, setSeen] = React.useState(false);
  React.useEffect(() => {
    const node = ref.current;
    if (!node || seen) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      setSeen(true);
      observer.disconnect();
    }, { threshold: 0.25 });
    observer.observe(node);
    return () => observer.disconnect();
  });
  return seen;
}

export function useGrowIn() {
  const ref = React.useRef<HTMLDivElement>(null);
  const seen = useSeenOnce(ref);
  const reduced = useReducedMotion();
  const [grown, setGrown] = React.useState(false);
  React.useEffect(() => {
    if (!seen || grown) return;
    const frame = requestAnimationFrame(() => setGrown(true));
    return () => cancelAnimationFrame(frame);
  }, [seen, grown]);
  return { ref, shown: grown || reduced };
}

export function useElementWidth<T extends HTMLElement>(fallback: number) {
  const [node, ref] = React.useState<T | null>(null);
  const [measured, setMeasured] = React.useState<number | null>(null);
  React.useEffect(() => {
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => setMeasured(entry.contentRect.width));
    observer.observe(node);
    return () => observer.disconnect();
  }, [node]);
  return { ref, width: measured ?? fallback, measured: measured !== null };
}

export const toneFor = (providerId: string): Tone =>
  providerId === OURS
    ? { solid: "border-brand bg-brand", label: "text-fg-brand", stroke: "text-brand" }
    : { solid: "border-neutral-40 bg-neutral-40", label: "text-fg-secondary", stroke: "text-neutral-40" };

export function spreadLabels(positions: number[], gap: number, min: number, max: number) {
  const order = positions.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value);
  const placed = order.map((item) => item.value);
  for (let i = 1; i < placed.length; i++) placed[i] = Math.max(placed[i], placed[i - 1] + gap);
  const overflow = placed.length ? placed[placed.length - 1] - max : 0;
  if (overflow > 0) for (let i = 0; i < placed.length; i++) placed[i] -= overflow;
  for (let i = 0; i < placed.length; i++) placed[i] = Math.max(placed[i], min + i * gap);
  const result = new Array<number>(positions.length);
  order.forEach((item, i) => (result[item.index] = placed[i]));
  return result;
}
