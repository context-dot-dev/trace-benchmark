import * as React from "react";

import { cn } from "@/lib/utils";

const BAR =
  "group/announcement relative isolate flex min-h-11.5 w-full flex-wrap items-center justify-center gap-x-2 gap-y-0.5 overflow-hidden border-b border-wash-pill px-4 py-1 text-center text-caption leading-snug text-fg outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus-ring sm:text-body-sm";

/**
 * The one-line strip above the site's header: a cool gray band with a hairline under it, the message centered. As a
 * link, hover lays a neutral wash over the band rather than swapping its color, so the band keeps its hue.
 */
function AnnouncementBar({
  href,
  external = false,
  className,
  children,
}: {
  /** Makes the whole strip a link. */
  href?: string;
  /** Opens the link in a new tab. */
  external?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const content = (
    <>
      <span aria-hidden="true" data-slot="announcement-bar-surface" className="pointer-events-none absolute inset-0 -z-10 bg-announcement" />
      {href && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 -z-10 bg-wash-announcement opacity-0 transition-opacity duration-150 ease-out group-hover/announcement:opacity-100 motion-reduce:transition-none"
        />
      )}
      <span data-slot="announcement-bar-text" className="min-w-0">
        {children}
      </span>
    </>
  );
  return (
    <div data-slot="announcement-bar" className={cn("relative z-70 min-h-11.5 shrink-0 overflow-hidden", className)}>
      {href ? (
        <a href={href} target={external ? "_blank" : undefined} rel={external ? "noopener noreferrer" : undefined} className={BAR}>
          {content}
        </a>
      ) : (
        <div className={BAR}>{content}</div>
      )}
    </div>
  );
}

export { AnnouncementBar };
