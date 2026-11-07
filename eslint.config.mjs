// Type-aware promise checks, and nothing else. Every other static check is Biome's (`biome.json`).
//
// This file exists because the bug class that matters most here — an async gesture whose promise is
// dropped, so its failure vanishes — needs the real type checker: Biome's own promise rules infer
// types without `tsc`, miss every promise that comes from a library (`fs.readFile(…)` left
// unawaited) and flag the ordinary `Promise | undefined` guard (`if (running) return running`).
//
// It is slow for what it checks (the type information is the cost), so it is `npm run lint:promises`
// and its own CI job, and is not part of `scripts/checks.sh`, which sits in the commit hook.
import tseslint from "typescript-eslint";

/* Source carries `eslint-disable … react-hooks/exhaustive-deps` comments from before the codebase
   decided that rule is wrong for it (effects without a dependency list are deliberate; see
   CLAUDE.md). ESLint reports a directive naming a rule it does not know, so the rule is defined here
   as the nothing it is. */
const noop = { meta: { schema: [] }, create: () => ({}) };

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "release/**",
      "boards/**",
      "icons/data/**",
      "test-results/**",
      ".dev-home/**",
      "node_modules/**",
      "test/fixtures/**",
      "test/__golden__/**",
      "e2e/**/*-snapshots/**",
      "src/dsl/icon-names.ts",
      "src/dsl/emoji-names.ts",
      "src/render/icon-index.ts",
    ],
  },
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { project: ["./tsconfig.eslint.json"], tsconfigRootDir: import.meta.dirname },
    },
    plugins: {
      "@typescript-eslint": tseslint.plugin,
      "react-hooks": { rules: { "exhaustive-deps": noop } },
    },
    linterOptions: { reportUnusedDisableDirectives: "off" },
    rules: {
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/await-thenable": "error",
    },
  },
);
