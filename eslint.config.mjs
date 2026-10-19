import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Copied from the Context.dev design system registry by `npx context-ds add`; updated there, not edited here.
    "src/components/site/**",
    "src/components/ui/**",
    "src/components/visuals/**",
    "src/hooks/**",
  ]),
]);

export default eslintConfig;
