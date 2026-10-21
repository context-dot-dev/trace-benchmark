"use client";

import * as React from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";

// The site's ringed table (comparison-table): a white card in the soft blue glass ring, hairline rows, no zebra stripes
// and no vertical rules. Figures use tabular numbers and align right; a highlighted column is tinted blue at 4 percent.

export type Column = {
  key: string;
  label: React.ReactNode;
  align?: "left" | "right";
  highlight?: boolean;
  sortable?: boolean;
  className?: string;
};

export type Row = {
  key: string;
  cells: Record<string, React.ReactNode>;
  selected?: boolean;
};

export type SortState = { column: string; ascending: boolean };

export function CellDetail({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={cn("block text-body-sm leading-snug font-normal text-fg-muted", className)}>{children}</span>;
}

function SortIcon({ active, ascending }: { active: boolean; ascending: boolean }) {
  if (!active) return <ArrowUpDown aria-hidden="true" className="size-3 text-fg-faint" />;
  return ascending ? <ArrowUp aria-hidden="true" className="size-3 text-fg-brand" /> : <ArrowDown aria-hidden="true" className="size-3 text-fg-brand" />;
}

/** Whether a scroller has more content past its right edge, so a fade and an arrow can say so. */
function useMoreToTheRight() {
  const [node, attach] = React.useState<HTMLDivElement | null>(null);
  const [more, setMore] = React.useState(false);
  React.useEffect(() => {
    if (!node) return;
    const update = () => setMore(node.scrollLeft + node.clientWidth < node.scrollWidth - 1);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    node.addEventListener("scroll", update, { passive: true });
    return () => {
      observer.disconnect();
      node.removeEventListener("scroll", update);
    };
  }, [node]);
  const scrollOn = React.useCallback(() => node?.scrollBy({ left: node.clientWidth * 0.75, behavior: "smooth" }), [node]);
  return [attach, more, scrollOn] as const;
}

/** The phone layout of a table: one block per row, its first cell as the title and every other column as a labelled value. */
function StackedRows({ caption, columns, rows, onRowSelect, empty, framed }: { caption: string; columns: Column[]; rows: Row[]; onRowSelect?: (key: string) => void; empty?: React.ReactNode; framed: boolean }) {
  const [first, ...rest] = columns;
  return (
    <div className={cn("sm:hidden", framed && "-m-2 rounded-card bg-ring-tint p-2")}>
      <ul aria-label={caption} className={cn("rounded-card bg-surface", framed && "ring-1 ring-hairline")}>
        {rows.length === 0 && <li className="px-4 py-6 text-center text-body-sm text-fg-subtle">{empty ?? "No rows yet."}</li>}
        {rows.map((row) => (
          <li key={row.key} className={cn("flex flex-col gap-3 border-hairline px-4 py-4 not-first:border-t", row.selected && "bg-blue-10/60")}>
            <div className="text-body text-fg">
              {onRowSelect ? (
                <button type="button" aria-pressed={!!row.selected} onClick={() => onRowSelect(row.key)} className="rounded-sm text-left outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring">
                  {row.cells[first.key]}
                </button>
              ) : (
                row.cells[first.key]
              )}
            </div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
              {rest.map((column) => (
                <div key={column.key} className="flex min-w-0 flex-col gap-0.5">
                  <dt className={cn("text-caption text-fg-muted", column.highlight && "text-fg-brand")}>{column.label}</dt>
                  <dd className="text-body text-fg tabular-nums">{row.cells[column.key]}</dd>
                </div>
              ))}
            </dl>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function DataTable({
  caption,
  columns,
  rows,
  sort,
  onSortChange,
  onRowSelect,
  empty,
  footnote,
  minWidth = "min-w-0",
  stackOnPhones = !sort,
  framed = true,
  fixedLayout = false,
  className,
}: {
  caption: string;
  columns: Column[];
  rows: Row[];
  sort?: SortState;
  onSortChange?: (sort: SortState) => void;
  onRowSelect?: (key: string) => void;
  empty?: React.ReactNode;
  footnote?: React.ReactNode;
  minWidth?: string;
  fixedLayout?: boolean;
  framed?: boolean;
  /** Below 640px, each row becomes a block of label and value pairs instead of a row that needs a sideways swipe. */
  stackOnPhones?: boolean;
  className?: string;
}) {
  const [first, ...rest] = columns;
  const [attachScroller, moreToTheRight, scrollOn] = useMoreToTheRight();
  const align = (column: Column) => (column.align === "right" ? "text-right" : "text-left");

  return (
    <div data-slot="data-table" className={cn("flex min-w-0 flex-col gap-5", className)}>
      {stackOnPhones && <StackedRows caption={caption} columns={columns} rows={rows} onRowSelect={onRowSelect} empty={empty} framed={framed} />}
      <div className={cn("relative", framed && "-m-2 rounded-card bg-ring-tint p-2", stackOnPhones && "max-sm:hidden")}>
        <div
          aria-hidden="true"
          className={cn(
            "pointer-events-none absolute inset-y-2 right-2 z-10 w-20 rounded-r-card bg-linear-to-l from-surface via-surface/80 to-transparent transition-opacity duration-200 ease-out motion-reduce:transition-none",
            moreToTheRight ? "opacity-100" : "opacity-0",
          )}
        />
        {/* Pointer users get a button that scrolls the hidden columns in; keyboard users scroll the focusable region itself. */}
        <button
          type="button"
          tabIndex={-1}
          aria-hidden="true"
          onClick={scrollOn}
          className={cn(
            "absolute top-1/2 right-4 z-20 flex size-8 -translate-y-1/2 items-center justify-center rounded-pill bg-surface text-fg shadow-key ring-1 ring-hairline transition-opacity duration-200 ease-out motion-reduce:transition-none",
            moreToTheRight ? "opacity-100" : "pointer-events-none opacity-0",
          )}
        >
          <ChevronRight className="size-4" />
        </button>
        <div ref={attachScroller} tabIndex={0} role="region" aria-label={caption} className={cn("overflow-x-auto rounded-card bg-surface outline-none focus-visible:ring-2 focus-visible:ring-focus-ring", framed && "ring-1 ring-hairline")}>
          <table className={cn("w-full border-collapse text-left leading-snug", fixedLayout && "table-fixed", minWidth)}>
            <caption className="sr-only">{caption}</caption>
            <thead>
              <tr>
                {columns.map((column, index) => {
                  const active = sort?.column === column.key;
                  const ariaSort = column.sortable ? (active ? (sort!.ascending ? "ascending" : "descending") : "none") : undefined;
                  return (
                    <th
                      key={column.key}
                      scope="col"
                      aria-sort={ariaSort}
                      className={cn(
                        "px-2 py-3.5 align-middle text-body-sm font-normal text-fg-muted first:pl-3 last:pr-3 sm:px-4 sm:whitespace-nowrap sm:first:pl-5 sm:last:pr-5 md:first:pl-6 md:last:pr-6",
                        align(column),
                        column.highlight && "bg-brand/4 text-fg-brand",
                        index === 0 && "w-auto",
                        column.className,
                      )}
                    >
                      {column.sortable && onSortChange ? (
                        <button
                          type="button"
                          onClick={() => onSortChange({ column: column.key, ascending: active ? !sort!.ascending : column.align !== "right" })}
                          className={cn("inline-flex items-center gap-1.5 rounded-sm outline-none hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring", active && "text-fg", column.align === "right" && "flex-row-reverse")}
                        >
                          {column.label}
                          <SortIcon active={active} ascending={!!sort?.ascending} />
                        </button>
                      ) : (
                        column.label
                      )}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr className="border-t border-hairline">
                  <td colSpan={columns.length} className="px-5 py-6 text-center text-body-sm text-fg-subtle md:px-6">
                    {empty ?? "No rows yet."}
                  </td>
                </tr>
              )}
              {rows.map((row) => (
                <tr
                  key={row.key}
                  aria-selected={onRowSelect ? !!row.selected : undefined}
                  tabIndex={onRowSelect ? 0 : undefined}
                  onClick={onRowSelect ? () => onRowSelect(row.key) : undefined}
                  onKeyDown={onRowSelect ? (event) => {
                    if (event.target !== event.currentTarget || (event.key !== "Enter" && event.key !== " ")) return;
                    event.preventDefault();
                    onRowSelect(row.key);
                  } : undefined}
                  className={cn("border-t border-hairline", onRowSelect && "cursor-pointer transition-colors duration-150 ease-out hover:bg-wash-hover", row.selected && "bg-blue-10/60 hover:bg-blue-10/60")}
                >
                  <th scope="row" className={cn("px-2 py-3.5 pl-3 align-top text-body font-normal text-fg sm:px-4 sm:pl-5 md:pl-6", first.highlight && "bg-brand/4", first.className)}>
                    {onRowSelect ? (
                      <button
                        type="button"
                        aria-pressed={!!row.selected}
                        onClick={(event) => {
                          event.stopPropagation();
                          onRowSelect(row.key);
                        }}
                        className="rounded-sm text-left outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
                      >
                        {row.cells[first.key]}
                      </button>
                    ) : (
                      row.cells[first.key]
                    )}
                  </th>
                  {rest.map((column) => (
                    <td
                      key={column.key}
                      className={cn("px-2 py-3.5 align-top text-body text-fg tabular-nums last:pr-3 sm:px-4 sm:last:pr-5 md:last:pr-6", align(column), column.highlight && "bg-brand/4", column.className)}
                    >
                      {row.cells[column.key]}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {footnote && <div className="max-w-(--ds-layout-text) text-body leading-relaxed text-fg-muted">{footnote}</div>}
    </div>
  );
}
