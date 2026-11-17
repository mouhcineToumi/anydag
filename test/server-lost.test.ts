// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * #402: a page left open over an `anydag serve` that has since restarted. The new server mints another
 * secret path, so every request this page makes is answered `401` by a server that is alive — no
 * network error, nothing rejected — and the page used to read that as "did not land" and say nothing:
 * a write taken back in silence, a change feed closed for good. Here the page's half: its `fetch`
 * hears the gate's `401` and marks the page lost, once; the feed, refused, asks the question again
 * where it can be heard rather than going quietly stale; and the words say how to get back.
 */

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const GATE = { error: "this server needs its token", code: "token" };

/* What this origin keeps: the secret `anydag serve` handed the page, when a test says it was handed one. */
let kept: Map<string, string>;

beforeEach(() => {
  vi.resetModules();
  kept = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => kept.get(k) ?? null,
    setItem: (k: string, v: string) => kept.set(k, v),
    removeItem: (k: string) => kept.delete(k),
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("the page's fetch hears the gate", () => {
  async function wrapped(answer: (url: string) => Response) {
    const seen: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        seen.push(url);
        return answer(url);
      }),
    );
    const vault = await import("@/vault/current");
    const lost = await import("@/auth/lost");
    vault.watchVault();
    let told = 0;
    const off = lost.onServerLost(() => told++);
    return { lost, seen, told: () => told, off };
  }

  it("marks the page lost on a 401 from the API, once, before the caller reads it", async () => {
    const { lost, told, off } = await wrapped(() => json(401, GATE));
    expect(lost.serverLost()).toBe(false);
    const r = await fetch("/__board/patch?name=plan", { method: "POST", body: "{}" });
    expect(r.status).toBe(401);
    expect(lost.serverLost()).toBe(true);
    await fetch("/api/vaults");
    expect(told()).toBe(1);
    off();
  });

  it("hears it under a secret path too — a restarted `anydag serve`'s, the issue's case", async () => {
    kept.set("dag:path", "old-secret-0123456789");
    const { lost, seen, off } = await wrapped(() => json(401, GATE));
    await fetch("/__board/events");
    expect(seen[0]).toBe("/s/old-secret-0123456789/__board/events");
    expect(lost.serverLost()).toBe(true);
    off();
  });

  it("is not lost over any other refusal, nor over a 401 from somewhere that is not this server", async () => {
    const { lost, off } = await wrapped((url) => (url.startsWith("https://elsewhere.example/") ? json(401, {}) : json(403, {})));
    await fetch("/__board/patch?name=plan", { method: "POST" });
    await fetch("/api/sync/link");
    await fetch("https://elsewhere.example/api/thing");
    expect(lost.serverLost()).toBe(false);
    off();
  });
});

describe("which URLs are the API's", () => {
  it("reads the root, the secret path and this origin, and nothing else", async () => {
    const { toApi } = await import("@/vault/current");
    const origin = "http://127.0.0.1:4100";
    expect(toApi("/__board/patch?name=a", origin)).toBe(true);
    expect(toApi("/api/auth/me", origin)).toBe(true);
    expect(toApi("/s/abcdefghijklmnop/__board/events?vault=v", origin)).toBe(true);
    expect(toApi(`${origin}/s/abcdefghijklmnop/api/vaults`, origin)).toBe(true);
    expect(toApi("/assets/index.js", origin)).toBe(false);
    expect(toApi("/s/abcdefghijklmnop/assets/index.js", origin)).toBe(false);
    expect(toApi("http://127.0.0.1:9999/api/vaults", origin)).toBe(false);
  });
});

describe("the change feed, refused", () => {
  class FakeSource {
    static made: FakeSource[] = [];
    readyState = 0;
    closed = false;
    handlers = new Map<string, (e: Event) => void>();
    constructor(public url: string) {
      FakeSource.made.push(this);
    }
    addEventListener(type: string, h: (e: Event) => void) {
      this.handlers.set(type, h);
    }
    close() {
      this.closed = true;
      this.readyState = 2;
    }
    /** What the browser does with a stream answered by a status: closes it for good, then says so. */
    refuse() {
      this.readyState = 2;
      this.handlers.get("error")?.(new Event("error"));
    }
  }

  async function feed(status: number) {
    vi.useFakeTimers();
    FakeSource.made = [];
    vi.stubGlobal("EventSource", FakeSource);
    const asked: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        asked.push(url);
        return json(status, status === 401 ? GATE : {});
      }),
    );
    const vault = await import("@/vault/current");
    vault.watchVault();
    return asked;
  }

  it("asks the server again, hears the gate, and does not knock on a dead secret again", async () => {
    const asked = await feed(401);
    const events = await import("@/board/events");
    const lost = await import("@/auth/lost");
    const off = events.onBoard(() => undefined);
    /* A stream merely dropped — a server going away — is the browser's to retry: nothing asked. */
    FakeSource.made[0].handlers.get("error")?.(new Event("error"));
    expect(asked).toEqual([]);

    FakeSource.made[0].refuse();
    await vi.advanceTimersByTimeAsync(0);
    expect(asked).toEqual(["/api/auth/me"]);
    expect(lost.serverLost()).toBe(true);

    await vi.advanceTimersByTimeAsync(events.RETRY * 3);
    const offAgain = events.onNote(() => undefined);
    expect(FakeSource.made).toHaveLength(1);
    offAgain();
    off();
  });

  it("opens again, and tells every listener to look, when the refusal was not the gate's", async () => {
    await feed(200);
    const events = await import("@/board/events");
    const lost = await import("@/auth/lost");
    const heard: unknown[] = [];
    const off = events.onBoard((c) => heard.push(c));
    FakeSource.made[0].refuse();
    await vi.advanceTimersByTimeAsync(0);
    expect(lost.serverLost()).toBe(false);
    expect(FakeSource.made).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(events.RETRY);
    expect(FakeSource.made).toHaveLength(2);
    expect(heard).toEqual([{ name: "", sha1: "", resume: true }]);
    off();
  });
});

describe("what the page says", () => {
  it("names the address `anydag serve` printed when it was handed one, and a reload otherwise", async () => {
    const { lostWords } = await import("@/auth/lost");
    const served = lostWords("a-secret-0123456789");
    expect(served.short).toContain("`anydag serve` printed");
    expect(served.full).toContain("?token=");
    expect(served.short).toContain("nothing here is saved");
    const shell = lostWords("");
    expect(shell.short).toContain("reload the page");
    expect(shell.short).not.toContain("anydag serve");
  });
});
