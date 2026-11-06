"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ProviderLogo, ProviderName } from "@/components/trace/provider-logo";
import { percent } from "@/lib/benchmark/format";
import { providers, type ProviderMetric } from "@/lib/benchmark/types";
import type { Failures, Funnel, Latency, Pair } from "@/lib/benchmark/analysis";
import { failureReasons } from "@/lib/benchmark/outcomes";
import { cn } from "@/lib/utils";

export const integer = (value: number) => value.toLocaleString("en-US");
export const seconds = (ms: number | null | undefined) =>
  ms == null ? "—" : `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)} s`;
export const points = (value: number | null | undefined) =>
  value == null ? "" : `±${(value * 100).toFixed(1)}`;
const ordinal = (n: number) => `${n}${["th", "st", "nd", "rd"][n % 100 > 10 && n % 100 < 14 ? 0 : n % 10 < 4 ? n % 10 : 0]}`;

export function Name({ id, className }: { id: string; className?: string }) {
  return <ProviderName id={id} name={providers.find((p) => p.id === id)?.name ?? id} className={className} />;
}
export function Swatch({ id }: { id: string }) {
  return (
    <span
      aria-hidden="true"
      className="bench-swatch"
      style={{ backgroundColor: providers.find((p) => p.id === id)?.color }}
    />
  );
}

export function Table({
  headers,
  rows,
  label,
  className,
}: {
  headers: string[];
  rows: { id: string; cells: ReactNode[] }[];
  label: string;
  className?: string;
}) {
  return (
    <div className={cn("bench-scroll", className)} tabIndex={0} role="region" aria-label={label}>
      <table>
        <caption className="sr-only">{label}</caption>
        <thead>
          <tr>
            {headers.map((h) => (
              <th key={h} scope="col">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              {row.cells.map((cell, j) =>
                j === 0 ? (
                  <th key={headers[j]} scope="row">
                    {cell}
                  </th>
                ) : (
                  <td key={headers[j]} data-label={headers[j]}>
                    {cell}
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Dot meter: two rows of dots, filled left to right. Each column is 1% of pages when space allows. */
export function Bars({
  rows,
  ranks,
}: {
  rows: ProviderMetric[];
  ranks: Map<string, { place: number; tied: boolean }>;
}) {
  const track = useRef<HTMLDivElement>(null);
  const [columns, setColumns] = useState(50);
  useEffect(() => {
    if (!track.current) return;
    const observer = new ResizeObserver(([entry]) =>
      setColumns(Math.max(10, Math.min(50, Math.floor(entry.contentRect.width / 11)))),
    );
    observer.observe(track.current);
    return () => observer.disconnect();
  }, []);
  const ordered = [...providers].sort(
    (a, b) => (rows.find((r) => r.id === b.id)?.rate ?? -1) - (rows.find((r) => r.id === a.id)?.rate ?? -1),
  );
  const leader = ordered[0]?.id;
  const leaderRate = rows.find((r) => r.id === leader)?.rate ?? null;
  return (
    <div
      className="bench-meter"
      role="img"
      aria-label={ordered
        .map((p) => {
          const row = rows.find((r) => r.id === p.id);
          return `${p.name}: ${percent(row?.rate)}${row?.ci != null ? `, plus or minus ${(row.ci * 100).toFixed(1)} points` : ""}`;
        })
        .join("; ")}
    >
      <div className="bench-meter-axis" aria-hidden="true">
        <span className="bench-meter-scale">
          <span>0%</span>
          <span>{columns === 50 ? "Each dot is 1% of pages" : ""}</span>
          <span>100%</span>
        </span>
      </div>
      {ordered.map((p, index) => {
        const row = rows.find((r) => r.id === p.id);
        const value = row?.rate;
        const filled = Math.round((value ?? 0) * columns * 2);
        const rank = ranks.get(p.id);
        return (
          <div className="bench-meter-row" key={p.id}>
            <span className="bench-meter-place">{rank?.place ?? "—"}</span>
            <Name id={p.id} />
            <div
              ref={index === 0 ? track : undefined}
              className="bench-meter-track"
              style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
              aria-hidden="true"
            >
              {Array.from({ length: columns * 2 }, (_, cell) => (
                <span className="meter-cell" key={cell}>
                  <span
                    className="meter-dot"
                    style={cell < filled ? { backgroundColor: p.color, borderColor: p.color } : undefined}
                  />
                </span>
              ))}
            </div>
            <span className="bench-meter-value">
              <strong data-score={p.id}>{percent(value)}</strong>
              {row?.ci != null && <small>{points(row.ci)}</small>}
            </span>
            <span className="bench-meter-note">
              {index === 0 && value != null ? (
                <span className={cn("bench-chip", !rank?.tied && "is-brand")}>{rank?.tied ? "Tied 1st" : "Leader"}</span>
              ) : rank?.tied ? (
                <span className="bench-chip">Tied {ordinal(rank.place)}</span>
              ) : value != null && leaderRate != null ? (
                `−${((leaderRate - value) * 100).toFixed(1)} pts`
              ) : null}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** Rows show who got the page, columns show who missed it. */
export function PairMatrix({ pairs, order }: { pairs: Pair[]; order: string[] }) {
  const cell = (a: string, b: string) => {
    const pair = pairs.find((p) => (p.a === a && p.b === b) || (p.a === b && p.b === a));
    if (!pair) return null;
    return pair.a === a ? pair.aOnly : pair.bOnly;
  };
  const max = Math.max(1, ...pairs.flatMap((p) => [p.aOnly, p.bOnly]));
  return (
    <div className="bench-matrix" role="table" aria-label="Pages the row provider accessed and the column provider missed">
      <div role="row" className="bench-matrix-row is-head">
        <span role="columnheader" className="bench-matrix-corner">
          <span>Got the page ↓</span>
          <br />
          <span>Missed it →</span>
        </span>
        {order.map((id) => (
          <span role="columnheader" key={id} className="bench-matrix-head" title={providers.find((p) => p.id === id)?.name}>
            <ProviderLogo id={id} />
            <span className="sr-only">{providers.find((p) => p.id === id)?.name}</span>
          </span>
        ))}
      </div>
      {order.map((row) => (
        <div role="row" className="bench-matrix-row" key={row}>
          <span role="rowheader" className="bench-matrix-label">
            <Swatch id={row} />
            {providers.find((p) => p.id === row)?.name}
          </span>
          {order.map((col) => {
            const value = row === col ? null : cell(row, col);
            return (
              <span
                role="cell"
                key={col}
                className={cn("bench-matrix-cell", value == null && "is-empty")}
                style={value != null ? { backgroundColor: `color-mix(in srgb, var(--ds-color-brand) ${Math.round((value / max) * 22)}%, transparent)` } : undefined}
              >
                {value == null ? <span aria-label="Not applicable">—</span> : integer(value)}
              </span>
            );
          })}
        </div>
      ))}
    </div>
  );
}

/** Range strip from median to p95 with the p99 marked, on a shared 0–30 s axis. */
export function LatencyStrips({ rows }: { rows: Latency[] }) {
  const max = 30_000;
  const x = (ms: number | null) => `${Math.min(100, ((ms ?? 0) / max) * 100)}%`;
  return (
    <div className="bench-latency">
      <div className="bench-latency-legend" aria-hidden="true">
        <span><i className="is-median" />Median</span>
        <span><i className="is-range" />Median to p95</span>
        <span><i className="is-tail" />Slowest 1% (p99)</span>
      </div>
      <div className="bench-latency-row is-head" aria-hidden="true">
        <span>Provider</span>
        <span>0 to 30 seconds</span>
        <span>p50</span>
        <span>p90</span>
        <span>p95</span>
        <span>p99</span>
      </div>
      {rows.map((row) => {
        const color = providers.find((p) => p.id === row.id)?.color;
        const fastest = Math.min(...rows.map((r) => r.p50 ?? Infinity)) === row.p50;
        const tightest = Math.min(...rows.map((r) => r.p95 ?? Infinity)) === row.p95;
        return (
          <div className="bench-latency-row" key={row.id}>
            <span className="bench-latency-name">
              <Swatch id={row.id} />
              {providers.find((p) => p.id === row.id)?.name}
            </span>
            <span className="bench-latency-track" aria-hidden="true" style={{ color }}>
              {row.p50 != null && (
                <>
                  <i className="is-range" style={{ left: x(row.p50), width: `calc(${x(row.p95)} - ${x(row.p50)})` }} />
                  <i className="is-median" style={{ left: x(row.p50) }} />
                  <i className="is-tail" style={{ left: x(row.p99) }} />
                </>
              )}
            </span>
            <span className={cn(fastest && "is-best")}>{seconds(row.p50)}</span>
            <span>{seconds(row.p90)}</span>
            <span className={cn(tightest && "is-best")}>{seconds(row.p95)}</span>
            <span>{seconds(row.p99)}</span>
          </div>
        );
      })}
      <div className="bench-latency-row is-axis" aria-hidden="true">
        <span />
        <span className="bench-latency-axis">
          {[0, 5, 10, 15, 20, 25, 30].map((s) => (
            <span key={s}>{s === 0 ? "0 s" : s === 30 ? "30 s" : s}</span>
          ))}
        </span>
      </div>
    </div>
  );
}

const stages = [
  { key: "returned", label: "Returned content" },
  { key: "accessed", label: "Page accessed" },
  { key: "rightPage", label: "Right page" },
  { key: "substantive", label: "Substantive" },
] as const;
/** Slope chart: each provider's share of pages surviving each quality stage. */
export function FunnelChart({ rows }: { rows: Funnel[] }) {
  const container = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  useEffect(() => {
    if (!container.current) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(280, Math.round(entry.contentRect.width))));
    observer.observe(container.current);
    return () => observer.disconnect();
  }, []);
  const available = stages.filter((s) => rows.some((r) => r[s.key] != null));
  const share = (r: Funnel, key: (typeof stages)[number]["key"]) => (r.n ? (r[key] ?? 0) / r.n : 0);
  const values = rows.flatMap((r) => available.map((s) => share(r, s.key)));
  const lo = Math.max(0, Math.floor((Math.min(...values, 1) * 100 - 2) / 5) * 5) / 100;
  // On narrow screens the end labels move into a legend below the chart.
  const narrow = width < 420;
  const compact = width < 640;
  const W = width, H = 250, L = 40, R = W - (narrow ? 24 : 150), T = 14, B = H - (compact ? 50 : 30);
  const x = (i: number) => (available.length === 1 ? (L + R) / 2 : L + (i * (R - L)) / (available.length - 1));
  const y = (v: number) => T + ((1 - v) / (1 - lo || 1)) * (B - T);
  const last = available.at(-1)?.key ?? "returned";
  const ends = rows.map((r) => ({ id: r.id, v: share(r, last) })).sort((a, b) => b.v - a.v);
  // Push end labels apart so they never overlap.
  const labelY: Record<string, number> = {};
  let previous = -Infinity;
  for (const e of ends) {
    const target = Math.max(y(e.v), previous + 16);
    labelY[e.id] = target;
    previous = target;
  }
  const grid = [];
  for (let g = 1; g >= lo - 1e-9; g -= 0.05) grid.push(Math.round(g * 100) / 100);
  const short: Record<string, string> = { returned: "Returned", accessed: "Accessed", rightPage: "Right page", substantive: "Substantive" };
  return (
    <div ref={container} className="bench-funnel-wrap">
      <svg
        className="bench-funnel"
        viewBox={`0 0 ${W} ${H}`}
        width={W}
        height={H}
        role="img"
        aria-label={rows
          .map((r) => `${providers.find((p) => p.id === r.id)?.name}: ${available.map((s) => `${s.label} ${percent(r.n ? share(r, s.key) : null)}`).join(", ")}`)
          .join("; ")}
      >
        {grid.map((g) => (
          <g key={g}>
            <line x1={L} x2={R} y1={y(g)} y2={y(g)} className="bench-funnel-grid" />
            <text x={L - 8} y={y(g) + 4} textAnchor="end" className="bench-funnel-scale">
              {g === 1 ? "100%" : Math.round(g * 100)}
            </text>
          </g>
        ))}
        {available.map((s, i) => (
          <g key={s.key}>
            <line x1={x(i)} x2={x(i)} y1={T} y2={B} className="bench-funnel-stage" />
            <text
              x={x(i)}
              y={compact && i % 2 === 1 ? H - 6 : compact ? H - 26 : H - 8}
              textAnchor={i === 0 ? "start" : i === available.length - 1 ? "end" : "middle"}
              className="bench-funnel-label"
            >
              {compact ? short[s.key] : s.label}
            </text>
          </g>
        ))}
        {rows.map((r) => {
          const p = providers.find((x) => x.id === r.id)!;
          const pts = available.map((s, i) => [x(i), y(share(r, s.key))] as const);
          const end = ends.find((e) => e.id === r.id)!;
          return (
            <g key={r.id}>
              <polyline points={pts.map((pt) => pt.join(",")).join(" ")} fill="none" stroke={p.color} strokeWidth="2" strokeLinejoin="round" />
              {pts.map(([cx, cy], i) => (
                <circle key={i} cx={cx} cy={cy} r="4" className="bench-funnel-dot" stroke={p.color}>
                  <title>{`${p.name}, ${available[i].label}: ${percent(share(r, available[i].key))}`}</title>
                </circle>
              ))}
              {!narrow && (
                <text x={R + 12} y={labelY[r.id] + 4} className="bench-funnel-end" fill={p.color}>
                  {percent(end.v)} {p.name}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {narrow && (
        <ul className="bench-funnel-legend">
          {ends.map((e) => (
            <li key={e.id}>
              <Swatch id={e.id} />
              {providers.find((p) => p.id === e.id)?.name} <strong>{percent(e.v)}</strong>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Stacked bars of why pages were not accessed, as a share of all scored pages. */
export function FailureBars({ rows }: { rows: Failures[] }) {
  const visible = failureReasons.filter((reason) => rows.some((r) => r.reasons[reason.id] > 0));
  const shares = rows.map((r) => (r.total ? r.failed / r.total : 0));
  const scale = Math.max(0.05, ...shares) * 1.05;
  const ordered = [...rows].sort((a, b) => (a.total ? a.failed / a.total : 0) - (b.total ? b.failed / b.total : 0));
  return (
    <div className="bench-failures">
      <div className="bench-failure-legend">
        {visible.map((reason) => (
          <span key={reason.id}>
            <i style={{ backgroundColor: reason.color }} />
            {reason.name}
          </span>
        ))}
      </div>
      {ordered.map((row) => (
        <div className="bench-failure-row" key={row.id}>
          <span className="bench-failure-name">{providers.find((p) => p.id === row.id)?.name}</span>
          <span className="bench-failure-track">
            {visible.map((reason) => {
              const count = row.reasons[reason.id];
              // Skip segments too thin to see; they would only draw a stray hairline.
              if (!count || !row.total || (count / row.total / scale) * 100 < 0.4) return null;
              return (
                <i
                  key={reason.id}
                  title={`${reason.name}: ${integer(count)} pages (${percent(count / row.total)})`}
                  style={{ width: `${(count / row.total / scale) * 100}%`, backgroundColor: reason.color }}
                />
              );
            })}
          </span>
          <strong>{percent(row.total ? row.failed / row.total : null)}</strong>
        </div>
      ))}
    </div>
  );
}
