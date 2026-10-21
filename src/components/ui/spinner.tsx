import * as React from "react";
import { Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";

// The dashboard's spinner: a thin ring turning once a second, in the color of the text around it.
function Spinner({ className, ...props }: React.ComponentProps<"svg">) {
  return <Loader2 role="status" aria-label="Loading" data-slot="spinner" className={cn("size-4 animate-spin", className)} strokeWidth={1.5} {...props} />;
}

export { Spinner };
