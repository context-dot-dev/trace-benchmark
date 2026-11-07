import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  return [{ url: "https://trace.context.dev/", changeFrequency: "weekly", priority: 1 }];
}
