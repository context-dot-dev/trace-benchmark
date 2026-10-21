"use client";

import * as React from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";

import { usePortalContainer } from "@/lib/surface";
import { TooltipProvider, useTooltipScope } from "@/lib/tooltip-provider";
import { cn } from "@/lib/utils";

// Hovering waits a beat before the label appears, so passing over a control doesn't flash it; once one is showing,
// the next one within the warm window appears at once (Radix's skip delay), so sweeping a row of icons doesn't wait.
function Tooltip(props: React.ComponentProps<typeof TooltipPrimitive.Root>) {
  const shared = useTooltipScope();
  if (shared) return <TooltipPrimitive.Root data-slot="tooltip" {...props} />;
  return (
    <TooltipProvider>
      <TooltipPrimitive.Root data-slot="tooltip" {...props} />
    </TooltipProvider>
  );
}

function TooltipTrigger(props: React.ComponentProps<typeof TooltipPrimitive.Trigger>) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />;
}

// The dashboard's label: white, control corners, 11px on a hairline and a soft shadow, on one line unless `wrap`, 6px
// above (or 8px beside) its trigger. The first one hovered grows from its trigger in a short ease-out pop; the next ones
// in the warm window (Radix's instant open) appear at once. Reduced motion keeps only the fade.
function TooltipContent({ className, side = "right", sideOffset, wrap = false, children, ...props }: React.ComponentProps<typeof TooltipPrimitive.Content> & { wrap?: boolean }) {
  return (
    <TooltipPrimitive.Portal container={usePortalContainer()}>
      <TooltipPrimitive.Content
        data-slot="tooltip-content"
        side={side}
        sideOffset={sideOffset ?? (side === "left" || side === "right" ? 8 : 6)}
        className={cn(
          "z-50 origin-(--radix-tooltip-content-transform-origin) rounded-control bg-surface px-2 py-1 text-axis leading-4 text-fg shadow-tooltip data-[state=delayed-open]:animate-pop-in",
          wrap ? "w-max max-w-64 text-pretty" : "whitespace-nowrap",
          className,
        )}
        {...props}
      >
        {children}
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  );
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider };
