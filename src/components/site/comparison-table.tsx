import * as React from "react";
import { Check } from "lucide-react";

import { cn } from "@/lib/utils";

// The site's comparison tables, both inside a white card in the soft blue glass ring, the brand's own column tinted blue
// at 4 percent, and no vertical rules.
// - `text` (the use-case pages): column heads at h5 with a small caption under each, hairline rows, and each cell a
//   short answer in words, the alternative's muted and the brand's in black.
// - `marks` (the alternatives pages' full comparison): compact centered heads, rows grouped under plain category
//   headings, and each cell a check, a quiet en dash for no, or a short figure (in blue in the brand's column).

export type ComparisonCellValue = boolean | string;
export type ComparisonColumn = { key: string; header: string; caption?: string; highlight?: boolean };
export type ComparisonRow = { feature: string; category?: string; [key: string]: ComparisonCellValue | undefined };

/** A `marks` cell: a check, an en dash for no, or a short figure. */
function ComparisonMark({ value, highlight }: { value: ComparisonCellValue | undefined; highlight?: boolean }) {
  if (typeof value === "string") return <span className={cn("text-body-sm", highlight ? "font-medium text-fg-brand" : "text-fg-nav")}>{value}</span>;
  if (value) {
    return (
      <span className="inline-flex justify-center">
        <Check aria-hidden="true" className={cn("size-5", highlight ? "text-fg-brand" : "text-[var(--ds-color-neutral-50)]")} />
        <span className="sr-only">Yes</span>
      </span>
    );
  }
  return (
    <span className="text-body-sm text-neutral-30">
      <span aria-hidden="true">–</span>
      <span className="sr-only">No</span>
    </span>
  );
}

function ComparisonTable({
  columns,
  rows,
  variant = "text",
  caption,
  firstColumnHeader,
  footnote,
  className,
}: {
  columns: ComparisonColumn[];
  rows: ComparisonRow[];
  variant?: "text" | "marks";
  /** Names the scrolling region and the table for screen readers; the visible title belongs to the section around it. */
  caption?: string;
  /** The first column's head; `marks` defaults to "Feature", `text` leaves it empty. */
  firstColumnHeader?: string;
  /** A line under the card, such as when prices were last checked. */
  footnote?: React.ReactNode;
  className?: string;
}) {
  const marks = variant === "marks";
  const categories = [...new Set(rows.flatMap((row) => (row.category ? [row.category] : [])))];
  const groups = categories.length > 0 ? categories.map((category) => ({ category, rows: rows.filter((row) => row.category === category) })) : [{ category: undefined, rows }];
  const firstHeader = firstColumnHeader ?? (marks ? "Feature" : undefined);
  const last = columns.length - 1;

  return (
    <div data-slot="comparison-table" className={cn("flex flex-col gap-3", className)}>
      {/* The glass ring: a wrapper 8px wider than the card, so its outer edge shares the card's radius. */}
      <div className="-m-2 rounded-card bg-ring-tint p-2">
        <div tabIndex={0} role="region" aria-label={caption} className="overflow-x-auto rounded-card bg-surface ring-1 ring-hairline outline-none focus-visible:ring-2 focus-visible:ring-focus-ring">
          <table className={cn("w-full border-collapse text-left leading-snug", marks ? "min-w-136" : "min-w-160")}>
            {caption && <caption className="sr-only">{caption}</caption>}
            <thead>
              {marks ? (
                <tr className="text-body-sm">
                  <th scope="col" className="px-5 py-4 font-normal text-fg-nav md:px-8">
                    {firstHeader}
                  </th>
                  {columns.map((col) => (
                    <th key={col.key} scope="col" className={cn("w-36 px-4 py-4 text-center md:w-44", col.highlight ? "bg-brand/4 font-medium text-fg-brand" : "font-normal text-fg")}>
                      {col.header}
                    </th>
                  ))}
                </tr>
              ) : (
                <tr className="align-bottom">
                  {firstHeader ? (
                    <th scope="col" className="w-[28%] px-5 py-5 text-body-sm font-normal text-fg-subtle md:px-8">
                      {firstHeader}
                    </th>
                  ) : (
                    <td className="w-[28%] px-5 py-5 md:px-8" />
                  )}
                  {columns.map((col, i) => (
                    <th key={col.key} scope="col" className={cn("px-5 py-5 font-normal", i === last && "md:px-8", col.highlight && "bg-brand/4")}>
                      <span className={cn("block text-h5", col.highlight ? "text-fg-brand" : "text-fg")}>{col.header}</span>
                      {col.caption && <span className="block text-body-sm text-fg-subtle">{col.caption}</span>}
                    </th>
                  ))}
                </tr>
              )}
            </thead>
            {groups.map((group) => (
              <tbody key={group.category ?? "rows"}>
                {group.category && (
                  <tr className="border-t border-hairline">
                    <th scope="colgroup" colSpan={columns.length + 1} className="px-5 pt-6 pb-2 text-body-sm font-medium text-fg md:px-8">
                      {group.category}
                    </th>
                  </tr>
                )}
                {group.rows.map((row) =>
                  marks ? (
                    <tr key={row.feature} className="border-t border-wash-pill">
                      <th scope="row" className="px-5 py-3.5 text-body font-normal text-fg-nav md:px-8">
                        {row.feature}
                      </th>
                      {columns.map((col) => (
                        <td key={col.key} className={cn("px-4 py-3.5 text-center", col.highlight && "bg-brand/4")}>
                          <ComparisonMark value={row[col.key]} highlight={col.highlight} />
                        </td>
                      ))}
                    </tr>
                  ) : (
                    <tr key={row.feature} className="border-t border-hairline">
                      <th scope="row" className="px-5 py-4 text-body font-normal text-fg md:px-8">
                        {row.feature}
                      </th>
                      {columns.map((col, i) => (
                        <td key={col.key} className={cn("px-5 py-4 text-body", i === last && "md:px-8", col.highlight ? "bg-brand/4 text-fg" : "text-fg-subtle")}>
                          {typeof row[col.key] === "boolean" ? <ComparisonMark value={row[col.key]} highlight={col.highlight} /> : row[col.key]}
                        </td>
                      ))}
                    </tr>
                  ),
                )}
              </tbody>
            ))}
          </table>
        </div>
      </div>
      {footnote && <p className="text-body-sm leading-relaxed text-fg-subtle">{footnote}</p>}
    </div>
  );
}

export { ComparisonTable, ComparisonMark };
