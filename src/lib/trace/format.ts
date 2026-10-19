export const isNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

export const humanize = (value: unknown) => String(value ?? "Unavailable").replace(/_/g, " ");

export const percent = (value: number | null | undefined) => (isNumber(value) ? `${(value * 100).toFixed(1)}%` : "—");

export const wholePercent = (value: number | null | undefined) => (isNumber(value) ? `${Math.round(value * 100)}%` : "—");

export const seconds = (value: number | null | undefined) => (isNumber(value) ? `${value.toFixed(2)}s` : "—");

export const count = (value: number | null | undefined) => (value == null ? "—" : value.toLocaleString("en-US"));

// Dates are formatted by hand, in UTC: Safari's Intl joins a date and time with " at " where Node uses a comma, which
// would make the server-rendered text differ from the browser's.
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad = (value: number) => String(value).padStart(2, "0");
const monthDay = (date: Date) => `${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}`;
const clock12 = (date: Date) => `${date.getUTCHours() % 12 || 12}:${pad(date.getUTCMinutes())} ${date.getUTCHours() < 12 ? "AM" : "PM"}`;

export const dateTimeUtc = (value: string | null | undefined) => {
  if (!value || !Number.isFinite(Date.parse(value))) return "Unavailable";
  const date = new Date(value);
  return `${monthDay(date)}, ${date.getUTCFullYear()}, ${clock12(date)} UTC`;
};

export const runStart = (startedAt: string) => {
  const date = new Date(startedAt);
  return `${monthDay(date)}, ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
};

export const shortDay = (day: string) => monthDay(new Date(`${day}T00:00:00Z`));

export const collectionRange = (timestamps: (string | null | undefined)[]) => {
  const times = timestamps.map((value) => (value ? Date.parse(value) : NaN)).filter(Number.isFinite);
  if (!times.length) return "No collection dates available";
  const format = (time: number) => {
    const date = new Date(time);
    return `${monthDay(date)}, ${date.getUTCFullYear()}`;
  };
  const first = format(Math.min(...times));
  const last = format(Math.max(...times));
  return first === last ? first : `${first} – ${last}`;
};

export const usd = (value: number | null | undefined, digits = 2) =>
  isNumber(value) ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value) : "Unknown";

export const usdRange = (low: number | null | undefined, high: number | null | undefined) =>
  high === null || high === undefined ? "Unavailable" : usd(low) === usd(high) ? usd(high) : `${usd(low)}–${usd(high)}`;

export const safeHttpUrl = (value: string | null | undefined) => {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
};
