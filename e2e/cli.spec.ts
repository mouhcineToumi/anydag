import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { expect, test, type Page } from "@playwright/test";

/**
 * The CLI against the running server, and the page drawing what it wrote.
 *
 * The one check in the suite that goes **only through the routes**: every write here is a command,
 * and every read is a command or the page — never `boards/` on disk. It is the proof the unit tests'
 * stubbed `fetch` points at, that the shapes the CLI expects are the shapes the routes answer.
 *
 * It finds the dev server the way a terminal finds the app: through `server.json` in the app's home,
 * which `npm run dev` keeps in `.dev-home/`. Its pictures are taken of the Vite page (`ANYDAG_WEB`),
 * since the dev server serves no page of its own.
 */

const run = promisify(execFile);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const WEB = `http://localhost:${Number(process.env.ANYDAG_PORT) || 3500}`;
const HOME = process.env.ANYDAG_HOME || path.join(ROOT, ".dev-home");

let config = "";
test.beforeAll(() => {
  config = fs.mkdtempSync(path.join(os.tmpdir(), "anydag-cli-e2e-"));
});
test.afterAll(() => fs.rmSync(config, { recursive: true, force: true }));

/** One command: its exit code, and what it printed on each stream. */
async function anydag(...args: string[]): Promise<{ code: number; out: string; err: string }> {
  try {
    const { stdout, stderr } = await run("node", [path.join(ROOT, "cli/anydag.mjs"), ...args], {
      cwd: config,
      env: { ...process.env, ANYDAG_HOME: HOME, ANYDAG_WEB: WEB, ANYDAG_VAULT: "" },
      timeout: 90_000,
    });
    return { code: 0, out: stdout, err: stderr };
  } catch (e) {
    const x = e as { code?: number; stdout?: string; stderr?: string };
    return { code: typeof x.code === "number" ? x.code : 1, out: x.stdout ?? "", err: x.stderr ?? "" };
  }
}

async function ready(page: Page, board: string) {
  await page.goto(`/?board=${encodeURIComponent(board)}&snapshot=1`);
  await page.waitForFunction(() => document.documentElement.dataset.dagReady === "1", null, { timeout: 20_000 });
}

let board = "";
test.beforeEach(async ({}, info) => {
  const made = await anydag("board", "new", `e2e-cli-${info.testId}`);
  expect(made.code, made.err).toBe(0);
  board = made.out.trim();
});
test.afterEach(async () => {
  await anydag("board", "rm", board, "--yes");
});

test("a diagram built card by card from a terminal is what the page draws", async ({ page }) => {
  expect((await anydag("item", "add", board, "arch", "--id", "stack", "--at", "0,0")).code).toBe(0);
  const grown = await anydag("node", "add", board, "stack", "--from", "api", "--id", "cache", "--title", "Cache");
  expect(grown.code, grown.err).toBe(0);
  expect((await anydag("node", "set", board, "stack", "api", "title=Orders API", "hue=teal", "bold")).code).toBe(0);

  const shown = await anydag("item", "show", board, "stack");
  expect(shown.out).toContain('service api "Orders API"');
  expect(shown.out).toContain("hue=teal bold");
  expect(shown.out).toContain("api --> cache");

  await ready(page, board);
  const card = page.locator('[data-dag-item="stack"] [data-dag-node="cache"]');
  await expect(card).toBeVisible();
  await expect(page.locator('[data-dag-item="stack"] [data-dag-node="api"]')).toContainText("Orders API");
});

test("pages, links and z-order are written the way the canvas writes them", async ({ page }) => {
  await anydag("item", "add", board, "md", "--id", "a", "--at", "0,0");
  await anydag("item", "add", board, "md", "--id", "b", "--at", "400,0");
  const linked = await anydag("link", "add", board, "a", "b", "--label", "then");
  expect(linked.code, linked.err).toBe(0);
  const links = JSON.parse((await anydag("link", "ls", board, "--json")).out) as { links: { label?: string }[] };
  expect(links.links.map((l) => l.label)).toEqual(["then"]);
  const added = await anydag("page", "add", board, "Later");
  expect(added.out.trim()).toBe("page-2");
  expect((await anydag("item", "set", board, "b", "page=Later")).code).toBe(0);
  expect((await anydag("item", "front", board, "a")).code).toBe(0);

  const listed = JSON.parse((await anydag("item", "ls", board, "--json")).out) as { items: { id: string; page: string }[] };
  expect(listed.items.map((i) => [i.id, i.page]).filter(([id]) => id === "a" || id === "b")).toEqual([
    ["b", "page-2"],
    ["a", "page-1"],
  ]);
  /* A link joins two things on one page — an `edges` fence belongs to a page — so `b` leaving
     takes the line with it, exactly as it does when the page's own select moves it. */
  expect((JSON.parse((await anydag("link", "ls", board, "--json")).out) as { links: unknown[] }).links).toEqual([]);

  await ready(page, board);
  await expect(page.locator('[data-dag-item="a"]')).toBeVisible();
  /* `b` is on the other page now, so the first page does not draw it. */
  await expect(page.locator('[data-dag-item="b"]')).toHaveCount(0);
});

test("a write against a moved board is refused with exit 3, and --base carries it", async () => {
  const read = JSON.parse((await anydag("board", "cat", board, "--json")).out) as { text: string; base: string };
  await anydag("item", "add", board, "md", "--id", "meanwhile");
  fs.writeFileSync(path.join(config, "x.md"), "```md {#mine}\nmine\n```\n");
  const refused = await anydag("board", "write", board, "--base", read.base, "--file", path.join(config, "x.md"));
  expect(refused.code).toBe(3);
  expect(refused.err).toMatch(/base is now/);
  const now = JSON.parse((await anydag("board", "cat", board, "--json")).out) as { base: string };
  const written = await anydag("board", "write", board, "--base", now.base, "--file", path.join(config, "x.md"));
  expect(written.code, written.err).toBe(0);
  expect((await anydag("board", "cat", board)).out).toContain("mine");
});

test("snapshot and export see the drawing, and diagnose exits 4 on an error", async () => {
  await anydag("item", "add", board, "arch", "--id", "stack", "--at", "0,0");
  const shot = await anydag("snapshot", board, "--item", "stack", "-o", path.join(config, "stack.png"));
  expect(shot.code, shot.err + shot.out).toBe(0);
  expect(fs.readFileSync(path.join(config, "stack.png")).subarray(1, 4).toString()).toBe("PNG");
  expect(shot.out).toMatch(/quality {2}stack/);

  const svg = await anydag("board", "export", board, "--format", "svg", "-o", path.join(config, "board.svg"));
  expect(svg.code, svg.err).toBe(0);
  expect(fs.readFileSync(path.join(config, "board.svg"), "utf8")).toMatch(/^<svg[^>]*xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);

  expect((await anydag("node", "add", board, "stack", "database", "pg")).err).toMatch(/did you mean `db`/);
  fs.writeFileSync(path.join(config, "bad.txt"), "servce api");
  const broke = await anydag("item", "body", board, "stack", "--file", path.join(config, "bad.txt"));
  expect(broke.code).toBe(4);
  expect(broke.err).toMatch(/E_UNKNOWN_KIND/);
  expect((await anydag("board", "diagnose", board)).code).toBe(4);
});

test("search, the corpus and a quiz's check are the routes' answers, through the server's grammar", async () => {
  /* All three were answered inside the CLI until they became routes, and the unit tests stub
     the routes — so this is where the wire shape is proved, against the real parser. */
  const word = `zyxquist${Date.now().toString(36)}`;
  fs.writeFileSync(path.join(config, "s.md"), `\`\`\`md {#said}\nThe ${word} settles overnight.\n\`\`\`\n`);
  expect((await anydag("board", "write", board, "--force", "--file", path.join(config, "s.md"))).code).toBe(0);
  const found = await anydag("search", word, "--json");
  expect(found.code, found.err).toBe(0);
  const hits = (JSON.parse(found.out) as { hits: { name: string; part: string | null; snippet: string }[] }).hits;
  expect(hits.map((h) => [h.name, h.part])).toEqual([[board, "said"]]);
  expect(hits[0]!.snippet).toContain(`**${word}**`);

  const corpus = await anydag("corpus", board);
  expect(corpus.code, corpus.err).toBe(0);
  expect(corpus.out).toContain(`${board}#said`);

  const quiz = `e2e-cli-quiz-${Date.now().toString(36)}`;
  fs.writeFileSync(path.join(config, "q.md"), "## One? {#qa}\n\n- [ ] y\n- [ ] n\n");
  const made = await anydag("quiz", "new", quiz, "--file", path.join(config, "q.md"));
  expect(made.code, made.err).toBe(0);
  try {
    const checked = await anydag("quiz", "check", made.out.trim(), "--json");
    expect(checked.code).toBe(4);
    expect(JSON.parse(checked.out)).toMatchObject({ questions: 1, diagnostics: [{ code: "EQ_NO_ANSWER" }] });
  } finally {
    await anydag("quiz", "rm", made.out.trim(), "--yes");
  }
});
