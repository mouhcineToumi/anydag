// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Doze: a tab hidden for a minute lets go of the live channel, and is told everything may have
 * changed when it is shown again. An open stream is a connection held for as long as the tab stays
 * hidden, whether or not anything is coming down it.
 */

class FakeSource {
  static made: FakeSource[] = [];
  closed = false;
  handlers = new Map<string, (e: MessageEvent<string>) => void>();
  constructor(public url: string) {
    FakeSource.made.push(this);
  }
  addEventListener(type: string, h: (e: MessageEvent<string>) => void) {
    this.handlers.set(type, h);
  }
  close() {
    this.closed = true;
  }
  emit(type: string, data: unknown) {
    this.handlers.get(type)?.({ data: JSON.stringify(data) } as MessageEvent<string>);
  }
}

let hidden = false;

function setHidden(h: boolean) {
  hidden = h;
  document.dispatchEvent(new Event("visibilitychange"));
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.resetModules();
  FakeSource.made = [];
  hidden = false;
  vi.stubGlobal("EventSource", FakeSource);
  Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("the live channel in a hidden tab", () => {
  it("stays open for a glance at another tab", async () => {
    const events = await import("@/board/events");
    const off = events.onBoard(() => undefined);
    setHidden(true);
    vi.advanceTimersByTime(events.DOZE - 1000);
    setHidden(false);
    vi.advanceTimersByTime(events.DOZE * 2);
    expect(FakeSource.made).toHaveLength(1);
    expect(FakeSource.made[0].closed).toBe(false);
    off();
  });

  it("closes after a minute hidden, and opens again with a resume when shown", async () => {
    const events = await import("@/board/events");
    const heard: unknown[] = [];
    let trees = 0;
    const offA = events.onBoard((c) => heard.push(c));
    const offB = events.onBoards(() => trees++);
    setHidden(true);
    vi.advanceTimersByTime(events.DOZE);
    expect(FakeSource.made[0].closed).toBe(true);

    setHidden(false);
    expect(FakeSource.made).toHaveLength(2);
    expect(heard).toEqual([{ name: "", sha1: "", resume: true }]);
    expect(trees).toBe(1);

    /* The new stream is the one that is heard. */
    FakeSource.made[1].emit("dag:board", { name: "plan", sha1: "abc" });
    expect(heard[1]).toEqual({ name: "plan", sha1: "abc" });
    offA();
    offB();
    expect(FakeSource.made[1].closed).toBe(true);
  });

  it("a listener added while dozing waits, and is told with the rest", async () => {
    const events = await import("@/board/events");
    const off = events.onNote(() => undefined);
    setHidden(true);
    vi.advanceTimersByTime(events.DOZE);
    const heard: unknown[] = [];
    const late = events.onNote((c) => heard.push(c));
    expect(FakeSource.made).toHaveLength(1);
    setHidden(false);
    expect(FakeSource.made).toHaveLength(2);
    expect(heard).toHaveLength(1);
    off();
    late();
  });

  it("a tab opened hidden lets go too, though no visibilitychange ever came", async () => {
    /* A reference modifier-clicked into a background tab, a restored session: the commonest way a
       tab sits unseen for a day, and the first version never armed the doze for it. */
    hidden = true;
    const events = await import("@/board/events");
    const off = events.onBoard(() => undefined);
    expect(FakeSource.made).toHaveLength(1);
    vi.advanceTimersByTime(events.DOZE);
    expect(FakeSource.made[0].closed).toBe(true);
    setHidden(false);
    expect(FakeSource.made).toHaveLength(2);
    off();
  });

  it("a stream opened again while hidden lets go as well", async () => {
    const events = await import("@/board/events");
    const first = events.onBoard(() => undefined);
    first();
    expect(FakeSource.made[0].closed).toBe(true);
    setHidden(true);
    const second = events.onBoard(() => undefined);
    expect(FakeSource.made).toHaveLength(2);
    vi.advanceTimersByTime(events.DOZE);
    expect(FakeSource.made[1].closed).toBe(true);
    second();
  });

  it("a resume concerns every file, and a change only its own", async () => {
    const { concerns } = await import("@/board/events");
    expect(concerns({ name: "", sha1: "", resume: true }, "plan")).toBe(true);
    expect(concerns({ name: "plan", sha1: "x" }, "plan")).toBe(true);
    expect(concerns({ name: "other", sha1: "x" }, "plan")).toBe(false);
  });
});
