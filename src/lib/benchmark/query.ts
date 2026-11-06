import { createLoader, createParser, parseAsStringLiteral } from "nuqs/server";
import { categories } from "./types";

export const benchmarkQueryParsers = {
  source: parseAsStringLiteral(["all", "wikipedia_daily"]).withDefault("all"),
  category: parseAsStringLiteral([
    "all",
    ...categories.map((category) => category.id),
    "other",
  ]).withDefault("all"),
  run: createParser<string>({
    parse: (value) => value || null,
    serialize: (value) => value,
  }).withDefault("latest"),
};

export const loadBenchmarkQuery = createLoader(benchmarkQueryParsers);
