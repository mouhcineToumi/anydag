import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { sealId } from "../../src/board/envelope";

import { ApiError, EXIT } from "../api";
import { UsageError, bool, list, num, str } from "../args";
import { diagnosticLines, type Diagnosed } from "../board";
import { emit, type Command, type Ctx } from "../context";
import { exportZip } from "./files";

/**
 * The three things only a laid-out page can answer — what a board looks like, whether it is tidy,
 * and what its export is.
 *
 * The first three open the page in Playwright against the server this command reaches (the
 * running app's, or one this process listens with), carrying its token — which is what closes the
 * loop MCP had to leave open. They need a built page (`npm run build`).
 * Playwright is loaded only here, so every other command works on a machine without it.
 *
 * The page is driven the way `scripts/snapshot.mjs` and `scripts/tidy.mjs` drive it: `?snapshot=1`
 * strips the chrome and reads no preference, `data-dag-ready` says every item has its size, and a
 * document event asks for a tidy or an export.
 */

interface Browser {
  close(): Promise<void>;
  newContext(o: Record<string, unknown>): Promise<BrowserContext>;
}
interface BrowserContext {
  newPage(): Promise<Page>;
}
interface Page {
  on(ev: string, f: (x: { type?: () => string; text?: () => string } & Error) => void): void;
  goto(url: string): Promise<unknown>;
  waitForFunction(f: string | (() => boolean), arg?: unknown, o?: { timeout: number }): Promise<unknown>;
  evaluate<T, A = unknown>(f: string | ((a: A) => T | Promise<T>), arg?: A): Promise<T>;
  setViewportSize(s: { width: number; height: number }): Promise<void>;
  keyboard: { press(k: string): Promise<void> };
  waitForTimeout(ms: number): Promise<void>;
  locator(s: string): { first(): { boundingBox(): Promise<Box | null> }; boundingBox(): Promise<Box | null> };
  viewportSize(): { width: number; height: number } | null;
  screenshot(o: { path: string; clip: Box }): Promise<unknown>;
  pdf(o: { path?: string; preferCSSPageSize?: boolean; printBackground?: boolean; format?: string }): Promise<Buffer>;
}
type Box = { x: number; y: number; width: number; height: number };

/** A Chromium: the one `ANYDAG_CHROMIUM` names, Playwright's own, or where a managed image keeps one. */
async function launch(ctx: Ctx): Promise<Browser> {
  let chromium: { launch(o: Record<string, unknown>): Promise<Browser> };
  try {
    const mod = (await import("@playwright/test")) as unknown as {
      chromium: typeof chromium;
      default?: { chromium: typeof chromium };
    };
    chromium = mod.chromium ?? mod.default!.chromium;
  } catch {
    throw new ApiError(
      "this needs Playwright and a browser, which an AnyDag checkout has after `npm install` — everything else works without it; open it in the app to see it",
      EXIT.failed,
    );
  }
  const candidates = [ctx.env.ANYDAG_CHROMIUM, undefined, "/opt/pw-browsers/chromium"].filter((c, i, a) => a.indexOf(c) === i);
  let last: unknown;
  for (const executablePath of candidates) {
    try {
      return await chromium.launch(executablePath ? { executablePath } : {});
    } catch (e) {
      last = e;
    }
  }
  throw new ApiError(
    `no browser would start: ${last instanceof Error ? last.message.split("\n")[0] : String(last)}`,
    EXIT.failed,
  );
}

/** A page on this board, signed in as this terminal, ready — or the exit code for why not. */
async function openBoard(
  ctx: Ctx,
  board: string,
  q: { item?: string; theme?: string; page?: string; scale?: number },
): Promise<{ browser: Browser; page: Page; problems: string[] } | number> {
  /* The board exists and this session can read it, asked of the api first: a page that never
     becomes ready says nothing about *why*, and a 404 or a 401 does. */
  await ctx.api.get("/__board/get", { name: board });
  const params = new URLSearchParams({ board, snapshot: "1" });
  if (q.item) params.set("item", q.item);
  if (q.theme) params.set("theme", q.theme);
  if (q.page) params.set("page", q.page);
  return openPage(ctx, board, params, q.scale);
}

/** A note's page, the same way: asked of the api first, then opened under `?snapshot=1` and waited for. */
async function openNote(
  ctx: Ctx,
  note: string,
  q: { theme?: string },
): Promise<{ browser: Browser; page: Page; problems: string[] } | number> {
  await ctx.api.get("/__board/get", { name: note, kind: "note" });
  const params = new URLSearchParams({ note, snapshot: "1" });
  if (q.theme) params.set("theme", q.theme);
  return openPage(ctx, note, params, 1);
}

async function openPage(
  ctx: Ctx,
  label: string,
  params: URLSearchParams,
  scale?: number,
): Promise<{ browser: Browser; page: Page; problems: string[] } | number> {
  const browser = await launch(ctx);
  const context = await browser.newContext({ viewport: { width: 1600, height: 1200 }, deviceScaleFactor: scale ?? 2 });
  const page = await context.newPage();
  const problems: string[] = [];
  page.on("console", (m) => {
    if (m.type?.() === "error" || m.type?.() === "warning") problems.push(m.text?.() ?? "");
  });
  page.on("pageerror", (e) => problems.push(String(e)));
  /* In the vault the command was asked in, as the page's own links are. */
  if (ctx.vault) params.set("vault", ctx.vault);
  /* A server that draws the page: the app's, or — with none running — one this process listens
     with on an ephemeral port. `?token=` is swapped for a cookie by the server and cleaned off the
     address, which is how a browser is let in (`server/app.ts`). */
  /* `ANYDAG_WEB` names a page served somewhere else that reaches the same server — the Vite dev
     server, which proxies the routes and adds the token itself. */
  const elsewhere = ctx.env.ANYDAG_WEB?.replace(/\/+$/, "");
  const served = elsewhere ? null : await ctx.conn.listen(pageDir(ctx.env));
  if (!elsewhere && !served) {
    await browser.close();
    throw new ApiError("there is no built page to open — run `npm run build`, or start the app", EXIT.failed);
  }
  const web = elsewhere ?? `http://127.0.0.1:${served!.port}`;
  if (served) params.set("token", served.token);
  await page.goto(`${web}/?${params}`);
  try {
    await page.waitForFunction("document.documentElement.dataset.dagReady === '1'", null, { timeout: 30_000 });
    await page.evaluate("document.fonts.ready");
  } catch {
    await browser.close();
    ctx.io.err(
      `${label} never became ready — the page did not report every item's size (is ${web} the web app, not only the api?)`,
    );
    return EXIT.notReady;
  }
  return { browser, page, problems };
}

/** Tidy the page the way `T` does, and wait for its answer. */
async function tidyIn(page: Page, dry: boolean): Promise<{ moved: number; of: number; ids?: string[] }> {
  await page.evaluate((d: boolean) => {
    delete document.documentElement.dataset.dagTidy;
    document.dispatchEvent(new CustomEvent("dag:tidy", { detail: { dry: d } }));
  }, dry);
  await page.waitForFunction("document.documentElement.dataset.dagTidy !== undefined", null, { timeout: 30_000 });
  const out = await page.evaluate<{ moved: number; of: number; ids?: string[] }>(
    "JSON.parse(document.documentElement.dataset.dagTidy ?? '{}')",
  );
  await page.evaluate("new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))");
  return out;
}

const QUALITY = `Array.from(document.querySelectorAll("[data-dag-quality]")).map((el) => ({
  item: el.closest("[data-dag-item]")?.dataset.dagItem ?? "?",
  ...JSON.parse(el.dataset.dagQuality ?? "{}"),
}))`;

/** The built page: `ANYDAG_PAGE`, else the checkout's `dist/` beside the bundle (`cli/dist/anydag.mjs`). */
function pageDir(env: NodeJS.ProcessEnv): string {
  if (env.ANYDAG_PAGE) return path.resolve(env.ANYDAG_PAGE);
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "dist");
}

const fileStem = (s: string) => s.replace(/[^\w.-]+/g, "-");

export const PICTURE: Command[] = [
  {
    name: ["snapshot"],
    group: "picture",
    args: "<board>",
    min: 1,
    summary: "a PNG of a board, or one item, and every problem the text and the drawing have",
    help:
      "The agent's eyes: the page is opened as you, laid out in the real webfonts, and photographed. Printed after: " +
      "each diagnostic (`CODE item line:col message`), each quality finding the drawing measured of itself (`Q_*`), " +
      "and anything the page logged. Exit 4 when the board has an error; `Q_` findings are advisory and never fail it. " +
      "--tidy straightens the board first and writes that, so the picture is of the board as it will be read.",
    flags: [
      { name: "item", type: "string", value: "<id>", help: "one item, at full size" },
      { name: "page", type: "string", value: "<page>", help: "which page of the board" },
      { name: "theme", type: "string", value: "<theme>", help: "paper (default) · paper-dark · neutral" },
      { name: "scale", type: "string", value: "<n>", help: "device scale factor (default 2)" },
      { name: "out", short: "o", type: "string", value: "<file.png>", help: "where to write it (default ./<board>.png)" },
      { name: "tidy", type: "boolean", help: "tidy the board first — a write" },
    ],
    routes: ["GET /__board/get", "GET /__board/diagnostics"],
    async run(ctx, p) {
      const board = p.pos[0]!;
      const item = str(p, "item");
      const out = str(p, "out") ?? `${fileStem(board)}${item ? `-${fileStem(item)}` : ""}.png`;
      const opened = await openBoard(ctx, board, { item, theme: str(p, "theme"), page: str(p, "page"), scale: num(p, "scale") });
      if (typeof opened === "number") return opened;
      const { browser, page, problems } = opened;
      try {
        if (bool(p, "tidy")) {
          const t = await tidyIn(page, false);
          ctx.io.err(
            t.moved === 0
              ? `tidy  already tidy (${t.of} items)`
              : `tidy  moved ${t.moved} of ${t.of}: ${(t.ids ?? []).join(", ")}`,
          );
        }
        const pad = 48;
        if (item) {
          /* One item: park the layer at 1:1 with the item at the origin, the viewport its size. */
          const r = await page.evaluate<{ x: number; y: number; w: number; h: number } | null, string>((id) => {
            const el = document.querySelector<HTMLElement>(`[data-dag-item="${id}"]`);
            if (!el) return null;
            const m = new DOMMatrixReadOnly(getComputedStyle(el).transform);
            return { x: m.e, y: m.f, w: el.offsetWidth, h: el.offsetHeight };
          }, item);
          if (!r) throw new UsageError(`no item \`${item}\` on ${board}`);
          await page.setViewportSize({
            width: Math.max(400, Math.min(4000, Math.ceil(r.w + pad * 2))),
            height: Math.max(300, Math.min(4000, Math.ceil(r.h + pad * 2))),
          });
          await page.waitForTimeout(200);
          await page.evaluate<void, number[]>(
            ([x, y, d]) => {
              const l = document.querySelector<HTMLElement>(".dag-layer")!;
              l.style.transformOrigin = "0 0";
              l.style.transform = `translate(${d! - x!}px, ${d! - y!}px)`;
              l.style.width = l.style.height = "100%";
            },
            [r.x, r.y, pad],
          );
          await page.waitForTimeout(150);
        } else {
          const bounds = await page.evaluate<{ w: number; h: number } | null>(
            "JSON.parse(document.documentElement.dataset.dagBounds || 'null')",
          );
          if (bounds && bounds.w > 0 && bounds.h > 0) {
            await page.setViewportSize({
              width: Math.max(400, Math.min(4000, Math.ceil(bounds.w + pad * 2))),
              height: Math.max(300, Math.min(4000, Math.ceil(bounds.h + pad * 2))),
            });
            await page.keyboard.press("f");
            await page.waitForTimeout(150);
          }
        }
        const box = await (item ? page.locator(`[data-dag-item="${item}"]`).first() : page.locator(".dag-layer")).boundingBox();
        const view = page.viewportSize() ?? { width: 1600, height: 1200 };
        const edge = 40;
        const x = Math.max(0, (box?.x ?? 0) - edge);
        const y = Math.max(0, (box?.y ?? 0) - edge);
        fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
        await page.screenshot({
          path: out,
          clip: {
            x,
            y,
            width: Math.min(view.width - x, (box?.width ?? view.width) + edge * 2),
            height: Math.min(view.height - y, (box?.height ?? view.height) + edge * 2),
          },
        });
        const quality =
          await page.evaluate<{ item: string; totals?: Record<string, number>; findings?: { code: string; ids?: string[] }[] }[]>(
            QUALITY,
          );
        const diag = await ctx.api.get<Diagnosed>("/__board/diagnostics", { name: board });
        emit(ctx, { out, diagnostics: diag, quality, console: problems }, () => {
          ctx.io.out(out);
          for (const line of diagnosticLines(diag)) ctx.io.out(line);
          for (const q of quality) {
            const t = Object.entries(q.totals ?? {})
              .filter(([, v]) => v > 0)
              .map(([k, v]) => `${k}=${v}`)
              .join(" ");
            const n = (q.findings ?? []).length;
            ctx.io.out(`quality  ${q.item}  ${t || (n > 0 ? `${n} finding(s)` : "clean")}`);
            for (const f of q.findings ?? []) ctx.io.out(`${f.code}  ${q.item}  ${(f.ids ?? []).join(", ")}`);
          }
          for (const line of problems) ctx.io.out(`console  ${line}`);
        });
        return (diag.errors ?? 0) > 0 ? EXIT.errors : EXIT.ok;
      } finally {
        await browser.close();
      }
    },
  },
  {
    name: ["tidy"],
    group: "picture",
    args: "<board>",
    min: 1,
    summary: "straighten a board — rows exact, gaps even, nothing overlapping — and write it; --check only says",
    help:
      "The page's own tidy (`space T`), run over every item on the page with the sizes the browser measured, and " +
      "written as one edit. --check writes nothing and exits 3 when the board is not tidy, which makes it the " +
      "end-of-draw check. A tidy board tidies to itself.",
    flags: [
      { name: "check", type: "boolean", help: "say whether it is tidy; write nothing" },
      { name: "page", type: "string", value: "<page>", help: "which page" },
      { name: "theme", type: "string", value: "<theme>", help: "the theme sizes are measured in" },
    ],
    routes: ["GET /__board/get"],
    async run(ctx, p) {
      const board = p.pos[0]!;
      const opened = await openBoard(ctx, board, { theme: str(p, "theme"), page: str(p, "page"), scale: 1 });
      if (typeof opened === "number") return opened;
      try {
        const check = bool(p, "check");
        const t = await tidyIn(opened.page, check);
        emit(ctx, t, () => {
          if (t.moved === 0) ctx.io.out(`${board}: already tidy (${t.of} item${t.of === 1 ? "" : "s"})`);
          else ctx.io.out(`${board}: ${check ? "would move" : "moved"} ${t.moved} of ${t.of} — ${(t.ids ?? []).join(", ")}`);
        });
        return check && t.moved > 0 ? EXIT.conflict : EXIT.ok;
      } finally {
        await opened.browser.close();
      }
    },
  },
  {
    name: ["board", "export"],
    args: "<board>",
    min: 1,
    summary: "a board, or some items, as .board.md, a zip with its files, SVG or PNG — the files the Export menu saves",
    help:
      "md is the board's own text carrying its permanent id, so importing it elsewhere keeps every reference to it " +
      "working; it needs no browser. zip is that text with every picture and attachment it names beside it, each " +
      "`dag:` naming an attachment rewritten to the file's path — what the menu saves for a board that " +
      "names any. svg and png are the page's own export, fonts embedded, at the vault's export settings — laid " +
      "out in a browser, which this opens.",
    flags: [
      { name: "format", type: "string", value: "<md|zip|svg|png>", help: "default: from --out's extension, else md" },
      { name: "item", type: "list", value: "<id>", help: "export these items only; repeatable" },
      {
        name: "out",
        short: "o",
        type: "string",
        value: "<file>",
        help: "where to write it (default: stdout for md, ./<board>.<ext>)",
      },
    ],
    routes: ["GET /__board/get", "GET /__board/index", "GET /__board/file", "GET /__board/assets/{path:path}"],
    async run(ctx, p) {
      const board = p.pos[0]!;
      const out = str(p, "out");
      const format = str(p, "format") ?? (out ? path.extname(out).slice(1) : "md");
      if (format !== "md" && format !== "zip" && format !== "svg" && format !== "png")
        throw new UsageError("--format is md, zip, svg or png");
      if (format === "md" || format === "zip") {
        const got = await ctx.api.get<{ text: string; id?: string }>("/__board/get", { name: board });
        const text = got.id ? sealId(got.text, got.id) : got.text;
        if (format === "zip") return exportZip(ctx, board, "board", text, out);
        if (out) {
          fs.writeFileSync(out, text);
          ctx.io.err(`wrote ${out}`);
        } else ctx.io.write(text);
        return;
      }
      const ids = list(p, "item").length ? list(p, "item") : undefined;
      const opened = await openBoard(ctx, board, { scale: 1 });
      if (typeof opened === "number") return opened;
      try {
        const result = await opened.page.evaluate<{ ok: boolean; value: string }, { kind: string; ids?: string[] }>(
          (d) =>
            new Promise((resolve) => {
              document.dispatchEvent(
                new CustomEvent("dag:export", {
                  detail: {
                    kind: d.kind,
                    ids: d.ids,
                    reply: (value: string) => resolve({ ok: true, value }),
                    fail: (value: string) => resolve({ ok: false, value }),
                  },
                }),
              );
              setTimeout(
                () => resolve({ ok: false, value: "the page did not answer — is this app older than `dag:export`?" }),
                60_000,
              );
            }),
          { kind: format, ids },
        );
        if (!result.ok) throw new ApiError(`could not export: ${result.value}`, EXIT.failed);
        const bytes =
          format === "svg" ? Buffer.from(result.value, "utf8") : Buffer.from(result.value.replace(/^data:[^,]*,/, ""), "base64");
        const file = out ?? `${fileStem(board)}${ids?.length === 1 ? `-${fileStem(ids[0]!)}` : ""}.${format}`;
        fs.writeFileSync(file, bytes);
        emit(ctx, { out: file, bytes: bytes.length }, () => ctx.io.out(file));
      } finally {
        await opened.browser.close();
      }
    },
  },
  {
    name: ["note", "export"],
    args: "<note>",
    min: 1,
    summary: "a note as .note.md, a zip with its files, or PDF — the files the Export menu saves",
    help:
      "md is the note's own text, and needs no browser. zip is that text with every picture and attachment it " +
      "names beside it, each attachment's `dag:` rewritten to the file's path. pdf is the page's own print of it: the note drawn " +
      "read-only, embedded boards and all, in a light theme whatever --theme the screen wears — laid out in a " +
      "browser, which this opens, and printed there with the page's own print stylesheet.",
    flags: [
      { name: "format", type: "string", value: "<md|zip|pdf>", help: "default: from --out's extension, else md" },
      { name: "theme", type: "string", value: "<name>", help: "the theme the page opens in; a dark one prints in the default" },
      {
        name: "out",
        short: "o",
        type: "string",
        value: "<file>",
        help: "where to write it (default: stdout for md, ./<note>.pdf)",
      },
    ],
    routes: ["GET /__board/get", "GET /__board/index", "GET /__board/file", "GET /__board/assets/{path:path}"],
    async run(ctx, p) {
      const note = p.pos[0]!;
      const out = str(p, "out");
      const format = str(p, "format") ?? (out ? path.extname(out).slice(1) : "md");
      if (format !== "md" && format !== "zip" && format !== "pdf") throw new UsageError("--format is md, zip or pdf");
      if (format === "md" || format === "zip") {
        const got = await ctx.api.get<{ text: string }>("/__board/get", { name: note, kind: "note" });
        if (format === "zip") return exportZip(ctx, note, "note", got.text, out);
        if (out) {
          fs.writeFileSync(out, got.text);
          ctx.io.err(`wrote ${out}`);
        } else ctx.io.write(got.text);
        return;
      }
      const opened = await openNote(ctx, note, { theme: str(p, "theme") });
      if (typeof opened === "number") return opened;
      try {
        /* The page sets the note out for paper — `NotePrint`, what the menu prints — and answers once
           every picture and embed in it has arrived. Then Chromium prints it, as the menu's dialog would. */
        const result = await opened.page.evaluate<{ ok: boolean; value: string }>(
          () =>
            new Promise((resolve) => {
              document.dispatchEvent(
                new CustomEvent("dag:export", {
                  detail: {
                    kind: "pdf",
                    reply: (value: string) => resolve({ ok: true, value }),
                    fail: (value: string) => resolve({ ok: false, value }),
                  },
                }),
              );
              setTimeout(
                () => resolve({ ok: false, value: "the page did not answer — is this app older than a note's PDF export?" }),
                60_000,
              );
            }),
        );
        if (!result.ok) throw new ApiError(`could not export: ${result.value}`, EXIT.failed);
        const file = out ?? `${fileStem(note)}.pdf`;
        const bytes = await opened.page.pdf({ path: file, preferCSSPageSize: true, printBackground: true });
        emit(ctx, { out: file, bytes: bytes.length, title: result.value }, () => ctx.io.out(file));
      } finally {
        await opened.browser.close();
      }
    },
  },
];
