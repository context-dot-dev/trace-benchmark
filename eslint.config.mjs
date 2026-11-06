import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    ".next/**",
    "src/app/.well-known/workflow/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "src/components/site/**",
    "src/components/ui/**",
    "src/components/visuals/**",
    "src/hooks/**",
  ]),
]);

export default eslintConfig;
