"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

import { LOGO_MARK_HEIGHT, LOGO_MARK_WIDTH, logoMarkKindAt } from "./hero-dot-logo-shape";
import { HERO_PATTERN_HOLE_ATTRIBUTE } from "@/components/visuals/hero-pattern-hole";

const DESKTOP_PITCH = 16;
const MOBILE_PITCH = 15;
const FINE_PITCH = 12;
const MOBILE_BREAKPOINT = 640;
const DOT_RADIUS_RATIO = 0.32;
const NOISE_CELL_SIZE_IN_DOTS = 11;
const BAND_LEVELS = [0.32, 0.5, 0.68];
const BAND_HALF_WIDTH = 0.045;
const LIVELY_BAND_HALF_WIDTH = 0.028;
const LIVELY_CENTER_FADE =
  "radial-gradient(ellipse 42% 48% at 50% 48%, color-mix(in srgb, var(--ds-color-black) 20%, transparent), color-mix(in srgb, var(--ds-color-black) 55%, transparent) 60%, var(--ds-color-black) 100%)";
const STREAM_ENTRY_HALF_WIDTH_IN_DOTS = 5.5;
const STREAM_TAIL_HALF_WIDTH_IN_DOTS = 0.5;
const STREAM_SAMPLES = 120;
const STREAM_RING_SHARE = 0.3;
const STREAM_LIT_SHARE = 0.12;
const STREAM_TAIL_OPACITY = 0.5;
const MINI_STREAM_BOX_ASPECT = 3.2;
const MINI_STREAM_MIN_WIDTH_SCALE = 0.5;
const FULL_STREAM_FIELD_HEIGHT_PX = 900;
const PULSE_SPEED_PX_PER_S = 320;
const PULSE_HALF_LENGTH_IN_DOTS = 1.6;
const PULSE_TICK_MS = 50;
const ENTRANCE_SETTLE_MS = 150;
const PAGE_SETTLE_TIMEOUT_MS = 3000;
const PULSE_TRANSITION_MS = 120;
const PULSE_REST_MIN_MS = 5000;
const PULSE_REST_MAX_MS = 12000;
const LIT_DOT_SHARE = 0.07;
const LIVELY_LIT_DOT_SHARE = 0.09;
const RING_DOT_SHARE = 0.1;
const DIM_OPACITY = 0.14;
const RING_OPACITY = 0.55;
const HOLE_CLEARANCE_RATIO = 1;
const OVAL_EDGE_JITTER = 0.3;
const SWAP_INTERVAL_MS = 900;
const SWAPS_PER_TICK = 2;
const SWAP_REACH_IN_DOTS = 2;
const LIVELY_SWAP_INTERVAL_MS = 600;
const LIVELY_SWAPS_PER_TICK = 3;
const LIVELY_TWINKLE_INTERVAL_MS = 450;
const LIVELY_TWINKLES_PER_TICK = 1;
const TRAIL_HOLD_MS = 1200;
const TRAIL_TRANSITION_MS = 150;
const TRAIL_SPAWN_COUNT = 4;
const TRAIL_SPAWN_REACH_IN_DOTS = 2;
const TRAIL_MAX_SPAWNED = 160;
const SEED = 7;
const WORD_SIZE = 12;
const WORD_ADVANCE = 0.6;
const WORD_MARGIN_CELLS = 1;
const WORD_TRAILING_BEARING = 0.1;
const WORD_BORDER = { paddingX: 5, height: 18, radius: 2, opacity: 0.35 };
const AUTO_TEXT_HOLES = "h1, h2, h3, h4, p";
const AUTO_BOX_HOLES = "a, button, img, input, [data-slot='hero-media'], [data-slot='hero-pill']";

type DotKind = "dim" | "lit" | "ring";

const KINDS: DotKind[] = ["dim", "lit", "ring"];

const INVERTED_KIND: Record<DotKind, DotKind> = { dim: "ring", ring: "lit", lit: "ring" };

interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
  opaque?: boolean;
  oval?: boolean;
}

interface Dot {
  key: string;
  cx: number;
  cy: number;
  kind: DotKind;
  opacity?: number;
}

interface PlacedWord {
  text: string;
  x: number;
  y: number;
}

interface FieldLayout {
  pitch: number;
  radius: number;
  dots: Dot[];
  words: PlacedWord[];
  clearedCells: Set<string>;
  markCells: Set<string>;
  streams: StreamLayout[];
}

const LOGO_MARK = { widthPx: 640, overhangRightPx: 64, overhangBottomPx: 96, minFieldWidth: 1024 };

function hash(x: number, y: number) {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(SEED, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function smoothstep(t: number) {
  return t * t * (3 - 2 * t);
}

function valueNoise(x: number, y: number) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = smoothstep(x - x0);
  const ty = smoothstep(y - y0);
  const top = hash(x0, y0) + (hash(x0 + 1, y0) - hash(x0, y0)) * tx;
  const bottom = hash(x0, y0 + 1) + (hash(x0 + 1, y0 + 1) - hash(x0, y0 + 1)) * tx;
  return top + (bottom - top) * ty;
}

function layeredNoise(x: number, y: number) {
  return (valueNoise(x, y) * 2 + valueNoise(x * 2 + 17, y * 2 + 31)) / 3;
}

function isOnBand(column: number, row: number, halfWidth = BAND_HALF_WIDTH) {
  const level = layeredNoise(column / NOISE_CELL_SIZE_IN_DOTS, row / NOISE_CELL_SIZE_IN_DOTS);
  return BAND_LEVELS.some((bandLevel) => Math.abs(level - bandLevel) < halfWidth);
}

type Point = [number, number];

type StreamCurve = [Point, Point, Point];

const STREAM_CURVES: StreamCurve[] = [
  [
    [-0.04, 0.04],
    [0.12, 0.08],
    [0.23, 0.36],
  ],
  [
    [-0.04, 0.42],
    [0.08, 0.54],
    [0.22, 0.62],
  ],
  [
    [0.04, 1.05],
    [0.08, 0.82],
    [0.22, 0.78],
  ],
  [
    [0.9, -0.05],
    [0.9, 0.16],
    [0.78, 0.3],
  ],
  [
    [1.04, 0.3],
    [0.9, 0.3],
    [0.77, 0.46],
  ],
  [
    [1.04, 0.62],
    [0.92, 0.7],
    [0.78, 0.7],
  ],
  [
    [0.97, 1.05],
    [0.94, 0.9],
    [0.8, 0.82],
  ],
];

const PHONE_FOOT_STREAM_CURVES: StreamCurve[] = [
  [
    [-0.06, 0.74],
    [0.28, 0.84],
    [0.46, 1.05],
  ],
  [
    [1.06, 0.82],
    [0.72, 0.88],
    [0.58, 1.05],
  ],
];

interface StreamLayout {
  dots: StreamDot[];
  lengthPx: number;
}

interface StreamDot {
  key: string;
  progress: number;
}

interface StreamSet {
  curves: StreamCurve[];
  widthScale: number;
}

function streamSet(width: number, height: number, mini: boolean, fillFootOnPhones: boolean): StreamSet {
  if (!mini) return { curves: fillFootOnPhones && width < MOBILE_BREAKPOINT ? [...STREAM_CURVES, ...PHONE_FOOT_STREAM_CURVES] : STREAM_CURVES, widthScale: 1 };
  const boxShare = Math.min(1, (height * MINI_STREAM_BOX_ASPECT) / width);
  const toFieldShare = (x: number, isLeftSide: boolean) => (isLeftSide ? x * boxShare : 1 - (1 - x) * boxShare);
  return {
    curves: STREAM_CURVES.map((curve) => {
      const isLeftSide = curve[2][0] < 0.5;
      return curve.map(([x, y]) => [toFieldShare(x, isLeftSide), y]) as StreamCurve;
    }),
    widthScale: Math.min(1, Math.max(MINI_STREAM_MIN_WIDTH_SCALE, height / FULL_STREAM_FIELD_HEIGHT_PX)),
  };
}

function pointOnCurve([start, bend, end]: StreamCurve, t: number, width: number, height: number): Point {
  const inverse = 1 - t;
  const x = inverse * inverse * start[0] + 2 * inverse * t * bend[0] + t * t * end[0];
  const y = inverse * inverse * start[1] + 2 * inverse * t * bend[1] + t * t * end[1];
  return [x * width, y * height];
}

function curveLength(curve: StreamCurve, width: number, height: number) {
  let length = 0;
  let previous = pointOnCurve(curve, 0, width, height);
  for (let sample = 1; sample <= STREAM_SAMPLES; sample++) {
    const point = pointOnCurve(curve, sample / STREAM_SAMPLES, width, height);
    length += Math.hypot(point[0] - previous[0], point[1] - previous[1]);
    previous = point;
  }
  return length;
}

function cellKey(column: number, row: number) {
  return `${column}:${row}`;
}

function layOutStreams(columns: number, rows: number, width: number, height: number, pitch: number, { curves, widthScale }: StreamSet) {
  const progressByCell = new Map<string, { stream: number; progress: number; distance: number }>();
  const entryHalfWidth = Math.max(STREAM_TAIL_HALF_WIDTH_IN_DOTS, STREAM_ENTRY_HALF_WIDTH_IN_DOTS * widthScale);
  curves.forEach((curve, stream) => {
    for (let sample = 0; sample <= STREAM_SAMPLES; sample++) {
      const t = sample / STREAM_SAMPLES;
      const [x, y] = pointOnCurve(curve, t, width, height);
      const halfWidth = (entryHalfWidth + (STREAM_TAIL_HALF_WIDTH_IN_DOTS - entryHalfWidth) * t) * pitch;
      const reach = Math.ceil(halfWidth / pitch);
      const centerColumn = Math.floor(x / pitch);
      const centerRow = Math.floor(y / pitch);
      for (let row = centerRow - reach; row <= centerRow + reach; row++) {
        for (let column = centerColumn - reach; column <= centerColumn + reach; column++) {
          if (column < 0 || row < 0 || column >= columns || row >= rows) continue;
          const distance = Math.hypot(column * pitch + pitch / 2 - x, row * pitch + pitch / 2 - y);
          if (distance > halfWidth) continue;
          const key = cellKey(column, row);
          const claimed = progressByCell.get(key);
          if (claimed && (claimed.stream !== stream || claimed.distance <= distance)) continue;
          progressByCell.set(key, { stream, progress: t, distance });
        }
      }
    }
  });
  return progressByCell;
}

function streamDotKind(column: number, row: number, progress: number): DotKind | null {
  if (hash(column + 71, row + 37) < progress ** 2 * 0.7) return null;
  const roll = hash(column + 101, row + 211);
  return roll < STREAM_RING_SHARE ? "ring" : roll > 1 - STREAM_LIT_SHARE ? "lit" : "dim";
}

function textLineBoxes(element: Element) {
  const range = document.createRange();
  range.selectNodeContents(element);
  return Array.from(range.getClientRects());
}

function holeRect(box: DOMRect, origin: DOMRect, kind: string | null): Rect {
  return {
    left: box.left - origin.left,
    top: box.top - origin.top,
    right: box.right - origin.left,
    bottom: box.bottom - origin.top,
    opaque: kind === "box",
    oval: kind === "oval",
  };
}

function measureContentHoles(scope: HTMLElement, field: HTMLElement, svg: SVGSVGElement): Rect[] {
  const origin = field.getBoundingClientRect();
  const holes: Rect[] = [];
  const marked = Array.from(scope.querySelectorAll(`[${HERO_PATTERN_HOLE_ATTRIBUTE}]`));
  const isOwn = (element: Element) => svg.contains(element) || (field !== scope && field.contains(element));
  const elements: [Element, string | null][] = marked.length
    ? marked.map((element) => [element, element.getAttribute(HERO_PATTERN_HOLE_ATTRIBUTE)])
    : [
        ...Array.from(scope.querySelectorAll(AUTO_TEXT_HOLES)).map((element) => [element, "text"] as [Element, string]),
        ...Array.from(scope.querySelectorAll(AUTO_BOX_HOLES)).map((element) => [element, "snug-box"] as [Element, string]),
      ];
  for (const [element, kind] of elements) {
    if (isOwn(element)) continue;
    const boxes = kind === "text" ? textLineBoxes(element) : [element.getBoundingClientRect()];
    for (const box of boxes) if (box.width > 0 && box.height > 0) holes.push(holeRect(box, origin, kind));
  }
  return holes;
}

function buildLayout(
  width: number,
  height: number,
  holes: Rect[],
  words: string[],
  fixedPitch: number | undefined,
  litShare: number,
  logoMark: boolean,
  streams: boolean,
  miniStreams: boolean,
  fillFootOnPhones: boolean,
): FieldLayout {
  const pitch = fixedPitch ?? (width < MOBILE_BREAKPOINT ? MOBILE_PITCH : DESKTOP_PITCH);
  const clearance = pitch * HOLE_CLEARANCE_RATIO;
  const isInHole = (x: number, y: number, hole: Rect) => {
    if (hole.oval) {
      const radiusX = (hole.right - hole.left) / 2;
      const radiusY = (hole.bottom - hole.top) / 2;
      const distance = Math.hypot((x - hole.left - radiusX) / radiusX, (y - hole.top - radiusY) / radiusY);
      return distance + (hash(Math.round(x), Math.round(y)) - 0.5) * OVAL_EDGE_JITTER < 1;
    }
    return x > hole.left - clearance && x < hole.right + clearance && y > hole.top - clearance && y < hole.bottom + clearance;
  };
  const isCleared = (x: number, y: number) => holes.some((hole) => isInHole(x, y, hole));
  const isClearedForMark = (x: number, y: number) => holes.some((hole) => !hole.opaque && isInHole(x, y, hole));
  const dots: Dot[] = [];
  const clearedCells = new Set<string>();
  const markCells = new Set<string>();
  const streamShapes = streamSet(width, height, miniStreams, fillFootOnPhones);
  const columns = Math.floor(width / pitch);
  const rows = Math.floor(height / pitch);
  const streamCells = streams ? layOutStreams(columns, rows, width, height, pitch, streamShapes) : null;
  const streamLayouts: StreamLayout[] = streamShapes.curves.map((curve) => ({ dots: [], lengthPx: curveLength(curve, width, height) }));
  const showMark = logoMark && width >= LOGO_MARK.minFieldWidth;
  const markUnitsPerPx = LOGO_MARK_WIDTH / LOGO_MARK.widthPx;
  const markLeft = width - LOGO_MARK.widthPx + LOGO_MARK.overhangRightPx;
  const markTop = height + LOGO_MARK.overhangBottomPx - LOGO_MARK.widthPx / (LOGO_MARK_WIDTH / LOGO_MARK_HEIGHT);
  const bandHalfWidth = litShare === LIVELY_LIT_DOT_SHARE ? LIVELY_BAND_HALF_WIDTH : BAND_HALF_WIDTH;
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const key = cellKey(column, row);
      const cx = column * pitch + pitch / 2;
      const cy = row * pitch + pitch / 2;
      const inMarkBox = showMark && cx >= markLeft - clearance && cy >= markTop - clearance;
      if (inMarkBox ? isClearedForMark(cx, cy) : isCleared(cx, cy)) {
        clearedCells.add(key);
        continue;
      }
      if (inMarkBox) {
        const markKind = logoMarkKindAt((cx - markLeft) * markUnitsPerPx, (cy - markTop) * markUnitsPerPx, pitch * DOT_RADIUS_RATIO * markUnitsPerPx);
        if (markKind) {
          markCells.add(key);
          dots.push({ key, cx, cy, kind: markKind });
        }
        continue;
      }
      if (streamCells) {
        const streamCell = streamCells.get(key);
        const kind = streamCell && streamDotKind(column, row, streamCell.progress);
        if (!streamCell || !kind) continue;
        streamLayouts[streamCell.stream].dots.push({ key, progress: streamCell.progress });
        dots.push({ key, cx, cy, kind, opacity: 1 - (1 - STREAM_TAIL_OPACITY) * streamCell.progress });
        continue;
      }
      if (!isOnBand(column, row, bandHalfWidth)) continue;
      const roll = hash(column + 101, row + 211);
      const kind: DotKind = roll < RING_DOT_SHARE ? "ring" : roll > 1 - litShare ? "lit" : "dim";
      dots.push({ key, cx, cy, kind });
    }
  }
  return {
    pitch,
    radius: pitch * DOT_RADIUS_RATIO,
    dots,
    words: placeWords(words, columns, rows, pitch, dots, clearedCells),
    clearedCells,
    markCells,
    streams: streamCells ? streamLayouts.filter((stream) => stream.dots.length > 0) : [],
  };
}

function placeWords(words: string[], columns: number, rows: number, pitch: number, dots: Dot[], clearedCells: Set<string>): PlacedWord[] {
  if (words.length === 0) return [];
  const taken = new Set([...dots.map((dot) => dot.key), ...clearedCells]);
  const isOpen = (column: number, row: number) => column >= 0 && row >= 0 && column < columns && row < rows && !taken.has(cellKey(column, row));
  const placed: { word: PlacedWord; column: number; row: number }[] = [];

  for (const text of words) {
    const span = Math.ceil((text.length * WORD_ADVANCE * WORD_SIZE) / pitch);
    const fits = (column: number, row: number) => {
      for (let dy = -WORD_MARGIN_CELLS; dy <= WORD_MARGIN_CELLS; dy++) {
        for (let dx = -WORD_MARGIN_CELLS; dx < span + WORD_MARGIN_CELLS; dx++) if (!isOpen(column + dx, row + dy)) return false;
      }
      return true;
    };
    let best: { column: number; row: number; score: number } | null = null;
    for (let row = WORD_MARGIN_CELLS; row < rows - WORD_MARGIN_CELLS; row++) {
      for (let column = WORD_MARGIN_CELLS; column < columns - span - WORD_MARGIN_CELLS; column++) {
        if (!fits(column, row)) continue;
        const distance = placed.length ? Math.min(...placed.map((other) => Math.hypot(other.column - column, other.row - row))) : hash(column + 17, row + 29);
        if (!best || distance > best.score) best = { column, row, score: distance };
      }
    }
    if (!best) continue;
    for (let dx = 0; dx < span; dx++) taken.add(cellKey(best.column + dx, best.row));
    for (let dx = -WORD_MARGIN_CELLS; dx < span + WORD_MARGIN_CELLS; dx++) {
      for (let dy = -WORD_MARGIN_CELLS; dy <= WORD_MARGIN_CELLS; dy++) clearedCells.add(cellKey(best.column + dx, best.row + dy));
    }
    placed.push({ word: { text, x: best.column * pitch, y: (best.row + 0.5) * pitch }, column: best.column, row: best.row });
  }
  return placed.map(({ word }) => word);
}

function kindStyle(kind: DotKind) {
  return {
    fillOpacity: kind === "ring" ? 0 : kind === "lit" ? 1 : DIM_OPACITY,
    strokeOpacity: kind === "ring" ? RING_OPACITY : 0,
  };
}

function paint(circle: SVGCircleElement | undefined, kind: DotKind) {
  if (!circle) return;
  const style = kindStyle(kind);
  circle.style.fillOpacity = String(style.fillOpacity);
  circle.style.strokeOpacity = String(style.strokeOpacity);
}

function pickRandom<T>(items: T[]) {
  return items[Math.floor(Math.random() * items.length)];
}

function animateField(scope: HTMLElement, field: HTMLElement, svg: SVGSVGElement, spawnLayer: SVGGElement, layout: FieldLayout, lively: boolean, solidDots: boolean) {
  const paintKind = (circle: SVGCircleElement | undefined, kind: DotKind) => paint(circle, solidDots || kind !== "lit" ? kind : "ring");
  const circles = new Map<string, SVGCircleElement>();
  for (const circle of svg.querySelectorAll<SVGCircleElement>("circle[data-dot]")) circles.set(circle.dataset.dot ?? "", circle);
  const kinds = new Map(layout.dots.map((dot) => [dot.key, dot.kind]));
  for (const [key, kind] of kinds) paintKind(circles.get(key), kind);
  const inverted = new Map<string, number>();
  const spawnedCells = new Set<string>();
  const timers = new Set<number>();
  const later = (callback: () => void, delay: number) => {
    const timer = window.setTimeout(() => {
      timers.delete(timer);
      callback();
    }, delay);
    timers.add(timer);
  };

  let onScreen = true;
  const visibility = new IntersectionObserver(([entry]) => {
    onScreen = entry.isIntersecting;
  });
  visibility.observe(field);

  const drift = window.setInterval(
    () => {
      if (document.hidden || !onScreen || layout.streams.length > 0) return;
      const lit = Array.from(kinds).filter(([key, kind]) => kind === "lit" && !inverted.has(key) && !layout.markCells.has(key));
      for (let swap = 0; swap < (lively ? LIVELY_SWAPS_PER_TICK : SWAPS_PER_TICK) && lit.length > 0; swap++) {
        const [from] = pickRandom(lit);
        const [column, row] = from.split(":").map(Number);
        const candidates: string[] = [];
        for (let dy = -SWAP_REACH_IN_DOTS; dy <= SWAP_REACH_IN_DOTS; dy++) {
          for (let dx = -SWAP_REACH_IN_DOTS; dx <= SWAP_REACH_IN_DOTS; dx++) {
            const key = cellKey(column + dx, row + dy);
            if (kinds.get(key) === "dim" && !inverted.has(key)) candidates.push(key);
          }
        }
        if (candidates.length === 0) continue;
        const to = pickRandom(candidates);
        kinds.set(from, "dim");
        kinds.set(to, "lit");
        paintKind(circles.get(from), "dim");
        paintKind(circles.get(to), "lit");
      }
    },
    lively ? LIVELY_SWAP_INTERVAL_MS : SWAP_INTERVAL_MS,
  );

  const invert = (key: string) => {
    const kind = kinds.get(key);
    if (!kind || inverted.has(key)) return;
    const circle = circles.get(key);
    inverted.set(key, 1);
    circle?.style.setProperty("transition-duration", `${TRAIL_TRANSITION_MS}ms`);
    paintKind(circle, INVERTED_KIND[kind]);
    later(() => {
      inverted.delete(key);
      circle?.style.removeProperty("transition-duration");
      paintKind(circle, kinds.get(key) ?? kind);
    }, TRAIL_HOLD_MS);
  };

  const pulses = layout.streams.map((stream) => ({ stream, position: 0, restUntil: performance.now() + Math.random() * PULSE_REST_MAX_MS, lit: new Set<string>() }));
  const pulseTimer =
    pulses.length > 0
      ? window.setInterval(() => {
          if (document.hidden || !onScreen) return;
          const now = performance.now();
          for (const pulse of pulses) {
            if (now < pulse.restUntil) continue;
            pulse.position += (PULSE_SPEED_PX_PER_S * PULSE_TICK_MS) / 1000 / pulse.stream.lengthPx;
            const halfLength = (PULSE_HALF_LENGTH_IN_DOTS * layout.pitch) / pulse.stream.lengthPx;
            const nowLit = new Set<string>();
            if (pulse.position <= 1 + halfLength) {
              for (const dot of pulse.stream.dots) if (Math.abs(dot.progress - pulse.position) < halfLength) nowLit.add(dot.key);
            } else {
              pulse.position = -halfLength;
              pulse.restUntil = now + PULSE_REST_MIN_MS + Math.random() * (PULSE_REST_MAX_MS - PULSE_REST_MIN_MS);
            }
            for (const key of pulse.lit) {
              if (nowLit.has(key) || inverted.has(key)) continue;
              const circle = circles.get(key);
              circle?.style.removeProperty("transition-duration");
              paint(circle, kinds.get(key) ?? "dim");
            }
            for (const key of nowLit) {
              if (pulse.lit.has(key) || inverted.has(key)) continue;
              const circle = circles.get(key);
              circle?.style.setProperty("transition-duration", `${PULSE_TRANSITION_MS}ms`);
              paint(circle, "lit");
            }
            pulse.lit = nowLit;
          }
        }, PULSE_TICK_MS)
      : 0;

  const dotKeys = Array.from(kinds.keys()).filter((key) => !layout.markCells.has(key));
  const twinkle = lively
    ? window.setInterval(() => {
        if (document.hidden || !onScreen || dotKeys.length === 0) return;
        for (let count = 0; count < LIVELY_TWINKLES_PER_TICK; count++) invert(pickRandom(dotKeys));
      }, LIVELY_TWINKLE_INTERVAL_MS)
    : 0;

  const scatter = (column: number, row: number) => {
    const origin = cellKey(column, row);
    if (spawnedCells.has(origin) || spawnLayer.childElementCount >= TRAIL_MAX_SPAWNED) return;
    spawnedCells.add(origin);
    later(() => spawnedCells.delete(origin), TRAIL_HOLD_MS);
    const open: [number, number][] = [];
    for (let dy = -TRAIL_SPAWN_REACH_IN_DOTS; dy <= TRAIL_SPAWN_REACH_IN_DOTS; dy++) {
      for (let dx = -TRAIL_SPAWN_REACH_IN_DOTS; dx <= TRAIL_SPAWN_REACH_IN_DOTS; dx++) {
        const key = cellKey(column + dx, row + dy);
        if (column + dx >= 0 && row + dy >= 0 && !kinds.has(key) && !layout.clearedCells.has(key) && !spawnedCells.has(key)) open.push([column + dx, row + dy]);
      }
    }
    for (let count = 0; count < TRAIL_SPAWN_COUNT && open.length > 0; count++) {
      const [spawnColumn, spawnRow] = open.splice(Math.floor(Math.random() * open.length), 1)[0];
      const spawnKey = cellKey(spawnColumn, spawnRow);
      spawnedCells.add(spawnKey);
      const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      circle.setAttribute("cx", String(spawnColumn * layout.pitch + layout.pitch / 2));
      circle.setAttribute("cy", String(spawnRow * layout.pitch + layout.pitch / 2));
      circle.setAttribute("r", String(layout.radius - 0.5));
      circle.style.opacity = "0";
      circle.style.transitionDuration = `${TRAIL_TRANSITION_MS}ms`;
      paintKind(circle, pickRandom(KINDS));
      spawnLayer.appendChild(circle);
      requestAnimationFrame(() => (circle.style.opacity = "1"));
      later(() => {
        circle.style.removeProperty("transition-duration");
        circle.style.opacity = "0";
      }, TRAIL_HOLD_MS);
      later(() => {
        circle.remove();
        spawnedCells.delete(spawnKey);
      }, TRAIL_HOLD_MS * 2);
    }
  };

  const visit = (column: number, row: number) => {
    const key = cellKey(column, row);
    if (layout.clearedCells.has(key)) return;
    if (kinds.has(key)) invert(key);
    else scatter(column, row);
  };

  let last: { x: number; y: number } | null = null;
  let origin: DOMRect | null = null;
  const forgetOrigin = () => {
    origin = null;
  };
  const onPointerMove = (event: PointerEvent) => {
    if (event.pointerType !== "mouse") return;
    origin ??= field.getBoundingClientRect();
    const point = { x: event.clientX - origin.left, y: event.clientY - origin.top };
    const from = last ?? point;
    const steps = Math.max(1, Math.ceil(Math.hypot(point.x - from.x, point.y - from.y) / (layout.pitch / 2)));
    let previousCell = "";
    for (let step = 1; step <= steps; step++) {
      const column = Math.floor((from.x + ((point.x - from.x) * step) / steps) / layout.pitch);
      const row = Math.floor((from.y + ((point.y - from.y) * step) / steps) / layout.pitch);
      const key = cellKey(column, row);
      if (key === previousCell) continue;
      previousCell = key;
      visit(column, row);
    }
    last = point;
  };
  const onPointerLeave = () => {
    last = null;
  };

  scope.addEventListener("pointermove", onPointerMove, { passive: true });
  scope.addEventListener("pointerleave", onPointerLeave);
  window.addEventListener("scroll", forgetOrigin, { passive: true });
  window.addEventListener("resize", forgetOrigin, { passive: true });

  return () => {
    window.clearInterval(drift);
    window.clearInterval(twinkle);
    window.clearInterval(pulseTimer);
    visibility.disconnect();
    for (const timer of timers) window.clearTimeout(timer);
    scope.removeEventListener("pointermove", onPointerMove);
    scope.removeEventListener("pointerleave", onPointerLeave);
    window.removeEventListener("scroll", forgetOrigin);
    window.removeEventListener("resize", forgetOrigin);
    spawnLayer.replaceChildren();
  };
}

let pageHasSettled = false;
function afterPageSettles(start: () => void): () => void {
  if (pageHasSettled) {
    start();
    return () => {};
  }
  let cancelRun = () => {};
  const settle = () => {
    const run = () => {
      pageHasSettled = true;
      start();
    };
    if ("requestIdleCallback" in window) {
      const idleCallback = window.requestIdleCallback(run, { timeout: PAGE_SETTLE_TIMEOUT_MS });
      cancelRun = () => window.cancelIdleCallback(idleCallback);
    } else {
      const timer = setTimeout(run, 1);
      cancelRun = () => clearTimeout(timer);
    }
  };
  if (document.readyState === "complete") settle();
  else window.addEventListener("load", settle, { once: true });
  return () => {
    window.removeEventListener("load", settle);
    cancelRun();
  };
}

function scopeOf(field: HTMLElement) {
  return field.closest<HTMLElement>("[data-slot='hero'], section") ?? field;
}

const DOT_TRANSITION_CLASS = "[&>circle]:transition-[fill-opacity,stroke-opacity,opacity] [&>circle]:duration-700 [&>circle]:ease-in-out motion-reduce:[&>circle]:transition-none";

export interface HeroDotFieldProps {
  className?: string;
  words?: string[];
  wordClassName?: string;
  fine?: boolean;
  lively?: boolean;
  logoMark?: boolean;
  streams?: boolean;
  miniStreams?: boolean;
  fillFootOnPhones?: boolean;
  solidDots?: boolean;
}

export function HeroDotField({
  className,
  words = [],
  wordClassName,
  fine = false,
  lively = false,
  logoMark = false,
  streams = false,
  miniStreams = false,
  fillFootOnPhones = false,
  solidDots = true,
}: HeroDotFieldProps) {
  const wordsKey = words.join(" ");
  const svgRef = React.useRef<SVGSVGElement>(null);
  const spawnLayerRef = React.useRef<SVGGElement>(null);
  const [layout, setLayout] = React.useState<FieldLayout | null>(null);

  React.useEffect(() => {
    const svg = svgRef.current;
    const field = svg?.parentElement;
    if (!svg || !field) return;
    const scope = scopeOf(field);

    let frame = 0;
    const relayout = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() =>
        setLayout(
          buildLayout(
            field.clientWidth,
            field.clientHeight,
            measureContentHoles(scope, field, svg),
            wordsKey ? wordsKey.split(" ") : [],
            fine && field.clientWidth >= MOBILE_BREAKPOINT ? FINE_PITCH : undefined,
            !solidDots ? 0 : lively ? LIVELY_LIT_DOT_SHARE : LIT_DOT_SHARE,
            logoMark,
            streams,
            miniStreams,
            fillFootOnPhones,
          ),
        ),
      );
    };

    const observer = new ResizeObserver(relayout);
    observer.observe(field);
    for (const hole of scope.querySelectorAll(`[${HERO_PATTERN_HOLE_ATTRIBUTE}]`)) observer.observe(hole);
    void document.fonts.ready.then(relayout);
    let settleTimer = 0;
    const relayoutOnceSettled = () => {
      window.clearTimeout(settleTimer);
      settleTimer = window.setTimeout(relayout, ENTRANCE_SETTLE_MS);
    };
    scope.addEventListener("animationend", relayoutOnceSettled);

    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(settleTimer);
      observer.disconnect();
      scope.removeEventListener("animationend", relayoutOnceSettled);
    };
  }, [wordsKey, fine, lively, logoMark, streams, miniStreams, fillFootOnPhones, solidDots]);

  React.useEffect(() => {
    const svg = svgRef.current;
    const field = svg?.parentElement;
    const spawnLayer = spawnLayerRef.current;
    if (!svg || !field || !spawnLayer || !layout || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let stopAnimating: (() => void) | undefined;
    const cancelStart = afterPageSettles(() => {
      stopAnimating = animateField(scopeOf(field), field, svg, spawnLayer, layout, lively, solidDots);
    });
    return () => {
      cancelStart();
      stopAnimating?.();
    };
  }, [layout, lively, solidDots]);

  return (
    <svg
      ref={svgRef}
      aria-hidden="true"
      data-dot-field=""
      className={cn(
        "pointer-events-none absolute inset-0 size-full text-brand/60 transition-opacity duration-700 ease-out motion-reduce:transition-none",
        layout ? "opacity-100" : "opacity-0",
        className,
      )}
      style={!streams && lively ? { maskImage: LIVELY_CENTER_FADE, WebkitMaskImage: LIVELY_CENTER_FADE } : undefined}
    >
      <g fill="currentColor" stroke="currentColor" strokeWidth="1" className={DOT_TRANSITION_CLASS}>
        {layout?.dots.map((dot) => <circle key={dot.key} data-dot={dot.key} cx={dot.cx} cy={dot.cy} r={layout.radius - 0.5} opacity={dot.opacity} style={kindStyle(dot.kind)} />)}
      </g>
      <g ref={spawnLayerRef} fill="currentColor" stroke="currentColor" strokeWidth="1" className={DOT_TRANSITION_CLASS} />
      <g fill="currentColor" fontSize={WORD_SIZE} fontWeight={800} className={cn("font-data", wordClassName)}>
        {layout?.words.map((word) => (
          <g key={word.text}>
            <rect
              x={word.x - WORD_BORDER.paddingX + 0.5}
              y={Math.round(word.y - WORD_BORDER.height / 2) + 0.5}
              width={Math.round(word.text.length * WORD_ADVANCE * WORD_SIZE - WORD_TRAILING_BEARING * WORD_SIZE + WORD_BORDER.paddingX * 2)}
              height={WORD_BORDER.height}
              rx={WORD_BORDER.radius}
              fill="none"
              stroke="currentColor"
              strokeOpacity={WORD_BORDER.opacity}
            />
            <text x={word.x} y={word.y} dominantBaseline="central">
              {word.text}
            </text>
          </g>
        ))}
      </g>
    </svg>
  );
}
