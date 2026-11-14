import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { asker, DEBOUNCE } from "../src/search/ask";
import type { Found } from "../src/search/wire";

/**
 * Asking the server per query: one request once typing pauses, and the latest query's answer is the
 * only one that lands. The shared modules are why the stubbed `fetch` is put back after each test.
 */

const found = (name: string): Found => ({
  id: name,
  name,
  kind: "note",
  title: null,
  part: "L1",
  what: "paragraph",
  score: 1,
  terms: [name],
  snippet: `**${name}**`,
  runs: [{ text: name, hit: true }],
});

interface Call {
  url: string;
  signal: AbortSignal;
  answer(hits: Found[], status?: number): void;
}

let calls: Call[] = [];
const real = globalThis.fetch;

beforeEach(() => {
  vi.useFakeTimers();
  calls = [];
  globalThis.fetch = ((url: string, init: RequestInit) =>
    new Promise<Response>((resolve, reject) => {
      const signal = init.signal!;
      signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      calls.push({
        url,
        signal,
        answer: (hits, status = 200) => resolve(new Response(JSON.stringify({ hits }), { status })),
      });
    })) as typeof fetch;
});
afterEach(() => {
  vi.useRealTimers();
  globalThis.fetch = real;
});

/** Let a resolved request's `await`s run. */
const settle = () => vi.advanceTimersByTimeAsync(0);

describe("asking the server per query", () => {
  it("sends one request when typing pauses, not one per key", async () => {
    const got: [string, Found[]][] = [];
    const a = asker((q, hits) => got.push([q, hits]));
    for (const q of ["p", "pa", "pay", "paym"]) {
      a.ask(q);
      await vi.advanceTimersByTimeAsync(DEBOUNCE - 20);
    }
    expect(calls).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(DEBOUNCE);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("/__board/search?q=paym");

    calls[0]!.answer([found("paym")]);
    await settle();
    expect(got).toEqual([["paym", [found("paym")]]]);
  });

  it("encodes the query, spaces and all", async () => {
    const a = asker(() => {});
    a.ask("pay sett & more");
    await vi.advanceTimersByTimeAsync(DEBOUNCE);
    expect(calls[0]!.url).toBe("/__board/search?q=pay%20sett%20%26%20more");
  });

  it("aborts the request in flight when a newer query replaces it, and drops its answer", async () => {
    const got: string[] = [];
    const a = asker((q) => got.push(q));
    a.ask("pay");
    await vi.advanceTimersByTimeAsync(DEBOUNCE);
    expect(calls).toHaveLength(1);

    a.ask("payments");
    expect(calls[0]!.signal.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(DEBOUNCE);
    expect(calls).toHaveLength(2);

    /* The slow answer to `pay` arrives after the fast one to `payments`, and is not drawn. */
    calls[1]!.answer([found("payments")]);
    await settle();
    calls[0]!.answer([found("pay")]);
    await settle();
    expect(got).toEqual(["payments"]);
  });

  it("drops an answer that arrives after stop, and can be asked again", async () => {
    const got: string[] = [];
    const a = asker((q) => got.push(q));
    a.ask("pay");
    await vi.advanceTimersByTimeAsync(DEBOUNCE);
    a.stop();
    expect(calls[0]!.signal.aborted).toBe(true);
    calls[0]!.answer([found("pay")]);
    await settle();
    expect(got).toEqual([]);

    a.ask("ledger");
    await vi.advanceTimersByTimeAsync(DEBOUNCE);
    calls[1]!.answer([found("ledger")]);
    await settle();
    expect(got).toEqual(["ledger"]);
  });

  it("sends nothing for a query stopped before its pause ended", async () => {
    const a = asker(() => {});
    a.ask("pay");
    a.stop();
    await vi.advanceTimersByTimeAsync(DEBOUNCE * 3);
    expect(calls).toHaveLength(0);
  });

  it("says nothing for a refused or failed request", async () => {
    const got: string[] = [];
    const a = asker((q) => got.push(q));
    a.ask("pay");
    await vi.advanceTimersByTimeAsync(DEBOUNCE);
    calls[0]!.answer([], 500);
    await settle();

    a.ask("pay");
    await vi.advanceTimersByTimeAsync(DEBOUNCE);
    globalThis.fetch = (() => Promise.reject(new TypeError("fetch failed"))) as typeof fetch;
    a.ask("ledger");
    await vi.advanceTimersByTimeAsync(DEBOUNCE);
    expect(got).toEqual([]);
  });
});
