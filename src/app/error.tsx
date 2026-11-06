"use client";

import { Button } from "@/components/ui/button";

export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main id="main" className="mx-auto flex min-h-[70vh] max-w-160 flex-col items-start justify-center gap-6 px-6">
      <p className="text-body text-fg-brand">TRACE by context.dev</p>
      <h1 className="text-h2 tracking-tight">The benchmark data is unavailable right now.</h1>
      <p className="text-body leading-relaxed text-fg-muted">We could not load the benchmark results. Please try again in a moment to see the collected results.</p>
      <Button onClick={reset}>Try again</Button>
    </main>
  );
}
