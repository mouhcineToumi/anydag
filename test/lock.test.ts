import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  LOCKED,
  LOCK_CHANGED,
  LOCK_HINT,
  LOCK_KEYS,
  LOCK_REFUSED,
  isLocked,
  lockNoticeText,
  lockedAffordance,
  mayEdit,
  refuseLocked,
  setLocked,
  toggleLock,
} from "@/settings/lock";

/**
 * The lock's state: one key this browser keeps, and the two events every page hears it by.
 *
 * Node has no `window`, so its three parts are stood in for here — a store, an address, and an
 * `EventTarget` for the global `addEventListener`/`dispatchEvent` the module calls bare — and taken
 * back after each test, which `isolate: false` in `vitest.config.ts` asks of every file.
 */
let store: Record<string, string>;
let heard: string[];
const target = new EventTarget();
const record = (e: Event) => heard.push(e.type);

beforeEach(() => {
  store = {};
  heard = [];
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => void (store[k] = v),
      removeItem: (k: string) => void delete store[k],
    },
  });
  Object.defineProperty(globalThis, "location", { configurable: true, value: { search: "?board=demo" } });
  Object.defineProperty(globalThis, "dispatchEvent", { configurable: true, value: (e: Event) => target.dispatchEvent(e) });
  target.addEventListener(LOCK_CHANGED, record);
  target.addEventListener(LOCK_REFUSED, record);
});

afterEach(() => {
  target.removeEventListener(LOCK_CHANGED, record);
  target.removeEventListener(LOCK_REFUSED, record);
  Reflect.deleteProperty(globalThis, "localStorage");
  Reflect.deleteProperty(globalThis, "location");
  Reflect.deleteProperty(globalThis, "dispatchEvent");
});

describe("the lock", () => {
  it("is off until somebody locks, and kept as one key this browser holds", () => {
    expect(isLocked()).toBe(false);
    setLocked(true);
    expect(isLocked()).toBe(true);
    expect(store[LOCKED]).toBe("1");
    setLocked(false);
    expect(isLocked()).toBe(false);
    /* Absent, not "0": unlocked is the default, and a browser never locked carries nothing. */
    expect(LOCKED in store).toBe(false);
  });

  it("says so when it changes, and only when it does", () => {
    setLocked(true);
    setLocked(true);
    toggleLock();
    expect(heard).toEqual([LOCK_CHANGED, LOCK_CHANGED]);
    expect(isLocked()).toBe(false);
  });

  it("refuses a write while locked, says so, and lets one through otherwise", () => {
    expect(mayEdit()).toBe(true);
    expect(heard).toEqual([]);
    setLocked(true);
    heard = [];
    expect(mayEdit()).toBe(false);
    expect(refuseLocked()).toBe(false);
    expect(heard).toEqual([LOCK_REFUSED, LOCK_REFUSED]);
  });

  it("is never read under ?snapshot=1, where a page is photographed rather than used", () => {
    store[LOCKED] = "1";
    expect(isLocked()).toBe(true);
    Object.defineProperty(globalThis, "location", { configurable: true, value: { search: "?board=demo&snapshot=1" } });
    expect(isLocked()).toBe(false);
  });

  it("gives a control that writes the one hover sentence and the disabled hook, and nothing unlocked", () => {
    expect(LOCK_HINT).toBe(`Read only — unlock (${LOCK_KEYS})`);
    expect(LOCK_HINT).toBe("Read only — unlock (Ctrl+Shift+L)");
    expect(lockedAffordance(false)).toEqual({});
    expect(lockedAffordance(true)).toEqual({
      "aria-disabled": true,
      "data-dag-readonly-blocked": "",
      title: "Read only — unlock (Ctrl+Shift+L)",
    });
  });

  it("says why a write was refused, and that unlocking worked, with the wording the notice uses", () => {
    expect(lockNoticeText("refused")).toBe("Read only: unlock to change this.");
    expect(lockNoticeText("locked")).toMatch(/^Read only:/);
    expect(lockNoticeText("unlocked")).toMatch(/^Unlocked:/);
  });
});
