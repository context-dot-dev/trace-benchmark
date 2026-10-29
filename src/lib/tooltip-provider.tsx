"use client";

import * as React from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";

const TooltipScope = React.createContext(false);

/** Share the dashboard's warm window across every tooltip in a surface. */
export function TooltipProvider({ delayDuration = 1000, skipDelayDuration = 300, children, ...props }: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
  return (
    <TooltipScope.Provider value>
      <TooltipPrimitive.Provider delayDuration={delayDuration} skipDelayDuration={skipDelayDuration} {...props}>
        {children}
      </TooltipPrimitive.Provider>
    </TooltipScope.Provider>
  );
}

export function useTooltipScope() {
  return React.useContext(TooltipScope);
}
