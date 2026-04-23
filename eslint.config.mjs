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
    // Stale agent worktrees shouldn't pollute CI.
    ".claude/**",
    // Committed snapshot checked into the repo; not application code.
    "data/genres.json.backup*",
    // Manual test harness (CommonJS)
    "test-colour.js",
  ]),
]);

export default eslintConfig;
