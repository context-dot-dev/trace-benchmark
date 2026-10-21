import * as React from "react";

import { cn } from "@/lib/utils";

// The dashboard's field (INPUT_CLASS): 40px, a light border that darkens on hover and turns brand blue on focus.
function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "flex h-10 w-full min-w-0 rounded-control border border-line bg-surface px-3.5 text-body-sm text-fg transition-[border-color,box-shadow] duration-150 ease-out outline-none placeholder:text-fg-subtle hover:border-line-strong focus:border-brand disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-danger file:border-0 file:bg-transparent file:text-body-sm file:text-fg motion-reduce:transition-none",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
