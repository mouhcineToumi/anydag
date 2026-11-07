/**
 * The CLI against the real routes — no browser, no socket.
 *
 * `test/cli-main.test.ts` stubs `fetch` with answers copied from the routes; this is the other half,
 * the proof that the shapes the CLI expects are the shapes the routes answer. It used to be three of
 * `e2e/cli.spec.ts`'s four checks, each paying for a Vite page and a Chromium for assertions that
 * only read command output. `server/connect.ts` serves a vault **in this process** when no app is
 * running, so `main()` here is `anydag` as a terminal runs it with nothing open: the real parser, the
 * real vault, the real sha1 base and 409, and a `fetch` that reaches them with no socket.
 *
 * What stays in `e2e/cli.spec.ts` is what needs a page: the board a terminal wrote is drawn, and
 * `snapshot` and `export` are pictures of it.
 */
import "./sqlite-shim";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { Io } from "../../cli/context";
import { main } from "../../cli/main";

let root = "";
let home = "";
let work = "";
let env: NodeJS.ProcessEnv;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "anydag-cli-vault-"));
  home = fs.mkdtempSync(path.join(os.tmpdir(), "anydag-cli-home-"));
  work = fs.mkdtempSync(path.join(os.tmpdir(), "anydag-cli-work-"));
  /* No app home with a `server.json`, so the command serves `root` itself. */
  env = { ANYDAG_HOME: home, ANYDAG_VAULT: root };
});
afterEach(() => {
  for (const p of [root, home, work]) fs.rmSync(p, { recursive: true, force: true });
});

/** One command: its exit code, and what it printed on each stream. */
async function anydag(...argv: string[]): Promise<{ code: number; out: string; err: string }> {
  const out: string[] = [];
  const err: string[] = [];
  const io: Io = {
    out: (l) => out.push(`${l}\n`),
    err: (l) => err.push(`${l}\n`),
    write: (c) => out.push(String(c)),
    stdinIsTTY: false,
    stdoutIsTTY: false,
    readStdin: async () => "",
    ask: async () => "",
  };
  const code = await main(argv, io, env);
  return { code, out: out.join(""), err: err.join("") };
}

/** Write `text` as the board's whole text, over whatever is there. */
async function writeBoard(board: string, text: string) {
  const file = path.join(work, "board.md");
  fs.writeFileSync(file, text);
  return anydag("board", "write", board, "--force", "--file", file);
}

async function newBoard(name: string): Promise<string> {
  const made = await anydag("board", "new", name);
  expect(made.code, made.err).toBe(0);
  return made.out.trim();
}

const STACK = '```arch {#stack x=0 y=0}\nservice api "Orders API" hue=teal bold\ndb cache "Cache"\napi --> cache\n```\n';

describe("anydag board", () => {
  it("writes whole, and reads back what it wrote", async () => {
    const board = await newBoard("wire-write");
    const written = await writeBoard(board, STACK);
    expect(written.code, written.err).toBe(0);
    const shown = await anydag("board", "cat", board);
    expect(shown.out).toContain('service api "Orders API" hue=teal bold');
    expect(shown.out).toContain("api --> cache");
    /* In this test's own vault, which is what makes the rest of the file a test of the routes. */
    expect(fs.readFileSync(path.join(root, `${board}.board.md`), "utf8")).toContain("api --> cache");
  });

  it("refuses a write against a moved board with exit 3, and --base carries it", async () => {
    const board = await newBoard("wire-moved");
    const read = JSON.parse((await anydag("board", "cat", board, "--json")).out) as { text: string; base: string };
    /* Somebody else writes in between — the page, or another terminal. */
    expect((await writeBoard(board, "```md {#meanwhile}\nmeanwhile\n```\n")).code).toBe(0);
    fs.writeFileSync(path.join(work, "x.md"), "```md {#mine}\nmine\n```\n");
    const refused = await anydag("board", "write", board, "--base", read.base, "--file", path.join(work, "x.md"));
    expect(refused.code).toBe(3);
    expect(refused.err).toMatch(/base is now/);
    const now = JSON.parse((await anydag("board", "cat", board, "--json")).out) as { base: string };
    const written = await anydag("board", "write", board, "--base", now.base, "--file", path.join(work, "x.md"));
    expect(written.code, written.err).toBe(0);
    expect((await anydag("board", "cat", board)).out).toContain("mine");
  });

  it("lands a write that breaks a diagram, and says so with exit 4 — from the write and from diagnose", async () => {
    const board = await newBoard("wire-broken");
    expect((await writeBoard(board, STACK)).code).toBe(0);
    /* A person may be halfway through, so the write still lands. */
    const broke = await writeBoard(board, "```arch {#stack}\nservce api\n```\n");
    expect(broke.code).toBe(4);
    expect(broke.out + broke.err).toMatch(/E_UNKNOWN_KIND/);
    const diagnosed = await anydag("board", "diagnose", board);
    expect(diagnosed.code).toBe(4);
    expect(diagnosed.out + diagnosed.err).toMatch(/E_UNKNOWN_KIND/);
  });
});

describe("anydag quiz check", () => {
  it("is the route's answer, through the server's grammar", async () => {
    /* It was answered inside the CLI until it became a route, and `cli-main.test.ts` stubs the
       route — so this is where the wire shape is proved, against the real parser. */
    fs.writeFileSync(path.join(work, "q.md"), "## One? {#qa}\n\n- [ ] y\n- [ ] n\n");
    const made = await anydag("quiz", "new", "wire-quiz", "--file", path.join(work, "q.md"));
    expect(made.code, made.err).toBe(0);
    const checked = await anydag("quiz", "check", made.out.trim(), "--json");
    expect(checked.code).toBe(4);
    expect(JSON.parse(checked.out)).toMatchObject({ questions: 1, diagnostics: [{ code: "EQ_NO_ANSWER" }] });
  });
});
