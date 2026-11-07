#!/usr/bin/env node
/**
 * Tidy up a board from the command line — the end-of-draw check for an agent.
 *
 * The skill (or an MCP tool) writes a board and takes a snapshot to see it. What a snapshot cannot
 * say is whether the items are *arranged*: a note four pixels below its neighbour's top edge, a
 * diagram overlapping the table beside it because the table came out taller than guessed. This
 * runs the page's own tidy — `T` on the keyboard — over every item, writes the result to the
 * board file the way a drag does, and says what moved.
 *
 *   node scripts/tidy.mjs <board> [--theme <name>] [--port 3500] [--check]
 *
 * It drives the page rather than doing the arithmetic here, because the arithmetic needs every
 * item's measured height and a diagram's height is known only once ELK has laid it out in the real
 * webfonts. The same reason `snapshot.mjs` is a browser and not a parser; `snapshot.mjs --tidy` is
 * this followed by the picture.
 *
 * Exit codes: 0 done (or nothing to do) · 3 `--check` and the board was not tidy (nothing is
 * written) · 5 the page never became ready · 6 the server is not up.
 */
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import { signIn, storageState } from "./session.mjs";

const require = createRequire(import.meta.url);

/**
 * Tidy the board the page is showing and wait for the write. `page` must already be ready
 * (`data-dag-ready="1"`). Resolves to `{ moved, of, ids }`. With `dry`, the page says what it
 * would move and writes nothing.
 */
export async function tidyInPage(page, dry = false) {
  await page.evaluate((dry) => {
    delete document.documentElement.dataset.dagTidy;
    document.dispatchEvent(new CustomEvent("dag:tidy", { detail: { dry } }));
  }, dry);
  await page.waitForFunction(() => document.documentElement.dataset.dagTidy !== undefined, null, { timeout: 30_000 });
  const result = await page.evaluate(() => JSON.parse(document.documentElement.dataset.dagTidy ?? "{}"));
  /* Two frames, so the re-flow that follows the write has painted and `data-dag-bounds` is the
     tidy board's, not the untidy one's. */
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  return result;
}

/** Where every item is, as the page has it, for saying what a tidy did. */
export async function positionsInPage(page) {
  return page.evaluate(() =>
    Object.fromEntries(
      Array.from(document.querySelectorAll("[data-dag-item]")).map((el) => {
        const m = /translate\((-?[\d.]+)px, (-?[\d.]+)px\)/.exec(el.style.transform ?? "");
        return [el.dataset.dagItem, m ? { x: Number(m[1]), y: Number(m[2]) } : null];
      }),
    ),
  );
}

/** A Chromium: the one named in `ANYDAG_CHROMIUM`, Playwright's own, or a managed image's. */
export async function launch(chromium) {
  const candidates = [process.env.ANYDAG_CHROMIUM, undefined, "/opt/pw-browsers/chromium"].filter(
    (c, i, a) => a.indexOf(c) === i,
  );
  let last;
  for (const executablePath of candidates) {
    try {
      return await chromium.launch(executablePath ? { executablePath } : {});
    } catch (e) {
      last = e;
    }
  }
  throw last;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    console.log(`usage: node scripts/tidy.mjs <board> [--theme <name>] [--port <n>] [--check]
  <board>   the board name as in boards/<name>.board.md, e.g. reference/architecture
  --theme   paper (default) · neutral · paper-dark — sizes are measured in it
  --check   report whether the board is tidy and exit 3 if not; write nothing
exit 0 done · 3 not tidy (--check) · 5 not ready · 6 no server`);
    process.exit(0);
  }
  const opt = (name, dflt) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : dflt;
  };
  const board = args.find((a, i) => !a.startsWith("--") && !(args[i - 1] ?? "").startsWith("--"));
  const theme = opt("--theme", null);
  const port = Number(opt("--port", process.env.ANYDAG_PORT || 3500));
  const check = args.includes("--check");
  const origin = `http://127.0.0.1:${port}`;

  try {
    /* `/api/health` rather than a board route: those answer 401 until the sign-in below. */
    await fetch(`${origin}/api/health`);
  } catch {
    console.error(`no AnyDag server at ${origin} — run \`npm run dev\` first`);
    process.exit(6);
  }

  /* A board belongs to an account, and a tidy is a write to one. */
  let session;
  try {
    session = await signIn(origin);
  } catch (e) {
    console.error(String(e.message ?? e));
    process.exit(6);
  }

  const { chromium } = require("@playwright/test");
  const browser = await launch(chromium);
  const context = await browser.newContext({
    viewport: { width: 1600, height: 1200 },
    storageState: storageState(session.cookie),
  });
  const page = await context.newPage();
  const q = new URLSearchParams({ board, snapshot: "1" });
  if (theme) q.set("theme", theme);
  await page.goto(`${origin}/?${q}`);
  try {
    await page.waitForFunction(() => document.documentElement.dataset.dagReady === "1", null, { timeout: 30_000 });
    await page.evaluate(() => document.fonts.ready);
  } catch {
    await browser.close();
    console.log("not ready: the page never reported every item's size (a diagram that never laid out?)");
    process.exit(5);
  }

  const before = await positionsInPage(page);
  const result = await tidyInPage(page, check);
  const after = await positionsInPage(page);
  await browser.close();

  if (result.moved === 0) {
    console.log(`tidy  ${board}  already tidy (${result.of} item${result.of === 1 ? "" : "s"})`);
    process.exit(0);
  }
  console.log(
    `tidy  ${board}  ${check ? "would move" : "moved"} ${result.moved} of ${result.of} item${result.of === 1 ? "" : "s"}`,
  );
  for (const id of result.ids ?? []) {
    const a = before[id];
    const b = after[id];
    if (a && b && !check) console.log(`  ${id}  ${a.x},${a.y} → ${b.x},${b.y}`);
    else console.log(`  ${id}`);
  }
  process.exit(check ? 3 : 0);
}
