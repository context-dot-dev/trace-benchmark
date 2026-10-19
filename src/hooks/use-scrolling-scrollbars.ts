"use client";

import { useEffect } from "react";

const HIDE_AFTER_MS = 900;

/**
 * Marks a thin-scrollbar scroller with `data-scrolling` while it's being scrolled and for a moment after, so its
 * scrollbar shows only then, the way overlay scrollbars behave. Scroll events don't bubble, so one listener catches
 * them all on the way down.
 */
export function useScrollingScrollbars() {
  // The timeout is only created later by the subscribed scroll callback. This teardown removes that callback and clears
  // every timeout it can create; React Doctor's effect timer matcher descends into event callbacks as if they ran here.
  // react-doctor-disable-next-line react-doctor/effect-needs-cleanup
  useEffect(() => {
    const timers = new Map<HTMLElement, ReturnType<typeof setTimeout>>();
    function handleScroll(event: Event) {
      const scroller = event.target;
      if (!(scroller instanceof HTMLElement) || !scroller.classList.contains("ds-scrollbar")) return;
      scroller.dataset.scrolling = "";
      clearTimeout(timers.get(scroller));
      timers.set(
        scroller,
        setTimeout(() => {
          delete scroller.dataset.scrolling;
          timers.delete(scroller);
        }, HIDE_AFTER_MS),
      );
    }
    document.addEventListener("scroll", handleScroll, { capture: true, passive: true });
    return () => {
      document.removeEventListener("scroll", handleScroll, { capture: true });
      timers.forEach((timer, element) => { clearTimeout(timer); delete element.dataset.scrolling; });
    };
  }, []);
}
