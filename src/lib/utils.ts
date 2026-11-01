import { type ClassValue, clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      radius: ["sm", "control", "card", "shell", "panel", "pill"],
      shadow: ["card", "raised", "floating", "key", "tooltip", "ring-hover"],
    },
    classGroups: {
      "font-size": [{ text: ["hero", "hero-tablet", "hero-desktop", "display", "h1", "h2", "h3", "h4", "h5", "body-lg", "body", "body-sm", "caption", "axis", "counter", "initial", "composer", "stat", "metric"] }],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
