#!/usr/bin/env node
/**
 * `anydag-api` from a checkout — run the bundle, rebuilding it first when any source it was built
 * from is newer (`cli/anydag.mjs`'s launcher, for the api server). The image runs the bundle
 * directly and never this file.
 *
 * Load-bearing:
 * - **Staleness is `dist/meta.json`'s inputs against the bundle's mtime**, and the check is skipped
 *   when esbuild cannot be loaded, so a bundle copied somewhere on its own still runs.
 * - **The exit code is set, never forced**: `serve` returns once it is listening, and a
 *   `process.exit` here would stop the server it just started.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const bundle = path.join(here, "dist", "anydag-api.mjs");
const meta = path.join(here, "dist", "meta.json");

function stale() {
  let built;
  try {
    built = fs.statSync(bundle).mtimeMs;
  } catch {
    return true;
  }
  let inputs;
  try {
    inputs = JSON.parse(fs.readFileSync(meta, "utf8")).inputs;
  } catch {
    return true;
  }
  return inputs.some((f) => {
    try {
      return fs.statSync(path.join(root, f)).mtimeMs > built;
    } catch {
      return true;
    }
  });
}

if (stale()) {
  try {
    const { build } = await import("./build.mjs");
    await build();
  } catch (e) {
    if (!fs.existsSync(bundle)) {
      console.error(`anydag-api: could not build the server (${e?.message ?? e}) — run \`npm install\` in ${root}`);
      process.exit(1);
    }
    console.error(`anydag-api: running the last build — rebuilding failed: ${e?.message ?? e}`);
  }
}

const { main } = await import(pathToFileURL(bundle).href);
process.exitCode = await main(process.argv.slice(2));
