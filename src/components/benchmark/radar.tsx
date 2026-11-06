"use client";

// Category radar, carried over from the previous layout for the Categories chart view.
import { useEffect, useRef, useState } from "react";
import { percent } from "@/lib/benchmark/format";
import { providers, type ProviderMetric } from "@/lib/benchmark/types";
import { integer } from "./charts";
import { Legend, patterns } from "./history";

function categoryRate(row: ProviderMetric | undefined, category: string) {
  const group = row?.categories[category];
  return group?.total && group.completed ? group.useful / group.total : null;
}
export function Radar({
  rows,
  chartCategories,
  accessOnly,
}: {
  rows: ProviderMetric[];
  accessOnly: boolean;
  chartCategories: { id: string; name: string }[];
}) {
  const [active, setActive] = useState<string | null>(null);
  const container = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  useEffect(() => {
    if (!container.current) return;
    const observer = new ResizeObserver(([entry]) =>
      setWidth(Math.max(280, Math.round(entry.contentRect.width))),
    );
    observer.observe(container.current);
    return () => observer.disconnect();
  }, []);
  const radius = Math.max(40, width / 2 - (width < 500 ? 104 : 96));
  const height = radius * 2 + 128;
  const cx = width / 2,
    cy = height / 2;
  const point = (i: number, value: number, extra = 0) => {
    const angle = (i * 2 * Math.PI) / chartCategories.length - Math.PI / 2;
    return [
      cx + Math.cos(angle) * (radius * value + extra),
      cy + Math.sin(angle) * (radius * value + extra),
    ];
  };
  const shortNames: Record<string, string[]> = {
    legal_regulatory: ["Legal"],
    software_docs: ["Docs"],
    arts_sports_reference: ["Arts &", "reference"],
  };
  const labels = chartCategories.map((c) => shortNames[c.id] ?? [c.name]);
  return (
    <>
      <Legend
        active={active}
        onSelect={(id) => setActive(active === id ? null : id)}
      />
      <div className="bench-radar" ref={container}>
        <svg
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label={`${accessOnly ? "Page access" : "Useful content"} by category from zero to 100 percent; exact values and page counts are available in the table`}
        >
          {[0.25, 0.5, 0.75, 1].map((value) => (
            <polygon
              key={value}
              points={chartCategories
                .map((_, i) => point(i, value).join(","))
                .join(" ")}
              className="bench-radar-grid"
            />
          ))}
          {chartCategories.map((category, i) => {
            const [x, y] = point(i, 1),
              [lx, ly] = point(i, 1, 20);
            return (
              <g key={category.id}>
                <line
                  x1={cx}
                  y1={cy}
                  x2={x}
                  y2={y}
                  className="bench-radar-grid"
                />
                <text
                  x={lx}
                  y={ly}
                  textAnchor={
                    Math.abs(lx - cx) < 1 ? "middle" : lx > cx ? "start" : "end"
                  }
                  dominantBaseline="middle"
                >
                  {labels[i].map((label, j) => (
                    <tspan
                      key={label}
                      x={lx}
                      dy={j ? 16 : labels[i].length > 1 ? -8 : 0}
                    >
                      {label}
                    </tspan>
                  ))}
                </text>
              </g>
            );
          })}
          {providers.map((p, providerIndex) => {
            const row = rows.find((r) => r.id === p.id);
            const values = chartCategories.map((c) => categoryRate(row, c.id));
            return (
              <g key={p.id} opacity={active && active !== p.id ? 0.2 : 1}>
                {values.map((value, i) => {
                  if (value == null) return null;
                  const next = values[(i + 1) % values.length];
                  const [x, y] = point(i, value),
                    [nx, ny] = point((i + 1) % values.length, next ?? 0);
                  return (
                    <g key={chartCategories[i].id}>
                      {next != null && (
                        <line
                          x1={x}
                          y1={y}
                          x2={nx}
                          y2={ny}
                          stroke={p.color}
                          strokeWidth="2"
                          strokeDasharray={patterns[providerIndex]}
                        />
                      )}
                      <circle cx={x} cy={y} r="3" fill={p.color}>
                        <title>{`${p.name}, ${chartCategories[i].name}: ${percent(value)} (${integer(row?.categories[chartCategories[i].id]?.total ?? 0)} pages)`}</title>
                      </circle>
                    </g>
                  );
                })}
              </g>
            );
          })}
          {(width < 500 ? [0, 0.5, 1] : [0, 0.25, 0.5, 0.75, 1]).map(
            (value) => (
              <text
                key={value}
                x={cx + 8}
                y={cy - radius * value + 4}
                textAnchor="start"
                className="bench-radar-scale"
              >
                {Math.round(value * 100)}%
              </text>
            ),
          )}
        </svg>
      </div>
    </>
  );
}
