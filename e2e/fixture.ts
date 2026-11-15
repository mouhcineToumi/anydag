import { test as base, type TestDetails } from "@playwright/test";

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

export const test = base.extend({
  /**
   * On `context` rather than on `page`, because a spec that opens a second page of its own
   * (`context.newPage()`) loads it through this one context, and because an init script covers a
   * reload or any other navigation the page makes, not only the `goto` a spec wrote.
   */
  context: async ({ context, request }, use, testInfo) => {
    const optOut = testInfo.annotations.some((a) => a.type === "vault" && a.description === DEFAULT);
    if (!optOut) await context.addInitScript(pin, await suiteVault(request));
    await use(context);
  },
});
