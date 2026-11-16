import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { scopeUrl } from "@/vault/current";
import { SECRET, forgetSecret, pathSecret, resetSecret, takeSecret, underSecret } from "@/vault/secret";

/**
 * The secret path `anydag serve` hands a browser (#339): the cookie is bound to `/s/<secret>/`
 * rather than to `/`, because a cookie reaches every port of `127.0.0.1` and a path is the one part
 * of an address the listener on another port does not know. The page takes the secret out of the
 * fragment `/?token=` redirects to, keeps it per origin, and puts every API request under it — and
 * nothing else. In the desktop app and behind Vite there is none, and nothing changes.
 */

const S = "Abc_def-0123456789xyzABCDEFGHIJK";

let url: string;
let store: Map<string, string>;
beforeEach(() => {
  store = new Map();
  const at = () => new URL(url, "http://127.0.0.1:41000");
  vi.stubGlobal("location", {
    get search() {
      return at().search;
    },
    get pathname() {
      return at().pathname;
    },
    get hash() {
      return at().hash;
    },
    origin: "http://127.0.0.1:41000",
  });
  vi.stubGlobal("history", {
    state: null,
    replaceState: (_s: unknown, _t: string, next: string) => {
      url = next;
    },
  });
  vi.stubGlobal("document", {});
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
  resetSecret();
});
afterEach(() => {
  vi.unstubAllGlobals();
  resetSecret();
});

describe("takeSecret", () => {
  it("takes the secret out of the fragment, keeps it for this origin, and cleans the address", () => {
    url = `/?board=plan&vault=v1#s=${S}`;
    expect(takeSecret()).toBe(S);
    expect(store.get(SECRET)).toBe(S);
    expect(pathSecret()).toBe(S);
    expect(url).toBe("/?board=plan&vault=v1");
  });

  it("leaves a fragment that is not the server's where it is", () => {
    url = "/?ref=abc#part";
    expect(takeSecret()).toBe("");
    expect(url).toBe("/?ref=abc#part");
  });

  it("keeps the rest of a fragment that also carried the secret", () => {
    url = `/?note=n#s=${S}&x=1`;
    takeSecret();
    expect(url).toBe("/?note=n#x=1");
  });

  it("refuses anything that is not a secret's shape, and still cleans it off", () => {
    for (const bad of ["../../api", "short", "a/b/c/d/e/f/g/h/i/j", "x%2F..%2Fy-0123456789"]) {
      resetSecret();
      store.clear();
      url = `/#s=${encodeURIComponent(bad)}`;
      expect(takeSecret()).toBe("");
      expect(store.has(SECRET)).toBe(false);
      expect(url).toBe("/");
    }
  });

  it("with no fragment, is the one this origin kept", () => {
    store.set(SECRET, S);
    url = "/?board=plan";
    expect(takeSecret()).toBe(S);
  });

  it("is forgotten when the server no longer answers to it", () => {
    store.set(SECRET, S);
    expect(pathSecret()).toBe(S);
    forgetSecret();
    expect(pathSecret()).toBe("");
    expect(store.has(SECRET)).toBe(false);
  });
});

describe("scopeUrl, under a secret", () => {
  it("puts every API request under the secret, the app's own routes too", () => {
    expect(scopeUrl("/__board/list", "v1", undefined, S)).toBe(`/s/${S}/__board/list?vault=v1`);
    expect(scopeUrl("/__board/events", "v1", undefined, S)).toBe(`/s/${S}/__board/events?vault=v1`);
    expect(scopeUrl("/__board/file?id=abc&download=1", "v1", undefined, S)).toBe(
      `/s/${S}/__board/file?id=abc&download=1&vault=v1`,
    );
    expect(scopeUrl("/api/auth/me", "v1", undefined, S)).toBe(`/s/${S}/api/auth/me`);
    expect(scopeUrl("/api/health", "", undefined, S)).toBe(`/s/${S}/api/health`);
    expect(scopeUrl("/api/vaults/open", "", undefined, S)).toBe(`/s/${S}/api/vaults/open`);
    expect(scopeUrl("/__board/list?vault=other", "v1", undefined, S)).toBe(`/s/${S}/__board/list?vault=other`);
  });

  it("leaves the page, its assets and every other origin alone", () => {
    for (const url of ["/", "/?board=plan", "/assets/index.js", "/src/main.tsx", "https://elsewhere.example/api/x"]) {
      expect(scopeUrl(url, "v1", "http://127.0.0.1:41000", S)).toBe(url);
    }
  });

  it("prefixes an absolute URL on this origin after the origin", () => {
    expect(scopeUrl("http://127.0.0.1:41000/__board/list", "v1", "http://127.0.0.1:41000", S)).toBe(
      `http://127.0.0.1:41000/s/${S}/__board/list?vault=v1`,
    );
  });

  it("never prefixes twice", () => {
    const once = scopeUrl("/__board/file?id=abc", "v1", undefined, S);
    expect(scopeUrl(once, "v1", undefined, S)).toBe(once);
  });

  it("adds nothing with no secret — the desktop app and Vite", () => {
    expect(scopeUrl("/api/auth/me", "", undefined, "")).toBe("/api/auth/me");
    expect(scopeUrl("/__board/list", "v1", undefined, "")).toBe("/__board/list?vault=v1");
    expect(underSecret("/api/health", "")).toBe("/api/health");
  });

  it("reads the kept secret by default", () => {
    store.set(SECRET, S);
    expect(scopeUrl("/api/health", "")).toBe(`/s/${S}/api/health`);
  });
});
