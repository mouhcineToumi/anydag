#!/usr/bin/env node
/**
 * Snapshot a board — or one item on it — as a PNG at 2×, and say what is wrong with it.
 *
 * This is the agent's eyes, on the Playwright the repo already installs, so a checkout is enough;
 * `anydag snapshot` is the same picture from the CLI.
 *
 *   node scripts/snapshot.mjs <board> [--item <id>] [--theme <name>] [--out <file.png>] [--port 3500] [--tidy] [--scale <n>]
 *
 * `--tidy` runs the page's tidy-up over the board first (see `tidy.mjs`) and writes the result to
 * the board file, so the picture is of the board as it will be read — which is what an agent wants
 * at the end of a draw.
 *
 * Prints, after the screenshot:
 *   - every diagnostic the parsers raise, as `CODE  line:col  message` (GET /__board/diagnostics)
 *   - every quality finding a laid-out diagram publishes, as `Q_CODE  item  id, id` (data-dag-quality)
 *   - any console error the page produced (the dev size assertion reports there)
 *
 * Exit codes: 0 clean · 4 the board has a parse error · 5 the page never became ready · 6 the
 * server is not up. Warnings and `Q_` findings never fail the run; they are advisory.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import { authed, signIn, storageState } from "./session.mjs";
import { launch, tidyInPage } from "./tidy.mjs";

const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const args = process.argv.slice(2);
if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
  console.log(`usage: node scripts/snapshot.mjs <board> [--item <id>] [--theme <name>] [--out <file.png>] [--port <n>] [--tidy]
  <board>   the board name as in boards/<name>.board.md, e.g. reference/architecture
  --item    fit one item rather than the whole board
  --theme   paper (default) · neutral · paper-dark
  --scale   device scale factor (default 2)
  --out     where to write the PNG (default: snapshots/<board>[-<item>].png under the repo)
  --tidy    tidy the board up first (writes the board file), then photograph it
exit 0 clean · 4 parse error · 5 not ready · 6 no server`);
  process.exit(0);
}
const opt = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : dflt;
};
const board = args.find((a, i) => !a.startsWith("--") && !(args[i - 1] ?? "").startsWith("--"));
const item = opt("--item", null);
const theme = opt("--theme", null);
const scale = Number(opt("--scale", "2")) || 2;
const port = Number(opt("--port", process.env.ANYDAG_PORT || 3500));
const tidyFirst = args.includes("--tidy");
const out =
  opt("--out", null) ??
  path.join(root, "snapshots", `${board.replace(/\//g, "-")}${item ? `-${item}` : ""}${theme ? `-${theme}` : ""}.png`);

const origin = `http://127.0.0.1:${port}`;

/* Is the server up at all? A clearer message than Playwright's net::ERR_CONNECTION_REFUSED.
   `/api/health` rather than a board route, which answers 401 until the line below has run. */
try {
  await fetch(`${origin}/api/health`);
} catch {
  console.error(`no AnyDag server at ${origin} — run \`npm run dev\` first`);
  process.exit(6);
}

/* Every board route wants the token the server started with, so the requests below go out with
   it. `?snapshot=1` is deliberately not a way past that: it strips the chrome, not the answer to
   the token — otherwise it would be a query string that reads the machine's documents. */
let session;
try {
  session = await signIn(origin);
} catch (e) {
  console.error(String(e.message ?? e));
  process.exit(6);
}

const q = new URLSearchParams({ board, snapshot: "1" });
if (item) q.set("item", item);
if (theme) q.set("theme", theme);

/* A machine with a Chromium already on it — a sandbox, a CI image — names it in `ANYDAG_CHROMIUM`, the
   same variable `playwright.config.ts` reads. Failing that, Playwright's own download; failing
   that, the one place a managed image tends to put one. `launch` in `tidy.mjs` is that search. */
const browser = await launch(chromium);
const context = await browser.newContext({
  viewport: { width: 1600, height: 1200 },
  deviceScaleFactor: scale,
  /* The session is httpOnly, so it cannot be set from a page script — this is the only way in. */
  storageState: storageState(session.cookie),
});
const page = await context.newPage();

const consoleProblems = [];
page.on("console", (msg) => {
  if (msg.type() === "error" || msg.type() === "warning") consoleProblems.push(msg.text());
});
page.on("pageerror", (e) => consoleProblems.push(String(e)));

await page.goto(`${origin}/?${q}`);
let ready = true;
try {
  await page.waitForFunction(() => document.documentElement.dataset.dagReady === "1", null, { timeout: 30_000 });
  await page.evaluate(() => document.fonts.ready);
} catch {
  ready = false;
}

/* Straighten the board before photographing it. The tidy is the page's own, run over every item
   and written to the file; what is printed is what moved. */
if (ready && tidyFirst) {
  const t = await tidyInPage(page);
  console.log(t.moved === 0 ? `tidy  already tidy (${t.of} items)` : `tidy  moved ${t.moved} of ${t.of} items: ${(t.ids ?? []).join(", ")}`);
}

/* One item: park the layer at 1:1 with the item at the origin and size the viewport to it. The page
   loads with the whole board fitted, so an element screenshot at that zoom is a thumbnail of the
   diagram rather than the diagram — `--item` is for the item at full size, at 2×. */
if (ready && item) {
  const r = await page.evaluate((id) => {
    const el = document.querySelector(`[data-dag-item="${id}"]`);
    if (!el) return null;
    const m = new DOMMatrixReadOnly(getComputedStyle(el).transform);
    return { x: m.e, y: m.f, w: el.offsetWidth, h: el.offsetHeight };
  }, item);
  if (r) {
    const pad = 48;
    const w = Math.min(4000, Math.ceil(r.w + pad * 2));
    const h = Math.min(4000, Math.ceil(r.h + pad * 2));
    await page.setViewportSize({ width: Math.max(400, w), height: Math.max(300, h) });
    /* The viewport refits the whole board on resize — after this evaluate returns, on the next
       frame — so the override has to land after that repaint or it is overwritten by the fit. */
    await page.waitForTimeout(200);
    await page.evaluate(
      ([x, y, pad]) => {
        const l = document.querySelector(".dag-layer");
        l.style.transformOrigin = "0 0";
        l.style.transform = `translate(${pad - x}px, ${pad - y}px)`;
        l.style.width = l.style.height = "100%";
      },
      [r.x, r.y, pad],
    );
    await page.waitForTimeout(150);
  }
}

/* Size the viewport to the board so the shot is the whole drawing, not whatever was on screen. */
if (ready && !item) {
  const bounds = await page.evaluate(() => JSON.parse(document.documentElement.dataset.dagBounds || "null"));
  if (bounds && bounds.w > 0 && bounds.h > 0) {
    const pad = 48;
    const w = Math.min(4000, Math.ceil(bounds.w + pad * 2));
    const h = Math.min(4000, Math.ceil(bounds.h + pad * 2));
    await page.setViewportSize({ width: Math.max(400, w), height: Math.max(300, h) });
    await page.keyboard.press("f");
    await page.waitForTimeout(150);
  }
}

fs.mkdirSync(path.dirname(out), { recursive: true });
/* `.dag-layer` is the transformed content layer, so an element screenshot is exactly the content's
   box and a board's first item touches the corner. Clip the page around it instead, with a margin,
   the way the fit leaves one on screen. */
{
  const box = await (item ? page.locator(`[data-dag-item="${item}"]`).first() : page.locator(".dag-layer")).boundingBox();
  const view = page.viewportSize() ?? { width: 1600, height: 1200 };
  const pad = 40;
  const x = Math.max(0, (box?.x ?? 0) - pad);
  const y = Math.max(0, (box?.y ?? 0) - pad);
  const w = Math.min(view.width - x, (box?.width ?? view.width) + pad * 2);
  const h = Math.min(view.height - y, (box?.height ?? view.height) + pad * 2);
  await page.screenshot({ path: out, clip: { x, y, width: w, height: h } });
}
console.log(`wrote ${path.relative(process.cwd(), out)}`);

/* What the parsers say — with the script's token on the request. An ask without it answers a 401
   whose body has no `board` and no `items`, and a missing list reads as an empty one: without this
   the script printed no diagnostic at all and exited 0 on a board full of errors, which is the
   exit code the skill's loop branches on. */
const diagRes = await authed(session.cookie)(`${origin}/__board/diagnostics?name=${encodeURIComponent(board)}`);
if (!diagRes.ok) {
  console.error(`could not read the diagnostics (${diagRes.status}) — the picture is written, the parse is unknown`);
  await browser.close();
  process.exit(6);
}
const diag = await diagRes.json();
let errors = 0;
for (const d of diag.board ?? []) {
  console.log(`${d.code}  board${d.line ? ` ${d.line}` : ""}  ${d.message}`);
  if (d.severity !== "warn") errors++;
}
for (const it of diag.items ?? []) {
  for (const d of it.diagnostics ?? []) {
    const where = d.line ? `${d.line}${d.col ? `:${d.col}` : ""}` : "";
    console.log(`${d.code}  ${it.id}${where ? ` ${where}` : ""}  ${d.message}`);
    if (d.severity === "error") errors++;
  }
}

/* What the drawing says about itself. */
const reports = ready
  ? await page.evaluate(() =>
      Array.from(document.querySelectorAll("[data-dag-quality]")).map((el) => ({
        item: el.closest("[data-dag-item]")?.dataset.dagItem ?? "?",
        ...JSON.parse(el.dataset.dagQuality ?? "{}"),
      })),
    )
  : [];
for (const r of reports) {
  const t = r.totals ?? {};
  const summary = Object.entries(t)
    .filter(([, v]) => v > 0)
    .map(([k, v]) => `${k}=${v}`)
    .join(" ");
  /* A finding the totals do not count — the frozen totals predate `Q_EDGE_OUTSIDE` and `Q_TEXT_CLIPPED` — still means
     the drawing is not clean. */
  const n = (r.findings ?? []).length;
  console.log(`quality  ${r.item}  ${summary || (n > 0 ? `${n} finding(s)` : "clean")}`);
  for (const f of r.findings ?? []) console.log(`${f.code}  ${r.item}  ${(f.ids ?? []).join(", ")}`);
}

for (const p of consoleProblems) console.log(`console  ${p}`);

await browser.close();
if (!ready) {
  console.log("not ready: the page never reported every item's size (a diagram that never laid out?)");
  process.exit(5);
}
if (errors > 0) process.exit(4);
