"use client";

import * as React from "react";
import * as AccordionPrimitive from "@radix-ui/react-accordion";
import { ArrowUp, Minus, Plus } from "lucide-react";

import { Accordion, AccordionItem } from "@/components/ui/accordion";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

// The site's FAQ: the heading, a line and a call to action on the left; category pills and a stack of question cards
// on the right. Each question is its own white card in the soft blue ring, its answer hanging off a small corner rule,
// and the last card is an "Ask anything" field. Opening a card closes the others; the answer grows open and fades in.
// Every category is stacked in one grid cell, so switching tabs never moves the page, and `sizing` decides what an
// opened answer does: hold room for the tallest one (`reserved`), scroll inside the closed height (`closed`), or grow.

type FaqItem = { id?: string; question: string; answer: React.ReactNode };
type FaqCategory = { value: string; label: string; items: FaqItem[] };
type FaqToggle = "plus" | "dots";
/**
 * `reserved` holds room for the tallest open answer, so nothing below ever moves; `closed` fixes the list at its height
 * with every answer closed and scrolls inside it, fading the edge with more cards beyond it; `stacked` keeps every
 * category at the tallest one's height and lets an opened answer grow the list; `content` lets the list grow with each
 * tab and answer.
 */
type FaqSizing = "reserved" | "closed" | "stacked" | "content";

// The card's surface: white with the raised hairline shadow.
const CARD = "rounded-card bg-surface shadow-raised";
// The soft blue glass ring around each card: a wrapper 8px wider on every side rather than a spread shadow, so the ring's
// outer edge shares the card's radius; the negative margin keeps it from adding size.
const RING = "-m-2 rounded-card bg-ring-tint p-2";
// The question's type, shared by the ask field so the two read as one stack.
const QUESTION = "text-body-lg leading-snug font-medium tracking-tight text-fg";
// The answer's block: a corner rule and the muted text, with room on the right where the toggle sits above.
const ANSWER = "flex gap-2.5 pr-16 pl-5 text-body-sm leading-relaxed text-fg-muted";

/** The answer's corner rule: a short line down and across, tying the answer to its question. */
function FaqAnswerRule() {
  return <span aria-hidden="true" className="h-6 w-3 shrink-0 rounded-bl-card border-b border-l border-neutral-30" />;
}

const DOTS = 5;
const PITCH = 4;
const cells = Array.from({ length: DOTS * DOTS }, (_, i) => ({ x: i % DOTS, y: Math.floor(i / DOTS) }));
const MIDDLE = Math.floor(DOTS / 2);

/**
 * The open and close mark in the brand's dot grid: a plus of solid dots on a field of rings that becomes a cross while
 * its card is open. Needs the card to be the Tailwind `group` with Radix's data-state.
 */
function FaqToggleDots({ className }: { className?: string }) {
  const dot = (picked: (c: { x: number; y: number }) => boolean, r: number) => cells.filter(picked).map(({ x, y }) => <circle key={`${x}:${y}`} cx={(x + 0.5) * PITCH} cy={(y + 0.5) * PITCH} r={r} />);
  return (
    <svg aria-hidden="true" viewBox={`0 0 ${DOTS * PITCH} ${DOTS * PITCH}`} data-slot="faq-toggle-dots" className={cn("text-fg-brand", className)}>
      <g fill="none" stroke="currentColor" strokeWidth={0.7} opacity={0.3}>
        {dot(() => true, 1)}
      </g>
      <g fill="currentColor" className="transition-opacity duration-200 ease-out group-data-[state=open]:opacity-0 motion-reduce:transition-none">
        {dot(({ x, y }) => x === MIDDLE || y === MIDDLE, 1.35)}
      </g>
      <g fill="currentColor" className="opacity-0 transition-opacity duration-200 ease-out group-data-[state=open]:opacity-100 motion-reduce:transition-none">
        {dot(({ x, y }) => x === y || x === DOTS - 1 - y, 1.35)}
      </g>
    </svg>
  );
}

/** One question card. Use inside FaqList (or any single Accordion). */
function FaqCard({ item, value, toggle = "plus", className }: { item: FaqItem; value: string; toggle?: FaqToggle; className?: string }) {
  return (
    <div className={RING}>
      <AccordionItem
        value={value}
        data-slot="faq-card"
        // The whole card turns light gray on hover, only where hovering is real.
        className={cn("group border-b-0 transition-[background-color] duration-200 ease-out [@media(hover:hover)]:hover:bg-subtle motion-reduce:transition-none", CARD, className)}
      >
        <AccordionPrimitive.Header className="flex">
          <AccordionPrimitive.Trigger className="flex flex-1 cursor-pointer items-center gap-5 rounded-card px-5 py-4 text-left outline-none focus-visible:ring-2 focus-visible:ring-focus-ring">
            <span className={cn("flex-1", QUESTION)}>{item.question}</span>
            {toggle === "dots" ? (
              <FaqToggleDots className="size-6 shrink-0" />
            ) : (
              <span aria-hidden="true" className="shrink-0 rounded-pill bg-wash-pill p-2.5 text-fg shadow-key">
                <Plus className="block size-4 group-data-[state=open]:hidden" strokeWidth={2} />
                <Minus className="hidden size-4 group-data-[state=open]:block" strokeWidth={2} />
              </span>
            )}
          </AccordionPrimitive.Trigger>
        </AccordionPrimitive.Header>
        {/* Always mounted so the row track can animate from 0fr to 1fr (the answer's real height) and back, the height on
          the ease-in-out curve while it moves on screen and the fade a beat shorter; closed answers are invisible, which
          also takes them out of the accessibility tree. Reduced motion keeps only the fade. */}
        <AccordionPrimitive.Content
          forceMount
          data-slot="faq-answer-track"
          className="grid transition-[grid-template-rows,opacity,visibility] duration-250 ease-in-out data-[state=closed]:invisible data-[state=closed]:grid-rows-[0fr] data-[state=closed]:opacity-0 data-[state=open]:grid-rows-[1fr] motion-reduce:transition-[opacity,visibility] motion-reduce:duration-200"
        >
          <div data-slot="faq-answer" className="min-h-0 overflow-hidden">
            <div className={cn(ANSWER, "pt-1 pb-5")}>
              <FaqAnswerRule />
              <div className="flex-1 pt-3">{item.answer}</div>
            </div>
          </div>
        </AccordionPrimitive.Content>
      </AccordionItem>
    </div>
  );
}

const MIN_QUESTION_LENGTH = 3;

/**
 * The closing "Ask anything" card: a field and the brand-blue send button, which waits for three characters. Pass
 * `onAsk` to receive the question, then `pending` while you fetch, and `answer` (or `error`) to show the reply under it;
 * or `children` to put your own content in the card.
 */
function FaqAskCard({
  placeholder = "Ask anything",
  onAsk,
  pending = false,
  answer,
  error,
  children,
  className,
}: {
  placeholder?: string;
  onAsk?: (question: string) => void;
  pending?: boolean;
  answer?: React.ReactNode;
  error?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}) {
  const id = React.useId();
  const [question, setQuestion] = React.useState("");
  const canSubmit = question.trim().length >= MIN_QUESTION_LENGTH && !pending;
  const reply = pending ? "Thinking…" : (error ?? answer);
  return (
    <div className={RING}>
      <div data-slot="faq-ask-card" className={cn("relative isolate overflow-hidden", CARD, className)}>
        {children ?? (
          <form
            className="flex items-center gap-5 px-5 py-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (canSubmit) onAsk?.(question.trim());
            }}
          >
            <label htmlFor={id} className="sr-only">
              {placeholder}
            </label>
            {/* At least 16px, or iOS Safari zooms the page into the field. */}
            <input
              id={id}
              name="question"
              type="text"
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              maxLength={500}
              autoComplete="off"
              placeholder={placeholder}
              className={cn("min-w-0 flex-1 bg-transparent outline-none placeholder:text-fg-faint", QUESTION)}
            />
            <button
              type="submit"
              aria-label="Ask"
              disabled={!canSubmit}
              className="shrink-0 rounded-control bg-brand p-2.5 text-on-brand shadow-key transition-[background-color,opacity,scale] duration-150 ease-out outline-none hover:bg-blue-90 focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-40 disabled:active:scale-100 motion-reduce:transition-none motion-reduce:active:scale-100"
            >
              {pending ? <Spinner aria-hidden="true" className="block text-on-brand" strokeWidth={2} /> : <ArrowUp className="block size-4" strokeWidth={2} />}
            </button>
          </form>
        )}
        {reply && (
          <div aria-live="polite" className={cn(ANSWER, "-mt-3 animate-content-in pb-5")}>
            <FaqAnswerRule />
            <div className={cn("flex-1 pt-3", error && !pending && "text-danger")}>{reply}</div>
          </div>
        )}
      </div>
    </div>
  );
}

const TWO_COLUMN_QUERY = "(min-width: 64rem)";

// The container's panels: each category's stack in a tabbed section, or the single list inside the container.
function panelsOf(container: HTMLElement) {
  const panels = [...container.querySelectorAll<HTMLElement>(":scope > [data-slot=faq-panel]")];
  return panels.length ? panels : [(container.firstElementChild as HTMLElement | null) ?? container];
}

// Each panel's height with every answer closed, and with its tallest answer open. Closed answers already sit at 0fr, so
// a panel's closed height is its height less the answers showing now, and each answer's scrollHeight is its open size.
function measurePanels(container: HTMLElement) {
  let closed = 0;
  let tallest = 0;
  for (const panel of panelsOf(container)) {
    const answers = [...panel.querySelectorAll<HTMLElement>("[data-slot=faq-answer]")];
    const panelClosed = panel.offsetHeight - answers.reduce((sum, answer) => sum + answer.offsetHeight, 0);
    closed = Math.max(closed, panelClosed);
    tallest = Math.max(tallest, panelClosed + Math.max(0, ...answers.map((answer) => answer.scrollHeight)));
  }
  return { closed, tallest };
}

// Fades whichever edge of the scrolling list has more cards beyond it, so a card cut off there reads as continuing.
function syncEdgeFades(container: HTMLElement) {
  container.toggleAttribute("data-fade-top", container.scrollTop > 1);
  container.toggleAttribute("data-fade-bottom", container.scrollTop + container.clientHeight < container.scrollHeight - 1);
}

// Scrolls the list just far enough to show the whole of a card that has finished opening.
function revealCard(container: HTMLElement, card: HTMLElement) {
  const { scrollPaddingTop, scrollPaddingBottom } = getComputedStyle(container);
  const top = card.offsetTop - container.offsetTop - (parseFloat(scrollPaddingTop) || 0);
  const bottom = card.offsetTop - container.offsetTop + card.offsetHeight + (parseFloat(scrollPaddingBottom) || 0);
  const visibleBottom = container.scrollTop + container.clientHeight;
  const target = bottom > visibleBottom ? Math.min(top, bottom - container.clientHeight) : Math.min(container.scrollTop, top);
  container.scrollTo({ top: target, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
}

/**
 * Sizes a FAQ list or tabbed stack for `reserved` or `closed`. Re-measures when the width changes and once fonts load.
 * With `reserved`, the room held under the list is published as `--faq-reserved-room` on the nearest
 * `[data-faq-layout]`, so a picture beside the list can stay level with its last card.
 */
function useFaqSizing(ref: React.RefObject<HTMLElement | null>, sizing: FaqSizing) {
  React.useLayoutEffect(() => {
    const container = ref.current;
    if (!container || (sizing !== "reserved" && sizing !== "closed")) return;
    const layout = container.closest<HTMLElement>("[data-faq-layout]");

    const size = () => {
      if (sizing === "closed") {
        const { paddingTop, paddingBottom } = getComputedStyle(container);
        container.style.height = `${measurePanels(container).closed + (parseFloat(paddingTop) || 0) + (parseFloat(paddingBottom) || 0)}px`;
        syncEdgeFades(container);
        return;
      }
      container.style.minHeight = "";
      // Stacked in one column, the room only opens a gap under the list; the section can grow there instead.
      if (layout && !window.matchMedia(TWO_COLUMN_QUERY).matches) {
        layout.style.removeProperty("--faq-reserved-room");
        return;
      }
      const { closed, tallest } = measurePanels(container);
      container.style.minHeight = `${tallest}px`;
      layout?.style.setProperty("--faq-reserved-room", `${tallest - closed}px`);
    };

    let measuredWidth = -1;
    const sizeIfWidthChanged = () => {
      if (container.offsetWidth === measuredWidth) return;
      measuredWidth = container.offsetWidth;
      size();
    };
    sizeIfWidthChanged();
    void document.fonts?.ready.then(size);
    const observer = new ResizeObserver(sizeIfWidthChanged);
    observer.observe(container);

    // In a scrolling list, a card that finishes opening scrolls into view; the fade's transition ends under reduced motion.
    const onTransitionEnd = (event: TransitionEvent) => {
      const track = event.target as HTMLElement;
      if (track.dataset.slot !== "faq-answer-track" || (event.propertyName !== "grid-template-rows" && event.propertyName !== "opacity")) return;
      const card = track.closest<HTMLElement>("[data-slot=faq-card]");
      if (card?.dataset.state === "open") revealCard(container, card);
      syncEdgeFades(container);
    };
    const onScroll = () => syncEdgeFades(container);
    if (sizing === "closed") {
      container.addEventListener("transitionend", onTransitionEnd);
      container.addEventListener("scroll", onScroll, { passive: true });
    }

    return () => {
      observer.disconnect();
      container.removeEventListener("transitionend", onTransitionEnd);
      container.removeEventListener("scroll", onScroll);
      container.style.height = "";
      container.style.minHeight = "";
      container.removeAttribute("data-fade-top");
      container.removeAttribute("data-fade-bottom");
      layout?.style.removeProperty("--faq-reserved-room");
    };
  }, [ref, sizing]);
}

// A fixed-height list scrolls, which would clip the cards' rings, so it is padded out by the ring's width; its scroll
// padding matches the edge fade, so a card revealed after opening stops clear of it.
const SCROLLING =
  "-m-2 overflow-y-auto overscroll-contain p-2 scroll-py-12 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden " +
  "data-fade-top:[mask-image:linear-gradient(to_bottom,transparent,var(--ds-color-black)_var(--ds-space-12))] " +
  "data-fade-bottom:[mask-image:linear-gradient(to_top,transparent,var(--ds-color-black)_var(--ds-space-12))] " +
  "data-fade-top:data-fade-bottom:[mask-image:linear-gradient(to_bottom,transparent,var(--ds-color-black)_var(--ds-space-12),var(--ds-color-black)_calc(100%-var(--ds-space-12)),transparent)]";

/** A stack of question cards where opening one closes the rest, optionally ending with the ask card. */
function FaqList({
  items,
  toggle,
  ask,
  sizing = "content",
  idPrefix = "faq",
  className,
}: {
  items: FaqItem[];
  toggle?: FaqToggle;
  ask?: React.ReactNode;
  sizing?: FaqSizing;
  idPrefix?: string;
  className?: string;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  useFaqSizing(ref, sizing);
  return (
    <div ref={ref} data-slot="faq-list" className={cn(sizing === "closed" && SCROLLING, className)}>
      <div className="flex flex-col gap-5">
        <Accordion type="single" collapsible className="flex flex-col gap-5">
          {items.map((item) => (
            <FaqCard key={item.id ?? item.question} value={item.id ?? `${idPrefix}-${item.question}`} item={item} toggle={toggle} />
          ))}
        </Accordion>
        {ask}
      </div>
    </div>
  );
}

/** Question cards in two columns from md (one open at a time across both), one column on phones. */
function FaqCardGrid({ items, toggle, idPrefix = "faq", className }: { items: FaqItem[]; toggle?: FaqToggle; idPrefix?: string; className?: string }) {
  const valued = items.map((item) => ({ item, value: item.id ?? `${idPrefix}-${item.question}` }));
  const column = (picked: typeof valued) => (
    <div className="flex flex-1 flex-col gap-5">
      {picked.map(({ item, value }) => (
        <FaqCard key={value} value={value} item={item} toggle={toggle} />
      ))}
    </div>
  );
  return (
    <div data-slot="faq-card-grid" className={className}>
      <Accordion type="single" collapsible className="hidden gap-5 md:flex">
        {column(valued.filter((_, i) => i % 2 === 0))}
        {column(valued.filter((_, i) => i % 2 !== 0))}
      </Accordion>
      <Accordion type="single" collapsible className="flex flex-col gap-5 md:hidden">
        {column(valued)}
      </Accordion>
    </div>
  );
}

/**
 * The product and landing pages' FAQ: questions on hairline rules inside one white ringed card, a brand-blue plus and
 * minus, the first answer open. It holds room for the tallest answer, so opening one never moves the page.
 */
function FaqPlainList({ items, idPrefix = "faq", className }: { items: FaqItem[]; idPrefix?: string; className?: string }) {
  const ref = React.useRef<HTMLDivElement>(null);
  useFaqSizing(ref, "reserved");
  const values = items.map((item, i) => item.id ?? `${idPrefix}-${i}`);
  return (
    <div ref={ref} data-slot="faq-plain-list" className={cn("rounded-card bg-surface px-6 ring-1 ring-hairline md:px-8", className)}>
      <Accordion type="single" collapsible defaultValue={values[0]}>
        {items.map((item, i) => (
          <AccordionItem key={values[i]} value={values[i]} className="group border-t border-b-0 border-hairline py-5 first:border-t-0 md:py-6">
            <AccordionPrimitive.Header className="flex">
              <AccordionPrimitive.Trigger className="flex flex-1 cursor-pointer items-center justify-between gap-5 rounded-sm text-left text-body-lg leading-snug tracking-normal text-fg outline-none focus-visible:ring-2 focus-visible:ring-focus-ring">
                {item.question}
                <Plus aria-hidden="true" className="size-4 shrink-0 text-fg-brand group-data-[state=open]:hidden" />
                <Minus aria-hidden="true" className="size-4 shrink-0 text-fg-brand group-data-[state=closed]:hidden" />
              </AccordionPrimitive.Trigger>
            </AccordionPrimitive.Header>
            {/* Opens instantly, like the brand's; mounted so the list can measure every answer. */}
            <AccordionPrimitive.Content forceMount className="grid data-[state=closed]:invisible data-[state=closed]:grid-rows-[0fr] data-[state=open]:grid-rows-[1fr]">
              <div data-slot="faq-answer" className="min-h-0 overflow-hidden">
                <div className="mt-3 text-body-sm leading-relaxed text-fg-secondary">{item.answer}</div>
              </div>
            </AccordionPrimitive.Content>
          </AccordionItem>
        ))}
      </Accordion>
    </div>
  );
}

/** The left column: the heading with its brand-blue accent, a line and a call to action, centered on phones. */
function FaqHeader({ title, description, action, className }: { title: React.ReactNode; description?: React.ReactNode; action?: React.ReactNode; className?: string }) {
  return (
    <div data-slot="faq-header" className={cn("mb-8 flex flex-col items-center gap-8 text-center lg:items-start lg:text-left", className)}>
      <div className="flex max-w-(--ds-layout-text) flex-col items-center gap-6 lg:items-start">
        <h2 className="text-h2 leading-none tracking-tight text-fg md:text-h1">{title}</h2>
        {description && <p className="text-body-lg leading-6.5 text-fg-nav">{description}</p>}
        {action}
      </div>
    </div>
  );
}

/**
 * The whole section: header on the left (with an optional `aside` under it, where the brand puts an illustration),
 * category tabs and the question stack on the right. `ask` ends every category's stack; pass false to leave it out.
 */
function FaqSection({
  title = (
    <>
      Frequently asked <span className="text-fg-brand">questions</span>
    </>
  ),
  description,
  action,
  aside,
  categories,
  defaultCategory,
  ask = <FaqAskCard />,
  toggle,
  sizing = "reserved",
  className,
}: {
  title?: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  aside?: React.ReactNode;
  categories: FaqCategory[];
  defaultCategory?: string;
  ask?: React.ReactNode | false;
  toggle?: FaqToggle;
  sizing?: FaqSizing;
  className?: string;
}) {
  const panelsRef = React.useRef<HTMLDivElement>(null);
  useFaqSizing(panelsRef, sizing);
  const stacked = sizing !== "content";
  return (
    <Tabs
      data-slot="faq-section"
      data-faq-layout=""
      defaultValue={defaultCategory ?? categories[0]?.value}
      onValueChange={() => panelsRef.current?.scrollTo({ top: 0 })}
      className={cn("flex flex-col gap-0 lg:grid lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:items-start lg:gap-16", className)}
    >
      {/* Below lg the column dissolves, so the aside can follow the questions instead of sitting above them. Beside the
          list it stays level with the last card, not with the room held under it. */}
      <div className="contents lg:flex lg:flex-col lg:self-stretch">
        <FaqHeader title={title} description={description} action={action} />
        {aside && <div className="order-last mt-8 lg:order-none lg:mt-auto lg:mb-(--faq-reserved-room,0px)">{aside}</div>}
      </div>
      <div className="min-w-0">
        {categories.length > 1 && (
          // On phones the pills scroll sideways, the last one fading out to say so.
          <div className="mb-5 overflow-x-auto px-1 pt-1 pb-3 [mask-image:linear-gradient(to_right,var(--ds-color-black)_calc(100%-var(--ds-space-10)),transparent)] sm:[mask-image:none] md:mb-7">
            <TabsList variant="pill" aria-label="FAQ categories" className="mx-auto w-max gap-0.5 sm:gap-2">
              {categories.map((category) => (
                <TabsTrigger key={category.value} value={category.value} className="px-2.5 py-1.5 text-caption leading-snug hover:text-fg sm:px-5 sm:py-2.5 sm:text-body">
                  {category.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>
        )}
        <div ref={panelsRef} className={cn("grid", sizing === "closed" && SCROLLING)}>
          {categories.map((category) => (
            <TabsContent
              key={category.value}
              value={category.value}
              forceMount
              data-slot="faq-panel"
              className={stacked ? "[grid-area:1/1] data-[state=inactive]:invisible" : "data-[state=inactive]:hidden"}
            >
              <FaqList items={category.items} toggle={toggle} ask={ask || undefined} idPrefix={`faq-${category.value}`} className="mx-auto max-w-(--ds-layout-heading) lg:max-w-none" />
            </TabsContent>
          ))}
        </div>
      </div>
    </Tabs>
  );
}

export { FaqSection, FaqHeader, FaqList, FaqCardGrid, FaqPlainList, FaqCard, FaqAskCard, FaqToggleDots, useFaqSizing, type FaqItem, type FaqCategory, type FaqToggle, type FaqSizing };
