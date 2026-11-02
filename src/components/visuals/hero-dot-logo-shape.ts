const SQUARE = { left: 260.5, top: 0, right: 772.32, bottom: 511.83 };
const HOLE = { cx: 414.05, cy: 358.28, r: 153.55 };
const DISC = { cx: 153.55, cy: 377.64, r: 153.55 };
export const LOGO_MARK_WIDTH = 772.32;
export const LOGO_MARK_HEIGHT = 531.2;

export type LogoMarkKind = "lit" | "ring";

export function logoMarkKindAt(x: number, y: number, dotRadius: number): LogoMarkKind | null {
  if (Math.hypot(x - DISC.cx, y - DISC.cy) <= DISC.r - dotRadius) return "lit";
  const inJoin = x >= DISC.cx && x - dotRadius < SQUARE.left && y >= DISC.cy - DISC.r + dotRadius && y <= DISC.cy - Math.sqrt(DISC.r ** 2 - (SQUARE.left - DISC.cx) ** 2);
  if (inJoin) return "lit";
  const inSquare = x - dotRadius >= SQUARE.left && x + dotRadius <= SQUARE.right && y - dotRadius >= SQUARE.top && y + dotRadius <= SQUARE.bottom;
  if (!inSquare) return null;
  const fromHole = Math.hypot(x - HOLE.cx, y - HOLE.cy);
  if (fromHole <= HOLE.r - dotRadius) return "ring";
  return fromHole <= HOLE.r + dotRadius ? null : "lit";
}
