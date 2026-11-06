import type { Metadata, Viewport } from "next";
import Script from "next/script";

import { THEME_BOOT_SCRIPT } from "@/components/trace/theme-toggle";
import { dsFontVariables } from "@/lib/ds-fonts";

import "./globals.css";

export const metadata: Metadata = {
  title: "Scraping Bench · Context.dev",
  description: "Compare page access across Context, Exa, Firecrawl, and Keenable on the same daily sample, with historical useful-content results preserved.",
  openGraph: {
    title: "Scraping Bench · Context.dev",
    description: "Compare page access across Context, Exa, Firecrawl, and Keenable on the same daily sample, with historical useful-content results preserved.",
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
        {children}
      </body>
    </html>
  );
}
