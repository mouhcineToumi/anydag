import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { main } from "./cli-reach";
import type { Io } from "../cli/context";

/**
 * The dispatch, the exit codes, and what the admin CLI does around a write: a whole-text write
 * carries a base, and a 409 is exit 3 naming the base it lost to — never re-sent over the other
 * writer's change.
 *
 * `fetch` is stubbed here, and every answer is copied from the route in `server/routes/`
 * that gives it — `{base, text}` from `/patch`, `{error, base, text}` for its 409, `{error, code}`
 * for the 401 `identity.require` raises. `docs/architecture/things-that-will-bite.md` records what a stub invented from the caller's
 * expectations costs (`test_mcp.py`'s `StubDsl`); these are the routes' own shapes, and the wire
 * itself is proven against the running stack by `e2e/cli.spec.ts`.
 */

interface Seen {
  method: string;
  path: string;
  body: unknown;
}

function recorder(): { io: Io; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    io: {
      out: (l) => out.push(l),
      err: (l) => err.push(l),
      write: (c) => out.push(String(c)),
      stdinIsTTY: false,
      stdoutIsTTY: false,
      readStdin: async () => "",
      ask: async () => "",
    },
  };
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function server(answer: (s: Seen) => Response): Seen[] {
  const seen: Seen[] = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
    const u = new URL(url);
    const s: Seen = {
      method: init.method ?? "GET",
      path: `${u.pathname}${u.search}`,
      body: init.body ? JSON.parse(String(init.body)) : undefined,
    };
    seen.push(s);
    return answer(s);
  });
  return seen;
}

let dir: string;
let env: NodeJS.ProcessEnv;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "anydag-cli-test-"));
  env = {};
});
afterEach(() => {
  vi.unstubAllGlobals();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("dispatch", () => {
  it("prints help, and names a usage mistake with exit 2", async () => {
    const r = recorder();
    expect(await main(["help"], r.io, env)).toBe(0);
    expect(r.out.join("\n")).toMatch(/board write <name>/);
    expect(r.out.join("\n")).toMatch(/sync status/);
    /* The gestures inside a board are the page's and MCP's: the admin CLI has none of them. */
    expect(r.out.join("\n")).not.toMatch(/node set|item add|table set|quiz practice|task ls|chat say/);
    expect(await main(["board", "cat"], r.io, env)).toBe(2);
    expect(r.err.at(-1)).toMatch(/usage: anydag board cat <name>/);
    expect(await main(["nonsense"], r.io, env)).toBe(2);
  });

  it("says there is no server, with exit 6", async () => {
    vi.stubGlobal("fetch", async () => {
      /* What undici throws for a refused connection: a TypeError whose `cause` says why. */
      throw Object.assign(new TypeError("fetch failed"), { cause: new Error("connect ECONNREFUSED") });
    });
    const r = recorder();
    expect(await main(["ls"], r.io, env)).toBe(6);
    expect(r.err[0]).toMatch(/no AnyDag server at http:\/\/anydag\.test \(connect ECONNREFUSED\)/);
  });

  it("says there is no vault to act in, with exit 7, and carries the token as a header", async () => {
    const seen: string[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit = {}) => {
      seen.push(new Headers(init.headers).get("x-anydag-token") ?? "");
      return json(404, { error: "no vault is open", code: "vault" });
    });
    const r = recorder();
    expect(await main(["ls"], r.io, env)).toBe(7);
    expect(seen).toEqual(["t0k3n"]);
    expect(r.err[0]).toMatch(/no vault is open/);
  });
});

describe("ls", () => {
  /* `/__board/list`'s shape, as `server/routes/docs.ts` answers it. */
  const listed = {
    boards: ["plan", "work/flow", "work/deep/map"],
    folders: ["work", "work/deep", "home"],
    notes: ["work/todo", "home/list"],
    quizzes: ["work/drill"],
    tables: [],
    files: ["work/spec.pdf"],
    ids: {
      plan: "aaaaaaaaaa",
      "work/flow": "bbbbbbbbbb",
      "work/deep/map": "cccccccccc",
      "work/todo": "dddddddddd",
      "home/list": "eeeeeeeeee",
      "work/drill": "ffffffffff",
      "work/spec.pdf": "gggggggggg",
    },
    shared: ["plan", "work/todo"],
    titles: { "work/todo": "To do", "home/list": "List" },
    tasks: { "work/todo": { status: "todo" } },
    questions: { "work/drill": 3 },
    sizes: { "work/spec.pdf": 12 },
  };

  it("narrows its --json to the folder, as the text is", async () => {
    server(() => json(200, listed));
    const r = recorder();
    expect(await main(["ls", "work", "--json"], r.io, env)).toBe(0);
    const got = JSON.parse(r.out.join(""));
    expect(got.boards).toEqual(["work/flow", "work/deep/map"]);
    expect(got.folders).toEqual(["work", "work/deep"]);
    expect(got.notes).toEqual(["work/todo"]);
    expect(Object.keys(got.ids).sort()).toEqual(["work/deep/map", "work/drill", "work/flow", "work/spec.pdf", "work/todo"]);
    expect(got.shared).toEqual(["work/todo"]);
    expect(got.titles).toEqual({ "work/todo": "To do" });
    expect(got.tasks).toEqual({ "work/todo": { status: "todo" } });
  });

  it("narrows its --json to the kinds asked for, and leaves it whole when nothing is", async () => {
    server(() => json(200, listed));
    const r = recorder();
    expect(await main(["ls", "--notes", "--json"], r.io, env)).toBe(0);
    const got = JSON.parse(r.out.join(""));
    expect(got).toMatchObject({ boards: [], folders: [], notes: ["work/todo", "home/list"], quizzes: [], files: [] });
    expect(Object.keys(got.ids).sort()).toEqual(["home/list", "work/todo"]);
    const all = recorder();
    expect(await main(["ls", "--json"], all.io, env)).toBe(0);
    expect(JSON.parse(all.out.join(""))).toEqual(listed);
  });
});

describe("a write that meets another writer", () => {
  const v1 = '```arch {#stack}\nservice api "API"\n```\n';
  const v2 = '```arch {#stack}\nclient web "Web"\nservice api "API"\n```\n';

  it("is refused with exit 3, naming the base it lost to, and is not sent again", async () => {
    const seen = server((s) => {
      if (s.path.startsWith("/__board/put"))
        return json(409, { error: "the board changed underneath this edit", base: "base-9", text: v2 });
      return json(404, { error: "no route" });
    });
    fs.writeFileSync(path.join(dir, "mine.md"), v1);
    const r = recorder();
    expect(await main(["board", "write", "b", "--base", "base-1", "--file", path.join(dir, "mine.md")], r.io, env)).toBe(3);
    expect(r.err.join("\n")).toMatch(/base is now base-9/);
    expect(seen.filter((s) => s.path.startsWith("/__board/put"))).toHaveLength(1);
    expect((seen[0]!.body as { base: string }).base).toBe("base-1");
  });

  it("writes under --force with no base, and prints the diagnostics after", async () => {
    server((s) => {
      if (s.path.startsWith("/__board/put")) return json(200, { base: "base-2", text: v1 });
      if (s.path.startsWith("/__board/diagnostics"))
        return json(200, {
          board: [],
          items: [
            {
              id: "stack",
              type: "arch",
              diagnostics: [{ code: "E_UNKNOWN_KIND", line: 2, col: 1, message: "x", severity: "error" }],
            },
          ],
          errors: 1,
          warnings: 0,
        });
      return json(404, { error: "no route" });
    });
    fs.writeFileSync(path.join(dir, "mine.md"), v1);
    const r = recorder();
    expect(await main(["board", "write", "b", "--force", "--file", path.join(dir, "mine.md")], r.io, env)).toBe(4);
    expect(r.err.join("\n")).toMatch(/E_UNKNOWN_KIND {2}stack 2:1/);
  });

  it("refuses a whole-text write with no base unless --force says so", async () => {
    const r = recorder();
    expect(await main(["board", "write", "b", "--file", "-"], r.io, env)).toBe(2);
    expect(r.err[0]).toMatch(/--base .* or --force/);
  });
});

/*
 * The folder and trash commands, held the way the rest are: the answers are the routes' own shapes —
 * `{folder, boards, notes, folders, trash}` from `/rmdir`, `{days, entries}` from `/trash`.
 */
describe("folder rm", () => {
  it("sends no flag without --recursive, and the refusal is the route's", async () => {
    const r = recorder();
    const seen = server((s) => (s.path === "/__board/rmdir" ? json(409, { error: "`plan` is not empty" }) : json(404, {})));
    expect(await main(["folder", "rm", "plan"], r.io, env)).toBe(1);
    expect(seen.map((s) => s.path)).toEqual(["/__board/rmdir"]);
    expect(seen[0]!.body).toEqual({ name: "plan" });
    expect(r.err.at(-1)).toMatch(/not empty/);
  });

  it("sends `recursive: true` — the boolean — and asks nothing, since it goes to the trash", async () => {
    const r = recorder();
    const trash = { id: "0123456789", name: "plan", kind: "folder" };
    const seen = server(() =>
      json(200, { folder: "plan", boards: ["plan/a", "plan/b"], notes: ["plan/sub/n"], folders: ["plan", "plan/sub"], trash }),
    );
    expect(await main(["folder", "rm", "plan/", "-r"], r.io, env)).toBe(0);
    expect(seen.map((s) => s.path)).toEqual(["/__board/rmdir"]);
    expect(seen[0]!.body).toEqual({ name: "plan", recursive: true });
    expect(r.err.at(-1)).toBe("moved plan/ and 3 files in it to the trash — anydag trash restore 0123456789 brings it back");
  });

  it("still takes --yes, which an old script passes, and does nothing with it", async () => {
    const r = recorder();
    const seen = server(() =>
      json(200, { folder: "empty", boards: [], notes: [], folders: ["empty"], trash: { id: "abcdefghjk" } }),
    );
    expect(await main(["folder", "rm", "empty", "-r", "-y"], r.io, env)).toBe(0);
    expect(seen.at(-1)!.body).toEqual({ name: "empty", recursive: true });
  });
});

describe("trash", () => {
  const day = 86_400_000;
  const entry = (id: string, name: string, kind = "board", extra: object = {}) => ({
    id,
    name,
    kind,
    title: null,
    deleted: new Date(Date.now() - 2 * day).toISOString().replace(/\.\d+Z$/, "Z"),
    expires: new Date(Date.now() + 28 * day - 3600_000).toISOString().replace(/\.\d+Z$/, "Z"),
    doc: null,
    holds: null,
    ...extra,
  });
  const listed = {
    days: 30,
    entries: [
      entry("aaaaaaaaaa", "plan"),
      entry("bbbbbbbbbb", "work", "folder", {
        holds: { boards: ["work/a"], notes: [], quizzes: [], tables: [], files: [], folders: ["work", "work/x"] },
      }),
      entry("cccccccccc", "dup"),
      entry("dddddddddd", "dup"),
    ],
  };

  it("lists what is in it, with how long each has", async () => {
    const r = recorder();
    server(() => json(200, listed));
    expect(await main(["trash", "ls"], r.io, env)).toBe(0);
    expect(r.out[0]).toMatch(/^aaaaaaaaaa {2}board +\d{4}-\d{2}-\d{2} {2}28 days left {2}plan$/);
    expect(r.out[1]).toMatch(/work\/ \(1 file, 1 folder\)$/);
  });

  it("restores by name or by id, and needs the id when a name was two things", async () => {
    const r = recorder();
    const seen = server((s) =>
      s.path === "/__board/trash" ? json(200, listed) : json(200, { ...entry("aaaaaaaaaa", "plan-2") }),
    );
    expect(await main(["trash", "restore", "plan"], r.io, env)).toBe(0);
    expect(seen.at(-1)!.body).toEqual({ id: "aaaaaaaaaa" });
    expect(r.out.at(-1)).toBe("plan-2");
    expect(r.err.at(-1)).toMatch(/plan was taken since, so it is back as plan-2/);
    expect(await main(["trash", "restore", "dup"], r.io, env)).toBe(2);
    expect(r.err.at(-1)).toMatch(/2 things in the trash were `dup` — name one by its id: cccccccccc, dddddddddd/);
  });

  it("deletes for good only once asked, and empties the same way", async () => {
    const r = recorder();
    const seen = server((s) =>
      s.path === "/__board/trash"
        ? json(200, listed)
        : s.path === "/__board/trash/empty"
          ? json(200, { ids: ["a", "b", "c", "d"] })
          : json(200, { id: "aaaaaaaaaa" }),
    );
    expect(await main(["trash", "rm", "plan"], r.io, env)).toBe(2);
    expect(r.err.at(-1)).toMatch(/delete board plan for good\? — pass --yes/);
    expect(await main(["trash", "rm", "plan", "--yes"], r.io, env)).toBe(0);
    expect(seen.at(-1)).toMatchObject({ path: "/__board/trash/delete", body: { id: "aaaaaaaaaa" } });
    expect(await main(["trash", "empty", "-y"], r.io, env)).toBe(0);
    expect(r.err.at(-1)).toBe("deleted 4 things for good");
  });
});
