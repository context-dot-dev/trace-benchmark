import * as React from "react";

import { SectionHeading, SiteSection } from "@/components/site/section";
import { cn } from "@/lib/utils";

/** A report section with the site's heading and blue closing phrase. */
export function ReportSection({
  id,
  title,
  accent,
  description,
  action,
  children,
  className,
}: {
  id: string;
  title: React.ReactNode;
  accent?: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <SiteSection id={id} aria-labelledby={`${id}-title`} className={cn("scroll-mt-24", className)}>
      <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
        <SectionHeading title={<span id={`${id}-title`}>{title}</span>} accent={accent} description={description} />
        {action && <div className="shrink-0">{action}</div>}
      </div>
      <div className="mt-6 flex flex-col gap-8">{children}</div>
    </SiteSection>
  );
}

/** Supporting lines under a control or a chart: muted, one idea per line. */
export function Notes({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("flex max-w-(--ds-layout-text) flex-col gap-2 text-body leading-relaxed text-fg-muted", className)}>{children}</div>;
}

export function Fine({ children, className }: { children: React.ReactNode; className?: string }) {
  return <p className={cn("max-w-(--ds-layout-text) text-body leading-relaxed text-fg-muted", className)}>{children}</p>;
}

export function SubHeading({ id, children, className }: { id?: string; children: React.ReactNode; className?: string }) {
  return (
    <h3 id={id} className={cn("scroll-mt-24 text-h4 leading-heading font-normal tracking-tight text-fg", className)}>
      {children}
    </h3>
  );
}

export function TextLink({ className, ...props }: React.ComponentProps<"a">) {
  return <a className={cn("rounded-sm text-fg-brand underline decoration-brand/30 underline-offset-3 transition-colors duration-150 ease-out hover:decoration-brand", className)} {...props} />;
}

/** A row of the section's controls, wrapping on phones. */
export function Controls({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("flex flex-wrap items-center gap-x-4 gap-y-3", className)}>{children}</div>;
}

export function ControlLabel({ children }: { children: React.ReactNode }) {
  return <span className="text-body-sm text-fg-subtle">{children}</span>;
}
