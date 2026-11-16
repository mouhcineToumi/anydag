/**
 * The path the API answers this page on, when the page is `anydag serve`'s in a browser.
 *
 * A cookie is not bound to a port, so the cookie `anydag serve` hands a browser is bound to a path
 * instead: `/s/<secret>/`, minted per launch (`server/app.ts`, #339). The address the server prints,
 * `/?token=…`, redirects to the page with `#s=<secret>` — a fragment, which is never sent to any
 * server — and the page keeps it in `localStorage`, which **is** per origin, port included. Every
 * request to the API is then made under that prefix (`scopeUrl` in `current.ts`), where the browser
 * sends the cookie and nowhere else does.
 *
 * The secret is not the token: the token stays in the `HttpOnly` cookie, and no script on the page
 * ever holds it. In the desktop app and behind Vite nothing is stored, and nothing is prefixed — their
 * requests carry the token as a header, added outside the page.
 *
 * No React here, so `test/secret.test.ts` can hold it in Node.
 */

/** Where this origin keeps the secret. Per origin, port included — the point. Never synced. */
export const SECRET = "dag:path";

/** What a secret looks like: what the server mints (`base64url`), and nothing that could be a path. */
const SHAPE = /^[A-Za-z0-9_-]{16,128}$/;

let held: string | null = null;

/** The secret this page's requests are made under, `""` when there is none. */
export function pathSecret(): string {
  if (held !== null) return held;
  /* Not a page — Node, which warns on a bare read of its own `localStorage`. */
  if (typeof document === "undefined") return "";
  try {
    const got = localStorage.getItem(SECRET) ?? "";
    held = SHAPE.test(got) ? got : "";
  } catch {
    /* No storage — Node, or site data blocked: nothing to prefix. */
    held = "";
  }
  return held;
}

/**
 * Take the secret out of the address, keep it, and clean the address. Called once at boot, before the
 * first request. A fragment that is not the server's is left where it is.
 */
export function takeSecret(): string {
  let hash: string;
  try {
    hash = location.hash;
  } catch {
    return pathSecret();
  }
  if (!hash.startsWith("#")) return pathSecret();
  const said = new URLSearchParams(hash.slice(1));
  const got = said.get("s");
  if (got === null) return pathSecret();
  said.delete("s");
  const rest = said.toString();
  history.replaceState(history.state, "", `${location.pathname}${location.search}${rest ? `#${rest}` : ""}`);
  if (!SHAPE.test(got)) return pathSecret();
  held = got;
  try {
    localStorage.setItem(SECRET, got);
  } catch {
    /* Site data blocked: this page has it, and a new one needs the link again. */
  }
  return got;
}

/** Drop a secret the server no longer answers to — a server since restarted mints another. */
export function forgetSecret(): void {
  held = "";
  try {
    localStorage.removeItem(SECRET);
  } catch {
    /* Nothing kept to forget. */
  }
}

/** For the tests: read storage again on the next ask. */
export function resetSecret(): void {
  held = null;
}

/** `path` — an API path, `/__board/…` or `/api/…` — under the secret, or as it is when there is none. */
export const underSecret = (path: string, secret: string = pathSecret()): string => (secret ? `/s/${secret}${path}` : path);
