import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, afterEach, describe, expect, it } from "vitest";

import { Parsed, Thread } from "../../server/grammar";

describe("the grammar's worker (#9)", () => {
  /* A stand-in for `grammar-worker.mjs`: `/stuck` never answers — a grammar caught in a loop on
     somebody else's file — and anything else answers at once. */
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "anydag-grammar-thread-"));
  const file = path.join(dir, "worker.mjs");
  fs.writeFileSync(
    file,
    `import { parentPort } from "node:worker_threads";
parentPort.on("message", (m) => {
  if (m.route === "/stuck") for (;;) {}
  parentPort.postMessage({ id: m.id, answer: { status: 200, body: m.route } });
});
`,
  );
  /* The suite shares a process between files (`isolate: false`): a worker left running is another
     file's problem, so every one is ended here. */
  const threads: Thread[] = [];
  const made = (deadlineMs: number): Thread => {
    const t = new Thread(file, deadlineMs);
    threads.push(t);
    return t;
  };
  afterEach(async () => {
    for (const t of threads.splice(0)) await t.close();
  });
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("ends a worker that is past its deadline, and answers the next question from a new one", async () => {
    const thread = made(300);
    const t = Date.now();
    await expect(thread.ask("POST", "/stuck", new URLSearchParams(), {})).rejects.toThrow(/longer than .* on \/stuck/);
    expect(Date.now() - t).toBeLessThan(5000);
    await expect(thread.ask("POST", "/index", new URLSearchParams(), {})).resolves.toEqual({ status: 200, body: "/index" });
  });

  it("does not end a worker that answers in time", async () => {
    const thread = made(300);
    for (let i = 0; i < 3; i++)
      await expect(thread.ask("GET", "/corpus", new URLSearchParams(), {})).resolves.toMatchObject({ status: 200 });
    await new Promise((r) => setTimeout(r, 400));
    await expect(thread.ask("GET", "/search", new URLSearchParams(), {})).resolves.toEqual({ status: 200, body: "/search" });
  });
});

describe("Parsed", () => {
  it("parses only what changed, and moves its generation only then", async () => {
    const asked: string[][] = [];
    const parsed = new Parsed(async (texts) => {
      asked.push(Object.keys(texts).sort());
      return Object.fromEntries(Object.entries(texts).map(([k, t]) => [k, { length: t.length }]));
    });
    await parsed.of({ a: "one", b: "two" });
    const g = parsed.generation;
    await parsed.of({ a: "one", b: "two" });
    expect(parsed.generation).toBe(g);
    await parsed.of({ a: "one", b: "three" });
    expect(parsed.generation).toBe(g + 1);
    // A text gone is a change too.
    await parsed.of({ a: "one" });
    expect(parsed.generation).toBe(g + 2);
    expect(asked).toEqual([["a", "b"], ["b"]]);
  });

  it("takes two cold asks one after the other, so the second parses nothing", async () => {
    let calls = 0;
    const parsed = new Parsed(async (texts) => {
      calls++;
      await new Promise((r) => setTimeout(r, 10));
      return Object.fromEntries(Object.keys(texts).map((k) => [k, {}]));
    });
    await Promise.all([parsed.of({ a: "x", b: "y" }), parsed.of({ a: "x", b: "y" })]);
    expect(calls).toBe(1);
  });
});
