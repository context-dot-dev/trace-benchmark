"use client";

import * as React from "react";
import { Moon } from "lucide-react";

import { cn } from "@/lib/utils";

export type ThemeChoice = "system" | "light" | "dark";

export const THEME_STORAGE_KEY = "trace-theme";

export const THEME_BOOT_SCRIPT = `try{var t=localStorage.getItem("${THEME_STORAGE_KEY}");if(t==="light"||t==="dark"||t==="system")document.documentElement.dataset.theme=t}catch(e){}`;

function applyTheme(choice: ThemeChoice) {
  document.documentElement.dataset.theme = choice;
  try {
    localStorage.setItem(THEME_STORAGE_KEY, choice);
  } catch {
  }
  window.dispatchEvent(new Event("trace-theme-change"));
}

function readTheme(): ThemeChoice {
  const stored = document.documentElement.dataset.theme;
  return stored === "dark" || stored === "system" ? stored : "light";
}

const subscribe = (listener: () => void) => {
  window.addEventListener("trace-theme-change", listener);
  return () => window.removeEventListener("trace-theme-change", listener);
};

export function ThemeToggle({ className }: { className?: string }) {
  const current = React.useSyncExternalStore(subscribe, readTheme, () => "light" as ThemeChoice);
  const dark = current === "dark" || (current === "system" && typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  const next = dark ? "light" : "dark";

  return (
    <button
      type="button"
      aria-label="Dark appearance"
      aria-pressed={dark}
      title="Dark appearance"
      onClick={() => {
        applyTheme(next);
      }}
      className={cn("grid size-10.5 place-items-center rounded-pill border border-line bg-surface text-fg-muted transition-colors hover:text-fg max-[43.2rem]:size-11", className)}
    >
      <Moon aria-hidden="true" className="size-4" />
    </button>
  );
}
