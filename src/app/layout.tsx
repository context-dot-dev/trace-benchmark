import type { Metadata, Viewport } from "next";
import Script from "next/script";
import { NuqsAdapter } from "nuqs/adapters/next/app";

import { THEME_BOOT_SCRIPT } from "@/components/trace/theme-toggle";
import { dsFontVariables } from "@/lib/ds-fonts";

import "./globals.css";

export const metadata: Metadata = {
  title: "TRACE · Daily web scraping API benchmark",
  description: "Daily web scraping API benchmark: page access, latency percentiles, document quality, cost per page, and failure reasons for context.dev, Exa, Firecrawl, and Keenable on a new fresh sample every day, with confidence intervals and page-level data.",
  openGraph: {
    title: "TRACE · context.dev",
    description: "Daily web scraping API benchmark: page access, latency percentiles, document quality, cost per page, and failure reasons for context.dev, Exa, Firecrawl, and Keenable on a new fresh sample every day, with confidence intervals and page-level data.",
    type: "website",
  },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, colorScheme: "light dark" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${dsFontVariables} antialiased`} suppressHydrationWarning>
      <head>
        <Script id="theme-boot" strategy="beforeInteractive">
          {THEME_BOOT_SCRIPT}
        </Script>
      </head>
      <body>
        <a href="#main" className="sr-only top-0 left-1/2 z-1100 rounded-control bg-surface text-body-sm text-fg shadow-floating focus:not-sr-only focus:fixed focus:top-3 focus:-translate-x-1/2 focus:px-4 focus:py-2">
          Skip to content
        </a>
        <NuqsAdapter>{children}</NuqsAdapter>
      </body>
    </html>
  );
}
