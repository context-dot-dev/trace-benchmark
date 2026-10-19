// The Context.dev mark's geometry, in its own 772.32 x 531.2 units: a rounded square with a round hole, and the disc
// beside it. The hero dot field lays these out as its own dots, so the mark shares the field's grid, dot sizes and
// pointer trail exactly.
const SQUARE = { left: 260.5, top: 0, right: 772.32, bottom: 511.83 };
const HOLE = { cx: 414.05, cy: 358.28, r: 153.55 };
const DISC = { cx: 153.55, cy: 377.64, r: 153.55 };
export const LOGO_MARK_WIDTH = 772.32;
export const LOGO_MARK_HEIGHT = 531.2;

export type LogoMarkKind = "lit" | "ring";

/**
 * Solid parts of the mark are lit dots and the square's hole is drawn in rings, in the site's two-dot language. A dot is
 * only placed where its whole disc (`dotRadius`, in mark units) lands inside that part, so the outline stays clean.
 */
export function logoMarkKindAt(x: number, y: number, dotRadius: number): LogoMarkKind | null {
  if (Math.hypot(x - DISC.cx, y - DISC.cy) <= DISC.r - dotRadius) return "lit";
  // The disc's top rows run straight on into the square, filling the notch its curve would leave against the square's
  // left edge, so the two shapes read as one joined line there.
  const inJoin = x >= DISC.cx && x - dotRadius < SQUARE.left && y >= DISC.cy - DISC.r + dotRadius && y <= DISC.cy - Math.sqrt(DISC.r ** 2 - (SQUARE.left - DISC.cx) ** 2);
  if (inJoin) return "lit";
  const inSquare = x - dotRadius >= SQUARE.left && x + dotRadius <= SQUARE.right && y - dotRadius >= SQUARE.top && y + dotRadius <= SQUARE.bottom;
  if (!inSquare) return null;
  const fromHole = Math.hypot(x - HOLE.cx, y - HOLE.cy);
  if (fromHole <= HOLE.r - dotRadius) return "ring";
  return fromHole <= HOLE.r + dotRadius ? null : "lit";
}
