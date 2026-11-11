// @vitest-environment jsdom
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { readIndex, seek } from "@/refs/useIndex";

/**
 * The page's copy of the reference index, and the two ways it used to stay stale for good (#123):
 * a refresh that failed waited for the feed's next change, and an embed of an id the index had not
 * heard of waited for the same. After the Assistant made a board and embedded it in an open note,
 * neither came, and every link to the board said *Nothing has this id any more*.
 *
 * The module keeps one index for the page, so the checks below run in order against it — the first
 * load is the first check's. `fetch` is stubbed for the whole file and put back after it.
 */

const doc = (id: string, name: string) => ({ id, name, kind: "board", refs: [] });

let answers: (() => Response)[] = [];
const asked: string[] = [];

const realFetch = globalThis.fetch;
globalThis.fetch = (async (url: string) => {
  asked.push(url);
  const next = answers.shift();
  if (!next) throw new Error("no answer scripted");
  return next();
}) as typeof fetch;

afterAll(() => {
  globalThis.fetch = realFetch;
  vi.useRealTimers();
});

beforeEach(() => {
  vi.useFakeTimers();
  asked.length = 0;
});

const ok =
  (...docs: ReturnType<typeof doc>[]) =>
  () =>
    new Response(JSON.stringify({ docs }), { status: 200 });
const down = () => new Response("anydag: the server is not answering", { status: 502 });

describe("the reference index", () => {
  it("asks again on its own after a refresh that got no answer", async () => {
    /* The first question subscribes, which asks, and waits for an answer, which asks once more. */
    answers = [down, down, ok(doc("aaaaaaaaaa", "a"))];
    const first = await readIndex();
    await vi.advanceTimersByTimeAsync(0);
    expect(first.loaded).toBe(false);
    expect(asked).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1000);
    expect(asked).toHaveLength(3);
    const after = await readIndex();
    expect(after.loaded).toBe(true);
    expect(after.byId.has("aaaaaaaaaa")).toBe(true);
  });

  it("asks once more for an id it does not know, and then knows it", async () => {
    answers = [ok(doc("aaaaaaaaaa", "a"), doc("bbbbbbbbbb", "Merge queue flow"))];
    seek("bbbbbbbbbb");
    await vi.advanceTimersByTimeAsync(800);
    expect(asked).toEqual(["/__board/index"]);
    expect((await readIndex()).byId.get("bbbbbbbbbb")?.name).toBe("Merge queue flow");
  });

  it("does not ask about an id it knows, nor twice about one that is gone", async () => {
    seek("aaaaaaaaaa");
    await vi.advanceTimersByTimeAsync(5000);
    expect(asked).toEqual([]);
    answers = [ok(doc("aaaaaaaaaa", "a"))];
    seek("cccccccccc");
    seek("cccccccccc");
    await vi.advanceTimersByTimeAsync(5000);
    seek("cccccccccc");
    await vi.advanceTimersByTimeAsync(5000);
    expect(asked).toEqual(["/__board/index"]);
  });
});
