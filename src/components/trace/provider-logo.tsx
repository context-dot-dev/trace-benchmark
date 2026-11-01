import Image from "next/image";

import { cn } from "@/lib/utils";

const LOGO_FILES: Record<string, string> = {
  exa: "/logos/exa.svg",
  keenable: "/logos/keenable.png",
  firecrawl: "/logos/firecrawl.png",
};

export function ContextMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 772.32 531.2" aria-hidden="true" className={cn("h-6 w-auto text-fg-brand", className)}>
      <path
        fill="currentColor"
        fillRule="evenodd"
        d="M287.56,0H745.26A27.06,27.06,0,0,1,772.32,27.06V484.77A27.06,27.06,0,0,1,745.26,511.83H284.51A24.01,24.01,0,0,1,260.5,487.82V27.06A27.06,27.06,0,0,1,287.56,0ZM260.5,358.28a153.55,153.55,0,1,0,307.1,0a153.55,153.55,0,1,0,-307.1,0Z"
      />
      <circle cx="153.55" cy="377.64" r="153.55" fill="currentColor" />
    </svg>
  );
}

export function ProviderLogo({ id, className = "size-4" }: { id: string; className?: string }) {
  if (id === "context") {
    return (
      <span aria-hidden="true" className={cn("inline-flex shrink-0 items-center justify-center", className)}>
        <ContextMark className="h-auto w-full" />
      </span>
    );
  }
  const src = LOGO_FILES[id];
  if (!src) return <span aria-hidden="true" className={cn("inline-block shrink-0 rounded-pill bg-neutral-20", className)} />;
  return (
    <span aria-hidden="true" className={cn("relative inline-flex shrink-0 overflow-hidden rounded-icon", className)}>
      <Image src={src} alt="" fill sizes="32px" unoptimized className="object-contain" />
    </span>
  );
}

export function ProviderName({ id, name, className, logoClassName, logoOnlyOnPhones = false }: { id: string; name: string; className?: string; logoClassName?: string; logoOnlyOnPhones?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2 text-fg", className)}>
      <ProviderLogo id={id} className={logoClassName} />
      <span className={cn(logoOnlyOnPhones && "max-sm:sr-only")}>{name}</span>
    </span>
  );
}
