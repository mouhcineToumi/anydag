import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { docsRoot } from "../server/handle";
// @ts-expect-error — a plain `.mjs` with no types, as every script beside it
import { build } from "../server/build.mjs";

/**
 * #398: the build never put `docs/` beside the bundle, so a built server answered
 * `GET /__board/dsl` with `{"types":[]}` and every `dsl_reference` was a 404 — in `anydag serve`,
 * in `npm run serve`, and in the packaged desktop app. Only the unit suite saw the sheets, because
 * it imports `server/handle.ts` from source and `docsRoot`'s second layout is the repository's
 * `docs/`.
 *
 * So this check is the artifact, not the source: `server/build.mjs` builds into a temporary
 * directory, the bundle it made runs as its own process, and the sheet is asked for the way an
 * agent and the Inspector ask for it. `docsRoot` pins the layout the build has to satisfy — `docs/`
 * beside the bundle is the first place the server looks — and the request is the symptom.
 *
 * The directory sits under `node_modules/.cache/` rather than in the OS temp directory because the
 * bundle leaves the one native module, `@parcel/watcher`, external, and Node resolves it upward
 * from the bundle's own path.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TOKEN = "build-test-token";

let out = "";
let server: ChildProcess | null = null;
let origin = "";

/** What the bundle said as it started, for a failure that happened before it printed an address. */
let said = "";

async function started(child: ChildProcess): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`the bundle printed no address: ${said}`)), 20_000);
    const watch = (chunk: Buffer) => {
      said += chunk.toString();
      const got = /open (http:\/\/127\.0\.0\.1:\d+)\/\?token=/.exec(said)?.[1];
      if (!got) return;
      clearTimeout(timer);
      resolve(got);
    };
    child.stdout?.on("data", watch);
    child.stderr?.on("data", (chunk: Buffer) => {
      said += chunk.toString();
    });
    const gone = (code: number | null) => {
      clearTimeout(timer);
      reject(new Error(`the bundle exited ${code} before it answered: ${said}`));
    };
    child.once("exit", gone);
  });
}

beforeAll(async () => {
  const cache = path.join(ROOT, "node_modules", ".cache");
  fs.mkdirSync(cache, { recursive: true });
  out = fs.mkdtempSync(path.join(cache, "anydag-build-"));
  const vault = path.join(out, "vault");
  const home = path.join(out, "home");
  fs.mkdirSync(vault);
  fs.mkdirSync(home);
  await build({ outdir: out });

  /* The suite's own environment must not stand in for the build: a developer may have
     `ANYDAG_DOCS_DIR` set, and then this check would pass on a bundle that carries nothing. */
  const env = { ...process.env };
  delete env.ANYDAG_DOCS_DIR;
  delete env.ANYDAG_TOKEN;
  delete env.ANYDAG_VAULT;
  server = spawn(process.execPath, [path.join(out, "anydag-server.mjs"), vault, "--no-page", "--port", "0", "--token", TOKEN], {
    env: { ...env, ANYDAG_HOME: home, ANYDAG_CLOUD: "off" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  origin = await started(server);
}, 120_000);

afterAll(async () => {
  if (server) {
    const child = server;
    server = null;
    if (child.exitCode === null && child.signalCode === null) {
      await new Promise<void>((resolve) => {
        child.once("exit", () => resolve());
        child.kill("SIGTERM");
      });
    }
  }
  if (out) fs.rmSync(out, { recursive: true, force: true });
});

describe("the server bundle", () => {
  it("carries the sheets and the prompts beside it, where the server looks for them", () => {
    expect(docsRoot(out)).toBe(path.join(out, "docs"));
    /* What `handle.ts` reads: every `dsl/*.md` `/dsl` lists, and the two files `/system` assembles. */
    for (const file of ["dsl/common.md", "dsl/arch.md", "dsl/sketch.md", "generate/guide.md", "generate/flashcards.md"])
      expect(fs.existsSync(path.join(out, "docs", file)), file).toBe(true);
  });

  it("answers /__board/dsl with the sheets, as an agent reads them", async () => {
    const list = await fetch(`${origin}/__board/dsl`, { headers: { "x-anydag-token": TOKEN } });
    expect(list.status).toBe(200);
    const { types } = (await list.json()) as { types: string[] };
    /* Every sheet in the repository, and none invented: the built server lists what the build
       copied, so a bundle that shipped a folder of the wrong one fails here. */
    const sheets = fs
      .readdirSync(path.join(ROOT, "docs", "dsl"))
      .filter((f) => f.endsWith(".md"))
      .map((f) => f.slice(0, -3))
      .sort();
    expect(types).toEqual(sheets);
    expect(types).toEqual(expect.arrayContaining(["arch", "common", "sketch"]));

    const one = await fetch(`${origin}/__board/dsl?type=arch`, { headers: { "x-anydag-token": TOKEN } });
    expect(one.status).toBe(200);
    const { text } = (await one.json()) as { text: string };
    expect(text).toContain("browser --> api");
  });
});
