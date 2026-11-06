"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { PanelLeft, PanelLeftOpen, SlidersHorizontal, ChevronUp, X } from "lucide-react";
import { ContextMark } from "@/components/trace/provider-logo";
import { ThemeToggle } from "@/components/trace/theme-toggle";

export type RailSection = { id: string; label: string; group?: string };

export const sections: RailSection[] = [
  { id: "overview", label: "Overview", group: "Results" },
  { id: "useful-content", label: "Leaderboard" },
  { id: "head-to-head", label: "Head-to-head" },
  { id: "categories", label: "Categories" },
  { id: "latency", label: "Latency" },
  { id: "quality", label: "Quality" },
  { id: "cost", label: "Cost" },
  { id: "failures", label: "Failures" },
  { id: "history", label: "History" },
  { id: "sources", label: "Sample & sources", group: "Method" },
  { id: "methodology", label: "Methodology" },
  { id: "data", label: "Data & API" },
  { id: "faq", label: "FAQ" },
  { id: "citation", label: "Citation" },
];
const number = (index: number) => String(index + 1).padStart(2, "0");
const RAIL_KEY = "bench-rail";

/** The section nearest the top third of the viewport, plus overall scroll progress. */
function useActiveSection() {
  const [active, setActive] = useState(sections[0].id);
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const line = window.innerHeight * 0.3;
      let current = sections[0].id;
      for (const section of sections) {
        const element = document.getElementById(section.id);
        if (element && element.getBoundingClientRect().top <= line) current = section.id;
      }
      // At the very bottom, the last section is the active one even if it is short.
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4)
        current = sections.at(-1)!.id;
      setActive(current);
      const max = document.documentElement.scrollHeight - window.innerHeight;
      setProgress(max > 0 ? Math.min(1, window.scrollY / max) : 0);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, []);
  return { active, progress };
}

function go(id: string) {
  const element = document.getElementById(id);
  if (!element) return;
  element.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  history.replaceState(null, "", `#${id}`);
  element.focus({ preventScroll: true });
}

export function BenchRail({
  sample,
  meta,
  glance,
  onFilters,
  shortDate,
}: {
  /** The sample date control. */
  sample: ReactNode;
  /** One line under the date, such as the protocol and page count. */
  meta: ReactNode;
  /** A compact, always-visible summary of the leaderboard. */
  glance: ReactNode;
  onFilters: () => void;
  shortDate: string;
}) {
  const { active, progress } = useActiveSection();
  const [rail, setRail] = useState<"auto" | "expanded" | "collapsed">("auto");
  const [sheet, setSheet] = useState(false);
  const pill = useRef<HTMLButtonElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const saved = localStorage.getItem(RAIL_KEY);
    // Restoring a saved preference after hydration avoids a server/client mismatch.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (saved === "expanded" || saved === "collapsed") setRail(saved);
  }, []);
  useEffect(() => {
    document.documentElement.dataset.rail = rail;
  }, [rail]);
  const toggleRail = useCallback(() => {
    setRail((current) => {
      const collapsed =
        current === "collapsed" || (current === "auto" && window.matchMedia("(max-width: 79.999rem)").matches);
      const next = collapsed ? "expanded" : "collapsed";
      localStorage.setItem(RAIL_KEY, next);
      return next;
    });
  }, []);
  // Number keys jump to sections; "[" toggles the rail. Ignored while typing or using a control.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable], [role=listbox], [role=slider], [role=dialog]")) return;
      if (event.key === "[") {
        event.preventDefault();
        toggleRail();
      } else if (/^[1-9]$/.test(event.key)) {
        const section = sections[Number(event.key) - 1];
        if (section) go(section.id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleRail]);
  useEffect(() => {
    if (!sheet) return;
    const previous = document.activeElement as HTMLElement | null;
    const trigger = pill.current;
    const panel = sheetRef.current;
    (panel?.querySelector<HTMLElement>("a[aria-current]") ?? panel?.querySelector<HTMLElement>("a"))?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSheet(false);
      if (event.key !== "Tab" || !panel) return;
      const focusable = [...panel.querySelectorAll<HTMLElement>("a, button, [tabindex='0']")].filter((el) => !el.hasAttribute("disabled"));
      const first = focusable[0], last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
      (previous ?? trigger)?.focus();
    };
  }, [sheet]);
  const activeIndex = Math.max(0, sections.findIndex((s) => s.id === active));
  const nav = (variant: "rail" | "sheet") => {
    const groups = [...new Set(sections.map((s, i) => sections.slice(0, i + 1).findLast((x) => x.group)?.group ?? ""))];
    return groups.map((group) => {
      const items = sections
        .map((s, index) => ({ ...s, index }))
        .filter((s, i) => (sections.slice(0, i + 1).findLast((x) => x.group)?.group ?? "") === group);
      return (
        <div className="bench-nav-group" key={group}>
          <p className="bench-nav-label">{group}</p>
          <ul>
            {items.map((s) => (
              <li key={s.id}>
                <a
                  href={`#${s.id}`}
                  data-label={s.label}
                  aria-current={active === s.id ? "location" : undefined}
                  onClick={(event) => {
                    event.preventDefault();
                    if (variant === "sheet") setSheet(false);
                    requestAnimationFrame(() => go(s.id));
                  }}
                >
                  <span className="bench-nav-number">{number(s.index)}</span>
                  <span className="bench-nav-text">{s.label}</span>
                  {variant === "rail" && <span className="bench-nav-dot" aria-hidden="true" />}
                </a>
              </li>
            ))}
          </ul>
        </div>
      );
    });
  };
  return (
    <>
      <aside className="bench-rail" data-state={rail} aria-label="Benchmark sections">
        <div className="bench-rail-panel">
          <div className="bench-rail-brand">
            <a href="#overview" className="bench-rail-home" onClick={(event) => { event.preventDefault(); go("overview"); }}>
              <ContextMark className="h-[0.95rem] w-auto" />
              <span className="bench-rail-wordmark">TRACE</span>
            </a>
            <button type="button" className="bench-rail-toggle" onClick={toggleRail} aria-label="Collapse or expand the section list" title="Collapse or expand ( [ )">
              <PanelLeft aria-hidden="true" className="bench-icon-collapse" />
              <PanelLeftOpen aria-hidden="true" className="bench-icon-expand" />
            </button>
          </div>
          <div className="bench-rail-sample">
            {sample}
            <div className="bench-rail-meta">
              <span>{meta}</span>
              <button type="button" onClick={onFilters}>
                <SlidersHorizontal aria-hidden="true" />
                Filters
              </button>
            </div>
          </div>
          <nav className="bench-rail-nav" aria-label="Sections">{nav("rail")}</nav>
          <div className="bench-rail-glance">{glance}</div>
          <div className="bench-rail-foot">
            <a href="https://github.com/context-dot-dev/trace-benchmark">Source on GitHub</a>
            <ThemeToggle className="size-8" />
          </div>
        </div>
      </aside>
      <div className="bench-pill-wrap">
        <div className="bench-pill">
          <button
            ref={pill}
            type="button"
            className="bench-pill-main"
            aria-haspopup="dialog"
            aria-expanded={sheet}
            onClick={() => setSheet(true)}
          >
            <svg viewBox="0 0 20 20" aria-hidden="true" className="bench-pill-progress">
              <circle cx="10" cy="10" r="8" />
              <circle cx="10" cy="10" r="8" style={{ strokeDasharray: `${progress * 50.27} 50.27` }} />
            </svg>
            <span className="bench-nav-number">{number(activeIndex)}</span>
            <span>{sections[activeIndex].label}</span>
            <span className="sr-only">. Open the section list</span>
          </button>
          <button type="button" className="bench-pill-date" onClick={() => setSheet(true)} aria-label={`Sample ${shortDate}. Change the sample`}>
            {shortDate}
            <ChevronUp aria-hidden="true" />
          </button>
        </div>
      </div>
      {sheet && (
        <div className="bench-sheet-layer">
          <button type="button" className="bench-sheet-scrim" aria-label="Close the section list" onClick={() => setSheet(false)} tabIndex={-1} />
          <div ref={sheetRef} className="bench-sheet" role="dialog" aria-modal="true" aria-label="Sections and sample">
            <div className="bench-sheet-head">
              <span className="bench-sheet-handle" aria-hidden="true" />
              <button type="button" className="bench-sheet-close" onClick={() => setSheet(false)} aria-label="Close">
                <X aria-hidden="true" />
              </button>
            </div>
            <div className="bench-sheet-sample">{sample}</div>
            <nav className="bench-sheet-nav" aria-label="Sections">{nav("sheet")}</nav>
            <div className="bench-rail-foot">
              <a href="https://github.com/context-dot-dev/trace-benchmark">Source on GitHub</a>
              <ThemeToggle className="size-9" />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
