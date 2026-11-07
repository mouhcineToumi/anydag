import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { main } from "./cli-reach";
import { offsetAt } from "../src/note/event";
import { setZone } from "../src/note/zone";
import type { Io } from "../cli/context";
import { handle } from "../server/handle";

/**
 * The dispatch, the exit codes, and the one behaviour the CLI has that the page does not: an edit is
 * **recomputed** from the text a 409 carries, never re-sent.
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
    const s: Seen = { method: init.method ?? "GET", path: `${u.pathname}${u.search}`, body: init.body ? JSON.parse(String(init.body)) : undefined };
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
  /* `event` commands read the account's time zone into `src/note/zone.ts`. */
  setZone(null);
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("dispatch", () => {
  it("prints help, and names a usage mistake with exit 2", async () => {
    const r = recorder();
    expect(await main(["help"], r.io, env)).toBe(0);
    expect(r.out.join("\n")).toMatch(/node set <board> <item> <card>/);
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
    ids: { plan: "aaaaaaaaaa", "work/flow": "bbbbbbbbbb", "work/deep/map": "cccccccccc", "work/todo": "dddddddddd", "home/list": "eeeeeeeeee", "work/drill": "ffffffffff", "work/spec.pdf": "gggggggggg" },
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

describe("an edit that meets another writer", () => {
  const v1 = '```arch {#stack}\nservice api "API"\nstore db "DB"\n```\n';
  /* Somebody put a card above `api` between the read and the write: its line moved. */
  const v2 = '```arch {#stack}\nclient web "Web"\nservice api "API"\nstore db "DB"\n```\n';

  it("is worked out again from the text the 409 carried, and written under its base", async () => {
    let patches = 0;
    const seen = server((s) => {
      if (s.path.startsWith("/__board/get")) return json(200, { name: "b", id: "0123456789", text: v1, base: "base-1" });
      if (s.path.startsWith("/__board/patch")) {
        patches++;
        if (patches === 1) return json(409, { error: "the board changed underneath this edit", base: "base-2", text: v2 });
        return json(200, { base: "base-3", text: "…" });
      }
      if (s.path.startsWith("/__board/diagnostics")) return json(200, { board: [], items: [], errors: 0, warnings: 0 });
      return json(404, { error: "no route" });
    });
    const r = recorder();
    expect(await main(["node", "set", "b", "stack", "api", "title=Orders"], r.io, env)).toBe(0);
    const [first, second] = seen.filter((s) => s.path.startsWith("/__board/patch")).map((s) => s.body as { base: string; ops: { body: string }[] });
    expect(first!.base).toBe("base-1");
    expect(second!.base).toBe("base-2");
    /* The retry's body keeps the other writer's card — it was written from v2, not re-sent from v1. */
    expect(second!.ops[0]!.body).toBe('client web "Web"\nservice api "Orders"\nstore db "DB"');
    expect(first!.ops[0]!.body).toBe('service api "Orders"\nstore db "DB"');
  });

  it("gives up after one retry with exit 3, naming the base it lost to", async () => {
    server((s) => {
      if (s.path.startsWith("/__board/get")) return json(200, { name: "b", text: v1, base: "base-1" });
      return json(409, { error: "the board changed underneath this edit", base: "base-9", text: v2 });
    });
    const r = recorder();
    expect(await main(["item", "set", "b", "stack", "x=8"], r.io, env)).toBe(3);
    expect(r.err[0]).toMatch(/base is now base-9/);
  });

  it("refuses a whole-text write with no base unless --force says so", async () => {
    const r = recorder();
    expect(await main(["board", "write", "b", "--file", "-"], r.io, env)).toBe(2);
    expect(r.err[0]).toMatch(/--base .* or --force/);
  });
});

/*
 * Two routes that reached `main` after the CLI was written, and are held here the way the rest are:
 * `/rmdir`'s `recursive` and `/corpus`. The answers are the routes' own shapes —
 * `{boards, folders, notes, ids}` from `/list`, `{folder, boards, notes, folders}` from `/rmdir`,
 * `{docs: [{id, name, kind, title, units}]}` from `/corpus`.
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
    const seen = server(() => json(200, { folder: "plan", boards: ["plan/a", "plan/b"], notes: ["plan/sub/n"], folders: ["plan", "plan/sub"], trash }));
    expect(await main(["folder", "rm", "plan/", "-r"], r.io, env)).toBe(0);
    expect(seen.map((s) => s.path)).toEqual(["/__board/rmdir"]);
    expect(seen[0]!.body).toEqual({ name: "plan", recursive: true });
    expect(r.err.at(-1)).toBe("moved plan/ and 3 files in it to the trash — anydag trash restore 0123456789 brings it back");
  });

  it("still takes --yes, which an old script passes, and does nothing with it", async () => {
    const r = recorder();
    const seen = server(() => json(200, { folder: "empty", boards: [], notes: [], folders: ["empty"], trash: { id: "abcdefghjk" } }));
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
      entry("bbbbbbbbbb", "work", "folder", { holds: { boards: ["work/a"], notes: [], quizzes: [], tables: [], files: [], folders: ["work", "work/x"] } }),
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
    const seen = server((s) => (s.path === "/__board/trash" ? json(200, listed) : json(200, { ...entry("aaaaaaaaaa", "plan-2") })));
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
      s.path === "/__board/trash" ? json(200, listed) : s.path === "/__board/trash/empty" ? json(200, { ids: ["a", "b", "c", "d"] }) : json(200, { id: "aaaaaaaaaa" }),
    );
    expect(await main(["trash", "rm", "plan"], r.io, env)).toBe(2);
    expect(r.err.at(-1)).toMatch(/delete board plan for good\? — pass --yes/);
    expect(await main(["trash", "rm", "plan", "--yes"], r.io, env)).toBe(0);
    expect(seen.at(-1)).toMatchObject({ path: "/__board/trash/delete", body: { id: "aaaaaaaaaa" } });
    expect(await main(["trash", "empty", "-y"], r.io, env)).toBe(0);
    expect(r.err.at(-1)).toBe("deleted 4 things for good");
  });
});

describe("search", () => {
  const corpus = {
    docs: [
      {
        id: "0123456789",
        name: "shop",
        kind: "board",
        title: "Shop",
        units: [
          { what: "title", text: "Shop" },
          { part: "flow", what: "arch", text: "checkout · payments settle nightly · ledger" },
        ],
      },
      { id: "abcdefghjk", name: "notes/ops", kind: "note", title: null, units: [{ part: "L4", what: "paragraph", text: "Nothing about money here." }] },
    ],
  };

  /** `GET /__board/search` as the api answers it: the account's corpus handed to the grammar
      service's `/search`, which is called here rather than restated. */
  const searched = async (path: string) => {
    const q = new URL(path, "http://x").searchParams;
    const limit = q.get("limit");
    const body = { docs: corpus.docs, q: q.get("q") ?? "", ...(limit ? { limit: Number(limit) } : {}) };
    return (await handle({ method: "POST", route: "/search", query: new URLSearchParams(), body })).body;
  };

  it("asks the route — the page's engine: every word, each a prefix — and names where", async () => {
    const r = recorder();
    const seen = server(() => json(500, { error: "unreached" }));
    vi.stubGlobal("fetch", async (url: string) => {
      const u = new URL(url);
      seen.push({ method: "GET", path: `${u.pathname}${u.search}`, body: undefined });
      return json(200, await searched(`${u.pathname}${u.search}`));
    });
    expect(await main(["search", "pay", "sett"], r.io, env)).toBe(0);
    expect(seen[0]!.path).toBe("/__board/search?q=pay+sett");
    expect(r.out).toHaveLength(1);
    expect(r.out[0]).toMatch(/^shop#flow\s+arch\s+checkout · \*\*payments\*\* \*\*settle\*\* nightly/);
    expect(r.err.at(-1)).toBe("1 hit");
  });

  it("answers --json with the hits, and an empty list is not a failure", async () => {
    const r = recorder();
    vi.stubGlobal("fetch", async (url: string) => json(200, await searched(new URL(url).pathname + new URL(url).search)));
    expect(await main(["search", "zebra", "--json"], r.io, env)).toBe(0);
    expect(JSON.parse(r.out.join(""))).toEqual({ query: "zebra", hits: [] });
  });

  it("refuses a --limit that is not a whole number above zero, before asking", async () => {
    const r = recorder();
    const seen = server(() => json(200, { query: "", hits: [] }));
    expect(await main(["search", "pay", "--limit", "0"], r.io, env)).toBe(2);
    expect(seen).toEqual([]);
  });
});

describe("corpus", () => {
  const corpus = {
    docs: [
      { id: "0123456789", name: "shop", kind: "board", title: "Shop", units: [{ what: "title", text: "Shop" }, { part: "flow", what: "arch", text: "checkout · payments" }] },
      { id: "abcdefghjk", name: "ops", kind: "note", title: null, units: [{ part: "L4", what: "paragraph", text: "Nothing here." }] },
    ],
  };

  it("prints a line per unit, where a result would open", async () => {
    const r = recorder();
    const seen = server(() => json(200, corpus));
    expect(await main(["corpus"], r.io, env)).toBe(0);
    expect(seen[0]!.path).toBe("/__board/corpus");
    expect(r.out.map((l) => l.split(/\s{2,}/)[0])).toEqual(["shop", "shop#flow", "ops#L4"]);
    expect(r.err.at(-1)).toBe("3 units in 2 documents");
  });

  it("narrows to one document, and names one that is not there", async () => {
    const r = recorder();
    server(() => json(200, corpus));
    expect(await main(["corpus", "ops", "--json"], r.io, env)).toBe(0);
    expect(JSON.parse(r.out.join(""))).toEqual({ docs: [corpus.docs[1]] });
    expect(await main(["corpus", "nope"], r.io, env)).toBe(2);
  });
});

describe("tasks", () => {
  it("makes a note that is a task, filed under its title in the folder asked for", async () => {
    const seen = server((s) =>
      s.path === "/__board/create" ? json(200, { name: "launch/ship-the-pricing-page", id: "0123456789", base: "b" }) : json(404, { error: "no route" }),
    );
    const r = recorder();
    expect(await main(["task", "new", "Ship", "the", "pricing", "page", "--folder", "launch", "--due", "2026-10-03"], r.io, env)).toBe(0);
    expect(seen[0]!.body).toEqual({
      name: "launch/ship-the-pricing-page",
      kind: "note",
      text: '---\ntitle: "Ship the pricing page"\nstatus: todo\ndue: 2026-10-03\n---\n',
    });
    expect(r.out).toEqual(["launch/ship-the-pricing-page"]);
  });

  it("sends only what it was asked to change, and refuses a status that is not one", async () => {
    const seen = server((s) => (s.path === "/__board/task" ? json(200, { name: "n", task: null }) : json(404, { error: "no route" })));
    const r = recorder();
    expect(await main(["task", "set", "n", "--status", "doing"], r.io, env)).toBe(2);
    expect(r.err.at(-1)).toMatch(/`doing` is not a status: todo, in-progress, done/);
    expect(seen).toEqual([]);
    expect(await main(["task", "set", "n", "--none"], r.io, env)).toBe(0);
    expect(seen[0]!.body).toEqual({ name: "n", status: null, due: null, start: null });
    expect(await main(["task", "set", "n", "--status", "In progress", "--no-due"], r.io, env)).toBe(0);
    expect(seen[1]!.body).toEqual({ name: "n", status: "in-progress", due: null });
    expect(await main(["task", "done", "n"], r.io, env)).toBe(0);
    expect(seen[2]!.body).toEqual({ name: "n", status: "done" });
  });

  it("lists in the Tasks page's order, and --open leaves out what is done", async () => {
    server(() =>
      json(200, {
        boards: [],
        folders: [],
        notes: ["a", "b", "c"],
        ids: {},
        titles: { a: "Alpha", b: "Beta", c: "Gamma" },
        tasks: { a: { status: "todo", due: "2026-10-03" }, b: { status: "done" }, c: { status: "in-progress" } },
      }),
    );
    const r = recorder();
    expect(await main(["task", "ls", "--open"], r.io, env)).toBe(0);
    expect(r.out.map((l) => l.replace(/\s+/g, " "))).toEqual(["In progress c Gamma", "To do 2026-10-03 a Alpha"]);
  });
});

describe("events", () => {
  it("makes a note that is an event, with this machine's offset on a time typed without one when the account has no zone", async () => {
    const seen = server((s) => (s.path === "/__board/create" ? json(200, { name: "offsite", id: "0123456789", base: "b" }) : json(404, { error: "no route" })));
    const r = recorder();
    expect(await main(["event", "new", "Offsite", "--start", "2026-10-03 09:00", "--end", "2026-10-03T17:00"], r.io, env)).toBe(0);
    const zone = (h: number) => offsetAt(new Date(2026, 9, 3, h));
    expect(seen.find((q) => q.path === "/__board/create")!.body).toEqual({
      name: "offsite",
      kind: "note",
      text: `---\ntitle: "Offsite"\nstart: 2026-10-03T09:00${zone(9)}\nend: 2026-10-03T17:00${zone(17)}\n---\n`,
    });
    expect(await main(["event", "new", "Conference", "--start", "2026-10-12", "--end", "2026-10-14", "--folder", "trips"], r.io, env)).toBe(0);
    /* Every request the CLI makes is recorded, so the second create is the one the folder made. */
    expect(seen.filter((q) => q.path === "/__board/create")[1]!.body).toEqual({ name: "trips/conference", kind: "note", text: '---\ntitle: "Conference"\nstart: 2026-10-12\nend: 2026-10-14\n---\n' });
    /* An end in the other form, or before the start, is refused before anything is sent. */
    expect(await main(["event", "new", "X", "--start", "2026-10-12", "--end", "2026-10-12T10:00"], r.io, env)).toBe(2);
    expect(await main(["event", "new", "X", "--start", "2026-10-12", "--end", "2026-10-11"], r.io, env)).toBe(2);
    expect(await main(["event", "new", "X", "--start", "soon"], r.io, env)).toBe(2);
    expect(seen.filter((q) => q.path === "/__board/create")).toHaveLength(2);
  });

  it("writes a time typed without an offset in the account's zone, not this machine's", async () => {
    const seen = server((s) =>
      s.path === "/api/auth/me"
        ? json(200, { account: { uid: "u", handle: "local", email: "a@b", name: "" }, zone: "Asia/Kolkata" })
        : json(200, { name: "standup", id: "0123456789", base: "b" }),
    );
    const r = recorder();
    expect(await main(["event", "new", "Standup", "--start", "2026-10-03T09:00", "--end", "2026-10-03 09:15"], r.io, env)).toBe(0);
    const text = (seen.find((q) => q.path === "/__board/create")!.body as { text: string }).text;
    expect(text).toContain("start: 2026-10-03T09:00+05:30\nend: 2026-10-03T09:15+05:30\n");
  });

  it("starts at the next whole hour and lasts one when nobody says", async () => {
    const seen = server(() => json(200, { name: "standup", id: "0123456789", base: "b" }));
    const r = recorder();
    expect(await main(["event", "new", "Standup"], r.io, env)).toBe(0);
    const text = (seen.find((q) => q.path === "/__board/create")!.body as { text: string }).text;
    const start = /start: (\S+)/.exec(text)![1]!;
    const end = /end: (\S+)/.exec(text)![1]!;
    expect(start).toMatch(/T\d{2}:00[+-]\d{2}:\d{2}$/);
    expect(new Date(end).getTime() - new Date(start).getTime()).toBe(3_600_000);
    expect(new Date(start).getTime()).toBeGreaterThan(Date.now());
  });

  it("sends only what it was asked to change", async () => {
    const seen = server((s) => (s.path === "/__board/event" ? json(200, { name: "n", event: null }) : json(404, { error: "no route" })));
    const r = recorder();
    expect(await main(["event", "set", "n"], r.io, env)).toBe(2);
    expect(await main(["event", "set", "n", "--none"], r.io, env)).toBe(0);
    const sent = () => seen.filter((q) => q.path === "/__board/event").map((q) => q.body);
    expect(sent()[0]).toEqual({ name: "n", start: null, end: null });
    expect(await main(["event", "set", "n", "--start", "2026-10-12", "--no-end"], r.io, env)).toBe(0);
    expect(sent()[1]).toEqual({ name: "n", start: "2026-10-12", end: null });
  });

  it("lists soonest first, and --from and --to keep what touches those days", async () => {
    server(() =>
      json(200, {
        boards: [],
        folders: [],
        notes: ["a", "b", "c", "d"],
        ids: {},
        titles: { a: "Alpha", b: "Beta", c: "Gamma", d: "Delta" },
        tasks: { d: { status: "todo", due: "2026-10-13" } },
        events: { a: { start: "2026-10-12", end: "2026-10-14" }, b: { start: "2026-10-01" }, c: { start: "2026-10-20" } },
      }),
    );
    const r = recorder();
    expect(await main(["event", "ls", "--json"], r.io, env)).toBe(0);
    expect(JSON.parse(r.out.join("\n")).map((e: { name: string }) => e.name)).toEqual(["b", "a", "c"]);
    const s = recorder();
    expect(await main(["event", "ls", "--from", "2026-10-13", "--to", "2026-10-19", "--json"], s.io, env)).toBe(0);
    expect(JSON.parse(s.out.join("\n")).map((e: { name: string }) => e.name)).toEqual(["a"]);
  });
});

describe("projects", () => {
  const listed = {
    boards: [],
    folders: ["work", "work/pricing", "work/pricing/research", "other"],
    notes: ["work/pricing/pricing", "work/pricing/copy", "work/pricing/research/research", "work/pricing/research/ask", "other/loose"],
    ids: {},
    titles: { "work/pricing/pricing": "Pricing", "work/pricing/research/research": "Research" },
    tasks: { "work/pricing/copy": { status: "todo" }, "work/pricing/research/ask": { status: "done" }, "other/loose": { status: "todo" } },
    projects: { "work/pricing/pricing": { status: "active", hue: "coral" }, "work/pricing/research/research": { status: "paused" } },
  };

  it("makes a folder a project with its note, and refuses one that is already", async () => {
    const seen = server((s) =>
      s.path === "/__board/list"
        ? json(200, listed)
        : s.path === "/__board/create"
          ? json(200, { name: "other/other", id: "0123456789", base: "b" })
          : json(404, { error: "no route" }),
    );
    const r = recorder();
    expect(await main(["project", "new", "other/", "--hue", "Teal"], r.io, env)).toBe(0);
    expect(seen.find((c) => c.path === "/__board/create")!.body).toEqual({
      name: "other/other",
      kind: "note",
      text: '---\ntitle: "Other"\nproject: active\nhue: teal\n---\n',
    });
    expect(await main(["project", "new", "work/pricing"], r.io, env)).toBe(2);
    expect(r.err.at(-1)).toMatch(/is a project already: its note is `work\/pricing\/pricing`/);
  });

  it("names a project by its folder or its note, and sends only what changes", async () => {
    const seen = server((s) =>
      s.path === "/__board/list" ? json(200, listed) : s.path === "/__board/project" ? json(200, { name: "x", project: null }) : json(404, { error: "no route" }),
    );
    const r = recorder();
    expect(await main(["project", "set", "work/pricing", "--status", "done"], r.io, env)).toBe(0);
    expect(seen.filter((c) => c.path === "/__board/project").at(-1)!.body).toEqual({ name: "work/pricing/pricing", status: "done" });
    expect(await main(["project", "set", "work/pricing/research/research", "--none"], r.io, env)).toBe(0);
    expect(seen.filter((c) => c.path === "/__board/project").at(-1)!.body).toEqual({ name: "work/pricing/research/research", status: null, hue: null });
    expect(await main(["project", "set", "other", "--hue", "coral"], r.io, env)).toBe(2);
    expect(await main(["project", "set", "work/pricing", "--status", "yes"], r.io, env)).toBe(2);
  });

  it("lists every project with its open tasks, and task ls --project keeps to its folder", async () => {
    server(() => json(200, listed));
    const r = recorder();
    expect(await main(["project", "ls"], r.io, env)).toBe(0);
    expect(r.out.map((l) => l.replace(/\s+/g, " "))).toEqual([
      "Active coral work/pricing Pricing 1 open of 2",
      "Paused work/pricing/research Research 0 open of 1",
    ]);
    const t = recorder();
    expect(await main(["task", "ls", "--project", "work/pricing"], t.io, env)).toBe(0);
    expect(t.out.map((l) => l.replace(/\s+/g, " "))).toEqual(["To do work/pricing/copy copy", "Done work/pricing/research/ask ask"]);
  });
});
