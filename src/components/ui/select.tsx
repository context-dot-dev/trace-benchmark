"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { cva, type VariantProps } from "class-variance-authority";

import { ScrollArea } from "@/components/ui/scroll-area";
import { usePortalContainer } from "@/lib/surface";
import { cn } from "@/lib/utils";

const triggerVariants = cva(
  "flex items-center gap-1.5 whitespace-nowrap outline-none transition-colors duration-150 ease-out focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid focus-visible:outline-focus-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-3.5 [&_svg]:shrink-0 [&_svg]:text-fg-subtle",
  {
    variants: {
      appearance: {
        ghost: "h-8 rounded-control border border-line px-3 text-body-sm text-fg-muted hover:border-line-strong hover:text-fg data-[state=open]:border-line-strong data-[state=open]:text-fg",
        field: "w-full rounded-control border border-line bg-surface text-fg hover:border-line-strong data-[state=open]:border-brand data-placeholder:text-fg-subtle [&>span]:flex-1 [&>span]:text-left",
        chip: "h-7 rounded-[calc(var(--ds-radius-control)-0.125rem)] bg-wash-hover px-2.5 text-caption text-fg-muted hover:bg-wash-pill hover:text-fg data-[state=open]:bg-wash-pill data-[state=open]:text-fg",
      },
      compact: { true: "", false: "" },
    },
    compoundVariants: [
      { appearance: "field", compact: false, className: "h-10 px-3.5 text-body-sm" },
      { appearance: "field", compact: true, className: "h-7 px-2.5 text-caption" },
    ],
    defaultVariants: { appearance: "ghost", compact: false },
  },
);

type SelectOption = { value: string; label: string; description?: string };

export function Select({ value, onValueChange, options, label, disabled, icon, className, appearance, compact }: {
  value: string;
  onValueChange: (value: string) => void;
  options: SelectOption[];
  label: string;
  disabled?: boolean;
  icon?: React.ReactNode;
  className?: string;
} & VariantProps<typeof triggerVariants>) {
  const id = React.useId();
  const portalContainer = usePortalContainer();
  const trigger = React.useRef<HTMLButtonElement>(null);
  const panel = React.useRef<HTMLDivElement>(null);
  const search = React.useRef({ text: "", time: 0 });
  const [open, setOpen] = React.useState(false);
  const [active, setActive] = React.useState(0);
  if (disabled && open) setOpen(false);

  const positionPanel = React.useCallback(() => {
    const button = trigger.current;
    const menu = panel.current;
    if (!button || !menu) return;
    const rect = button.getBoundingClientRect();
    const viewport = window.visualViewport;
    const left = viewport?.offsetLeft ?? 0;
    const top = viewport?.offsetTop ?? 0;
    const width = viewport?.width ?? window.innerWidth;
    const height = viewport?.height ?? window.innerHeight;
    if (rect.bottom <= top || rect.top >= top + height || rect.right <= left || rect.left >= left + width) {
      setOpen(false);
      return;
    }
    const below = top + height - rect.bottom - 14;
    const above = rect.top - top - 14;
    menu.style.width = `${Math.min(rect.width, width - 16)}px`;
    menu.style.maxWidth = `${width - 16}px`;
    const viewportElement = menu.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]');
    if (!viewportElement) return;
    const rows = Array.from(viewportElement.children).slice(0, 5) as HTMLElement[];
    const gap = parseFloat(getComputedStyle(viewportElement).rowGap) || 0;
    const padding = parseFloat(getComputedStyle(menu).paddingTop) * 2;
    const fiveRowsHeight = rows.reduce((height, row) => height + row.offsetHeight, padding) + Math.max(0, rows.length - 1) * gap;
    const downward = below >= fiveRowsHeight || below >= above;
    menu.style.height = `${Math.max(0, Math.min(fiveRowsHeight, downward ? below : above))}px`;
    menu.style.left = `${Math.max(left + 8, Math.min(rect.right - menu.offsetWidth, left + width - menu.offsetWidth - 8))}px`;
    menu.style.top = `${downward ? rect.bottom + 6 : rect.top - menu.offsetHeight - 6}px`;
  }, []);

  const openMenu = (index = Math.max(0, options.findIndex((option) => option.value === value))) => {
    setActive(index);
    setOpen(true);
    trigger.current?.focus({ preventScroll: true });
  };

  const closeMenu = React.useCallback(() => {
    setOpen(false);
    search.current = { text: "", time: 0 };
  }, []);

  const choose = (index: number) => {
    const option = options[index];
    if (!option) return;
    onValueChange(option.value);
    closeMenu();
    trigger.current?.focus({ preventScroll: true });
  };

  React.useLayoutEffect(() => {
    if (open) positionPanel();
  }, [open, options, positionPanel]);

  React.useEffect(() => {
    if (!open) return;
    panel.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  React.useEffect(() => {
    if (!open) return;
    const reposition = (event: Event) => {
      if (event.target instanceof Node && panel.current?.contains(event.target)) return;
      positionPanel();
    };
    const dismiss = (event: Event) => {
      if (event.target instanceof Node && !panel.current?.contains(event.target) && !trigger.current?.contains(event.target)) closeMenu();
    };
    document.addEventListener("pointerdown", dismiss, true);
    document.addEventListener("focusin", dismiss);
    window.addEventListener("resize", positionPanel);
    window.addEventListener("scroll", reposition, true);
    window.visualViewport?.addEventListener("resize", positionPanel);
    window.visualViewport?.addEventListener("scroll", positionPanel);
    return () => {
      document.removeEventListener("pointerdown", dismiss, true);
      document.removeEventListener("focusin", dismiss);
      window.removeEventListener("resize", positionPanel);
      window.removeEventListener("scroll", reposition, true);
      window.visualViewport?.removeEventListener("resize", positionPanel);
      window.visualViewport?.removeEventListener("scroll", positionPanel);
    };
  }, [open, positionPanel, closeMenu]);

  const onKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    const last = options.length - 1;
    if (event.key === "Tab") {
      closeMenu();
      return;
    }
    if (event.key === "Escape") {
      closeMenu();
      return;
    }
    if (["ArrowDown", "ArrowUp", "Home", "End", "Enter", " "].includes(event.key)) {
      event.preventDefault();
      if (!open) openMenu(event.key === "Home" ? 0 : event.key === "End" ? last : undefined);
      else if (event.key === "Enter" || event.key === " ") choose(active);
      else setActive(event.key === "Home" ? 0 : event.key === "End" ? last : Math.max(0, Math.min(last, active + (event.key === "ArrowDown" ? 1 : -1))));
      return;
    }
    if (event.key.length !== 1 || event.ctrlKey || event.metaKey || event.altKey) return;
    event.preventDefault();
    const now = performance.now();
    const letter = event.key.toLocaleLowerCase();
    const text = open && now - search.current.time < 700 ? search.current.text + letter : letter;
    search.current = { text, time: now };
    const query = [...text].every((character) => character === letter) ? letter : text;
    const start = open ? active : options.findIndex((option) => option.value === value);
    const index = options.findIndex((_, offset) => options[(start + offset + 1) % options.length].label.toLocaleLowerCase().startsWith(query));
    if (index >= 0) {
      const match = (start + index + 1) % options.length;
      if (open) setActive(match);
      else openMenu(match);
    }
  };

  return (
    <>
      <button
        ref={trigger}
        type="button"
        role="combobox"
        aria-label={label}
        aria-haspopup="listbox"
        aria-controls={id}
        aria-expanded={open}
        aria-activedescendant={open ? `${id}-${active}` : undefined}
        disabled={disabled}
        data-slot="select-trigger"
        data-state={open ? "open" : "closed"}
        className={cn(triggerVariants({ appearance, compact }), className)}
        onClick={() => open ? closeMenu() : openMenu()}
        onKeyDown={onKeyDown}
      >
        {icon}
        <span data-slot="select-value">{options.find((option) => option.value === value)?.label}</span>
        <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="m5 6 3-3 3 3m-6 4 3 3 3-3" />
        </svg>
      </button>
      {open && createPortal(<div
        ref={panel}
        id={id}
        role="listbox"
        aria-label={label}
        data-slot="select-content"
        className="fixed z-50 m-0 flex min-w-48 origin-top-right animate-pop-in flex-col overflow-hidden rounded-shell border-0 bg-surface p-(--ds-space-frame) text-fg shadow-floating outline-none motion-reduce:animate-none"
      >
        <ScrollArea className="flex flex-col gap-0.5 [&>*]:shrink-0">
        {options.map((option, index) => (
          <div
            key={option.value}
            id={`${id}-${index}`}
            role="option"
            aria-selected={option.value === value}
            data-index={index}
            data-slot="select-item"
            data-state={option.value === value ? "checked" : "unchecked"}
            data-highlighted={active === index ? "" : undefined}
            className="relative flex w-full cursor-default items-center gap-2 rounded-control py-1.5 pr-8 pl-2.5 text-body-sm leading-5 text-fg-muted outline-none select-none transition-colors duration-150 data-[highlighted]:bg-wash-hover data-[highlighted]:text-fg data-[state=checked]:text-fg motion-reduce:transition-none [&_svg]:size-3.5 [&_svg]:shrink-0"
            onPointerMove={(event) => {
              if (event.pointerType === "mouse") setActive(index);
            }}
            onPointerDown={(event) => {
              if (event.pointerType === "mouse") event.preventDefault();
            }}
            onClick={() => choose(index)}
          >
            <span className="min-w-0 flex-1">
              {option.label}
              {option.description && <span className="mt-0.5 block text-caption text-fg-subtle">{option.description}</span>}
            </span>
            {option.value === value && (
              <svg className="absolute right-2.5 text-brand" aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                <path d="m3 8 3 3 7-7" />
              </svg>
            )}
          </div>
        ))}
        </ScrollArea>
      </div>, portalContainer ?? document.body)}
    </>
  );
}
