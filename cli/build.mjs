#!/usr/bin/env node
/**
 * Bundle the CLI: `cli/main.ts` and everything it imports from `src/` into one ESM file.
 *
 * The same move `server/build.mjs` makes for the server, for the same reason: `src/board/`
 * and `src/dsl/` are TypeScript with extensionless imports, which Node cannot load as they stand,
 * and the CLI must run the page's own code rather than a copy of it.
 *
 * `meta.json` beside the bundle lists every source it was built from, which is what lets
 * `anydag.mjs` rebuild it the moment one of them is newer — a CLI carrying last week's grammar
 * would write edits the parser no longer agrees with, and nothing would say so.
 *
 * Playwright is left out of the bundle and loaded only by the three commands that open a browser,
 * so every other command starts without it and works on a machine that does not have it.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
export const BUNDLE = path.join(here, "dist", "anydag.mjs");
export const META = path.join(here, "dist", "meta.json");

export async function build() {
  const { build: esbuild } = await import("esbuild");
  const version = fs.readFileSync(path.join(root, "VERSION"), "utf8").trim();
  const result = await esbuild({
    absWorkingDir: root,
    /* The grammar's worker too, for the server the CLI and `anydag mcp` run in-process. */
    entryPoints: { anydag: "cli/main.ts", "grammar-worker": "server/grammar-worker.ts" },
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    outdir: path.dirname(BUNDLE),
    outExtension: { ".js": ".mjs" },
    /* A CommonJS dependency inside an ESM bundle calls `require`, which ESM does not define. */
    banner: { js: "import{createRequire as __acr}from'node:module';const require=__acr(import.meta.url);" },
    /* `@parcel/watcher` reaches this bundle through `server/vault.ts`'s import — a native module
     esbuild cannot inline, and the newer edge the CLI's `--vault` half never opens. It stays
     outside like `playwright` does; a machine that ships the bundle without it only breaks when a
     command opens a browser or serves in-process. */
  external: ["@parcel/watcher", "playwright", "playwright-core", "esbuild"],
    define: { __ANYDAG_VERSION__: JSON.stringify(version) },
    metafile: true,
    logLevel: "warning",
  });
  const inputs = Object.keys(result.metafile.inputs).filter((f) => !f.includes("node_modules"));
  fs.writeFileSync(META, JSON.stringify({ inputs: [...inputs, "VERSION"] }, null, 2));
  return BUNDLE;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  await build();
  console.log(path.relative(process.cwd(), BUNDLE));
}
