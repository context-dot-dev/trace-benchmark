"use client";

import * as React from "react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

export type PanelTab = { id: string; label: string; content: React.ReactNode };

const FOLDER_TAB =
  "min-h-11 rounded-control px-4 py-2 text-body-sm font-medium text-fg-muted hover:text-fg data-[state=active]:bg-surface data-[state=active]:text-fg-brand data-[state=active]:shadow-sm";

function PanelChrome({ children, aside }: { children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-4 rounded-t-card border-b border-line bg-subtle p-2">
      {children}
      {aside && <div className="hidden shrink-0 md:block">{aside}</div>}
    </div>
  );
}

function PanelBody({ children, footer, className }: { children: React.ReactNode; footer?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-5 p-4 sm:p-6", className)}>
      {children}
      {footer}
    </div>
  );
}

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
          <TabsList aria-label={label} className="-mb-px min-w-0 flex-1 gap-0 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {tabs.map((tab) => (
              <TabsTrigger key={tab.id} value={tab.id} className={FOLDER_TAB}>
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </PanelChrome>
        <PanelBody footer={footer} className={bodyClassName}>
          {tabs.map((tab) => (
            <TabsContent
              key={tab.id}
              value={tab.id}
              forceMount
              aria-hidden={active !== tab.id}
              inert={active !== tab.id}
              className={cn("col-start-1 row-start-1 min-w-0", active !== tab.id && "hidden")}
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
export function Panel({
  title,
  aside,
  footer,
  children,
  className,
  bodyClassName,
}: {
  title: React.ReactNode;
  aside?: React.ReactNode;
  footer?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
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
