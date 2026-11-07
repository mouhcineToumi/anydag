import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { storageKey } from "@/settings/prefs";
import { LAST, currentVault, pinVault, scopeUrl, scopedKey, scopes, settleVault, vaultHref, withVault } from "@/vault/current";

/**
 * How a page says which vault it is in — held here because every request the app makes passes through
 * `scopeUrl`, and the property that matters most is the one no browser check would notice: **a tab
 * names its vault everywhere** (the server's default moves whenever another tab or the CLI opens a
 * folder), and names it in no place that is not about a vault.
 */

describe("scopeUrl", () => {
  it("leaves every URL byte for byte when no vault is pinned", () => {
    for (const url of ["/__board/list", "/__board/get?name=a%20b", "/api/settings", "/__board/assets/x.assets/p%20q.png"]) {
      expect(scopeUrl(url, "")).toBe(url);
    }
  });

  it("adds the id to the document routes and to /api, never to the app's own", () => {
    expect(scopeUrl("/__board/list", "v1")).toBe("/__board/list?vault=v1");
    expect(scopeUrl("/__board/get?name=plan&kind=note", "v1")).toBe("/__board/get?name=plan&kind=note&vault=v1");
    expect(scopeUrl("/api/practice", "v1")).toBe("/api/practice?vault=v1");
    expect(scopeUrl("/api/vault/settings", "v1")).toBe("/api/vault/settings?vault=v1");
    expect(scopeUrl("/api/auth/me", "v1")).toBe("/api/auth/me");
    expect(scopeUrl("/api/vaults", "v1")).toBe("/api/vaults");
    expect(scopeUrl("/api/vaults/open", "v1")).toBe("/api/vaults/open");
    expect(scopeUrl("/api/settings", "v1")).toBe("/api/settings");
    expect(scopeUrl("/api/health", "v1")).toBe("/api/health");
    expect(scopeUrl("/src/main.tsx", "v1")).toBe("/src/main.tsx");
  });

  it("keeps an encoded path encoded and a hash after the query", () => {
    expect(scopeUrl("/__board/assets/a.assets/p%20q.png", "v1")).toBe("/__board/assets/a.assets/p%20q.png?vault=v1");
    expect(scopeUrl("/__board/get?name=x#frag", "v1")).toBe("/__board/get?name=x&vault=v1#frag");
  });

  it("never overrides a request that already names a vault", () => {
    expect(scopeUrl("/__board/list?vault=other", "v1")).toBe("/__board/list?vault=other");
  });

  it("scopes an absolute URL on this origin and leaves every other origin alone", () => {
    expect(scopeUrl("http://here:3500/__board/list", "v1", "http://here:3500")).toBe("http://here:3500/__board/list?vault=v1");
    expect(scopeUrl("https://elsewhere.example/__board/list", "v1", "http://here:3500")).toBe("https://elsewhere.example/__board/list");
  });

  it("encodes an id, though an id never needs it", () => {
    expect(scopeUrl("/__board/list", "a b")).toBe("/__board/list?vault=a%20b");
  });
});

describe("scopes", () => {
  it("is the board routes and /api but the app's own", () => {
    expect(scopes("/__board/events")).toBe(true);
    expect(scopes("/api/vault/settings")).toBe(true);
    expect(scopes("/api/auth/me")).toBe(false);
    expect(scopes("/api/vaults")).toBe(false);
    expect(scopes("/api/vaults/close")).toBe(false);
    expect(scopes("/api/settings")).toBe(false);
    expect(scopes("/__boardx")).toBe(false);
  });
});

describe("withVault", () => {
  it("carries the tab's vault on an in-app link, before any hash", () => {
    expect(withVault("?board=plan", "v1")).toBe("?board=plan&vault=v1");
    expect(withVault("/?quiz=q&run=1", "v1")).toBe("/?quiz=q&run=1&vault=v1");
    expect(withVault("?ref=abc#%5Epara", "v1")).toBe("?ref=abc&vault=v1#%5Epara");
  });

  it("adds nothing with no vault, and never a second one", () => {
    expect(withVault("?board=plan", "")).toBe("?board=plan");
    expect(withVault("?board=plan&vault=other", "v1")).toBe("?board=plan&vault=other");
  });

  it("opens a vault at the root, the picker at a bare slash", () => {
    expect(vaultHref("v1")).toBe("/?vault=v1");
    expect(vaultHref("")).toBe("/");
  });
});

describe("what this browser keeps per vault", () => {
  afterEach(() => pinVault(null));

  it("keeps a vault's own keys under its id", () => {
    expect(scopedKey("dag:theme", "v1")).toBe("dag:theme@v1");
    expect(scopedKey("dag:theme", "")).toBe("dag:theme");
  });

  it("scopes the settings, the theme, the favourites, the attachments folder and the open folders — not the window's layout", () => {
    pinVault("v1");
    expect(storageKey("dag:settings")).toBe("dag:settings@v1");
    expect(storageKey("dag:theme")).toBe("dag:theme@v1");
    expect(storageKey("dag:favourites")).toBe("dag:favourites@v1");
    expect(storageKey("dag:attachments")).toBe("dag:attachments@v1");
    expect(storageKey("dag:sidebar-open")).toBe("dag:sidebar-open@v1");
    expect(storageKey("dag:library")).toBe("dag:library");
    expect(storageKey("dag:sidebar")).toBe("dag:sidebar");
    expect(storageKey("dag:prefs-at")).toBe("dag:prefs-at");
    pinVault("");
    expect(storageKey("dag:theme")).toBe("dag:theme");
  });
});

describe("settleVault", () => {
  let url: string;
  let store: Map<string, string>;

  beforeEach(() => {
    store = new Map();
    const at = () => new URL(url, "http://here");
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
    });
    vi.stubGlobal("history", {
      state: null,
      replaceState: (_s: unknown, _t: string, next: string) => {
        url = next;
      },
    });
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    pinVault(null);
  });

  it("takes the URL's vault, pins it, and remembers it", () => {
    url = "/?board=plan&vault=b";
    expect(settleVault(["a", "b"], "a")).toBe("b");
    expect(currentVault()).toBe("b");
    expect(store.get(LAST)).toBe("b");
    expect(url).toBe("/?board=plan&vault=b");
  });

  it("resumes the last one on a bare slash, and says so in the address", () => {
    store.set(LAST, "b");
    url = "/";
    expect(settleVault(["a", "b"], "a")).toBe("b");
    expect(url).toBe("/?vault=b");
  });

  it("names the server's default in the address when nothing else says — the tab never relies on it later", () => {
    url = "/?board=plan";
    expect(settleVault(["a", "b"], "a")).toBe("a");
    expect(url).toBe("/?board=plan&vault=a");
    expect(currentVault()).toBe("a");
  });

  it("does not resume the last vault for a link that opens something", () => {
    store.set(LAST, "b");
    url = "/?board=plan";
    expect(settleVault(["a", "b"], "a")).toBe("a");
  });

  it("lands in another vault, with the key replaced, when the one named is not open", () => {
    url = "/?board=plan&vault=gone#part";
    expect(settleVault(["a"], "a")).toBe("a");
    expect(url).toBe("/?board=plan&vault=a#part");
  });

  it("is the empty id, with the key taken out, when no vault is open at all", () => {
    url = "/?board=plan&vault=gone";
    expect(settleVault([], null)).toBe("");
    expect(url).toBe("/?board=plan");
    expect(currentVault()).toBe("");
  });

  it("trusts the URL when the list could not be had", () => {
    url = "/?vault=b";
    expect(settleVault(null)).toBe("b");
  });

  it("stays where the tab is once pinned, whatever the address says later", () => {
    url = "/?vault=b";
    settleVault(["a", "b"], "a");
    url = "/?board=plan";
    expect(currentVault()).toBe("b");
  });

  it("never remembers a picture being taken", () => {
    store.set(LAST, "b");
    url = "/?snapshot=1&board=plan";
    expect(settleVault(["a", "b"], "a")).toBe("a");
    expect(store.get(LAST)).toBe("b");
  });
});
