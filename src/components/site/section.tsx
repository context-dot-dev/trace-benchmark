import * as React from "react";

import { cn } from "@/lib/utils";

type GridTone = "light" | "dark";

// Nodes are solid, never translucent: a node straddles the section's edge, so half of it can sit over the neighboring
// section's color, and the line beneath must not show through it. A dark section's edge nodes straddle the white
// section above it, so they are split in the negative of each side: dark over the white, light over the black.
const TONES: Record<GridTone, { line: string; node: string; edgeNode: string }> = {
  light: { line: "bg-rule", node: "bg-node", edgeNode: "bg-node" },
  dark: {
    line: "bg-white/15",
    node: "bg-neutral-60",
    edgeNode: "bg-[linear-gradient(to_bottom,var(--ds-color-neutral-70)_50%,var(--ds-color-neutral-40)_50%)]",
  },
};

const NODE = "absolute size-2 rounded-pill";
const COLUMN = "w-full max-w-(--ds-frame-column) mx-auto";

/**
 * The content column's two edges as hairlines down the whole section, and a full-bleed rule along its top with a node
 * on each corner. It overlays the section (which must be `relative`) and draws a column-width box inside it, so it
 * lines up whether the section is the column itself or a full-bleed band around it.
 */
function SectionEdgeLines({ tone = "light", header, className }: { tone?: GridTone; header?: "below" | "under"; className?: string }) {
  const colors = TONES[tone];
  return (
    // Every line is centered on its edge, like the nodes, so each node sits on the exact crossing. Under the header the
    // top rule has no nodes, so none sit against the navbar.
    <div aria-hidden="true" data-slot="section-edge-lines" className={cn("pointer-events-none absolute inset-x-0 top-0 bottom-0 z-10 flex justify-center", className)}>
      <div className={cn("relative h-full", COLUMN)}>
        <div className={cn("absolute inset-y-0 left-0 w-px -translate-x-1/2", colors.line)} />
        <div className={cn("absolute inset-y-0 right-0 w-px translate-x-1/2", colors.line)} />
        <div className={cn("absolute top-0 left-1/2 h-px w-screen -translate-x-1/2 -translate-y-1/2", colors.line)} />
        {!header && (
          <>
            <span className={cn(NODE, colors.edgeNode, "top-0 left-0 -translate-x-1/2 -translate-y-1/2")} />
            <span className={cn(NODE, colors.edgeNode, "top-0 right-0 translate-x-1/2 -translate-y-1/2")} />
          </>
        )}
      </div>
    </div>
  );
}

/**
 * A full-bleed rule between a section's heading and its content, with a node where it crosses each column edge. It
 * sits in the column's content box, so the nodes step back out by the column's gutter to land on the edge lines. Its top
 * margin is smaller than the section's top padding, so a heading sits closer to its own content than to the section
 * above. `standalone` builds the column box itself, for headings that span the full width.
 */
function SectionHeaderRule({ tone = "light", standalone = false, className }: { tone?: GridTone; standalone?: boolean; className?: string }) {
  const colors = TONES[tone];
  const rule = (
    <div aria-hidden="true" data-slot="section-header-rule" className={cn("pointer-events-none relative z-20 mt-10 mb-8 h-px md:mt-12", className)}>
      <div className={cn("absolute top-0 left-1/2 h-px w-screen -translate-x-1/2", colors.line)} />
      <span className={cn(NODE, colors.node, "top-1/2 -left-6 -translate-x-1/2 -translate-y-1/2 sm:-left-8 md:-left-10 lg:-left-12")} />
      <span className={cn(NODE, colors.node, "top-1/2 -right-6 translate-x-1/2 -translate-y-1/2 sm:-right-8 md:-right-10 lg:-right-12")} />
    </div>
  );
  if (!standalone) return rule;
  return <div className={cn(COLUMN, "px-6 sm:px-8 md:px-10 lg:px-12")}>{rule}</div>;
}

/**
 * A full-bleed band with the content in the ruled column. The site's base layer already draws the page's column lines
 * and the rule between top-level sections; `lines` draws them on the section itself (a dark band, or a page without the
 * base layer). It clips sideways, so the nodes on a full-width column never widen the page.
 */
function SiteSection({
  tone = "light",
  lines = false,
  header,
  className,
  columnClassName,
  children,
  ...props
}: React.ComponentProps<"section"> & { tone?: GridTone; lines?: boolean; header?: "below" | "under"; columnClassName?: string }) {
  return (
    <section
      data-slot="site-section"
      className={cn("relative w-full overflow-x-clip pt-10 pb-8 md:pt-12 md:pb-10", tone === "dark" ? "bg-inverse text-white" : "bg-surface text-fg", className)}
      {...props}
    >
      {lines && <SectionEdgeLines tone={tone} header={header} />}
      <div data-slot="site-section-column" className={cn("relative", COLUMN, "px-6 sm:px-8 md:px-10 lg:px-12", columnClassName)}>
        {children}
      </div>
    </section>
  );
}

/**
 * The site's section heading: left aligned, regular weight, tight, its closing words (`accent`) in brand blue, and one
 * or two lines of muted description under it.
 */
function SectionHeading({
  title,
  accent,
  description,
  as: Heading = "h2",
  className,
  children,
}: {
  title: React.ReactNode;
  accent?: React.ReactNode;
  description?: React.ReactNode;
  as?: "h1" | "h2" | "h3";
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <div data-slot="section-heading" className={cn("flex flex-col items-start gap-6", className)}>
      <Heading className="max-w-(--ds-layout-heading) text-left text-h3 font-normal tracking-tight text-balance text-fg leading-display md:text-h2">
        {title}
        {accent && (
          <>
            {" "}
            <span className="text-fg-brand">{accent}</span>
          </>
        )}
      </Heading>
      {description && <p className="max-w-(--ds-layout-text) text-body leading-relaxed text-fg-muted md:text-body-lg">{description}</p>}
      {children}
    </div>
  );
}

/** A plain full-bleed rule between two blocks that are not sections of their own (no nodes). */
function SectionDivider({ className }: { className?: string }) {
  return <div aria-hidden="true" data-slot="section-divider" className={cn("relative left-1/2 h-px w-screen -translate-x-1/2 bg-rule", className)} />;
}

export { SiteSection, SectionDivider, SectionEdgeLines, SectionHeaderRule, SectionHeading };
