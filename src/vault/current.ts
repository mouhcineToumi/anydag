/**
 * Which vault this tab is in, and how every request says so.
 *
 * A vault is a folder, and one server serves several. **Every request names its vault**: `?vault=<id>`,
 * because an `EventSource` and an `<img src>` cannot send a header. The server has a default — the
 * vault opened last — but the default moves whenever another tab or the CLI opens a folder, so a tab
 * never relies on it: {@link settleVault} takes the vault out of the URL (or, for a bare address,
 * the one this browser used last, or else the server's default), writes it into the URL and **pins**
 * it. From then on every scoped request from this tab names it.
 *
 * With no vault open at all the id is `""`, nothing is added, and the page shows the picker instead of
 * an app. No React here, so `test/vault.test.ts` can hold it in Node.
 */

import { desktop } from "./desktop";

/** The query key a request and a page name their vault with. */
export const PARAM = "vault";

/** Which vault this browser used last — what a bare `/` resumes. This browser's, never synced. */
export const LAST = "dag:vault";

/**
 * Dispatched on `window` when a request is refused because its vault is not open any more — closed in
 * another tab or from the terminal. The page goes to another vault, or to the picker, silently.
 */
export const GONE = "dag:vault-gone";

/** The query keys that open something, so an address carrying one is not a bare `/`. */
const OPENS = ["board", "note", "quiz", "table", "file", "calendar", "ref", "tasks", "quizzes", "chat", "view", "snapshot"];

let pinned: string | null = null;

/**
 * The id of the vault this tab is in, `""` when there is none.
 *
 * **Pinned once the page has settled which it is**, and read off the URL only before then. A tab
 * does not change vault without a navigation — switching is a page load — so a later `replaceState`
 * that happened to drop the key must not quietly move every request after it into the default vault.
 */
export function currentVault(): string {
  if (pinned !== null) return pinned;
  try {
    return new URLSearchParams(location.search).get(PARAM) ?? "";
  } catch {
    /* No `location` — Node. The answer that sends nothing. */
    return "";
  }
}

/** Fix this tab's vault. Called once, by {@link settleVault}; exported for the tests. */
export function pinVault(id: string | null): void {
  pinned = id;
}

/** Routes about the app and not a vault: they answer with no vault open, and are never scoped. */
const UNSCOPED = ["/api/auth/", "/api/vaults", "/api/settings", "/api/health"];

/** Whether a path is one a vault scopes: the document routes, and `/api/` but the app's own. */
export function scopes(path: string): boolean {
  if (path.startsWith("/__board/")) return true;
  if (!path.startsWith("/api/")) return false;
  return !UNSCOPED.some((u) => (u.endsWith("/") ? path.startsWith(u) : path === u || path.startsWith(`${u}/`)));
}

/**
 * `url` with `vault=<id>` added, when it is one of this app's scoped routes and names no vault of
 * its own. Everything else comes back **byte for byte** — a string, never a re-serialised `URL`, so
 * an encoded path stays encoded as it was.
 */
export function scopeUrl(url: string, id: string = currentVault(), origin?: string): string {
  if (!id) return url;
  let rest = url;
  if (/^[a-z][a-z0-9+.-]*:/i.test(url)) {
    /* The page's own origin: an absolute URL on it is one of ours. */
    const ours = origin ?? (typeof location === "undefined" ? undefined : location.origin);
    if (!ours || !url.startsWith(`${ours}/`)) return url;
    rest = url.slice(ours.length);
  }
  const hash = rest.indexOf("#");
  const body = hash === -1 ? rest : rest.slice(0, hash);
  const tail = hash === -1 ? "" : rest.slice(hash);
  const q = body.indexOf("?");
  const path = q === -1 ? body : body.slice(0, q);
  if (!scopes(path)) return url;
  if (q !== -1 && new URLSearchParams(body.slice(q + 1)).has(PARAM)) return url;
  const joined = `${body}${q === -1 ? "?" : "&"}${PARAM}=${encodeURIComponent(id)}${tail}`;
  return url === rest ? joined : `${url.slice(0, url.length - rest.length)}${joined}`;
}

/**
 * An in-app link — `?board=plan`, `/?quiz=q&run=1`, `?ref=<id>#part` — carrying this tab's vault, so
 * following it, or opening it in a new tab, lands where the link was made.
 */
export function withVault(href: string, id: string = currentVault()): string {
  if (!id) return href;
  const hash = href.indexOf("#");
  const body = hash === -1 ? href : href.slice(0, hash);
  const tail = hash === -1 ? "" : href.slice(hash);
  const q = body.indexOf("?");
  if (q !== -1 && new URLSearchParams(body.slice(q + 1)).has(PARAM)) return href;
  return `${body}${q === -1 ? "?" : "&"}${PARAM}=${encodeURIComponent(id)}${tail}`;
}

/**
 * The `localStorage` key a vault keeps its own copy of something under: `key@id`, and the key itself
 * when no vault is pinned. See `settings/prefs.ts` for which keys are a vault's.
 */
export const scopedKey = (key: string, id: string = currentVault()): string => (id ? `${key}@${id}` : key);

/** The address that opens a vault: `/?vault=<id>`, or `/` for the picker. */
export function vaultHref(id: string): string {
  return id ? `/?${PARAM}=${encodeURIComponent(id)}` : "/";
}

function readLast(): string {
  try {
    return localStorage.getItem(LAST) ?? "";
  } catch {
    return "";
  }
}

/** Remember which vault this browser is in, for the next bare `/`. Never for a snapshot. */
function rememberVault(id: string): void {
  try {
    if (new URLSearchParams(location.search).get("snapshot") === "1") return;
    if (id) localStorage.setItem(LAST, id);
    else localStorage.removeItem(LAST);
  } catch {
    /* Site data blocked: the tab is in the right vault, which is the point. */
  }
}

/**
 * Settle which vault this tab is in, before anything else asks. `open` is the ids the server is
 * serving, `fallback` the server's default (`null` when it could not be asked, or has none).
 *
 * In order: the URL's `vault=`; for a bare `/`, the one this browser used last; then the server's
 * default. Never one that is not open when the list could be had — a link to a vault since closed
 * lands in another one, with the key replaced in the address, rather than on a page of 404s. The result
 * is written into the URL (a snapshot's too: the tab names its vault in every request) and pinned.
 */
export function settleVault(open: readonly string[] | null, fallback: string | null = null): string {
  let q: URLSearchParams;
  try {
    q = new URLSearchParams(location.search);
  } catch {
    pinVault("");
    return "";
  }
  let id = q.get(PARAM) ?? "";
  if (!id && location.pathname === "/" && !OPENS.some((k) => q.has(k))) id = readLast();
  if (id && open && !open.includes(id)) id = "";
  if (!id && fallback && (!open || open.includes(fallback))) id = fallback;
  if (!id && open && open.length === 1) id = open[0]!;
  if (id) q.set(PARAM, id);
  else q.delete(PARAM);
  const search = q.toString();
  const next = `${location.pathname}${search ? `?${search}` : ""}${location.hash}`;
  if (next !== `${location.pathname}${location.search}${location.hash}`) history.replaceState(history.state, "", next);
  pinVault(id);
  /* Only the app's own page says where somebody is working. */
  if (location.pathname === "/") rememberVault(id);
  return id;
}

let leaving = false;

/**
 * Go to another vault: a page load, so every subscription, cache and preference starts again.
 *
 * **Once per page.** A vault closed from this tab is heard three ways at nearly once — the close
 * dialog's own answer, the change feed saying so, and any request refused with its 404 — and each
 * goes elsewhere. A second `assign` cancels the navigation the first began, which the browser
 * reports as an aborted load and a test reads as a page that never left.
 */
export function switchVault(id: string): void {
  if (leaving) return;
  leaving = true;
  rememberVault(id);
  location.assign(vaultHref(id));
}

/**
 * The desktop shell asks every write for the page's key (`desktop/main.ts`, `trusted`), which only
 * the page's own top frame is given — so an attachment opened as a document can read at most. A
 * browser on `anydag serve` has no shell and no key, and sends nothing extra.
 */
const PAGE_HEADER = "x-anydag-page";

function marked(input: RequestInfo | URL, init: RequestInit | undefined): [RequestInfo | URL, RequestInit | undefined] {
  const key = desktop()?.pageKey;
  if (!key) return [input, init];
  const request = typeof Request !== "undefined" && input instanceof Request ? input : null;
  const method = (init?.method ?? request?.method ?? "GET").toUpperCase();
  if (method === "GET" || method === "HEAD") return [input, init];
  if (request && !init) {
    const headers = new Headers(request.headers);
    headers.set(PAGE_HEADER, key);
    return [new Request(request, { headers }), undefined];
  }
  const headers = new Headers(init?.headers ?? request?.headers);
  headers.set(PAGE_HEADER, key);
  return [input, { ...init, headers }];
}

/**
 * Add `vault=` to every scoped request this page makes, and hear the one refusal that means the vault
 * itself has gone. Installed before the first request; idempotent.
 */
let installed = false;
export function watchVault(): void {
  if (installed) return;
  installed = true;
  const original = globalThis.fetch;
  globalThis.fetch = async (...args: Parameters<typeof fetch>) => {
    const id = currentVault();
    let [input, init] = args;
    if (id) {
      if (typeof input === "string") input = scopeUrl(input, id);
      else if (input instanceof URL) input = new URL(scopeUrl(input.href, id));
      else if (typeof Request !== "undefined" && input instanceof Request) {
        const next = scopeUrl(input.url, id);
        if (next !== input.url) input = new Request(next, input);
      }
    }
    [input, init] = marked(input, init);
    const response = await original(input, init);
    if (id && response.status === 404) {
      /* Read off a clone, so whoever asked still gets the body. Only a 404 is ever read. */
      void response
        .clone()
        .json()
        .then((body: unknown) => {
          if (body && typeof body === "object" && (body as { code?: unknown }).code === "vault") dispatchEvent(new Event(GONE));
        })
        .catch(() => undefined);
    }
    return response;
  };
}
