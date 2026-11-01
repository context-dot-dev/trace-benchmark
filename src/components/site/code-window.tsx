"use client";

import * as React from "react";
import { Check, Copy } from "lucide-react";

import { useCopy } from "@/components/ui/copy-button";
import { cn } from "@/lib/utils";


const TOKEN = /(\/\/.*$|^\s*#.*$|'[^']*'|"[^"]*"|`[^`]*`|\b\d+(?:\.\d+)?\b|\b(?:true|false|null)\b|[{}()[\],:;=])/;

function tokenClass(token: string) {
  if (/^(\/\/|\s*#)/.test(token)) return "text-white/35";
  if (/^['"`]/.test(token) || /^\d/.test(token) || /^(true|false|null)$/.test(token)) return "text-blue-60";
  if (/^[{}()[\],:;=]$/.test(token)) return "text-white/50";
  return undefined;
}

function codeLines(code: string) {
  const seen = new Map<string, number>();
  return code.split("\n").map((text) => {
    const occurrence = seen.get(text) ?? 0;
    seen.set(text, occurrence + 1);
    return { id: `${text}\u0000${occurrence}`, text };
  });
}

function CodeBlock({ code, className }: { code: string; className?: string }) {
  return (
    <pre data-slot="code-block" className={cn("p-5 font-mono text-body-sm leading-[calc(var(--spacing)*5.5)] text-white/85 [tab-size:4]", className)}>
      <code>
        {codeLines(code).map(({ id, text }) => (
          <span key={id} className="block min-h-[calc(var(--spacing)*5.5)] whitespace-pre">
            {text.split(new RegExp(TOKEN, "g")).map((part, j) =>
              part ? (
                <span key={j} className={tokenClass(part)}>
                  {part}
                </span>
              ) : null,
            )}
          </span>
        ))}
      </code>
    </pre>
  );
}

const windowButtonClass =
  "inline-flex size-7 shrink-0 items-center justify-center rounded-card text-white/45 outline-none transition-[background-color,color] duration-150 ease-out hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/60 motion-reduce:transition-none [&_svg]:size-3.5";

const roundWindowButtonClass =
  "flex size-8 shrink-0 items-center justify-center rounded-pill text-white/60 outline-none transition-[background-color,color] duration-150 ease-out hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white motion-reduce:transition-none [&_svg]:size-4";

function WindowCopyButton({ value, label = "Copy code", round = false, className }: { value: string; label?: string; round?: boolean; className?: string }) {
  const { hasCopied, copy } = useCopy();
  return (
    <button type="button" onClick={() => copy(value)} aria-label={hasCopied ? "Copied" : label} className={cn(round ? roundWindowButtonClass : windowButtonClass, className)}>
      {hasCopied ? <Check aria-hidden="true" strokeWidth={1.75} /> : <Copy aria-hidden="true" strokeWidth={1.5} />}
    </button>
  );
}

type TerminalWindowProps = { label?: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode; className?: string };

function TerminalWindow({ label, actions, children, className }: TerminalWindowProps) {
  return (
    <div data-slot="terminal-window" className={cn("min-w-0 overflow-hidden rounded-card bg-code text-left text-white", className)}>
      <div className="flex min-h-11 items-center gap-2 border-b border-white/10 px-4 py-2">
        <span aria-hidden="true" className="size-3 shrink-0 rounded-pill bg-window-close" />
        <span aria-hidden="true" className="size-3 shrink-0 rounded-pill bg-window-minimize" />
        <span aria-hidden="true" className="size-3 shrink-0 rounded-pill bg-window-zoom" />
        {label && <span className="ml-2 inline-flex min-w-0 items-center gap-1.5 truncate rounded-card bg-white/10 px-2.5 py-1 font-mono text-caption font-medium text-white">{label}</span>}
        {actions && <div className="ml-auto flex shrink-0 items-center gap-1">{actions}</div>}
      </div>
      {children}
    </div>
  );
}

function CodeWindow({ className, windowClassName, ...props }: TerminalWindowProps & { windowClassName?: string }) {
  return (
    <div data-slot="code-window" className={cn("min-w-0 rounded-card bg-ring-tint p-2", className)}>
      <TerminalWindow className={windowClassName} {...props} />
    </div>
  );
}

export type CodeTabSample = {
  language: string;
  label?: string;
  code: string;
  filename?: string;
  install?: string | null;
  content?: React.ReactNode;
};

function CodeTabs({
  samples,
  defaultLanguage,
  language: languageProp,
  onLanguageChange,
  className,
}: {
  samples: CodeTabSample[];
  defaultLanguage?: string;
  language?: string;
  onLanguageChange?: (language: string) => void;
  className?: string;
}) {
  const baseId = React.useId();
  const [ownLanguage, setOwnLanguage] = React.useState(defaultLanguage ?? samples[0]?.language);
  const language = languageProp ?? ownLanguage;
  const active = samples.find((s) => s.language === language) ?? samples[0];
  const tabs = React.useRef<Record<string, HTMLButtonElement | null>>({});
  if (!active) return null;

  const select = (next: string) => {
    setOwnLanguage(next);
    onLanguageChange?.(next);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const next = samples[(samples.indexOf(active) + step + samples.length) % samples.length];
    select(next.language);
    tabs.current[next.language]?.focus();
  };

  return (
    <CodeWindow
      className={cn("flex flex-col", className)}
      windowClassName="flex flex-1 flex-col"
      label={active.filename}
      actions={<WindowCopyButton round value={active.code} label={`Copy ${active.label ?? active.language} code`} />}
    >
      {samples.length > 1 && (
        <div role="tablist" aria-label="Code language" onKeyDown={onKeyDown} className="flex min-w-0 gap-1 overflow-x-auto border-b border-white/10 px-3 py-2 [scrollbar-width:none]">
          {samples.map((sample) => {
            const selected = sample === active;
            return (
              <button
                key={sample.language}
                ref={(node) => {
                  tabs.current[sample.language] = node;
                }}
                id={`${baseId}-tab-${sample.language}`}
                type="button"
                role="tab"
                aria-selected={selected}
                aria-controls={`${baseId}-panel-${sample.language}`}
                tabIndex={selected ? 0 : -1}
                onClick={() => select(sample.language)}
                className={cn(
                  "shrink-0 rounded-pill px-3 py-1.5 text-body-sm leading-snug outline-none transition-colors duration-150 ease-out focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-white motion-reduce:transition-none",
                  selected ? "bg-white/10 text-white" : "text-white/55 hover:text-white",
                )}
              >
                {sample.label ?? sample.language}
              </button>
            );
          })}
        </div>
      )}
      <div className="relative h-88 lg:h-auto lg:min-h-88 lg:flex-1">
        {samples.map((sample) => (
          <div
            key={sample.language}
            id={`${baseId}-panel-${sample.language}`}
            role={samples.length > 1 ? "tabpanel" : undefined}
            aria-labelledby={samples.length > 1 ? `${baseId}-tab-${sample.language}` : undefined}
            tabIndex={0}
            hidden={sample !== active}
            className="absolute inset-0 overflow-auto outline-none [scrollbar-color:color-mix(in_srgb,var(--ds-color-white)_20%,transparent)_transparent] [scrollbar-width:thin] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand [&_pre]:bg-transparent"
          >
            {sample.content ? <div className="p-5 font-mono text-body-sm leading-[calc(var(--spacing)*5.5)] text-white/85">{sample.content}</div> : <CodeBlock code={sample.code} />}
          </div>
        ))}
      </div>
    </CodeWindow>
  );
}

function InstallCommand({ command, label = "install command", className }: { command?: string | null; label?: string; className?: string }) {
  const { hasCopied, copy } = useCopy();
  if (!command) {
    return <p className={cn("w-fit max-w-full rounded-pill px-4 py-2 text-body-sm text-fg/65 ring-1 ring-black/10 ring-inset", className)}>No install needed. Call the REST API directly.</p>;
  }
  return (
    <div data-slot="install-command" className={cn("flex w-fit max-w-full items-center gap-2 rounded-pill py-1 pr-1 pl-4 ring-1 ring-black/10 ring-inset", className)}>
      <code className="min-w-0 overflow-x-auto font-mono text-body-sm leading-5 whitespace-nowrap text-fg/70 [scrollbar-width:none]">
        <span aria-hidden="true" className="text-fg/35">
          ${" "}
        </span>
        {command}
      </code>
      <button
        type="button"
        onClick={() => copy(command)}
        aria-label={hasCopied ? `${label} copied` : `Copy ${label}`}
        className="flex size-8 shrink-0 items-center justify-center rounded-pill text-fg/45 outline-none transition-colors duration-150 ease-out hover:bg-blue-10 hover:text-fg-brand focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring motion-reduce:transition-none"
      >
        {hasCopied ? <Check aria-hidden="true" className="size-4 text-fg-brand" /> : <Copy aria-hidden="true" className="size-4" />}
      </button>
    </div>
  );
}

export { CodeWindow, TerminalWindow, CodeBlock, CodeTabs, InstallCommand, WindowCopyButton };
