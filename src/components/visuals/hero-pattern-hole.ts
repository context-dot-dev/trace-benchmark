export const HERO_PATTERN_HOLE_ATTRIBUTE = "data-hero-pattern-hole";

export type HeroPatternHole = "text" | "box" | "snug-box" | "tight-box" | "cover" | "oval";

export function patternHole(kind: HeroPatternHole) {
  return { [HERO_PATTERN_HOLE_ATTRIBUTE]: kind } as Record<string, string>;
}
