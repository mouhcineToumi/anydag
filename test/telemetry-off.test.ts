/**
 * The anonymous-logs toggle in a build whose `cloud` switch is off (#326).
 *
 * Settings → Privacy draws the toggle in every build. Off, choosing it must make **no telemetry
 * request at all** — `/api/telemetry` is not registered — and must keep the answer for the first
 * build that can carry it (`dag:telemetry-pending`). `e2e/cloud.spec.ts` holds the page half; this
 * is the client's own answer, with `fetch` counted.
 *
 * The modules are imported afresh (`vi.resetModules`) so `features.known` and the client's `started`
 * are the first load's, not a previous file's in the shared suite.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TELEMETRY_PENDING } from "@/settings/prefs";

const store = new Map<string, string>();
const calls: { url: string; method: string; body: unknown }[] = [];

beforeEach(() => {
  store.clear();
  calls.length = 0;
  vi.resetModules();
  vi.stubGlobal("location", { search: "" });
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
  vi.stubGlobal("fetch", async (url: string, init?: { method?: string; body?: string }) => {
    calls.push({ url, method: init?.method ?? "GET", body: init?.body ? JSON.parse(init.body) : null });
    return new Response(JSON.stringify({ features: { cloud: false } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the toggle with the switch off", () => {
  it("records the choice and makes no telemetry request", async () => {
    const { loadFeatures } = await import("@/features");
    const { setConsent, startTelemetry } = await import("@/telemetry/client");

    expect(await loadFeatures()).toEqual({ cloud: false });
    await startTelemetry();
    expect(await setConsent(true)).toBe(true);

    /* The one request is the health answer the page asks for anyway; nothing went to the logs. */
    expect(calls).toEqual([{ url: "/api/health", method: "GET", body: null }]);
    expect(store.get(TELEMETRY_PENDING)).toBe("1");

    /* And a no is the same shape: recorded here, sent nowhere. */
    expect(await setConsent(false)).toBe(true);
    expect(calls).toHaveLength(1);
    expect(store.get(TELEMETRY_PENDING)).toBe("0");
  });
});
