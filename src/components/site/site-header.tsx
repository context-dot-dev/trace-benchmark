"use client";

import * as React from "react";
import { ArrowRight, ChevronDown } from "lucide-react";

import { AnnouncementBar } from "@/components/site/announcement-bar";
import { cn } from "@/lib/utils";

type NavLink = { label: string; href: string; external?: boolean };
type NavMenuItem = {
  title: React.ReactNode;
  description?: React.ReactNode;
  href: string;
  icon?: React.ReactNode;
  glyph?: React.ReactNode;
  external?: boolean;
};
type NavMobileGroup = { label?: React.ReactNode; links: { label: React.ReactNode; href: string; external?: boolean }[] };
type NavMenu = {
  label: string;
  width?: string;
  current?: boolean;
  panel?: React.ReactNode;
  items?: NavMenuItem[];
  featured?: React.ReactNode;
  footer?: React.ReactNode;
  mobile?: NavMobileGroup[];
};
type NavItem = NavLink | NavMenu;
type HeaderAction = { label: React.ReactNode; href: string; external?: boolean };

const isMenu = (item: NavItem): item is NavMenu => !("href" in item);

const DESKTOP_QUERY = "(min-width: 880px)";
const CLOSE_DELAY_MS = 150;
const SWIPE_MIN_DISTANCE_PX = 48;
const SWIPE_MAX_DURATION_MS = 600;
const WHEEL_STEP_DELTA_PX = 60;
const WHEEL_STEP_COOLDOWN_MS = 450;
const WHEEL_GESTURE_GAP_MS = 120;

const FOCUS = "outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring";
const NAV_LINK = cn(
  "flex cursor-pointer items-center gap-1 whitespace-nowrap rounded-pill px-2 py-2 text-body-sm leading-5 font-medium transition-colors duration-150 ease-out motion-reduce:transition-none min-[1280px]:px-3.5",
  FOCUS,
);
const PILL = "inline-flex w-fit items-center justify-center whitespace-nowrap rounded-pill border font-normal transition-colors duration-200 ease-out motion-reduce:transition-none";
const BLACK_PILL = cn(PILL, "border-primary bg-primary text-on-primary hover:bg-neutral-80", FOCUS);
const OUTLINE_PILL = cn(PILL, "border-brand bg-surface text-fg-brand hover:bg-tint", FOCUS);


type Box = { x: number; y: number; width: number; height: number };

function boxWithin(item: HTMLElement, container: HTMLElement): Box {
  let x = 0;
  let y = 0;
  let node: HTMLElement | null = item;
  while (node && node !== container) {
    x += node.offsetLeft;
    y += node.offsetTop;
    node = node.offsetParent instanceof HTMLElement ? node.offsetParent : null;
  }
  return { x, y, width: item.offsetWidth, height: item.offsetHeight };
}

function GlideHover({ className, highlightClassName, style, children }: { className?: string; highlightClassName?: string; style?: React.CSSProperties; children: React.ReactNode }) {
  const ref = React.useRef<HTMLDivElement>(null);
  const hovered = React.useRef<HTMLElement | null>(null);
  const [box, setBox] = React.useState<Box | null>(null);
  const [visible, setVisible] = React.useState(false);
  const [gliding, setGliding] = React.useState(false);

  return (
    <div
      ref={ref}
      className={cn("relative isolate", className)}
      style={style}
      onPointerOver={(event) => {
        const container = ref.current;
        if (event.pointerType !== "mouse" || !container || !(event.target instanceof Element)) return;
        const item = event.target.closest("[data-glide-item]");
        if (!(item instanceof HTMLElement) || !container.contains(item) || hovered.current === item) return;
        hovered.current = item;
        setBox(boxWithin(item, container));
        setGliding(visible);
        setVisible(true);
      }}
      onPointerLeave={() => {
        hovered.current = null;
        setVisible(false);
      }}
    >
      {box && (
        <span
          aria-hidden="true"
          className={cn(
            "pointer-events-none absolute top-0 left-0 -z-10 motion-reduce:transition-none",
            gliding ? "transition-[translate,width,height,opacity] duration-200 ease-out" : "transition-opacity duration-150 ease-out",
            highlightClassName,
          )}
          style={{ width: box.width, height: box.height, translate: `${box.x}px ${box.y}px`, opacity: visible ? 1 : 0 }}
        />
      )}
      {children}
    </div>
  );
}


function linkTarget(external?: boolean) {
  return external ? { target: "_blank", rel: "noopener noreferrer" } : {};
}

function NavBlueFrame({ backdrop, className, children }: { backdrop?: React.ReactNode; className?: string; children?: React.ReactNode }) {
  return (
    <div className={cn("relative isolate overflow-hidden rounded-card bg-brand", className)}>
      {backdrop && (
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10">
          {backdrop}
        </div>
      )}
      {children}
    </div>
  );
}

function NavFeaturedCard({
  title,
  description,
  cta,
  href,
  backdrop,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  cta?: React.ReactNode;
  href: string;
  backdrop?: React.ReactNode;
  className?: string;
}) {
  return (
    <a href={href} className={cn("group/featured flex w-68 shrink-0 rounded-card", FOCUS, className)}>
      <NavBlueFrame backdrop={backdrop} className="flex w-full flex-col justify-end p-5 text-on-brand">
        <span className="relative flex flex-col gap-2">
          <span className="text-h4 leading-7.5 tracking-tight">{title}</span>
          {description && <span className="text-body-sm text-white/85">{description}</span>}
          {cta && (
            <span className="flex items-center gap-1.5 pt-1.5 text-body-sm font-medium">
              {cta}
              <ArrowRight aria-hidden="true" className="size-3.5" />
            </span>
          )}
        </span>
      </NavBlueFrame>
    </a>
  );
}

function NavMenuLink({ item }: { item: NavMenuItem }) {
  return (
    <a href={item.href} {...linkTarget(item.external)} data-glide-item="" className={cn("flex items-start gap-3 rounded-card p-3", FOCUS)}>
      {item.glyph ?? (item.icon && <span className="flex size-9 shrink-0 items-center justify-center rounded-control bg-brand text-on-brand [&>svg]:size-4">{item.icon}</span>)}
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-body font-medium text-fg">{item.title}</span>
        {item.description && <span className="text-body-sm text-fg-nav">{item.description}</span>}
      </span>
    </a>
  );
}

function NavLinksPanel({ items, featured, footer, rows = 3 }: { items: NavMenuItem[]; featured?: React.ReactNode; footer?: React.ReactNode; rows?: number }) {
  return (
    <div className="flex flex-col">
      <div className="flex gap-2 p-3">
        {featured}
        <GlideHover className="grid min-w-0 flex-1 grid-flow-col grid-cols-2 gap-0.5" style={{ gridTemplateRows: `repeat(${rows}, auto)` }} highlightClassName="rounded-card bg-wash-hover">
          {items.map((item) => (
            <NavMenuLink key={item.href} item={item} />
          ))}
        </GlideHover>
      </div>
      {footer && <div className="flex items-center gap-4 border-t border-wash-pill bg-subtle px-5 py-3 text-body-sm">{footer}</div>}
    </div>
  );
}

function NavFooterLink({ href, external, children }: { href: string; external?: boolean; children: React.ReactNode }) {
  return (
    <a href={href} {...linkTarget(external)} className={cn("rounded-sm font-medium text-fg transition-colors duration-150 ease-out hover:text-fg-brand motion-reduce:transition-none", FOCUS)}>
      {children}
    </a>
  );
}

type NavPreviewItem = {
  id: string;
  title: React.ReactNode;
  href: string;
  icon?: React.ReactNode;
  summary?: React.ReactNode;
  proof?: React.ReactNode;
  preview?: React.ReactNode;
};

function NavPreviewPanel({
  items,
  footerLink,
  backdrop,
  ctaLabel = "Explore",
}: {
  items: NavPreviewItem[];
  footerLink?: { label: React.ReactNode; href: string };
  backdrop?: React.ReactNode;
  ctaLabel?: React.ReactNode;
}) {
  const [activeId, setActiveId] = React.useState<string>();
  const active = items.find((item) => item.id === activeId) ?? items[0];
  if (!active) return null;
  return (
    <div className="flex gap-2.5 p-2.5">
      <div className="flex w-68 shrink-0 flex-col py-1">
        <ul className="flex flex-col gap-0.5">
          {items.map((item) => {
            const isActive = item.id === active.id;
            return (
              <li key={item.id}>
                <a
                  href={item.href}
                  onPointerEnter={() => setActiveId(item.id)}
                  onFocus={() => setActiveId(item.id)}
                  className={cn(
                    "flex items-center gap-3 rounded-card px-3 py-2 text-body font-medium transition-colors duration-150 ease-out motion-reduce:transition-none",
                    isActive ? "bg-tint text-fg-brand" : "text-fg",
                    FOCUS,
                  )}
                >
                  {item.icon && <span className="flex size-8 shrink-0 items-center justify-center">{item.icon}</span>}
                  <span className="flex-1">{item.title}</span>
                  {isActive && <ArrowRight aria-hidden="true" className="size-3.5 shrink-0" />}
                </a>
              </li>
            );
          })}
        </ul>
        {footerLink && (
          <>
            <hr className="mx-3 my-1 h-px border-0 bg-wash-pill" />
            <a
              href={footerLink.href}
              className={cn("group/more flex items-center gap-2 rounded-card px-3 py-2 text-body-sm text-fg-nav transition-colors duration-150 ease-out hover:text-fg motion-reduce:transition-none", FOCUS)}
            >
              {footerLink.label}
              <ArrowRight aria-hidden="true" className="size-3" />
            </a>
          </>
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-4 rounded-card bg-subtle p-2.5">
        <NavBlueFrame backdrop={backdrop} className="flex h-52 items-center justify-center p-3">
          <div aria-hidden="true" key={active.id} className="relative h-full w-full max-w-96 overflow-hidden rounded-card bg-surface">
            {active.preview}
          </div>
        </NavBlueFrame>
        <div className="flex items-end justify-between gap-4 px-1.5 pb-1.5">
          <div className="flex min-w-0 flex-col gap-1">
            <p className="text-h5 leading-snug tracking-tight text-fg">{active.title}</p>
            {(active.summary || active.proof) && (
              <p className="text-body-sm text-fg-nav">
                {active.summary}
                {active.summary && active.proof && <br />}
                {active.proof}
              </p>
            )}
          </div>
          <a href={active.href} className={cn(BLACK_PILL, "shrink-0 gap-1.5 px-4 py-2 text-body-sm")}>
            {ctaLabel}
            <ArrowRight aria-hidden="true" className="size-3" />
          </a>
        </div>
      </div>
    </div>
  );
}

type NavStory = { name: React.ReactNode; summary?: React.ReactNode; href: string; visual?: React.ReactNode };

function NavStoriesPanel({
  title = "Featured stories",
  viewAll,
  stories,
  readLabel = "Read their story",
}: {
  title?: React.ReactNode;
  viewAll?: { label: React.ReactNode; href: string };
  stories: NavStory[];
  readLabel?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex items-baseline justify-between gap-4">
        <p className="text-body-lg text-fg">{title}</p>
        {viewAll && (
          <a href={viewAll.href} className={cn(OUTLINE_PILL, "px-4 py-1.5 text-body-sm leading-5")}>
            {viewAll.label}
          </a>
        )}
      </div>
      <GlideHover className="-mx-3 flex items-start" highlightClassName="rounded-card bg-wash-hover">
        {stories.map((story) => (
          <a key={story.href} href={story.href} data-glide-item="" className={cn("group/story flex min-w-0 flex-1 flex-col gap-3 rounded-card p-3", FOCUS)}>
            <div className="relative h-28 w-full overflow-hidden rounded-card bg-brand">{story.visual}</div>
            <div className="flex flex-col gap-1">
              <p className="line-clamp-1 text-body-lg text-fg">{story.name}</p>
              {story.summary && <p className="line-clamp-2 text-body-sm text-fg-nav">{story.summary}</p>}
            </div>
            <span className="inline-flex items-center gap-1.5 text-body-sm text-fg-brand">
              {readLabel}
              <ArrowRight aria-hidden="true" className="size-3.5" />
            </span>
          </a>
        ))}
      </GlideHover>
    </div>
  );
}


type DropdownState = { active: string | null; last: string | null; isSwitch: boolean };

function menuPanel(menu: NavMenu) {
  return menu.panel ?? <NavLinksPanel items={menu.items ?? []} featured={menu.featured} footer={menu.footer} />;
}

function DesktopNav({
  items,
  currentPath,
  state,
  openMenu,
  scheduleClose,
  cancelClose,
  surface,
}: {
  items: NavItem[];
  currentPath?: string;
  state: DropdownState;
  openMenu: (label: string | null) => void;
  scheduleClose: () => void;
  cancelClose: () => void;
  surface: "white" | "brand";
}) {
  const id = React.useId();
  const menus = items.filter(isMenu);
  const order = React.useMemo(() => items.filter(isMenu).map((menu) => menu.label), [items]);
  const shown = state.active ?? state.last ?? order[0];
  const panelRefs = React.useRef<Record<string, HTMLDivElement | null>>({});
  const [sizes, setSizes] = React.useState<Record<string, { width: number; height: number }>>({});
  const rootRef = React.useRef<HTMLElement>(null);
  const touchStart = React.useRef<{ x: number; y: number; time: number } | null>(null);
  const triggerId = React.useCallback((label: string) => `${id}-trigger-${order.indexOf(label)}`, [id, order]);
  const panelId = (label: string) => `${id}-panel-${order.indexOf(label)}`;

  React.useEffect(() => {
    const measure = () =>
      setSizes((previous) => {
        let changed = false;
        const next = { ...previous };
        for (const label of order) {
          const element = panelRefs.current[label];
          if (!element) continue;
          const size = { width: element.offsetWidth, height: element.offsetHeight };
          if (next[label]?.width !== size.width || next[label]?.height !== size.height) {
            next[label] = size;
            changed = true;
          }
        }
        return changed ? next : previous;
      });
    const observer = new ResizeObserver(measure);
    for (const label of order) {
      const element = panelRefs.current[label];
      if (element) observer.observe(element);
    }
    return () => observer.disconnect();
  }, [order]);

  const stepMenu = React.useCallback(
    (direction: 1 | -1) => {
      if (!window.matchMedia(DESKTOP_QUERY).matches || order.length === 0) return;
      if (!state.active) {
        openMenu(direction === 1 ? order[0] : order[order.length - 1]);
        return;
      }
      const next = order[order.indexOf(state.active) + direction];
      if (next) openMenu(next);
    },
    [order, state.active, openMenu],
  );
  const stepRef = React.useRef(stepMenu);
  React.useEffect(() => {
    stepRef.current = stepMenu;
  }, [stepMenu]);

  React.useEffect(() => {
    const element = rootRef.current?.closest<HTMLElement>("[data-slot=site-header-row]");
    if (!element) return;
    let accumulated = 0;
    let lastEventAt = 0;
    let cooldownUntil = 0;
    const onWheel = (event: WheelEvent) => {
      if (Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return;
      event.preventDefault();
      const now = performance.now();
      if (now - lastEventAt > WHEEL_GESTURE_GAP_MS) accumulated = 0;
      lastEventAt = now;
      if (now < cooldownUntil) return;
      accumulated += event.deltaX * (event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : 1);
      if (Math.abs(accumulated) >= WHEEL_STEP_DELTA_PX) {
        stepRef.current(accumulated > 0 ? 1 : -1);
        accumulated = 0;
        cooldownUntil = now + WHEEL_STEP_COOLDOWN_MS;
      }
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, []);

  React.useEffect(() => {
    if (!state.active) return;
    const active = state.active;
    const row = rootRef.current?.closest<HTMLElement>("[data-slot=site-header-row]");
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !row?.contains(event.target)) openMenu(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      document.getElementById(triggerId(active))?.focus({ preventScroll: true });
      openMenu(null);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [state.active, openMenu, triggerId]);

  const offset = order.slice(0, Math.max(0, order.indexOf(shown))).reduce((sum, label) => sum + (sizes[label]?.width ?? 0), 0);
  const size = sizes[shown];
  const morph = state.isSwitch ? "duration-300 ease-out" : "duration-0";

  return (
    <nav
      ref={rootRef}
      aria-label="Primary"
      className="relative hidden items-center justify-self-center min-[880px]:flex"
      onTouchStart={(event) => {
        const touch = event.touches[0];
        touchStart.current = { x: touch.clientX, y: touch.clientY, time: performance.now() };
      }}
      onTouchEnd={(event) => {
        const start = touchStart.current;
        touchStart.current = null;
        if (!start) return;
        const touch = event.changedTouches[0];
        const dx = touch.clientX - start.x;
        const dy = touch.clientY - start.y;
        if (performance.now() - start.time > SWIPE_MAX_DURATION_MS) return;
        if (Math.abs(dx) < SWIPE_MIN_DISTANCE_PX || Math.abs(dx) < Math.abs(dy) * 1.5) return;
        stepMenu(dx < 0 ? 1 : -1);
      }}
      onTouchCancel={() => (touchStart.current = null)}
    >
      <GlideHover className="flex items-center gap-0.5 min-[1280px]:gap-1" highlightClassName="rounded-pill bg-subtle">
        {items.map((item) => {
          if (isMenu(item)) {
            const isOpen = state.active === item.label;
            return (
              <button
                key={item.label}
                id={triggerId(item.label)}
                type="button"
                data-glide-item=""
                className={cn(NAV_LINK, isOpen || item.current ? "text-fg" : "text-fg-nav hover:text-fg-brand")}
                aria-expanded={isOpen}
                aria-controls={panelId(item.label)}
                onPointerEnter={(event) => event.pointerType === "mouse" && openMenu(item.label)}
                onPointerLeave={(event) => event.pointerType === "mouse" && scheduleClose()}
                onClick={() => openMenu(isOpen ? null : item.label)}
                onKeyDown={(event) => {
                  if (event.key !== "ArrowDown") return;
                  event.preventDefault();
                  openMenu(item.label);
                  requestAnimationFrame(() => document.getElementById(panelId(item.label))?.querySelector("a")?.focus());
                }}
              >
                {item.label}
                <ChevronDown aria-hidden="true" className={cn("size-4 transition-transform duration-200 ease-out motion-reduce:transition-none", isOpen && "rotate-180")} />
              </button>
            );
          }
          const isCurrent = currentPath !== undefined && (item.href === "/" ? currentPath === "/" : currentPath.startsWith(item.href));
          return (
            <a
              key={item.label}
              href={item.href}
              {...linkTarget(item.external)}
              aria-current={isCurrent ? "page" : undefined}
              data-glide-item=""
              className={cn(NAV_LINK, isCurrent ? "text-fg" : "text-fg-nav hover:text-fg-brand")}
              onPointerEnter={() => openMenu(null)}
              onFocus={() => openMenu(null)}
            >
              {item.label}
            </a>
          );
        })}
      </GlideHover>

      {menus.length > 0 && (
        <>
          <div aria-hidden="true" className={cn("absolute inset-x-0 top-full h-5", !state.active && "pointer-events-none")} />

          <div
            data-slot="site-header-dropdown"
            aria-hidden={!state.active}
            inert={!state.active || undefined}
            onPointerEnter={cancelClose}
            onPointerLeave={(event) => event.pointerType === "mouse" && scheduleClose()}
            className={cn(
              "absolute top-[calc(100%+var(--ds-space-5))] left-1/2 isolate z-1000 origin-top -translate-x-1/2 rounded-card p-1.5 leading-snug shadow-floating transition-[opacity,translate,scale] duration-300 ease-out motion-reduce:transition-none",
              surface === "brand" ? "bg-ring-on-brand" : "bg-ring-tint",
              state.active ? "translate-y-0 scale-100 opacity-100" : "pointer-events-none -translate-y-2 scale-95 opacity-0",
            )}
          >
            <div
              className={cn("overflow-hidden rounded-card bg-surface transition-[width,height] motion-reduce:transition-none", morph)}
              style={size ? { width: size.width, height: size.height } : undefined}
            >
              <div className={cn("flex w-max items-start transition-transform motion-reduce:transition-none", morph)} style={{ transform: `translateX(${-offset}px)` }}>
                {menus.map((menu) => (
                  <div
                    key={menu.label}
                    id={panelId(menu.label)}
                    role="region"
                    aria-labelledby={triggerId(menu.label)}
                    ref={(element) => {
                      panelRefs.current[menu.label] = element;
                    }}
                    className="shrink-0"
                    style={{ width: menu.width ?? "max-content" }}
                    aria-hidden={shown !== menu.label}
                    inert={shown !== menu.label || undefined}
                  >
                    {menuPanel(menu)}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      )}
    </nav>
  );
}


function MobileMenuToggle({ open, onClick, controls }: { open: boolean; onClick: () => void; controls: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={open ? "Close menu" : "Open menu"}
      aria-expanded={open}
      aria-controls={open ? controls : undefined}
      data-slot="site-header-menu-toggle"
      className={cn("group/toggle flex size-11 items-center justify-center rounded-pill text-fg transition-colors duration-150 ease-out [@media(hover:hover)]:hover:bg-subtle", FOCUS)}
    >
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="size-6 overflow-visible">
        <path
          d="M4 8H20"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          className="origin-center transition-[translate,rotate] duration-250 ease-out [transform-box:fill-box] group-aria-expanded/toggle:translate-y-1 group-aria-expanded/toggle:rotate-45 motion-reduce:transition-none"
        />
        <path
          d="M4 16H20"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          className="origin-center transition-[translate,rotate] duration-250 ease-out [transform-box:fill-box] group-aria-expanded/toggle:-translate-y-1 group-aria-expanded/toggle:-rotate-45 motion-reduce:transition-none"
        />
      </svg>
    </button>
  );
}

const MOBILE_ROW =
  "flex min-h-13 w-full cursor-pointer items-center justify-between gap-3 rounded-card px-3 py-2 text-left text-h4 leading-snug font-normal transition-colors duration-150 ease-out motion-reduce:transition-none [@media(hover:hover)]:hover:bg-subtle";
const MOBILE_SUBLINK =
  "block rounded-card px-3 py-1.5 text-body-lg font-normal text-fg-nav transition-colors duration-150 ease-out motion-reduce:transition-none [@media(hover:hover)]:hover:bg-subtle [@media(hover:hover)]:hover:text-fg";
const MOBILE_ACTION =
  "flex min-h-12 items-center justify-center whitespace-nowrap rounded-pill border px-4 py-2 text-body leading-5 font-medium transition-colors duration-150 ease-out motion-reduce:transition-none";
const MOBILE_RAILS =
  "bg-surface bg-[linear-gradient(var(--ds-color-border-rule),var(--ds-color-border-rule)),linear-gradient(var(--ds-color-border-rule),var(--ds-color-border-rule))] bg-size-[1px_100%] bg-position-[var(--ds-space-3)_0,calc(100%-var(--ds-space-3))_0] bg-no-repeat shadow-[inset_0_1px_0_var(--ds-color-border-rule)]";

const EASE_OUT = "cubic-bezier(0.22, 1, 0.36, 1)";
function reveal(element: HTMLElement | null, rows: HTMLElement[]) {
  if (!element || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  element.animate([{ clipPath: "inset(0 0 100% 0)" }, { clipPath: "inset(0 0 0 0)" }], { duration: 300, easing: EASE_OUT });
  rows.forEach((row, index) =>
    row.animate([{ opacity: 0, translate: "0 10px" }, { opacity: 1, translate: "0 0" }], { duration: 300, easing: EASE_OUT, delay: 80 + index * 45, fill: "backwards" }),
  );
}

function MobileSection({ label, open, onToggle, groups }: { label: string; open: boolean; onToggle: () => void; groups: NavMobileGroup[] }) {
  const contentRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (!open || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    for (const child of Array.from(contentRef.current?.children ?? [])) {
      (child as HTMLElement).animate([{ opacity: 0, translate: "0 10px" }, { opacity: 1, translate: "0 0" }], { duration: 300, easing: EASE_OUT, delay: 60, fill: "backwards" });
    }
  }, [open]);
  return (
    <div data-mobile-row="" data-open={open || undefined} className="group/section">
      <button type="button" aria-expanded={open} onClick={onToggle} className={cn(MOBILE_ROW, FOCUS, open && "text-fg-brand")}>
        {label}
        <ChevronDown
          aria-hidden="true"
          className={cn("size-5 shrink-0 text-fg-nav transition-[rotate,color] duration-250 ease-out motion-reduce:transition-none", open && "rotate-180 text-fg-brand")}
        />
      </button>
      <div className={cn("grid transition-[grid-template-rows] duration-300 ease-out motion-reduce:transition-none", open ? "grid-rows-[1fr]" : "grid-rows-[0fr]")} inert={!open || undefined}>
        <div className="overflow-hidden">
          <div ref={contentRef} className="pt-1 pb-4">
            {groups.map((group) => (
              <div key={group.links.map((link) => link.href).join("|")} className="not-first:mt-5">
                {group.label && <p className="mx-3 mb-1 text-caption font-medium text-fg-nav">{group.label}</p>}
                {group.links.map((link) => (
                  <a key={link.href} href={link.href} {...linkTarget(link.external)} className={cn(MOBILE_SUBLINK, FOCUS)}>
                    {link.label}
                  </a>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function MobileNavigation({
  id,
  items,
  primaryAction,
  mobileSecondaryAction,
  headerRef,
  onClose,
}: {
  id: string;
  items: NavItem[];
  primaryAction?: HeaderAction;
  mobileSecondaryAction?: HeaderAction;
  headerRef: React.RefObject<HTMLElement | null>;
  onClose: () => void;
}) {
  const menuRef = React.useRef<HTMLElement>(null);
  const [openSection, setOpenSection] = React.useState<string | null>(null);
  const close = React.useEffectEvent(onClose);

  React.useLayoutEffect(() => {
    const menu = menuRef.current;
    const header = headerRef.current;
    const trigger = header?.querySelector<HTMLButtonElement>("[data-slot=site-header-menu-toggle]");
    if (!menu || !header || !trigger) return;

    reveal(menu, Array.from(menu.querySelectorAll<HTMLElement>("[data-mobile-row]")));

    const previousOverflow = document.body.style.overflow;
    const previousRootOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = "clip";
    const updateTop = () => menu.style.setProperty("--mobile-nav-top", `${header.getBoundingClientRect().bottom}px`);
    updateTop();
    const observer = new ResizeObserver(updateTop);
    observer.observe(header);
    const desktop = window.matchMedia(DESKTOP_QUERY);
    const closeOnDesktop = () => (desktop.matches ? close() : updateTop());

    const background: { element: HTMLElement; inert: boolean }[] = [];
    let current: HTMLElement = header;
    while (current.parentElement) {
      for (const sibling of Array.from(current.parentElement.children)) {
        if (sibling instanceof HTMLElement && sibling !== current) {
          background.push({ element: sibling, inert: sibling.inert });
          sibling.inert = true;
        }
      }
      current = current.parentElement;
      if (current === document.body) break;
    }
    trigger.focus({ preventScroll: true });

    const closeOnNavigation = (event: MouseEvent) => {
      if (event.target instanceof Element && event.target.closest("a[href]")) close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(header.querySelectorAll<HTMLElement>("a[href], button:not([disabled]), [tabindex='0']")).filter(
        (element) => element.getClientRects().length > 0 && element.getBoundingClientRect().top >= 0 && !element.closest("[inert]"),
      );
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!header.contains(document.activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first)?.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    header.addEventListener("click", closeOnNavigation);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", closeOnDesktop);
    desktop.addEventListener("change", closeOnDesktop);
    return () => {
      observer.disconnect();
      header.removeEventListener("click", closeOnNavigation);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", closeOnDesktop);
      desktop.removeEventListener("change", closeOnDesktop);
      document.body.style.overflow = previousOverflow;
      document.documentElement.style.overflow = previousRootOverflow;
      for (const { element, inert } of background) element.inert = inert;
      if (trigger.isConnected && !desktop.matches) trigger.focus({ preventScroll: true });
    };
  }, [headerRef]);

  return (
    <nav
      ref={menuRef}
      id={id}
      aria-label="Mobile navigation"
      className={cn(
        "absolute inset-x-0 top-full flex h-[calc(100dvh-var(--mobile-nav-top))] flex-col overflow-y-auto overscroll-contain px-6 pt-4 pb-[max(var(--ds-space-6),env(safe-area-inset-bottom))] text-fg [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        MOBILE_RAILS,
      )}
    >
      <div className="-mx-3">
        {items.map((item) => {
          if (isMenu(item)) {
            const groups = item.mobile ?? [{ links: (item.items ?? []).map((sub) => ({ label: sub.title, href: sub.href, external: sub.external })) }];
            return (
              <MobileSection
                key={item.label}
                label={item.label}
                open={openSection === item.label}
                onToggle={() => setOpenSection((open) => (open === item.label ? null : item.label))}
                groups={groups}
              />
            );
          }
          return (
            <a key={item.label} data-mobile-row="" href={item.href} {...linkTarget(item.external)} className={cn(MOBILE_ROW, FOCUS)}>
              {item.label}
            </a>
          );
        })}
      </div>
      {(mobileSecondaryAction || primaryAction) && (
        <div data-mobile-row="" className="-mx-6 mt-auto grid grid-cols-2 gap-3 border-y border-rule px-6 py-4">
          {mobileSecondaryAction && (
            <a href={mobileSecondaryAction.href} {...linkTarget(mobileSecondaryAction.external)} className={cn(MOBILE_ACTION, "border-line text-fg [@media(hover:hover)]:hover:bg-subtle", FOCUS)}>
              {mobileSecondaryAction.label}
            </a>
          )}
          {primaryAction && (
            <a
              href={primaryAction.href}
              {...linkTarget(primaryAction.external)}
              className={cn(MOBILE_ACTION, "border-primary bg-primary text-on-primary [@media(hover:hover)]:hover:border-neutral-90 [@media(hover:hover)]:hover:bg-neutral-90", FOCUS)}
            >
              {primaryAction.label}
            </a>
          )}
        </div>
      )}
    </nav>
  );
}


function SiteHeader({
  logo,
  wordmark,
  logoHref = "/",
  logoLabel = "Home",
  announcement,
  items = [],
  primaryAction,
  secondaryAction,
  mobileSecondaryAction,
  endAction,
  currentPath,
  surface = "white",
  className,
}: {
  logo: React.ReactNode;
  wordmark?: React.ReactNode;
  logoHref?: string;
  logoLabel?: string;
  announcement?: { text: React.ReactNode; href?: string; external?: boolean };
  items?: NavItem[];
  primaryAction?: HeaderAction;
  secondaryAction?: HeaderAction;
  mobileSecondaryAction?: HeaderAction;
  endAction?: React.ReactNode;
  currentPath?: string;
  surface?: "white" | "brand";
  className?: string;
}) {
  const headerRef = React.useRef<HTMLElement>(null);
  const menuId = React.useId();
  const [state, setState] = React.useState<DropdownState>({ active: null, last: null, isSwitch: false });
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const closeTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelClose = React.useCallback(() => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = null;
  }, []);
  const openMenu = React.useCallback(
    (label: string | null) => {
      cancelClose();
      setState((current) => (current.active === label ? current : { active: label, last: label ?? current.last, isSwitch: current.active !== null && label !== null }));
    },
    [cancelClose],
  );
  const scheduleClose = React.useCallback(() => {
    cancelClose();
    closeTimer.current = setTimeout(() => {
      setState((current) => ({ ...current, active: null, isSwitch: false }));
      closeTimer.current = null;
    }, CLOSE_DELAY_MS);
  }, [cancelClose]);
  React.useEffect(() => cancelClose, [cancelClose]);
  const closeMobile = React.useCallback(() => setMobileOpen(false), []);

  React.useEffect(() => {
    const header = headerRef.current;
    if (!header) return;
    const sync = () => {
      const scrolled = String(window.scrollY > 0);
      if (header.dataset.scrolled !== scrolled) header.dataset.scrolled = scrolled;
    };
    sync();
    window.addEventListener("scroll", sync, { passive: true });
    return () => window.removeEventListener("scroll", sync);
  }, []);

  return (
    <>
      {announcement && (
        <AnnouncementBar href={announcement.href} external={announcement.external}>
          {announcement.text}
        </AnnouncementBar>
      )}
      <header
        ref={headerRef}
        data-slot="site-header"
        data-scrolled="false"
        data-menu-open={mobileOpen}
        role={mobileOpen ? "dialog" : "banner"}
        aria-modal={mobileOpen || undefined}
        aria-label={mobileOpen ? "Navigation menu" : "Main navigation"}
        className={cn(
          "group/header sticky top-0 isolate z-1000 h-16 w-full min-[880px]:h-18",
          "[--header-card:min(100%-var(--ds-space-4),var(--ds-layout-column-wide))] md:[--header-card:min(100%-var(--ds-space-4),var(--ds-layout-column-wide),var(--ds-frame-column)-var(--ds-space-6))] min-[880px]:[--header-card:min(100%-var(--ds-space-6),var(--ds-layout-column-wide),var(--ds-frame-column)-var(--ds-space-6))]",
          "[--header-content:calc(var(--header-card)-var(--ds-space-6)-var(--ds-space-0-5))] data-[menu-open=true]:[--header-content:calc(var(--header-card)-var(--ds-space-8)-var(--ds-space-0-5))] min-[880px]:[--header-content:calc(var(--header-card)-var(--ds-space-7))]",
          "min-[880px]:data-[scrolled=true]:top-1.5",
          mobileOpen && MOBILE_RAILS,
          className,
        )}
      >
        <div
          aria-hidden="true"
          data-slot="site-header-card"
          className={cn(
            "pointer-events-none absolute inset-y-1.5 left-1/2 -z-10 w-(--header-card) -translate-x-1/2 rounded-card backdrop-blur-lg min-[880px]:inset-y-0.5",
            "transition-[width,inset-block,border-radius,background-color,backdrop-filter,opacity,box-shadow] ease-out [transition-duration:500ms,500ms,500ms,500ms,500ms,500ms,200ms] motion-reduce:transition-none",
            surface === "brand" ? "bg-ring-on-brand" : "bg-ring-tint",
            "group-data-[scrolled=true]/header:rounded-[var(--ds-space-12)] group-data-[scrolled=true]/header:shadow-floating",
            "group-data-[scrolled=false]/header:inset-y-0 group-data-[scrolled=false]/header:w-full group-data-[scrolled=false]/header:rounded-none group-data-[scrolled=false]/header:bg-transparent group-data-[scrolled=false]/header:backdrop-blur-[0px]",
            "group-data-[menu-open=true]/header:opacity-0",
          )}
        >
          <div
            className={cn(
              "absolute inset-[calc(var(--ds-space-1)+var(--ds-space-px))] rounded-card bg-surface transition-[inset,border-radius,background-color] duration-500 ease-out motion-reduce:transition-none min-[880px]:inset-1.5",
              "group-data-[scrolled=true]/header:rounded-[var(--ds-space-12)]",
              "group-data-[scrolled=false]/header:inset-0 group-data-[scrolled=false]/header:rounded-none group-data-[scrolled=false]/header:bg-transparent",
            )}
          />
        </div>

        <div data-slot="site-header-row" className="flex h-full w-full items-center justify-center" onMouseLeave={scheduleClose}>
          <div className="relative z-10 mx-auto grid w-(--header-content) grid-cols-[1fr_auto] items-center gap-3 min-[880px]:grid-cols-[auto_minmax(0,1fr)_auto] min-[1280px]:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
            <div className={cn("justify-self-start", !mobileOpen && "pl-3.5")}>
              <a href={logoHref} aria-label={logoLabel} className={cn("flex items-center gap-2 rounded-card", FOCUS)}>
                {logo}
                {wordmark && <span className="block text-h5 leading-9 font-medium text-fg min-[880px]:hidden min-[1200px]:block">{wordmark}</span>}
              </a>
            </div>

            <DesktopNav items={items} currentPath={currentPath} state={state} openMenu={openMenu} scheduleClose={scheduleClose} cancelClose={cancelClose} surface={surface} />

            <div className="hidden items-center gap-2 justify-self-end min-[880px]:flex">
              {endAction}
              {secondaryAction && (
                <a
                  href={secondaryAction.href}
                  {...linkTarget(secondaryAction.external)}
                  className={cn(
                    "flex h-10.5 items-center justify-center whitespace-nowrap rounded-pill border border-black/12 bg-surface px-3 text-body-sm leading-5 font-normal text-fg shadow-[0_1px_2px_var(--ds-color-wash-pill)] transition-colors duration-150 ease-out motion-reduce:transition-none [@media(hover:hover)]:hover:bg-frame min-[1280px]:px-5",
                    FOCUS,
                  )}
                >
                  {secondaryAction.label}
                </a>
              )}
              {primaryAction && (
                <a
                  href={primaryAction.href}
                  {...linkTarget(primaryAction.external)}
                  className={cn(
                    "flex h-10.5 items-center justify-center whitespace-nowrap rounded-pill border border-primary bg-neutral-90 px-3 text-body-sm leading-5 font-normal text-on-primary shadow-key transition-colors duration-150 ease-out motion-reduce:transition-none [@media(hover:hover)]:hover:bg-neutral-80 min-[1280px]:px-5",
                    FOCUS,
                  )}
                >
                  {primaryAction.label}
                </a>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 min-[880px]:hidden">
              {endAction}
              <MobileMenuToggle
                open={mobileOpen}
                controls={menuId}
                onClick={() => {
                  openMenu(null);
                  setMobileOpen((open) => !open);
                }}
              />
            </div>
          </div>
        </div>
        {mobileOpen && (
          <MobileNavigation
            id={menuId}
            items={items}
            primaryAction={primaryAction}
            mobileSecondaryAction={mobileSecondaryAction ?? secondaryAction}
            headerRef={headerRef}
            onClose={closeMobile}
          />
        )}
      </header>
    </>
  );
}

export {
  SiteHeader,
  NavLinksPanel,
  NavFeaturedCard,
  NavFooterLink,
  NavMenuLink,
  NavPreviewPanel,
  NavStoriesPanel,
  NavBlueFrame,
  GlideHover,
  type NavItem,
  type NavLink,
  type NavMenu,
  type NavMenuItem,
  type NavMobileGroup,
  type NavPreviewItem,
  type NavStory,
  type HeaderAction,
};
