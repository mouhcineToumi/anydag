#!/usr/bin/env node
/**
 * Bundle the local server: `server/main.ts` and everything it imports from `src/`, `plugins/` and
 * its own `handle.ts` (once the local server) into one ESM file — `cli/build.mjs`'s move, for its reason: the grammar is
 * TypeScript with extensionless imports, and the server runs the page's own code, not a copy.
 *
 * `@parcel/watcher` stays outside the bundle: it is the one native module (N-API, prebuilt), and a
 * `.node` file cannot be inlined.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
export const BUNDLE = path.join(here, "dist", "anydag-server.mjs");

export async function build() {
  const { build: esbuild } = await import("esbuild");
  const version = fs.readFileSync(path.join(root, "VERSION"), "utf8").trim();
  await esbuild({
    absWorkingDir: root,
    /* The grammar's worker beside the server (`server/grammar-worker.ts`): `server/grammar.ts` looks
       for it next to whichever bundle it is in. */
    entryPoints: { "anydag-server": "server/main.ts", "grammar-worker": "server/grammar-worker.ts" },
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    outdir: path.dirname(BUNDLE),
    outExtension: { ".js": ".mjs" },
    banner: { js: "import{createRequire as __acr}from'node:module';const require=__acr(import.meta.url);" },
    external: ["@parcel/watcher", "@playwright/test", "playwright", "playwright-core", "esbuild"],
    /* Where logs go when nothing at run time says (`server/telemetry.ts`): a release names its own
       collector with `ANYDAG_LOGS_BUILD_URL`; a checkout's build names none. */
    define: { __ANYDAG_VERSION__: JSON.stringify(version), __ANYDAG_LOGS_URL__: JSON.stringify(process.env.ANYDAG_LOGS_BUILD_URL ?? "") },
    logLevel: "warning",
  });
  return BUNDLE;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  await build();
  console.log(path.relative(process.cwd(), BUNDLE));
}
