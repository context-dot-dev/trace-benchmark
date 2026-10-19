"use client";

import * as React from "react";
import { Check, Copy } from "lucide-react";

import { SectionEdgeLines } from "@/components/site/section";
import { cn } from "@/lib/utils";

type FooterLink = { label: React.ReactNode; href: string; external?: boolean };
type FooterLinkGroup = { title: React.ReactNode; links: FooterLink[]; /** Extra rows after the links (a cookie settings button). */ extra?: React.ReactNode };
type ServiceState = "operational" | "degraded" | "maintenance" | "downtime";

const COLUMN = "relative mx-auto w-full max-w-(--ds-frame-column) px-6 sm:px-8 md:px-10 lg:px-12";
// Where the copyright row's rules cross the column lines, as on the dark section grid.
const NODE = "pointer-events-none absolute z-20 size-2 rounded-pill bg-neutral-60";
const FOCUS = "outline-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white";
const INLINE_LINK = cn("transition-colors duration-150 ease-out hover:text-white motion-reduce:transition-none", FOCUS);
const DIVIDER = <span aria-hidden="true" className="h-4 w-px bg-white/20" />;

function external(link: { href: string; external?: boolean }) {
  return (link.external ?? link.href.startsWith("http")) ? { target: "_blank", rel: "noopener noreferrer" } : {};
}

const STATE_DOT: Record<ServiceState, string> = {
  operational: "bg-success",
  degraded: "bg-warning",
  maintenance: "bg-warning",
  downtime: "bg-danger",
};
const STATE_LABEL: Record<ServiceState, string> = {
  operational: "All systems operational",
  degraded: "Degraded performance",
  maintenance: "Scheduled maintenance",
  downtime: "Service outage",
};

/** The footer's "Service status" link with a dot in the service's state. A neutral dot holds the place until it is known. */
function FooterStatusLink({ href, state, label = "Service status", className }: { href: string; state?: ServiceState | null; label?: React.ReactNode; className?: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" title={state ? STATE_LABEL[state] : undefined} className={cn("inline-flex items-center gap-2", INLINE_LINK, className)}>
      <span aria-hidden="true" className={cn("size-2 shrink-0 rounded-pill transition-colors duration-300 ease-out motion-reduce:transition-none", state ? STATE_DOT[state] : "bg-white/25")} />
      {label}
      {state && <span className="sr-only">: {STATE_LABEL[state]}</span>}
    </a>
  );
}

/** A quiet inline link for the footer's aside row (the compliance line). */
function FooterInlineLink({ className, ...props }: React.ComponentProps<"a">) {
  return <a className={cn(INLINE_LINK, className)} {...props} />;
}

/**
 * The pill that sits on the watermark and copies a prompt ("Onboard your agent"). Both labels share one grid cell, so
 * the pill keeps its width when the label swaps.
 */
function FooterCopyButton({
  text,
  label,
  copiedLabel = "Copied",
  className,
  ...props
}: Omit<React.ComponentProps<"button">, "children" | "onClick"> & { text: string; label: React.ReactNode; copiedLabel?: React.ReactNode }) {
  const [copied, setCopied] = React.useState(false);
  React.useEffect(() => {
    if (!copied) return;
    const timeout = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timeout);
  }, [copied]);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
        } catch {
          // The clipboard can be blocked; the label stays as it was.
        }
      }}
      className={cn(
        "pointer-events-auto inline-flex items-center justify-center gap-2 rounded-pill border border-brand bg-dark px-4 py-2 text-body-sm leading-5 font-medium whitespace-nowrap text-white transition-[background-color,scale] duration-150 ease-out hover:bg-navy-30 active:scale-95 motion-reduce:transition-none motion-reduce:active:scale-100",
        "outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring",
        className,
      )}
      {...props}
    >
      {copied ? <Check aria-hidden="true" className="size-4" /> : <Copy aria-hidden="true" className="size-4" />}
      <span className="grid justify-items-center">
        <span className={cn("col-start-1 row-start-1", copied && "invisible")}>{label}</span>
        <span aria-hidden="true" className={cn("col-start-1 row-start-1", !copied && "invisible")}>
          {copiedLabel}
        </span>
      </span>
    </button>
  );
}

/**
 * The site's footer: near black, the column's lines continuing down it in the dark tone. The brand block (logo,
 * two-line description, socials and a "Backed by" line after a short divider) and an aside (compliance badges over a
 * row of inline links) sit over a white rule at 15 percent; the link groups run in four columns under it; then the
 * copyright row between two rules with a node on each crossing, and the watermark band at the foot with its button.
 */
function SiteFooter({
  logo,
  description,
  socials,
  backedBy,
  badges,
  asideLinks = [],
  aside,
  groups = [],
  copyright,
  note,
  legal = [],
  end,
  watermark,
  watermarkAction,
  className,
}: {
  logo?: React.ReactNode;
  description?: React.ReactNode;
  /** Icon links; each is drawn at 16px, white at 60 percent. */
  socials?: React.ReactNode;
  /** After the socials, past a short divider (the site's "Backed by Y Combinator" link). */
  backedBy?: React.ReactNode;
  /** The top of the right side (the compliance badges, 82px tall). */
  badges?: React.ReactNode;
  /** Inline links under the badges, divided by short rules (`FooterInlineLink`, `FooterStatusLink`). */
  asideLinks?: React.ReactNode[];
  /** Replaces the whole right side. */
  aside?: React.ReactNode;
  groups?: FooterLinkGroup[];
  copyright?: React.ReactNode;
  /** The middle of the copyright row. */
  note?: React.ReactNode;
  legal?: FooterLink[];
  /** The right of the copyright row, after the legal links (a theme switch). */
  end?: React.ReactNode;
  /** What fills the band at the foot (the site's dot wordmark, `FooterWatermark`). */
  watermark?: React.ReactNode;
  /** The button on the watermark, on its "e" crossbar (above it on phones); the watermark's cursor clicks it. */
  watermarkAction?: React.ReactNode;
  className?: string;
}) {
  const right =
    aside ??
    ((badges || asideLinks.length > 0) && (
      <>
        {badges && <div className="flex items-center gap-3 [&_img]:h-20.5 [&_img]:w-auto">{badges}</div>}
        {asideLinks.length > 0 && (
          <div className="flex items-center gap-3 text-body-sm leading-none font-medium text-white/60">
            {asideLinks.map((link, index) => (
              <React.Fragment key={index}>
                {index > 0 && DIVIDER}
                {link}
              </React.Fragment>
            ))}
          </div>
        )}
      </>
    ));

  return (
    <footer data-slot="site-footer" className={cn("relative isolate overflow-x-clip bg-dark text-white", className)}>
      <div className="relative">
        <SectionEdgeLines tone="dark" />
        <div className={cn(COLUMN, "z-10 py-14 sm:py-16 md:py-20")}>
          {(logo || description || socials || backedBy || right) && (
            <div className="grid grid-cols-1 gap-8 border-b border-white/15 pb-8 md:grid-cols-[1fr_auto] md:gap-x-10">
              <div className="flex min-w-0 flex-col items-start gap-5">
                {logo && <div className="flex flex-col items-start gap-3">{logo}</div>}
                {description && <p className="max-w-md text-body leading-relaxed font-medium text-white/70">{description}</p>}
                {(socials || backedBy) && (
                  <div className="flex items-center gap-3">
                    {socials && (
                      <div className="flex items-center gap-3 [&_a]:-m-1.5 [&_a]:flex [&_a]:items-center [&_a]:justify-center [&_a]:p-1.5 [&_a]:text-white/60 [&_a]:transition-colors [&_a]:duration-150 [&_a]:ease-out [&_a:hover]:text-white [&_svg]:size-4">
                        {socials}
                      </div>
                    )}
                    {socials && backedBy && DIVIDER}
                    {backedBy && <span className="inline-flex items-center gap-1.5 text-body-sm leading-none font-medium text-white/60 [&_img]:size-4 [&_img]:rounded-sm">{backedBy}</span>}
                  </div>
                )}
              </div>
              {right && <div className="flex shrink-0 flex-col items-start gap-4 md:items-end md:justify-between">{right}</div>}
            </div>
          )}

          {groups.length > 0 && (
            <nav aria-label="Footer" className="grid grid-cols-2 gap-x-6 gap-y-10 pt-8 sm:gap-x-8 md:grid-cols-4">
              {groups.map((group) => (
                <div key={group.links.map((link) => link.href).join("|")} className="flex min-w-0 flex-col gap-3">
                  <p className="text-body font-medium text-white">{group.title}</p>
                  <ul className="flex flex-col gap-1">
                    {group.links.map((link) => (
                      <li key={link.href}>
                        <a href={link.href} {...external(link)} className={cn("block py-0.5 text-body leading-6 font-medium text-white/60", INLINE_LINK)}>
                          {link.label}
                        </a>
                      </li>
                    ))}
                    {group.extra}
                  </ul>
                </div>
              ))}
            </nav>
          )}
        </div>

        {(copyright || note || legal.length > 0 || end) && (
          // No z-index here: the corner nodes have to stack above the footer's column lines.
          <div className="relative w-full border-y border-white/15 bg-white/2">
            <div className={cn(COLUMN, "grid grid-cols-1 items-center justify-items-center gap-x-6 gap-y-4 py-5 text-center md:grid-cols-3 md:justify-items-start md:text-left")}>
              <span aria-hidden="true" className={cn(NODE, "-top-px left-0 -translate-x-1/2 -translate-y-1/2")} />
              <span aria-hidden="true" className={cn(NODE, "-top-px right-0 translate-x-1/2 -translate-y-1/2")} />
              <span aria-hidden="true" className={cn(NODE, "-bottom-px left-0 -translate-x-1/2 translate-y-1/2")} />
              <span aria-hidden="true" className={cn(NODE, "-bottom-px right-0 translate-x-1/2 translate-y-1/2")} />
              <span className="text-body-sm leading-5 font-medium tracking-tight text-white/60">{copyright}</span>
              <span className="flex items-center justify-center gap-1 text-body-sm leading-5 font-medium tracking-tight text-white/60 md:justify-self-center">{note}</span>
              {legal.length > 0 && (
                <nav aria-label="Legal" className="flex items-center gap-4 md:justify-self-end">
                  {legal.map((link) => (
                    <a key={link.href} href={link.href} {...external(link)} className={cn("py-0.5 text-body-sm leading-5 font-medium text-white/60", INLINE_LINK)}>
                      {link.label}
                    </a>
                  ))}
                </nav>
              )}
              {end && <div className="flex items-center md:justify-self-end">{end}</div>}
            </div>
          </div>
        )}
      </div>

      {(watermark || watermarkAction) && (
        // A band of faint dots, brightest in the middle, under the wordmark.
        <div data-slot="site-footer-watermark" className="pointer-events-none relative z-20 h-44 w-full overflow-hidden bg-dark leading-none select-none sm:h-[clamp(7.5rem,20vw,22rem)]">
          <div
            aria-hidden="true"
            className="absolute inset-0 bg-[radial-gradient(circle,var(--ds-color-white)_1px,transparent_1.5px)] bg-size-[0.875rem_0.875rem] bg-center opacity-9 [mask-image:radial-gradient(ellipse_at_center,var(--ds-color-black)_20%,transparent_75%)]"
          />
          {watermark}
          {/* The offset tracks the wordmark's scale, so the button sits on the "e" crossbar; a phone-width wordmark is too
              short to hold it, so there it sits in its own band above. */}
          {watermarkAction && (
            // Marked as the watermark's cursor origin, so its dotted cursor clicks the button before gliding onto the letters.
            <span data-watermark-cursor-origin="" className="absolute top-[calc(50%+min(1.65vw,2.1rem))] left-1/2 z-10 -translate-x-1/2 -translate-y-1/2 max-sm:top-4 max-sm:translate-y-0">{watermarkAction}</span>
          )}
        </div>
      )}
    </footer>
  );
}

export { SiteFooter, FooterCopyButton, FooterInlineLink, FooterStatusLink, type FooterLink, type FooterLinkGroup, type ServiceState };
