#!/usr/bin/env node
/**
 * Bundle the local server: `server/main.ts` and everything it imports from `src/`, `plugins/` and
 * its own `handle.ts` (once the local server) into one ESM file — `cli/build.mjs`'s move, for its reason: the grammar is
 * TypeScript with extensionless imports, and the server runs the page's own code, not a copy.
 *
 * `@parcel/watcher` stays outside the bundle: it is the one native module (N-API, prebuilt), and a
 * `.node` file cannot be inlined.
 *
 * **What a build bakes in.** A checkout's build bakes in nothing. The release and nightly
 * workflows hand this script `ANYDAG_LOGS_BUILD_URL` and `ANYDAG_FEEDBACK_BUILD_URL`
 * (`https://api.anydag.com/v1/logs` and `/v1/feedback`) — where the running server sends anonymous
 * logs and the feedback relay to, each after its own yes, and each losing to its runtime override
 * (`ANYDAG_LOGS_URL`, `ANYDAG_FEEDBACK_URL`). Nothing reads them until #103's `cloud` switch is on.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
export const BUNDLE = path.join(here, "dist", "anydag-server.mjs");

/**
 * What a build bakes in: the version, and — from the two `_BUILD_URL` variables the release and
 * nightly workflows set (`https://api.anydag.com/v1/logs` and `/v1/feedback`) — where the running
 * server sends anonymous logs and the feedback relay. A checkout's build bakes in nothing at all,
 * and nothing reads these until #103's `cloud` switch is on: a build before that contacts nothing.
 */
export function defines(env = process.env) {
  return {
    __ANYDAG_VERSION__: JSON.stringify(version()),
    __ANYDAG_LOGS_URL__: JSON.stringify(env.ANYDAG_LOGS_BUILD_URL ?? ""),
    __ANYDAG_FEEDBACK_URL__: JSON.stringify(env.ANYDAG_FEEDBACK_BUILD_URL ?? ""),
    /* `ANYDAG_CLOUD_BUILD=on` is the switch for every server-backed feature (`server/features.ts`):
       off unless a build says on, and no release does. */
    __ANYDAG_CLOUD__: JSON.stringify(env.ANYDAG_CLOUD_BUILD === "on" ? "on" : ""),
  };
}

/** @returns {string} */
function version() {
  return fs.readFileSync(path.join(root, "VERSION"), "utf8").trim();
}

export async function build() {
  const { build: esbuild } = await import("esbuild");
  await esbuild({
    absWorkingDir: root,
    /* The grammar's worker and the listing's beside the server (`server/grammar-worker.ts`,
       `server/list-worker.ts`): `server/grammar.ts` and `server/listing.ts` look for each next to
       whichever bundle they are in. */
    entryPoints: {
      "anydag-server": "server/main.ts",
      "grammar-worker": "server/grammar-worker.ts",
      "list-worker": "server/list-worker.ts",
    },
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    outdir: path.dirname(BUNDLE),
    outExtension: { ".js": ".mjs" },
    banner: { js: "import{createRequire as __acr}from'node:module';const require=__acr(import.meta.url);" },
    external: ["@parcel/watcher", "@playwright/test", "playwright", "playwright-core", "esbuild"],
    /* Where logs and feedback go when nothing at run time says (#99), and the `cloud` switch
       (`server/features.ts`, #103). */
    define: defines(),
    logLevel: "warning",
  });
  return BUNDLE;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  await build();
  console.log(path.relative(process.cwd(), BUNDLE));
}
