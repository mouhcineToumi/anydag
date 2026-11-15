import { type APIRequestContext, test as base, type TestDetails } from "@playwright/test";

import { scopeUrl } from "../src/vault/current";
import { suiteVault } from "./vault";

/**
 * The suite's `test`, and the one promise it adds: **a page a spec opens names the suite's vault**.
 *
 * A page that names none lands in the server's default, and the default is whichever vault was
 * opened last — `vaults.spec.ts` and `sync.spec.ts` open others as the point of their checks, and a
 * page that starts inside that window pins the wrong vault for its whole life (`src/vault/current.ts`,
 * `settleVault`): the file its test wrote is in another vault, every document request answers 404,
 * the page shows *Nothing open*, and Chromium prints each 404 on the console, which the suite counts
 * as a failure. `vault.ts`'s {@link suiteVault} is the id; an init script on the context writes it
 * into an address that names none, before the page's own scripts run.
 *
 * **A check that is about the server's default** — a bare `/`, a link to a vault that is not open —
 * opts out beside its title with {@link onServerDefault}, and settles the way a person's tab would.
 *
 * **A request a spec makes itself is pinned the same way.** `page.request`, `context.request` and the
 * `request` fixture ask the server directly, and a document route that names no vault is answered by
 * the default too (`server/app.ts`, `s.within`): a file uploaded, renamed or listed there lands in, or
 * is looked for in, another vault, and the page then 404s on it. {@link scopeRequests} adds the
 * suite's vault to those with the page's own rule (`scopeUrl`, `src/vault/current.ts`).
 *
 * Every spec imports `test` and `expect` from here rather than from `@playwright/test`; a spec that
 * takes them from the package has no pin, and the failure above is silent until a loaded machine
 * widens the window.
 */
export * from "@playwright/test";

/** How {@link onServerDefault} is recorded, in the report and in `testInfo.annotations`. */
const DEFAULT = "the server's own default";

/**
 * The test details that keep a check on the server's default vault, instead of the suite's:
 *
 *     test("a link to a vault that is not open opens the default one", onServerDefault, async ({ page }) => {
 *
 * Use it for a check that is *about* which vault a bare address resolves to, and nowhere else.
 */
export const onServerDefault: TestDetails = { annotation: { type: "vault", description: DEFAULT } };

/**
 * Runs in every page of a context before the page's own scripts: adds the suite's vault to an
 * address that names none, so `settleVault` reads it off the URL rather than falling back to the
 * server's default. Everything else is left byte for byte — a document that is not the app
 * (`about:blank`, a file route), and an address that names a vault on purpose (a check opening
 * another one, or a link to one that is not open, which is a check of its own).
 */
function pin(id: string): void {
  if (location.protocol !== "http:" && location.protocol !== "https:") return;
  const url = new URL(location.href);
  if (url.pathname !== "/" || url.searchParams.has("vault")) return;
  url.searchParams.set("vault", id);
  history.replaceState(history.state, "", url);
}

/** The calls of an `APIRequestContext` that take an address. */
const CALLS = ["get", "post", "put", "patch", "delete", "head", "fetch"] as const;

/** Whether a request's own `params` already name a vault, which is then its business. */
function names(options: unknown): boolean {
  const params = (options as { params?: unknown } | undefined)?.params;
  if (!params) return false;
  if (typeof params === "string") return new URLSearchParams(params).has("vault");
  if (params instanceof URLSearchParams) return params.has("vault");
  return Object.hasOwn(params, "vault");
}

/**
 * Makes every call of `api` that goes to a document route and names no vault name `id`, by the rule
 * the page's own requests follow (`scopeUrl`). An address that names one, a route about the app and
 * not a vault (`/api/vaults`, `/api/health`…) and another origin go through untouched.
 */
function scopeRequests(api: APIRequestContext, id: string, origin: string | undefined): void {
  const calls = api as unknown as Record<(typeof CALLS)[number], (url: unknown, options?: unknown) => Promise<unknown>>;
  for (const name of CALLS) {
    const call = calls[name].bind(api);
    calls[name] = (url, options) => call(typeof url === "string" && !names(options) ? scopeUrl(url, id, origin) : url, options);
  }
}

const optedOut = (annotations: { type: string; description?: string }[]): boolean =>
  annotations.some((a) => a.type === "vault" && a.description === DEFAULT);

export const test = base.extend({
  /**
   * On `context` rather than on `page`, because a spec that opens a second page of its own
   * (`context.newPage()`) loads it through this one context, and because an init script covers a
   * reload or any other navigation the page makes, not only the `goto` a spec wrote. `page.request`
   * is this context's `request`, so scoping it here covers both.
   */
  context: async ({ context, request, baseURL }, use, testInfo) => {
    if (!optedOut(testInfo.annotations)) {
      const id = await suiteVault(request);
      await context.addInitScript(pin, id);
      scopeRequests(context.request, id, baseURL);
    }
    await use(context);
  },
  /** The standalone `request` fixture, which shares nothing with the context's. */
  request: async ({ request, baseURL }, use, testInfo) => {
    if (!optedOut(testInfo.annotations)) scopeRequests(request, await suiteVault(request), baseURL);
    await use(request);
  },
});
