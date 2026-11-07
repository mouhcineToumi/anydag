#!/usr/bin/env node
/**
 * Bundle the Electron shell: `desktop/main.ts` and `desktop/preload.ts` into CJS under
 * `desktop/dist/` — what the `main` field of the packaged app points at, and what `desktop:dev`
 * runs. `electron` stays outside (it exists only in the app's runtime); `electron-updater` is
 * bundled into `main.cjs`. The version the preload and the logs say is the repository `VERSION`,
 * the same move `server/build.mjs` makes.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const DIST = path.join(here, "dist");

/** esbuild's options object, typed nowhere: the one file in the desktop that is plain JS. */
export async function build() {
  const { build: esbuild } = await import("esbuild");
  const version = fs.readFileSync(path.join(root, "VERSION"), "utf8").trim();
  await esbuild({
    absWorkingDir: root,
    entryPoints: [{ in: "desktop/main.ts", out: "main" }, { in: "desktop/preload.ts", out: "preload" }],
    bundle: true,
    platform: "node",
    external: ["electron"],
    format: "cjs",
    target: "node22",
    outdir: DIST,
    entryNames: "[name]",
    /* The repository is `"type": "module"`, so a `.js` here would be ESM; Electron wants CJS. */
    outExtension: { ".js": ".cjs" },
    define: { __ANYDAG_VERSION__: JSON.stringify(version) },
    logLevel: "warning",
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  await build();
  console.log(path.relative(process.cwd(), DIST));
}
