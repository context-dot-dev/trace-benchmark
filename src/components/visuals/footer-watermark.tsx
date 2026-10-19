"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

import { type DotLayer, sampleWatermarkDots, type WatermarkDots, type WatermarkPart } from "./footer-watermark-dots";

type Point = { x: number; y: number };

/** Mark an element beside the watermark (in the same parent) with this, and the cursor clicks it before gliding off. */
export const WATERMARK_CURSOR_ORIGIN_ATTRIBUTE = "data-watermark-cursor-origin";

const VIEW_BOX = { width: 140, height: 24 };
const BASELINE_Y = 22;
// In viewBox units. On a narrow screen the dots stop shrinking with the wordmark, so they stay circles, not a gray wash.
const DOT_PITCH = 0.6;
const SMALLEST_DOT_PITCH_PX = 3;
const DOT_PITCH_STEPS_PER_UNIT = 20;
const RING_OPACITY = 0.55;
const CURSOR_SIZE = 9;
const RESTING_CURSOR: Point = { x: 110, y: 5.5 };
// Where the pointer's tip lands inside the icon box, in viewBox units, with the icon's upright turn (its left edge
// vertical, like a system cursor).
const CURSOR_TIP: Point = { x: CURSOR_SIZE * (42 / 79), y: CURSOR_SIZE * (28 / 79) };
// In viewBox units: wide enough that the patch covers the letters from ascender to baseline, not just their tops.
const PATCH_RADIUS = 15;
// The patch swaps the paints fully out to this fraction of its radius, then feathers to nothing at the edge: a clean
// solid and outline swap inside, instead of letters caught half way in a gray smear.
const PATCH_CORE = 0.6;
// Time constants (ms) for easing toward the target, so it feels the same at 60Hz and 120Hz: the patch keeps close to
// the pointer, grows in quickly, and fades a little faster than it grows when the pointer leaves.
const FOLLOW_MS = 55;
const GROW_MS = 90;
const SHRINK_MS = 70;
// The cursor waits on the origin element as the watermark scrolls in, then glides to its resting spot once the wordmark
// is mostly on screen, so the move is seen rather than finished before anyone gets there.
const CURSOR_LAUNCH_MS = 900;
const CURSOR_LAUNCH_EASING = "cubic-bezier(0.65, 0, 0.35, 1)";
const CURSOR_LAUNCH_VISIBLE_RATIO = 0.6;
// Before the glide the cursor clicks the origin: it presses toward its tip, holds, lets go, then sets off.
const CURSOR_PRESS_MS = 150;
const CURSOR_RELEASE_TO_LAUNCH_MS = 180;
const CURSOR_PRESSED_SCALE = 0.86;
const ease = (from: number, to: number, dt: number, tau: number) => to + (from - to) * Math.exp(-dt / tau);

function dotPitchAt(pixelsPerUnit: number) {
  const pitch = Math.max(DOT_PITCH, SMALLEST_DOT_PITCH_PX / pixelsPerUnit);
  return Math.round(pitch * DOT_PITCH_STEPS_PER_UNIT) / DOT_PITCH_STEPS_PER_UNIT;
}

function DotLayerPaths({ layer, ringStroke }: { layer: DotLayer; ringStroke: number }) {
  return (
    <>
      <path d={layer.rings} fill="none" stroke="currentColor" strokeOpacity={RING_OPACITY} strokeWidth={ringStroke} />
      <path d={layer.solids} fill="currentColor" />
    </>
  );
}

const CURSOR_DOT_PITCH = 3.4;
const CURSOR_DOT_RADIUS = 1.15;
const CURSOR_PATH =
  "M36.16 32.93C32.65 32.44 30.21 36.34 32.19 39.27L48.13 62.93C50.03 65.75 54.34 65.16 55.41 61.93L58.87 51.53L66.7 43.85C69.13 41.47 67.77 37.34 64.4 36.87L36.16 32.93Z";
const CURSOR_OUTLINE =
  "M31.36 39.83C28.901 36.18 31.93 31.33 36.29 31.939L64.54 35.88C68.73 36.47 70.42 41.6 67.4 44.57L59.75 52.07L56.36 62.25C55.02 66.26 49.66 66.99 47.3 63.49L31.36 39.83Z";

// A pointer filled with the brand dot pattern over a dark base, so it reads as part of the dotted wordmark it rests on.
// The shadow sits outside the rotation so it always falls downward.
function CursorIcon({ id, ...props }: React.SVGProps<SVGSVGElement> & { id: string }) {
  const dotsId = `${id}-dots`;
  return (
    <svg viewBox="0 0 79 79" fill="none" aria-hidden="true" {...props}>
      <g filter={`url(#${id})`}>
        <g transform="rotate(34 50 48)">
          <path d={CURSOR_PATH} style={{ fill: "var(--ds-color-bg-code)" }} />
          <path d={CURSOR_PATH} fill={`url(#${dotsId})`} />
          <path d={CURSOR_OUTLINE} strokeWidth="3" style={{ stroke: "var(--ds-color-bg-code)" }} />
          <path d={CURSOR_OUTLINE} strokeWidth="1.4" style={{ stroke: "var(--ds-color-blue-80)" }} />
        </g>
      </g>
      <defs>
        <pattern id={dotsId} width={CURSOR_DOT_PITCH} height={CURSOR_DOT_PITCH} patternUnits="userSpaceOnUse">
          <circle cx={CURSOR_DOT_PITCH / 2} cy={CURSOR_DOT_PITCH / 2} r={CURSOR_DOT_RADIUS} style={{ fill: "var(--ds-color-blue-80)" }} />
        </pattern>
        <filter id={id} x="-10" y="-10" width="99" height="99" filterUnits="userSpaceOnUse" colorInterpolationFilters="sRGB">
          <feFlood floodOpacity="0" result="BackgroundImageFix" />
          <feColorMatrix in="SourceAlpha" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0" result="hardAlpha" />
          <feOffset dy="4" />
          <feGaussianBlur stdDeviation="2" />
          <feComposite in2="hardAlpha" operator="out" />
          <feColorMatrix type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.25 0" />
          <feBlend mode="normal" in2="BackgroundImageFix" result="effect1_dropShadow" />
          <feBlend mode="normal" in="SourceGraphic" in2="effect1_dropShadow" result="shape" />
        </filter>
      </defs>
    </svg>
  );
}

// Waits on the origin, then glides home with the Web Animations API once launched (offset goes back to null).
function LaunchingCursor({ id, offset, isHidden, isPressing }: { id: string; offset: Point | null; isHidden: boolean; isPressing: boolean }) {
  const groupRef = React.useRef<SVGGElement>(null);
  const lastOffset = React.useRef<Point | null>(null);

  React.useEffect(() => {
    const group = groupRef.current;
    if (!group) return;
    if (offset) {
      lastOffset.current = offset;
      return;
    }
    const from = lastOffset.current;
    lastOffset.current = null;
    if (!from) return;
    const glide = group.animate([{ transform: `translate(${from.x}px, ${from.y}px)` }, { transform: "translate(0px, 0px)" }], {
      duration: CURSOR_LAUNCH_MS,
      easing: CURSOR_LAUNCH_EASING,
    });
    return () => glide.cancel();
  }, [offset]);

  return (
    <g ref={groupRef} style={{ transform: `translate(${offset?.x ?? 0}px, ${offset?.y ?? 0}px)`, visibility: isHidden ? "hidden" : "visible" }}>
      <g
        className="transition-transform duration-150 ease-out motion-reduce:transition-none"
        style={{ transform: `scale(${isPressing ? CURSOR_PRESSED_SCALE : 1})`, transformOrigin: `${RESTING_CURSOR.x + CURSOR_TIP.x}px ${RESTING_CURSOR.y + CURSOR_TIP.y}px` }}
      >
        <CursorIcon id={id} x={RESTING_CURSOR.x} y={RESTING_CURSOR.y} width={CURSOR_SIZE} height={CURSOR_SIZE} />
      </g>
    </g>
  );
}

/**
 * The wordmark as a watermark, rebuilt from the brand's circles: `outlined` in rings, `solid` in solid dots. A soft
 * patch follows the pointer, and inside it the rings fill in and the dots hollow out. It fills its parent (a dark band
 * at the foot of the footer) and draws in `currentColor`, white by default. With an element marked
 * WATERMARK_CURSOR_ORIGIN_ATTRIBUTE beside it, a dotted cursor clicks that element as the watermark scrolls in, then
 * glides onto the letters. The letters are sampled from the brand face, so they appear once it has loaded.
 */
export function FooterWatermark({ outlined = "context.", solid = "dev", className }: { outlined?: string; solid?: string; className?: string }) {
  const svgRef = React.useRef<SVGSVGElement>(null);
  const wordRef = React.useRef<SVGTextElement>(null);
  const [dots, setDots] = React.useState<WatermarkDots | null>(null);
  const inkRef = React.useRef<SVGGElement>(null);
  const [inkOffsetY, setInkOffsetY] = React.useState(0);
  const patchRefs = React.useRef<SVGCircleElement[]>([]);
  const target = React.useRef<Point & { radius: number }>({ x: 0, y: 0, radius: 0 });
  const current = React.useRef<Point & { radius: number }>({ x: 0, y: 0, radius: 0 });
  const frame = React.useRef(0);
  const lastFrame = React.useRef(0);
  const snap = React.useRef(false);
  const [cursorLaunchOffset, setCursorLaunchOffset] = React.useState<Point | null>(null);
  const [hasCursorLaunched, setHasCursorLaunched] = React.useState(false);
  const [isCursorPressing, setIsCursorPressing] = React.useState(false);
  const id = React.useId().replace(/:/g, "");
  const parts = React.useMemo<WatermarkPart[]>(
    () => [
      { firstCharacter: 0, characterCount: outlined.length, isMostlySolid: false },
      { firstCharacter: outlined.length, characterCount: solid.length, isMostlySolid: true },
    ],
    [outlined, solid],
  );

  React.useEffect(() => {
    snap.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    return () => cancelAnimationFrame(frame.current);
  }, []);

  React.useEffect(() => {
    const svg = svgRef.current;
    const word = wordRef.current;
    if (!svg || !word) return;

    let sampledPitch = 0;
    let isFontReady = false;
    const sample = () => {
      const pixelsPerUnit = svg.getScreenCTM()?.a;
      if (!isFontReady || !pixelsPerUnit) return;
      const pitch = dotPitchAt(pixelsPerUnit);
      if (pitch === sampledPitch) return;
      sampledPitch = pitch;
      setDots(sampleWatermarkDots(word, parts, pitch, VIEW_BOX));
    };

    const observer = new ResizeObserver(sample);
    observer.observe(svg);
    let isMounted = true;
    // The letters' shapes are read from the rendered font, so sampling waits for it.
    void document.fonts.ready.then(() => {
      if (!isMounted) return;
      isFontReady = true;
      sample();
    });
    return () => {
      isMounted = false;
      observer.disconnect();
    };
  }, [parts]);

  React.useEffect(() => {
    const svg = svgRef.current;
    const origin = svg?.parentElement?.querySelector(`[${WATERMARK_CURSOR_ORIGIN_ATTRIBUTE}]`);
    if (!svg || !origin || !dots || hasCursorLaunched) return;
    const isReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const measureLaunchOffset = () => {
      const matrix = svg.getScreenCTM();
      if (!matrix) return null;
      const bounds = origin.getBoundingClientRect();
      const topBorderCenter = new DOMPoint(bounds.left + bounds.width / 2, bounds.top).matrixTransform(matrix.inverse());
      return { x: topBorderCenter.x - (RESTING_CURSOR.x + CURSOR_TIP.x), y: topBorderCenter.y - (RESTING_CURSOR.y + CURSOR_TIP.y) };
    };

    const clickTimers: ReturnType<typeof setTimeout>[] = [];
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        if (isReducedMotion) {
          observer.disconnect();
          setHasCursorLaunched(true);
          return;
        }
        setCursorLaunchOffset((offset) => offset ?? measureLaunchOffset());
        if (entry.intersectionRatio < CURSOR_LAUNCH_VISIBLE_RATIO) return;
        observer.disconnect();
        setIsCursorPressing(true);
        origin.setAttribute("data-pressed", "");
        clickTimers.push(
          setTimeout(() => {
            setIsCursorPressing(false);
            origin.removeAttribute("data-pressed");
          }, CURSOR_PRESS_MS),
          setTimeout(() => setHasCursorLaunched(true), CURSOR_PRESS_MS + CURSOR_RELEASE_TO_LAUNCH_MS),
        );
      },
      { threshold: [0, CURSOR_LAUNCH_VISIBLE_RATIO] },
    );
    observer.observe(svg);
    return () => {
      observer.disconnect();
      clickTimers.forEach(clearTimeout);
      origin.removeAttribute("data-pressed");
    };
  }, [dots, inkOffsetY, hasCursorLaunched]);

  // The font box leaves more room above the letters than below them, so the view is centered on the dots themselves.
  React.useEffect(() => {
    const ink = inkRef.current?.getBBox();
    if (!ink || ink.height === 0) return;
    setInkOffsetY(ink.y + ink.height / 2 - VIEW_BOX.height / 2);
  }, [dots]);

  const paint = () => {
    const { x, y, radius } = current.current;
    for (const patch of patchRefs.current) {
      patch.setAttribute("cx", String(x));
      patch.setAttribute("cy", String(y));
      patch.setAttribute("r", String(radius));
    }
  };

  const tick = (time: number) => {
    const now = current.current;
    const goal = target.current;
    // Capped, so a frame after the tab was hidden doesn't leap.
    const dt = lastFrame.current ? Math.min(64, time - lastFrame.current) : 16;
    lastFrame.current = time;
    if (snap.current) {
      Object.assign(now, goal);
    } else {
      now.x = ease(now.x, goal.x, dt, FOLLOW_MS);
      now.y = ease(now.y, goal.y, dt, FOLLOW_MS);
      now.radius = ease(now.radius, goal.radius, dt, goal.radius > now.radius ? GROW_MS : SHRINK_MS);
    }
    const settled = Math.abs(goal.x - now.x) < 0.01 && Math.abs(goal.y - now.y) < 0.01 && Math.abs(goal.radius - now.radius) < 0.01;
    if (settled) Object.assign(now, goal);
    paint();
    if (settled) {
      frame.current = 0;
      lastFrame.current = 0;
    } else {
      frame.current = requestAnimationFrame(tick);
    }
  };

  const animate = () => {
    if (!frame.current) frame.current = requestAnimationFrame(tick);
  };

  const toViewBox = (event: React.PointerEvent<SVGSVGElement>): Point | null => {
    const matrix = svgRef.current?.getScreenCTM();
    if (!matrix) return null;
    const { x, y } = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    return { x, y };
  };

  const onPointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    const point = toViewBox(event);
    if (!point) return;
    // Entering from nothing starts the patch under the pointer rather than sliding in from its last spot.
    if (current.current.radius < 0.5) Object.assign(current.current, point);
    target.current = { ...point, radius: PATCH_RADIUS };
    animate();
  };

  const onPointerLeave = () => {
    target.current = { ...target.current, radius: 0 };
    animate();
  };

  const viewBox = `0 ${inkOffsetY} ${VIEW_BOX.width} ${VIEW_BOX.height}`;

  return (
    <>
      {/* Takes the pointer by design (the patch follows it); it holds no controls, so nothing is blocked. */}
      <svg
        ref={svgRef}
        aria-hidden="true"
        data-slot="footer-watermark"
        viewBox={viewBox}
        preserveAspectRatio="xMidYMid meet"
        className={cn("pointer-events-auto absolute inset-0 size-full text-white mix-blend-plus-lighter select-none", className)}
        onPointerMove={onPointerMove}
        onPointerLeave={onPointerLeave}
        onPointerCancel={onPointerLeave}
        onPointerUp={(event) => {
          if (event.pointerType !== "mouse") onPointerLeave();
        }}
      >
        <defs>
          <radialGradient id={`${id}-patch-in`}>
            <stop offset={PATCH_CORE} stopOpacity={1} style={{ stopColor: "var(--ds-color-white)" }} />
            <stop offset="1" stopOpacity={0} style={{ stopColor: "var(--ds-color-white)" }} />
          </radialGradient>
          <radialGradient id={`${id}-patch-out`}>
            <stop offset={PATCH_CORE} stopOpacity={1} style={{ stopColor: "var(--ds-color-black)" }} />
            <stop offset="1" stopOpacity={0} style={{ stopColor: "var(--ds-color-black)" }} />
          </radialGradient>
          <mask id={`${id}-inside`} maskUnits="userSpaceOnUse" x="-1000" y="-1000" width="2000" height="2000">
            <circle
              ref={(element) => {
                if (element) patchRefs.current[0] = element;
              }}
              r="0"
              fill={`url(#${id}-patch-in)`}
            />
          </mask>
          <mask id={`${id}-outside`} maskUnits="userSpaceOnUse" x="-1000" y="-1000" width="2000" height="2000">
            <rect x="-1000" y="-1000" width="2000" height="2000" style={{ fill: "var(--ds-color-white)" }} />
            <circle
              ref={(element) => {
                if (element) patchRefs.current[1] = element;
              }}
              r="0"
              fill={`url(#${id}-patch-out)`}
            />
          </mask>
        </defs>
        <text
          ref={wordRef}
          aria-hidden
          visibility="hidden"
          x={VIEW_BOX.width / 2}
          y={BASELINE_Y}
          textAnchor="middle"
          fontSize={VIEW_BOX.height}
          className="tracking-tighter"
          style={{ fontFamily: "var(--ds-font-sans)", fontWeight: "var(--ds-font-weight-medium)" }}
        >
          {outlined}
          {solid}
        </text>
        {dots && (
          <g ref={inkRef}>
            <g aria-hidden mask={`url(#${id}-outside)`}>
              <DotLayerPaths layer={dots.resting} ringStroke={dots.ringStroke} />
            </g>
            <g aria-hidden mask={`url(#${id}-inside)`}>
              <DotLayerPaths layer={dots.swapped} ringStroke={dots.ringStroke} />
            </g>
          </g>
        )}
      </svg>
      {/* Its own layer, above the origin element, so the cursor rests on it rather than sliding under it. */}
      <svg aria-hidden="true" viewBox={viewBox} preserveAspectRatio="xMidYMid meet" className="pointer-events-none absolute inset-0 z-20 size-full">
        <LaunchingCursor
          id={`${id}-cursor`}
          offset={hasCursorLaunched ? null : cursorLaunchOffset}
          isHidden={!hasCursorLaunched && !cursorLaunchOffset}
          isPressing={isCursorPressing}
        />
      </svg>
    </>
  );
}
