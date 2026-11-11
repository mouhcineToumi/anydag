import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { refresher } from "@/board/refresher";

/**
 * What the file list and the reference index ask the server with (#123): one request out and one
 * queued at most, and a request that got no answer asked again on its own — the page used to wait
 * for the feed's next change, which after the Assistant's last write never came, so the sidebar
 * went on missing the board it had just made.
 */

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

/** A request whose answers are scripted, one per call, and that says how many times it was made. */
function scripted(...answers: (boolean | "throw")[]) {
  let calls = 0;
  const once = vi.fn(async () => {
    const a = answers[Math.min(calls++, answers.length - 1)];
    if (a === "throw") throw new Error("no answer");
    return a!;
  });
  return { once, calls: () => calls };
}

describe("refresher", () => {
  it("asks again on its own after a request that got no answer, waiting longer each time", async () => {
    const s = scripted("throw", false, true);
    const r = refresher(s.once, { first: 1000, last: 30_000 });
    await r.ask();
    expect(s.calls()).toBe(1);
    await vi.advanceTimersByTimeAsync(999);
    expect(s.calls()).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(s.calls()).toBe(2);
    /* The second failure waits twice as long. */
    await vi.advanceTimersByTimeAsync(1999);
    expect(s.calls()).toBe(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(s.calls()).toBe(3);
    /* And an answer ends it. */
    await vi.advanceTimersByTimeAsync(60_000);
    expect(s.calls()).toBe(3);
  });

  it("never waits longer than the last wait", async () => {
    const s = scripted(false);
    const r = refresher(s.once, { first: 1000, last: 4000 });
    await r.ask();
    await vi.advanceTimersByTimeAsync(1000 + 2000 + 4000);
    expect(s.calls()).toBe(4);
    await vi.advanceTimersByTimeAsync(4000);
    expect(s.calls()).toBe(5);
  });

  it("keeps one request out, and one more after it however many asks arrive meanwhile", async () => {
    let land: (ok: boolean) => void = () => {};
    let calls = 0;
    const r = refresher(
      () =>
        new Promise<boolean>((resolve) => {
          calls++;
          land = resolve;
        }),
    );
    void r.ask();
    void r.ask();
    void r.ask();
    expect(calls).toBe(1);
    land(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toBe(2);
    land(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toBe(2);
  });

  it("asks once more after a request out when told it is stale, and not at all when none is out", async () => {
    const s = scripted(true);
    const r = refresher(s.once);
    r.stale();
    await vi.advanceTimersByTimeAsync(0);
    expect(s.calls()).toBe(0);
    const out = r.ask();
    r.stale();
    await out;
    await vi.advanceTimersByTimeAsync(0);
    expect(s.calls()).toBe(2);
  });

  it("forgets a waiting retry when cancelled, but keeps an ask made after", async () => {
    const s = scripted(false, true);
    const r = refresher(s.once, { first: 1000 });
    await r.ask();
    r.cancel();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(s.calls()).toBe(1);
    await r.ask();
    expect(s.calls()).toBe(2);
  });
});
