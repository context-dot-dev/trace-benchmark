"use client";

import * as React from "react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

export type PanelTab = { id: string; label: string; content: React.ReactNode };

const FOLDER_TAB = cn(
  "group/tab relative h-auto shrink-0 gap-2 overflow-hidden rounded-none rounded-t-card border border-b-0 border-transparent px-3 py-2.5 max-[43.2rem]:min-h-11 font-mono text-axis leading-snug text-fg-muted transition-none hover:text-fg-brand focus-visible:outline-offset-[calc(var(--ds-space-0-5)*-1)] data-[state=active]:border-line data-[state=active]:bg-surface data-[state=active]:text-fg data-[state=active]:hover:text-fg sm:px-4 sm:text-caption",
  "before:absolute before:inset-1 before:-z-10 before:rounded-control before:bg-brand/10 before:opacity-0 before:transition-none hover:before:opacity-100 data-[state=active]:before:hidden",
);

/** The window chrome of the landing page's benchmark card: three hollow dots, then the row of folder tabs or a title. */
function PanelChrome({ children, aside }: { children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <div className="flex min-h-11 items-end gap-4 rounded-t-card border-b border-line bg-subtle px-2 sm:px-4">
      <div aria-hidden="true" className="hidden shrink-0 items-center gap-1.5 self-center sm:flex">
        <span className="size-2.5 rounded-pill border border-line-strong" />
        <span className="size-2.5 rounded-pill border border-line-strong" />
        <span className="size-2.5 rounded-pill border border-line-strong" />
      </div>
      {children}
      {aside && <div className="hidden shrink-0 self-center md:block">{aside}</div>}
    </div>
  );
}

/** The glass ring: a wrapper 8px wider than the card, so its outer edge shares the card's radius. */
function PanelBody({ children, footer, className }: { children: React.ReactNode; footer?: React.ReactNode; className?: string }) {
  return (
    <div className="p-3 sm:p-6">
      <div className="-m-2 rounded-card bg-ring-tint p-2">
        <div className={cn("flex min-w-0 flex-col gap-5 rounded-card bg-surface p-4 ring-1 ring-hairline sm:gap-6 sm:p-8", className)}>
          {children}
          {footer}
        </div>
      </div>
    </div>
  );
}

/** A benchmark card with folder tabs, one view per tab. */
export function TabbedPanel({
  label,
  tabs,
  value,
  onValueChange,
  aside,
  footer,
  className,
  bodyClassName,
}: {
  label: string;
  tabs: PanelTab[];
  value?: string;
  onValueChange?: (value: string) => void;
  aside?: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  const [uncontrolled, setUncontrolled] = React.useState(tabs[0]?.id);
  const active = value ?? uncontrolled;
  return (
    <div data-slot="trace-panel" className={cn("min-w-0 rounded-card border border-line bg-surface", className)}>
      <Tabs
        value={active}
        onValueChange={(next) => {
          setUncontrolled(next);
          onValueChange?.(next);
        }}
        className="gap-0"
      >
        <PanelChrome aside={aside}>
          <TabsList
            aria-label={label}
            className="-mb-px min-w-0 flex-1 gap-0 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {tabs.map((tab) => (
              <TabsTrigger key={tab.id} value={tab.id} className={FOLDER_TAB}>
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </PanelChrome>
        <PanelBody footer={footer} className={cn("grid grid-cols-1", bodyClassName)}>
          {tabs.map((tab) => (
            <TabsContent
              key={tab.id}
              value={tab.id}
              forceMount
              aria-hidden={active !== tab.id}
              inert={active !== tab.id}
              className={cn("col-start-1 row-start-1 min-w-0", active !== tab.id && "invisible pointer-events-none")}
            >
              {tab.content}
            </TabsContent>
          ))}
        </PanelBody>
      </Tabs>
      {aside && <div className="flex justify-center px-3 pb-4 md:hidden">{aside}</div>}
    </div>
  );
}

/** The same card with a single view, its title where the tabs would be. */
export function Panel({ title, aside, footer, children, className, bodyClassName }: { title: React.ReactNode; aside?: React.ReactNode; footer?: React.ReactNode; children: React.ReactNode; className?: string; bodyClassName?: string }) {
  return (
    <div data-slot="trace-panel" className={cn("min-w-0 rounded-card border border-line bg-surface", className)}>
      <PanelChrome aside={aside}>
        <div className="-mb-px flex min-w-0 flex-1">
          <span className="rounded-t-card border border-b-0 border-line bg-surface px-3 py-2.5 font-mono text-axis leading-snug text-fg sm:px-4 sm:text-caption">{title}</span>
        </div>
      </PanelChrome>
      <PanelBody footer={footer} className={bodyClassName}>
        {children}
      </PanelBody>
      {aside && <div className="flex justify-center px-3 pb-4 md:hidden">{aside}</div>}
    </div>
  );
}
