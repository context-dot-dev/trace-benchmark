"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { PanelLeft, PanelLeftOpen, ChevronUp, CalendarDays, X, House, ChartNoAxesColumn, ArrowLeftRight, Shapes, Timer, FileCheck2, DollarSign, CircleAlert, Globe, History, Database, FlaskConical, Code2, CircleHelp, Quote, type LucideIcon } from "lucide-react";
import { ContextMark } from "@/components/trace/provider-logo";
import { ThemeToggle } from "@/components/trace/theme-toggle";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";

export type RailSection = { id: string; label: string; group?: string; icon: LucideIcon };

export const sections: RailSection[] = [
  { id: "overview", label: "Overview", group: "Results", icon: House },
  { id: "useful-content", label: "Leaderboard", icon: ChartNoAxesColumn },
  { id: "head-to-head", label: "Head-to-head", icon: ArrowLeftRight },
  { id: "categories", label: "Categories", icon: Shapes },
  { id: "latency", label: "Latency", icon: Timer },
  { id: "quality", label: "Quality", icon: FileCheck2 },
  { id: "cost", label: "Cost", icon: DollarSign },
  { id: "failures", label: "Failures", icon: CircleAlert },
  { id: "sites", label: "Sites", icon: Globe },
  { id: "history", label: "History", icon: History },
  { id: "sources", label: "Sample & sources", group: "Method", icon: Database },
  { id: "methodology", label: "Methodology", icon: FlaskConical },
  { id: "data", label: "Data & API", icon: Code2 },
  { id: "faq", label: "FAQ", icon: CircleHelp },
  { id: "citation", label: "Citation", icon: Quote },
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
  glance,
  shortDate,
}: {
  /** The sample date control. */
  sample: ReactNode;
  /** A compact, always-visible summary of the leaderboard. */
  glance: ReactNode;
  shortDate: string;
}) {
  const { active, progress } = useActiveSection();
  const [rail, setRail] = useState<"auto" | "expanded" | "collapsed">("auto");
  // "sample" opens the sheet with focus on the sample date control instead of the current section.
  const [sheet, setSheet] = useState<false | "sections" | "sample">(false);
  const pill = useRef<HTMLButtonElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const navRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const saved = localStorage.getItem(RAIL_KEY);
    // Restoring a saved preference after hydration avoids a server/client mismatch.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (saved === "expanded" || saved === "collapsed") setRail(saved);
  }, []);
  useEffect(() => {
    document.documentElement.dataset.rail = rail;
  }, [rail]);
  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const revealActive = () => {
      if (!nav.clientHeight || getComputedStyle(nav).overflowY !== "auto") return;
      const link = nav.querySelector<HTMLElement>("a[aria-current]");
      if (!link) return;
      const bounds = nav.getBoundingClientRect();
      const item = link.getBoundingClientRect();
      if (item.top < bounds.top) nav.scrollTop += item.top - bounds.top;
      else if (item.bottom > bounds.bottom) nav.scrollTop += item.bottom - bounds.bottom;
    };
    revealActive();
    const observer = new ResizeObserver(revealActive);
    observer.observe(nav);
    return () => observer.disconnect();
  }, [active, rail]);
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
    const start =
      sheet === "sample"
        ? panel?.querySelector<HTMLElement>(".bench-sheet-sample button")
        : panel?.querySelector<HTMLElement>("a[aria-current]") ?? panel?.querySelector<HTMLElement>("a");
    start?.focus();
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
            {items.map((s) => {
              const link = (
                <a
                  href={`#${s.id}`}
                  aria-label={s.label}
                  aria-current={active === s.id ? "location" : undefined}
                  onClick={(event) => {
                    event.preventDefault();
                    if (variant === "sheet") setSheet(false);
                    requestAnimationFrame(() => go(s.id));
                  }}
                >
                  {variant === "rail" && <s.icon className="bench-nav-icon" aria-hidden="true" strokeWidth={1.5} />}
                  <span className="bench-nav-number">{number(s.index)}</span>
                  <span className="bench-nav-text">{s.label}</span>
                  {variant === "rail" && <span className="bench-nav-dot" aria-hidden="true" />}
                </a>
              );
              return (
                <li key={s.id}>
                  {variant === "rail" ? (
                    <Tooltip>
                      <TooltipTrigger asChild>{link}</TooltipTrigger>
                      <TooltipContent side="right" className="bench-rail-tooltip">{s.label}</TooltipContent>
                    </Tooltip>
                  ) : link}
                </li>
              );
            })}
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
            <a href="#overview" className="bench-rail-home" aria-label="Scraping Bench overview" onClick={(event) => { event.preventDefault(); go("overview"); }}>
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
          </div>
          <nav ref={navRef} className="bench-rail-nav" aria-label="Sections">{nav("rail")}</nav>
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
            aria-expanded={Boolean(sheet)}
            onClick={() => setSheet("sections")}
          >
            <svg viewBox="0 0 20 20" aria-hidden="true" className="bench-pill-progress">
              <circle cx="10" cy="10" r="8" />
              <circle cx="10" cy="10" r="8" style={{ strokeDasharray: `${progress * 50.27} 50.27` }} />
            </svg>
            <span className="bench-nav-number">{number(activeIndex)}</span>
            <span className="bench-pill-label">{sections[activeIndex].label}</span>
            <span className="sr-only">. Open the section list</span>
            <ChevronUp aria-hidden="true" className="bench-pill-chevron" />
          </button>
          <button type="button" className="bench-pill-date" onClick={() => setSheet("sample")} aria-label={`Sample ${shortDate}. Change the sample`}>
            <CalendarDays aria-hidden="true" />
            {shortDate}
          </button>
        </div>
      </div>
      {sheet && (
        <div className="bench-sheet-layer">
          <button type="button" className="bench-sheet-scrim" aria-label="Close the section list" onClick={() => setSheet(false)} tabIndex={-1} />
          <div ref={sheetRef} className="bench-sheet" role="dialog" aria-modal="true" aria-label="Sections and sample">
            <div className="bench-sheet-head">
              <span className="bench-sheet-title" aria-hidden="true">Sections</span>
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
