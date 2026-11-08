import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { docUrl, forgetPrefetched, openDoc, prefetchDoc } from "@/board/prefetch";

/**
 * A document's text asked for before the click that opens it.
 *
 * `openDoc` is what a page's first load calls instead of `fetch`; these hold the three rules the
 * module states: it answers from a prefetch only while one is fresh, it is gone soon after a page
 * takes it, and a change on the feed for that name takes it away.
 */

/** The one `EventSource` the change feed opens, with a way to send it an event. */
class FakeSource {
  static last: FakeSource | null = null;
  private on = new Map<string, (e: { data: string }) => void>();
  constructor() {
    FakeSource.last = this;
  }
  addEventListener(type: string, listen: (e: { data: string }) => void) {
    this.on.set(type, listen);
  }
  close() {}
  send(type: string, change: object) {
    this.on.get(type)?.({ data: JSON.stringify(change) });
  }
}

let calls: string[];
let served: number;

beforeEach(() => {
  calls = [];
  served = 0;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.stubGlobal("EventSource", FakeSource);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      calls.push(url);
      served += 1;
      return new Response(JSON.stringify({ text: `version ${served}`, base: `b${served}` }), { status: 200 });
    }),
  );
});

afterEach(() => {
  forgetPrefetched();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const textOf = async (r: Response) => ((await r.json()) as { text: string }).text;

describe("the read that opens a page", () => {
  it("is the prefetch when one was asked for, and no second request", async () => {
    prefetchDoc("note", "work/plan");
    expect(calls).toEqual([docUrl("note", "work/plan")]);
    expect(await textOf(await openDoc("note", "work/plan"))).toBe("version 1");
    expect(calls).toHaveLength(1);
  });

  it("asks once however often the pointer rests on the row", () => {
    prefetchDoc("board", "rested");
    prefetchDoc("board", "rested");
    expect(calls).toEqual(["/__board/get?name=rested"]);
  });

  it("serves a page mounted twice at once, then lets go", async () => {
    prefetchDoc("board", "twice");
    expect(await textOf(await openDoc("board", "twice"))).toBe("version 1");
    expect(await textOf(await openDoc("board", "twice"))).toBe("version 1");
    vi.advanceTimersByTime(1_500);
    expect(await textOf(await openDoc("board", "twice"))).toBe("version 2");
  });

  it("is a request of its own when nothing was asked for, or what was is stale", async () => {
    expect(await textOf(await openDoc("quiz", "pg"))).toBe("version 1");
    prefetchDoc("table", "deals");
    vi.advanceTimersByTime(11_000);
    expect(await textOf(await openDoc("table", "deals"))).toBe("version 3");
    expect(calls).toEqual([
      "/__board/get?name=pg&kind=quiz",
      "/__board/get?name=deals&kind=table",
      "/__board/get?name=deals&kind=table",
    ]);
  });

  it("is never what the server replaced since", async () => {
    prefetchDoc("note", "plan");
    FakeSource.last?.send("dag:note", { name: "other", sha1: "x" });
    FakeSource.last?.send("dag:note", { name: "plan", sha1: "y" });
    expect(await textOf(await openDoc("note", "plan"))).toBe("version 2");
  });

  it("is asked afresh when the prefetch met a server error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        calls.push(url);
        served += 1;
        return served === 1
          ? new Response("{}", { status: 502 })
          : new Response(JSON.stringify({ text: "fine" }), { status: 200 });
      }),
    );
    prefetchDoc("board", "failed");
    expect(await textOf(await openDoc("board", "failed"))).toBe("fine");
  });
});
