/**
 * What the grammar parsed is kept on disk in the app's home (#279), so its worker can be a process
 * that ends when it is idle: a reader started again parses nothing that did not move, the cache is
 * only a cache, and a vault's corpus and search are answered where the docs are.
 */
import "./sqlite-shim";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../../server/app";
import { Session } from "../../server/context";
import { WorkerProcess } from "../../server/grammar";
import { type Entry, Reader } from "../../server/parsing";
import { Shelf } from "../../server/parse-store";
import { makeEnv, sweepTemps, write, type Env } from "./helpers";

let env: Env;
beforeEach(() => {
  env = makeEnv();
});
afterEach(async () => {
  await env.cleanup();
  sweepTemps();
});

const appOf = () => createApp({ session: new Session(env.home, env.vault, "test"), token: "t", page: null });

const get = async (app: ReturnType<typeof appOf>, url: string) => {
  const res = await app.request(`http://127.0.0.1${url}`, { headers: { "x-anydag-token": "t", host: "127.0.0.1" } });
  expect(res.status).toBe(200);
  return res.json() as Promise<Record<string, unknown>>;
};

interface Hit {
  name: string;
  part: string | null;
  snippet: string;
}
const search = async (app: ReturnType<typeof appOf>, q: string) =>
  ((await get(app, `/__board/search?q=${encodeURIComponent(q)}`)) as { hits: Hit[] }).hits;

/** Every file under `dir`, with its size and mtime. */
function fingerprint(dir: string): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else {
        const st = fs.statSync(p);
        out.set(path.relative(dir, p), `${st.size}:${st.mtimeMs}`);
      }
    }
  };
  walk(dir);
  return out;
}

/** The keys the shelf holds for one question over the vault. */
const rows = (question: string): string[] => {
  const db = new DatabaseSync(path.join(env.homeDir, "parse.sqlite"));
  try {
    return (
      db
        .prepare("select t.key from texts t join sets s on s.id = t.set_id where s.root = ? and s.question = ? order by t.key")
        .all(env.root, question) as {
        key: string;
      }[]
    ).map((r) => r.key);
  } finally {
    db.close();
  }
};

describe("a vault's search and corpus", () => {
  it("finds the words of a note and of a board item, and cuts the snippet from the unit's row", async () => {
    await env.vault.create("Plan", "note", "# Plan\n\nPayments settle overnight.\n");
    await env.vault.create("Board", "board", "---\ntitle: Ops board\n---\n\n```md {#a}\nThe ledger closes at noon.\n```\n");
    const app = appOf();
    const hits = await search(app, "pay sett");
    // A block nothing anchored is named by its line in the file, frontmatter counted.
    expect(hits.map((h) => h.name)).toEqual(["Plan"]);
    expect(hits[0]!.part).toMatch(/^L\d+$/);
    expect(hits[0]!.snippet).toBe("**Payments** **settle** overnight.");
    expect((await search(app, "ledger")).map((h) => [h.name, h.part])).toEqual([["Board", "a"]]);
    expect(await search(app, "nothing-like-this")).toEqual([]);
  });

  it("narrows to one tag's documents before the limit, and with no words lists them by title (#327)", async () => {
    await env.vault.create("Plan", "note", "---\ntags: [Pricing]\n---\n# Plan\n\nSeat prices settle.\n");
    await env.vault.create("Other", "note", "# Other\n\nSeat counts by plan.\n");
    await env.vault.create("Board", "board", "---\ntitle: Ops board\ntags: [pricing, q4]\n---\n\n```md {#a}\nA seat.\n```\n");
    await env.vault.create("Templates/T", "note", "---\ntags: [pricing]\n---\n# {{title}}\n\nseat\n");
    const app = appOf();
    expect((await search(app, "seat")).map((h) => h.name).sort()).toEqual(["Board", "Other", "Plan", "Templates/T"]);
    const tagged = await get(app, "/__board/search?q=seat&tag=PRICING");
    expect(tagged.tag).toBe("PRICING");
    expect((tagged.hits as Hit[]).map((h) => h.name).sort()).toEqual(["Board", "Plan"]);
    /* The limit counts what the tag keeps, not what it drops. */
    expect(((await get(app, "/__board/search?q=seat&tag=q4&limit=1")).hits as Hit[]).map((h) => h.name)).toEqual(["Board"]);
    /* No words: every document carrying it, by title, with its kind — a template left out. */
    const all = await get(app, "/__board/search?tag=pricing");
    expect(all.hits).toEqual([]);
    expect(all.count).toBe(2);
    expect((all.docs as { name: string; kind: string; title: string | null }[]).map((d) => [d.name, d.kind, d.title])).toEqual([
      ["Board", "board", "Ops board"],
      ["Plan", "note", "Plan"],
    ]);
    const res = await app.request("http://127.0.0.1/__board/search?q=x&tag=2026", {
      headers: { "x-anydag-token": "t", host: "127.0.0.1" },
    });
    expect(res.status).toBe(400);
  });

  it("keeps what it parsed in the app's home, a row per text, and writes nothing into the vault", async () => {
    await env.vault.create("Plan", "note", "# Plan\n\nPayments settle overnight.\n");
    await env.vault.create("Other", "note", "# Other\n\nNothing here.\n");
    const app = appOf();
    await get(app, "/__board/list");
    const before = fingerprint(env.root);
    await search(app, "payments");
    await get(app, "/__board/index");
    expect(fingerprint(env.root)).toEqual(before);
    expect(rows("corpus")).toEqual(["Other.note.md", "Plan.note.md"]);
    expect(rows("index")).toEqual(["Other.note.md", "Plan.note.md"]);
  });

  it("cuts a text again when it changes, and drops the row of one that is gone", async () => {
    await env.vault.create("Plan", "note", "# Plan\n\nPayments settle overnight.\n");
    await env.vault.create("Gone", "note", "# Gone\n\nA ledger.\n");
    const app = appOf();
    expect((await search(app, "ledger")).map((h) => h.name)).toEqual(["Gone"]);
    const current = await env.vault.read("Plan", "note");
    await env.vault.write("Plan", "note", "# Plan\n\nInvoices clear at dawn.\n", current!.base);
    await env.vault.delete("Gone", "note");
    expect(await search(app, "payments")).toEqual([]);
    expect((await search(app, "invoices")).map((h) => h.name)).toEqual(["Plan"]);
    expect(await search(app, "ledger")).toEqual([]);
    expect(rows("corpus")).toEqual(["Plan.note.md"]);
  });

  it("answers the same from a home whose cache is gone: the cache is only a cache", async () => {
    await env.vault.create("Plan", "note", "# Plan\n\nPayments settle overnight.\n");
    const first = await search(appOf(), "payments");
    const corpus = await get(appOf(), "/__board/corpus");
    env = env.reopen({ freshHome: true });
    expect(fs.existsSync(path.join(env.homeDir, "parse.sqlite"))).toBe(false);
    expect(await search(appOf(), "payments")).toEqual(first);
    expect(await get(appOf(), "/__board/corpus")).toEqual(corpus);
  });

  it("streams the corpus with the title each text gives, and every attachment by its names", async () => {
    await env.vault.create("Plan", "note", "---\ntitle: The plan\n---\n# Plan\n\nPayments settle.\n");
    const { docs } = (await get(appOf(), "/__board/corpus")) as {
      docs: { name: string; kind: string; title: string; units: { what: string; text: string }[] }[];
    };
    const plan = docs.find((d) => d.name === "Plan")!;
    expect(plan.kind).toBe("note");
    expect(plan.title).toBe("The plan");
    expect(plan.units.map((u) => u.text)).toContain("Payments settle.");
  });
});

describe("a Reader on the shelf", () => {
  /** A reader over the vault folder, counting what it parses, on a shelf in `home`. */
  const readerOn = (home: string, parsed: string[][] = []) =>
    new Reader(
      env.root,
      (texts) => {
        parsed.push(Object.keys(texts).sort());
        return Object.fromEntries(Object.entries(texts).map(([k, t]) => [k, { t }]));
      },
      "index",
      Shelf.at(home),
    );
  const entries = (...keys: string[]): Entry[] => keys.map((k) => [k, k, "board"]);

  it("started again, answers the server that holds its last answer with nothing, and parses nothing", () => {
    write(env.root, "a.board.md", "one");
    write(env.root, "b.board.md", "two");
    const first = readerOn(env.homeDir).read(entries("a", "b"), null);
    expect(first.fresh).toEqual([
      ["a", { t: "one" }],
      ["b", { t: "two" }],
    ]);
    // The worker ended; another reads the same vault for the same server.
    const parsed: string[][] = [];
    const again = readerOn(env.homeDir, parsed).read(entries("a", "b"), first.turn);
    expect(again).toMatchObject({ fresh: [], parsed: false, whole: false, turn: first.turn });
    expect(parsed).toEqual([]);
    // A server started again holds nothing: the whole answer, from the rows, still parsing nothing.
    const whole = readerOn(env.homeDir, parsed).read(entries("a", "b"), null);
    expect(whole.whole).toBe(true);
    expect(whole.fresh).toEqual(first.fresh);
    expect(parsed).toEqual([]);
  });

  it("parses only the text that moved while it was not running", () => {
    write(env.root, "a.board.md", "one");
    write(env.root, "b.board.md", "two");
    const first = readerOn(env.homeDir).read(entries("a", "b"), null);
    write(env.root, "b.board.md", "three");
    const parsed: string[][] = [];
    const got = readerOn(env.homeDir, parsed).read(entries("a", "b"), first.turn);
    expect(parsed).toEqual([["b"]]);
    expect(got.fresh).toEqual([["b", { t: "three" }]]);
  });

  it("takes the kept listing's stamp for the text it read, and does not look at the disk", () => {
    write(env.root, "a.board.md", "one");
    const listed: Entry[] = [["a", "a", "board", "stamp-1"]];
    const first = readerOn(env.homeDir).read(listed, null);
    // Changed behind the listing's back: a reader that trusts the stamp has no reason to look.
    write(env.root, "a.board.md", "changed");
    const parsed: string[][] = [];
    expect(readerOn(env.homeDir, parsed).read(listed, first.turn)).toMatchObject({ fresh: [], parsed: false });
    expect(parsed).toEqual([]);
  });

  it("does not trust a row another build cut", () => {
    write(env.root, "a.board.md", "one");
    const first = readerOn(env.homeDir).read(entries("a"), null);
    const db = new DatabaseSync(path.join(env.homeDir, "parse.sqlite"));
    db.prepare("update sets set code = 'an-older-build'").run();
    db.close();
    const parsed: string[][] = [];
    const got = readerOn(env.homeDir, parsed).read(entries("a"), first.turn);
    expect(parsed).toEqual([["a"]]);
    expect(got.whole).toBe(true);
  });

  it("never takes a read cut short for an answer: a reader after it answers whole", () => {
    for (let i = 0; i < 600; i++) write(env.root, `n${i}.board.md`, `text ${i}`);
    const keys = Array.from({ length: 600 }, (_, i) => `n${i}`);
    const r = readerOn(env.homeDir);
    const first = r.read(entries(...keys), null);
    for (let i = 0; i < 600; i++) write(env.root, `n${i}.board.md`, `text ${i} again`);
    // A read that parsed its first chunk, kept it, and was ended there.
    const steps = r.steps(entries(...keys), first.turn);
    expect(steps.next().done).toBe(false);
    const parsed: string[][] = [];
    const after = readerOn(env.homeDir, parsed).read(entries(...keys), first.turn);
    expect(after.whole).toBe(true);
    expect(after.fresh.length).toBe(600);
    expect(after.fresh.find(([k]) => k === "n599")![1]).toEqual({ t: "text 599 again" });
    // What the first chunk parsed was kept, and not parsed again.
    expect(parsed.flat().length).toBe(100);
  });

  it("parses a text whose row went missing, rather than answering without it", () => {
    write(env.root, "a.board.md", "one");
    const r = readerOn(env.homeDir);
    r.read(entries("a"), null);
    const db = new DatabaseSync(path.join(env.homeDir, "parse.sqlite"));
    db.prepare("delete from texts").run();
    db.close();
    expect(r.docOf(["a", "a", "board"])).toEqual({ t: "one" });
  });
});

describe("the grammar's worker", () => {
  /** A stand-in worker: answers with its pid and what its environment holds, and ends when its channel does. */
  const fake = () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "anydag-worker-"));
    const file = path.join(dir, "worker.mjs");
    fs.writeFileSync(
      file,
      `const me = () => ({ status: 200, body: { pid: process.pid, env: Object.keys(process.env) } });
process.on("message", (m) => {
  if (m.read !== undefined) {
    if (m.last) process.send({ id: m.read, answer: me() });
    return;
  }
  process.send({ id: m.id, answer: me() });
});
process.on("disconnect", () => process.exit(0));\n`,
    );
    return { file, done: () => fs.rmSync(dir, { recursive: true, force: true }) };
  };
  const alive = (pid: number) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };
  const until = async (ok: () => boolean, ms = 5_000) => {
    const t = Date.now();
    while (!ok() && Date.now() - t < ms) await new Promise((r) => setTimeout(r, 20));
    return ok();
  };
  const ask = async (t: WorkerProcess) => (await t.ask("POST", "/index", new URLSearchParams(), {})).body as { pid: number };

  it("is a process that ends when it has been idle, and is started again by the next question", async () => {
    const w = fake();
    try {
      const t = new WorkerProcess(w.file, 60_000, 100);
      const a = await ask(t);
      expect(a.pid).not.toBe(process.pid);
      expect(t.pid).toBe(a.pid);
      expect(await until(() => t.pid === null && !alive(a.pid))).toBe(true);
      const b = await ask(t);
      expect(b.pid).not.toBe(a.pid);
      await t.close();
    } finally {
      w.done();
    }
  });

  it("ends after a search as after any question: a search holds nothing it would build again (#267)", async () => {
    const w = fake();
    try {
      const t = new WorkerProcess(w.file, 60_000, 50);
      const a = (await t.search(1, null, env.root, [], [], [], "q")).body as { pid: number };
      expect(await until(() => t.pid === null && !alive(a.pid), 2_000)).toBe(true);
    } finally {
      w.done();
    }
  });

  it("retired, answers the next question from a new process", async () => {
    const w = fake();
    try {
      const t = new WorkerProcess(w.file, 60_000, 60_000);
      const a = await ask(t);
      t.retire();
      expect(await until(() => !alive(a.pid))).toBe(true);
      const b = await ask(t);
      expect(b.pid).not.toBe(a.pid);
      await t.close();
    } finally {
      w.done();
    }
  });

  it("is given no token, secret or key from the server's environment", async () => {
    const w = fake();
    process.env.ANYDAG_TEST_SECRET = "s";
    process.env.ANYDAG_TEST_TOKEN = "t";
    try {
      const t = new WorkerProcess(w.file, 60_000, 50);
      const { env: names } = (await t.ask("POST", "/index", new URLSearchParams(), {})).body as { env: string[] };
      expect(names).not.toContain("ANYDAG_TEST_SECRET");
      expect(names).not.toContain("ANYDAG_TEST_TOKEN");
      expect(names).toContain("PATH");
      await t.close();
    } finally {
      delete process.env.ANYDAG_TEST_SECRET;
      delete process.env.ANYDAG_TEST_TOKEN;
      w.done();
    }
  });
});
