// A plain module, not a client one, so server components can mark holes with the attribute too.
export const HERO_PATTERN_HOLE_ATTRIBUTE = "data-hero-pattern-hole";

/**
 * How a marked element clears the dot patterns behind it. `text` clears each rendered line, `box` the element's box,
 * `snug-box` the box with just enough margin that no dot touches it, and `tight-box` the box with only a sliver of
 * margin (items packed close together). `cover` keeps the dots but places no solid cluster there: for opaque content
 * that hides the dots itself and moves, like a carousel's cards. `oval` clears the ellipse inscribed in the box, with a
 * frayed edge, for a soft opening around a drawing rather than a cut-out.
 */
export type HeroPatternHole = "text" | "box" | "snug-box" | "tight-box" | "cover" | "oval";

/** Spread on an element to mark it as a hole: `<h1 {...patternHole("text")}>`. */
export function patternHole(kind: HeroPatternHole) {
  return { [HERO_PATTERN_HOLE_ATTRIBUTE]: kind } as Record<string, string>;
}
