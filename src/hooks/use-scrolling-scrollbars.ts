"use client";

import { useEffect } from "react";

const HIDE_AFTER_MS = 900;
let users = 0;
let disconnect: (() => void) | undefined;

function subscribeToScrollingScrollbars() {
  users += 1;
  const release = () => {
    users -= 1;
    if (users === 0) {
      disconnect?.();
      disconnect = undefined;
    }
  };
  if (disconnect) return release;
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
  disconnect = () => {
    document.removeEventListener("scroll", handleScroll, { capture: true });
    timers.forEach((timer, element) => { clearTimeout(timer); delete element.dataset.scrolling; });
  };
  return release;
}

export function useScrollingScrollbars() {
  useEffect(subscribeToScrollingScrollbars, []);
}
