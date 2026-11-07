/**
 * The convergence harness: one in-process sync server on PGlite, two or
 * three devices each on a real `Vault`, a seeded random schedule, and three assertions on every
 * seed — every vault the same bytes, no token anybody wrote missing from every file, and no id
 * carried twice or linked when nothing carries it. `harness/world.ts` says what each step does and
 * what each assertion allows.
 *
 * `ANYDAG_SYNC_SEEDS` sets how many seeds run (10 here, 100 under `npm run sync:converge`);
 * `ANYDAG_SYNC_SEED=<n>` runs one seed alone, which is how a printed failure is replayed.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import * as merge from "../../server/sync/merge";
import { harness, type Harness } from "./helpers";
import { describeFailure, runSeed, type SeedResult } from "./harness/run";
import { World, type Dev } from "./harness/world";

const ONE = process.env.ANYDAG_SYNC_SEED;
const COUNT = Number(process.env.ANYDAG_SYNC_SEEDS ?? 10) || 10;
const FIRST = Number(process.env.ANYDAG_SYNC_SEED_FROM ?? 1) || 1;
const SEEDS = ONE !== undefined ? [Number(ONE)] : Array.from({ length: COUNT }, (_, i) => FIRST + i);

let h: Harness;
beforeAll(async () => {
  h = await harness("pglite");
}, 60_000);
afterAll(async () => {
  await h?.close();
});

describe("convergence", () => {
  it(
    `holds on ${SEEDS.length} seed(s)`,
    async () => {
      const failed: SeedResult[] = [];
      for (const seed of SEEDS) {
        const r = await runSeed(h, seed);
        if (r.failures.length) failed.push(r);
      }
      if (failed.length) {
        console.error(failed.map(describeFailure).join("\n\n"));
        expect.fail(`${failed.length} of ${SEEDS.length} seed(s) failed: ${failed.map((r) => r.seed).join(", ")} — the steps are printed above`);
      }
    },
    Math.max(60_000, SEEDS.length * 15_000),
  );

  it("sees a merge that keeps only theirs", async () => {
    // A broken merge: every text merge answers the remote's version, dropping what was written here.
    const spy = vi.spyOn(merge, "mergeContent").mockImplementation((_rel, _base, _ours, theirs) => ({ merged: theirs }));
    try {
      const caught: number[] = [];
      for (let seed = 1; seed <= 8 && caught.length === 0; seed++) {
        const r = await runSeed(h, 900_000 + seed);
        if (r.failures.some((f) => f.startsWith("lost:") || f.startsWith("converge:"))) caught.push(r.seed);
      }
      expect(spy).toHaveBeenCalled();
      expect(caught.length, "the harness must fail on a merge that drops our side").toBeGreaterThan(0);
    } finally {
      spy.mockRestore();
    }
  }, 180_000);

  /**
   * The minimal repros of what the seeds found, scripted rather than seeded. A defect found and not
   * yet fixed goes in as `it.fails`, which turns red the day it is fixed — the cue to make it an
   * `it`. The seeds named are the ones in the random run that showed the same thing.
   */
  describe("known divergences", () => {
    const text = (s: string) => Buffer.from(s);
    const sync = async (d: Dev) => {
      await d.vault.tree();
      await d.engine.scan();
      await d.engine.syncOnce();
    };
    async function scripted(fn: (w: World, A: Dev, B: Dev) => Promise<void>): Promise<void> {
      const w = await World.create(h, 700_000, 2);
      try {
        await fn(w, w.devs[0]!, w.devs[1]!);
        await w.settle();
        expect(await w.check()).toEqual([]);
      } finally {
        await w.close();
      }
    }

    // Seed 77, and the dangling links of 20, 30, 35, 48, 57, 78, 80, 90: one path made on two
    // devices with two ids. The pull keeps ours at the path and writes theirs as a conflict copy
    // through `freshCopy`, which gives it a new id — so the id B committed, and B's link to it, are
    // carried by nothing.
    it("a conflict copy keeps the id the other device committed", async () => {
      await scripted(async (w, A, B) => {
        w.write(A, "plan.md", text("---\nid: aaaaaaaaaa\n---\nmine\n"));
        w.write(B, "plan.md", text("---\nid: bbbbbbbbbb\n---\ntheirs\n"));
        w.write(B, "ideas.md", text("see [it](dag:bbbbbbbbbb)\n"));
        await sync(B);
        await sync(A);
      });
    });

    // Seed 60: a file renamed and edited on A (not a rename to the engine: the bytes moved) while B
    // edits it where it was. Edit wins against delete, so both paths carry one id, and each
    // device's tie-break keeps the path its own index knew — the other one — so both files are
    // given derived ids and the original id is carried by nothing.
    it("a duplicate id is settled the same way on every device", async () => {
      await scripted(async (w, A, B) => {
        w.write(A, "plan.md", text("---\nid: cccccccccc\n---\none\n"));
        w.write(A, "ideas.md", text("see [it](dag:cccccccccc)\n"));
        await sync(A);
        await sync(B);
        w.remove(A, "plan.md");
        w.write(A, "notes/plan.md", text("---\nid: cccccccccc\n---\none\ntwo\n"));
        w.write(B, "plan.md", text("---\nid: cccccccccc\n---\nzero\none\n"));
        await sync(A);
        await sync(B);
      });
    });

    // Seeds 28, 71, 76, 82, 91: a case-only rename on A while B edits the file. A's pull reads
    // the incoming `x.md`, finds no `x.md` on disk ("deleted here, edited there") and writes it
    // beside `X.md` — two spellings of one key, which the devices then trade every round.
    it("a case-only rename and a remote edit settle", async () => {
      await scripted(async (w, A, B) => {
        w.write(A, "x.md", text("one\ntwo\n"));
        await sync(A);
        await sync(B);
        w.remove(A, "x.md");
        w.write(A, "X.md", text("one\ntwo\n"));
        w.write(B, "x.md", text("one\ntwo\nthree\n"));
        await sync(B);
        await sync(A);
      });
    });

    // Seeds 20, 30, 48, 90: one document on two devices at two paths — B's, which B edited, and a
    // conflict copy of it A wrote beside its own new file at the path. The copy is pushed in the
    // same pass that wrote it, before A's vault has walked it, so it travelled with no created and
    // B never adopted one; A's own file was overwritten by B's, which adopts nothing either. So
    // neither device knew sync had written either file, each kept the path its own index knew —
    // A the copy, B its file — and the id ended up on neither.
    it("a duplicate id settles alike when neither device adopted a created for it", async () => {
      await scripted(async (w, A, B) => {
        w.write(B, "todo.md", text("---\nid: dddddddddd\n---\nb\n"));
        w.write(B, "ideas.md", text("see [it](dag:dddddddddd)\n"));
        await sync(B);
        w.write(A, "todo.md", text("a\n"));
        await sync(A);
        w.write(B, "todo.md", text("---\nid: dddddddddd\n---\nb\nb2\n"));
        await sync(B);
      });
    });

    // Seed 40: two conflict copies of one key in one minute, the first not yet pushed, the second
    // after a case-only rename moved the file it sits beside. The first is only in `dirty`, so the
    // name check let `x (conflict A …)` and `X (conflict A …)` both be written — one key, two
    // spellings, which the devices then traded every round.
    it("a second conflict copy in the same minute takes a new name, in any case", async () => {
      await scripted(async (w, A, B) => {
        w.write(A, "x.md", text("one\ntwo\n"));
        await sync(A);
        await sync(B);
        w.write(A, "x.md", text("one A\ntwo\n"));
        w.write(B, "x.md", text("one B\ntwo\n"));
        await sync(B);
        await A.engine.pull();
        w.remove(B, "x.md");
        w.write(B, "X.md", text("one BB\ntwo\n"));
        await sync(B);
        await A.engine.pull();
        expect(w.read(A, "X (conflict A 2026-11-06 14.30) 2.md")).not.toBeNull();
      });
    });

    // One name, two kinds: `ideas.md` made on A and `ideas.board.md` on B are two keys, so both
    // commits land and both files arrive everywhere — and the vault lists one document per name, so
    // the other's id claimed nothing and a link to it dangled. Each device now moves the younger to
    // a numbered name, both the same one, and both pushes of that move agree.
    it("one name made as two kinds on two devices becomes two documents", async () => {
      await scripted(async (w, A, B) => {
        const T = Date.parse("2026-11-06T14:30:00Z");
        A.clock = T;
        w.write(A, "ideas.md", text("---\nid: ffffffffff\n---\na note\n"));
        w.write(A, "links.md", text("see [it](dag:ffffffffff)\n"));
        B.clock = T + 5_000;
        w.write(B, "ideas.board.md", text("---\nid: gggggggggg\n---\n\n```md\na board\n```\n"));
        w.write(B, "more.md", text("see [it](dag:gggggggggg)\n"));
        await sync(A);
        await sync(B);
        await sync(A);
        await sync(B);
        expect(w.read(A, "ideas.md")).not.toBeNull();
        expect(w.read(A, "ideas 2.board.md")).not.toBeNull();
        expect(w.read(B, "ideas.board.md")).toBeNull();
      });
    });

    // Seed 1656: B empties a folder and removes it, outside the app. A applies the removal of what
    // was in it and kept the folder — empty, and no entry of its own — so A had `dirs` and B none.
    it("a folder emptied and removed on one device goes on the other", async () => {
      await scripted(async (w, A, B) => {
        w.mkdir(A, "dirs/draft");
        w.write(A, "notes/a.md", text("a\n"));
        await sync(A);
        await sync(B);
        w.rmdir(B, "dirs/draft");
        w.rmdir(B, "dirs");
        w.remove(B, "notes/a.md");
        w.rmdir(B, "notes");
        await sync(B);
        await sync(A);
        expect(w.has(A, "dirs")).toBe(false);
        expect(w.has(A, "notes")).toBe(false);
      });
    });

    // The other half: a folder emptied and kept is pushed as an empty folder, and stays.
    it("a folder emptied and kept on one device stays on the other", async () => {
      await scripted(async (w, A, B) => {
        w.write(A, "notes/a.md", text("a\n"));
        await sync(A);
        await sync(B);
        w.remove(B, "notes/a.md");
        await sync(B);
        await sync(A);
        expect(w.has(A, "notes")).toBe(true);
        expect(w.has(A, "notes/a.md")).toBe(false);
      });
    });

    // Seed 40, one run in fifteen: a duplicate id is settled by created, and one document had two.
    // A conflict copy took the second its device wrote it in rather than the created of the
    // document it holds, and a created said in a push before the vault had walked the file was
    // forgotten — the walk dated it again, a second later. Births straddling a second are what
    // made it a timing failure; the clocks here put them there every run.
    it("one document has one created on every device, whatever second each file was born in", async () => {
      await scripted(async (w, A, B) => {
        const T = Date.parse("2026-11-06T14:30:00Z");
        B.clock = T + 25_000;
        w.write(B, "todo.md", text("---\nid: eeeeeeeeee\n---\nb\n"));
        w.write(B, "ideas.md", text("see [it](dag:eeeeeeeeee)\n"));
        await sync(B);
        w.write(B, "todo.md", text("---\nid: eeeeeeeeee\n---\nb\nb2\n"));
        A.clock = T + 20_000;
        w.write(A, "todo.md", text("a\n"));
        await A.engine.scan();
        await A.engine.syncOnce();
        A.clock = T + 30_000;
        await sync(B);
      });
    });
  });
});
