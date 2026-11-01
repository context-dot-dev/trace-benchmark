export const isNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

export const percent = (value: number | null | undefined) =>
  value == null ? "—" : `${(value * 100).toFixed(1)}%`;
