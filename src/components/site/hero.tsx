"use client";

import * as React from "react";

import { RingBackdrop } from "@/components/visuals/ring-backdrop";
import { cn } from "@/lib/utils";

type HeroSurface = "white" | "blue";

const SURFACES: Record<HeroSurface, { section: string; title: string; accent: string; muted: string; frame: string }> = {
  white: {
    section: "bg-surface shadow-[inset_0_-1px_0_var(--ds-color-border-rule)]",
    title: "text-fg",
    accent: "text-fg-brand",
    muted: "text-fg-muted",
    frame: "text-rule",
  },
  blue: {
    section: "bg-brand",
    title: "text-on-brand",
    accent: "text-on-brand",
    muted: "text-on-brand/80",
    frame: "text-on-brand/25",
  },
};

const HeroContext = React.createContext<HeroSurface>("white");

function stagger(on: boolean, step: number): { className?: string; style?: React.CSSProperties } {
  if (!on) return {};
  return {
    className: "animate-content-in [animation-duration:var(--ds-duration-slow)] [animation-fill-mode:backwards]",
    style: { animationDelay: `${step * 60}ms` },
  };
}

function Braced({ phrase }: { phrase: string }) {
  const word = /^\{(.+)\}$/.exec(phrase)?.[1];
  if (!word) return <>{phrase}</>;
  return (
    <span data-brace-open="{" data-brace-close="}" className="before:content-[attr(data-brace-open)] after:content-[attr(data-brace-close)]">
      {word}
    </span>
  );
}

function AccentedTitle({ title, accent, className }: { title: string; accent: string[]; className: string }) {
  const phrases = accent.filter((phrase) => title.includes(phrase)).sort((a, b) => b.length - a.length);
  if (phrases.length === 0) return <>{title}</>;
  const pattern = new RegExp(phrases.map((phrase) => phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "g");
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  for (const match of title.matchAll(pattern)) {
    parts.push(title.slice(cursor, match.index));
    parts.push(<span key={`accent:${match.index}`} className={className}><Braced phrase={match[0]} /></span>);
    cursor = match.index + match[0].length;
  }
  parts.push(title.slice(cursor));
  return <>{parts}</>;
}

function HeroTitle({ title, accent, large, wrapTitle }: {
  title: React.ReactNode;
  accent?: string | string[];
  large: boolean;
  wrapTitle: boolean;
}) {
  const tone = SURFACES[React.useContext(HeroContext)];
  const accentList = typeof accent === "string" ? [accent] : (accent ?? (typeof title === "string" ? ["{API}", "{AI}"] : []));
  const titleNeedsMeasure = typeof title === "string" ? !title.includes("\n") : true;
  return (
    <h1
      className={cn(
        "w-full font-normal whitespace-pre-line text-balance",
        tone.title,
        "text-hero leading-tight tracking-tight antialiased sm:text-hero-tablet lg:text-hero-desktop lg:leading-hero",
        large && (wrapTitle ? titleNeedsMeasure && "max-w-(--ds-layout-text)" : "xl:w-max xl:shrink-0 xl:whitespace-nowrap"),
      )}
    >
      {typeof title === "string" ? <AccentedTitle title={title} accent={accentList} className={tone.accent} /> : title}
    </h1>
  );
}

function HeroPill({ variant = "plain", href, icon, className, children }: { variant?: "plain" | "outline"; href?: string; icon?: React.ReactNode; className?: string; children: React.ReactNode }) {
  const surface = SURFACES[React.useContext(HeroContext)];
  const Comp = href ? "a" : "span";
  return (
    <Comp
      href={href}
      data-slot="hero-pill"
      className={cn(
        "inline-flex max-w-full shrink-0 items-center justify-center gap-1.5 text-center text-body-sm leading-snug outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring [&_img]:size-4.5 [&_img]:rounded-sm [&_svg]:size-4",
        variant === "plain" && surface.muted,
        variant === "plain" && href && "min-h-11 gap-2 underline-offset-4 hover:underline",
        variant === "outline" && cn("gap-2 rounded-pill border border-current px-4 py-2", surface.title),
        className,
      )}
    >
      {icon}
      {children}
    </Comp>
  );
}

function HeroAction({ note, className, children }: { note?: React.ReactNode; className?: string; children: React.ReactNode }) {
  const surface = SURFACES[React.useContext(HeroContext)];
  return (
    <div data-slot="hero-action" className={cn("flex flex-col items-center gap-2", className)}>
      {children}
      {note && <span className={cn("text-center text-caption leading-snug", surface.muted)}>{note}</span>}
    </div>
  );
}

function Hero({
  surface = "white",
  size = "default",
  wrapTitle = false,
  eyebrow,
  pill,
  title,
  accent,
  description,
  actions,
  media,
  caption,
  background,
  staggerIn = false,
  className,
  contentClassName,
  ...props
}: Omit<React.ComponentProps<"section">, "title"> & {
  surface?: HeroSurface;
  size?: "default" | "large";
  wrapTitle?: boolean;
  eyebrow?: React.ReactNode;
  pill?: React.ReactNode;
  title: React.ReactNode;
  accent?: string | string[];
  description?: React.ReactNode;
  actions?: React.ReactNode;
  media?: React.ReactNode;
  caption?: React.ReactNode;
  background?: React.ReactNode;
  staggerIn?: boolean;
  contentClassName?: string;
}) {
  const tone = SURFACES[surface];
  const large = size === "large";
  const step = (n: number) => stagger(staggerIn, n);
  return (
    <HeroContext.Provider value={surface}>
      <section
        id="hero"
        data-slot="hero"
        data-ds-dots=""
        data-hero-surface={surface}
        className={cn("relative isolate w-full overflow-hidden text-center", tone.section, className)}
        {...props}
      >
        {background && (
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10">
            {background}
          </div>
        )}
        <div
          className={cn(
            "relative mx-auto flex w-full flex-col items-center overflow-hidden px-4 sm:px-6 lg:px-12",
            media
              ? "min-h-[max(calc(100svh-var(--hero-offset,0px)),calc(var(--spacing)*128))] justify-center gap-7 pt-8 pb-16 sm:pt-0 lg:gap-8"
              : "min-h-[min(calc(100svh-var(--hero-offset,0px)),calc(var(--spacing)*250))] justify-center gap-8 py-10 sm:py-12 lg:py-16",
            contentClassName,
          )}
        >
          <div className={cn("relative z-10 mx-auto flex w-full shrink-0 flex-col items-center", media ? "gap-3" : "gap-6", large ? "max-w-240" : "max-w-200")}>
            {eyebrow && (
              <div {...step(0)} className={cn("flex justify-center", step(0).className)}>
                {eyebrow}
              </div>
            )}
            <div className="flex w-full flex-col items-center gap-3">
              {pill}
              <div className={cn("flex w-full flex-col items-center text-center", large ? "gap-3" : "gap-6")}>
                <div {...step(1)} className={cn("flex w-full justify-center", step(1).className)}>
                  <HeroTitle title={title} accent={accent} large={large} wrapTitle={wrapTitle} />
                </div>
                {description && (
                  <div {...step(2)} className={cn("w-full", step(2).className)}>
                    <p className={cn("text-balance", tone.muted, large ? "text-h5 leading-snug" : "text-body-lg leading-snug")}>{description}</p>
                  </div>
                )}
              </div>
            </div>
          </div>
          {actions && (
            <div {...step(3)} className={cn("relative z-10 flex shrink-0 flex-wrap items-start justify-center gap-3", step(3).className)}>
              {actions}
            </div>
          )}
          {media && (
            <div className="relative z-10 mx-auto flex min-h-0 w-full max-w-225 flex-col items-center gap-3.5">
              <div {...step(4)} className={cn("flex min-h-0 w-full flex-col items-center", step(4).className)}>
                {media}
              </div>
              {caption && <p className={cn("text-center text-body-sm", tone.title)}>{caption}</p>}
            </div>
          )}
        </div>
      </section>
    </HeroContext.Provider>
  );
}

function HeroMedia({
  size = "default",
  backdrop,
  footer,
  className,
  panelClassName,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  size?: "default" | "small" | "compact";
  backdrop?: React.ReactNode;
  footer?: React.ReactNode;
  panelClassName?: string;
}) {
  return (
    <div data-slot="hero-media" className="flex min-h-0 w-full flex-col items-center">
      <div
        className={cn(
          "relative z-10 w-full max-w-232 rounded-[calc(var(--ds-radius-panel)-var(--ds-space-1-5))] bg-ring-tint p-2 sm:rounded-panel",
          size === "small" && "sm:max-w-152",
          size === "compact" && "max-w-76 sm:max-w-184",
          className,
        )}
      >
        <div
          className={cn(
            "relative flex min-h-0 w-full justify-center rounded-[calc(var(--ds-radius-panel)-var(--ds-space-1-5)-var(--ds-space-2))] bg-brand p-3 sm:rounded-[calc(var(--ds-radius-panel)-var(--ds-space-1))] sm:p-6 md:px-12 md:py-10",
            panelClassName,
          )}
          {...props}
        >
          {backdrop !== null && (
            <div aria-hidden="true" className="pointer-events-none absolute inset-2 overflow-hidden rounded-[calc(var(--spacing)*4.5)] text-white sm:rounded-[calc(var(--ds-radius-panel)-var(--ds-space-2))] md:inset-3">
              {backdrop ?? <RingBackdrop className="inset-0 rounded-[inherit]" />}
            </div>
          )}
          <div className="relative flex w-full justify-center">{children}</div>
        </div>
      </div>
      {footer}
    </div>
  );
}

function HeroMediaCard({ className, cardClassName, children }: { className?: string; cardClassName?: string; children: React.ReactNode }) {
  return (
    <div data-slot="hero-media-card" className={cn("-m-2 w-[calc(100%+var(--ds-space-4))] max-w-212 rounded-[calc(var(--ds-radius-panel)-var(--ds-space-3))] bg-blue-80 p-2", className)}>
      <div className={cn("relative flex w-full flex-col overflow-hidden rounded-[calc(var(--ds-radius-panel)-var(--ds-space-5))] bg-surface", cardClassName)}>{children}</div>
    </div>
  );
}

const GLASS = "bg-white/16 backdrop-blur-sm";
const cornerMask = (side: "0" | "100%"): React.CSSProperties => ({
  maskImage: `radial-gradient(circle at ${side} 100%, transparent var(--ds-space-3), var(--ds-color-black) var(--ds-space-3))`,
  WebkitMaskImage: `radial-gradient(circle at ${side} 100%, transparent var(--ds-space-3), var(--ds-color-black) var(--ds-space-3))`,
});

function HeroMediaTab({ className, children, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="hero-media-tab"
      className={cn(
        "relative -mt-px flex w-[calc(min(100%,calc(var(--spacing)*208))-var(--ds-space-10))] items-center gap-4 rounded-b-card border border-t-0 border-white/7 px-4 py-1",
        GLASS,
        className,
      )}
      {...props}
    >
      <span aria-hidden="true" className={cn("absolute top-0 -left-3 size-3", GLASS)} style={cornerMask("0")} />
      <span aria-hidden="true" className={cn("absolute top-0 -right-3 size-3", GLASS)} style={cornerMask("100%")} />
      {children}
    </div>
  );
}

function HeroFrame({ surface = "white", className }: { surface?: HeroSurface; className?: string }) {
  return (
    <div aria-hidden="true" data-slot="hero-frame" className={cn("pointer-events-none absolute inset-0 hidden overflow-hidden md:block", SURFACES[surface].frame, className)}>
      <div className="absolute inset-y-0 left-1/2 w-[min(var(--ds-layout-column-wide),100%-var(--ds-space-12))] -translate-x-1/2">
        <div className="absolute inset-x-0 top-(--hero-frame-top,var(--ds-space-3)) h-px bg-current" />
        <div className="absolute inset-x-0 bottom-0 h-px bg-current" />
      </div>
    </div>
  );
}

export { Hero, HeroAction, HeroFrame, HeroMedia, HeroMediaCard, HeroMediaTab, HeroPill };
