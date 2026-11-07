#!/usr/bin/env node
/**
 * `anydag` — run the bundled CLI, rebuilding it first when any source it was built from is newer.
 *
 * `npm link` in the repository puts this on the PATH; `npm run anydag -- <command>` runs it without
 * that. The staleness check is `meta.json`'s list of inputs against the bundle's mtime — a few
 * hundred `stat` calls, a couple of milliseconds — and it is skipped when esbuild is not there to
 * rebuild with, so a copy of the bundle on its own still runs.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const bundle = path.join(here, "dist", "anydag.mjs");
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
      /* A source that is gone is a source that changed. */
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
      console.error(`anydag: could not build the CLI (${e?.message ?? e}) — run \`npm install\` in ${root}`);
      process.exit(1);
    }
    /* No esbuild, or a source that does not compile: run what was built last, and say so once. */
    console.error(`anydag: running the last build — rebuilding failed: ${e?.message ?? e}`);
  }
}

const { main } = await import(pathToFileURL(bundle).href);
process.exitCode = await main(process.argv.slice(2));
