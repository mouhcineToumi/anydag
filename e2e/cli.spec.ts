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
 * The CLI is an admin tool (`docs/architecture/cli.md`): whole files, never a card at a time — so a
 * board here is written whole, the way an agent without MCP or a script would.
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

/** Write `text` as the board's whole text, over whatever is there. */
async function writeBoard(text: string) {
  const file = path.join(config, "board.md");
  fs.writeFileSync(file, text);
  return anydag("board", "write", board, "--force", "--file", file);
}

const STACK = "```arch {#stack x=0 y=0}\nservice api \"Orders API\" hue=teal bold\ndb cache \"Cache\"\napi --> cache\n```\n";

test("a board written whole from a terminal is what the page draws", { tag: "@smoke" }, async ({ page }) => {
  const written = await writeBoard(STACK);
  expect(written.code, written.err).toBe(0);

  const shown = await anydag("board", "cat", board);
  expect(shown.out).toContain('service api "Orders API" hue=teal bold');
  expect(shown.out).toContain("api --> cache");

  await ready(page, board);
  await expect(page.locator('[data-dag-item="stack"] [data-dag-node="cache"]')).toBeVisible();
  await expect(page.locator('[data-dag-item="stack"] [data-dag-node="api"]')).toContainText("Orders API");
});

test("a write against a moved board is refused with exit 3, and --base carries it", async () => {
  const read = JSON.parse((await anydag("board", "cat", board, "--json")).out) as { text: string; base: string };
  /* Somebody else writes in between — the page, or another terminal. */
  expect((await writeBoard("```md {#meanwhile}\nmeanwhile\n```\n")).code).toBe(0);
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
  expect((await writeBoard(STACK)).code).toBe(0);
  const shot = await anydag("snapshot", board, "--item", "stack", "-o", path.join(config, "stack.png"));
  expect(shot.code, shot.err + shot.out).toBe(0);
  expect(fs.readFileSync(path.join(config, "stack.png")).subarray(1, 4).toString()).toBe("PNG");
  expect(shot.out).toMatch(/quality {2}stack/);

  const svg = await anydag("board", "export", board, "--format", "svg", "-o", path.join(config, "board.svg"));
  expect(svg.code, svg.err).toBe(0);
  expect(fs.readFileSync(path.join(config, "board.svg"), "utf8")).toMatch(/^<svg[^>]*xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);

  /* A write that breaks the diagram still lands — a person may be halfway through — and says so. */
  const broke = await writeBoard("```arch {#stack}\nservce api\n```\n");
  expect(broke.code).toBe(4);
  expect(broke.out + broke.err).toMatch(/E_UNKNOWN_KIND/);
  const diagnosed = await anydag("board", "diagnose", board);
  expect(diagnosed.code).toBe(4);
  expect(diagnosed.out + diagnosed.err).toMatch(/E_UNKNOWN_KIND/);
});

test("a quiz's check is the route's answer, through the server's grammar", async () => {
  /* It was answered inside the CLI until it became a route, and the unit tests stub the route — so
     this is where the wire shape is proved, against the real parser. */
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
