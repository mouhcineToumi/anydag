import fs from "node:fs";

import type { APIRequestContext, Page } from "@playwright/test";

import { BOARDS } from "./boards";

/**
 * The `localStorage` key this tab keeps `key` under: a vault's own preferences are kept as `key@<id>`
 * (`src/vault/current.ts`), and the id is the one in the address. A spec that seeds or reads one of
 * `dag:settings`, `dag:theme`, `dag:favourites` or `dag:sidebar-open` by hand asks for it here.
 */
export const vaultKey = async (page: Page, key: string): Promise<string> => {
  /* The tab writes its vault into the address once it has asked the server which there are. */
  await page.waitForFunction(() => new URL(location.href).searchParams.has("vault"));
  return page.evaluate((k) => {
    const id = new URL(location.href).searchParams.get("vault");
    return id ? `${k}@${id}` : k;
  }, key);
};

let suite: string | null = null;

/**
 * The id of the vault the suite's fixtures are in (`boards/local/`), asked of the server once per
 * worker.
 *
 * **This is the vault every page is pinned to**, by the init script `e2e/fixture.ts` puts on the
 * context, so a spec imports `test` from there and gets it without naming it. A spec that asks the
 * server for something outside the page — the list, a document's id — names it with this.
 *
 * **The server's own default is not this.** Opening a vault makes it the default, `vaults.spec.ts`
 * and `sync.spec.ts` open one or more as the point of their checks, and each puts the suite's own
 * back a request later: a window of a few milliseconds on a quiet machine and a good deal more on a
 * loaded one. A page that starts in it pins the wrong vault and never recovers (`settleVault`), which
 * is the failure the pin exists to stop. The checks that are *about* the default opt out, with
 * `onServerDefault`.
 */
export async function suiteVault(request: APIRequestContext): Promise<string> {
  if (suite) return suite;
  const home = fs.realpathSync(BOARDS);
  let found: string | undefined;
  /* Polled, because the answer is wrong for as long as the list has not heard of the folder. */
  for (let i = 0; i < 50 && !found; i++) {
    const body = (await (await request.get("/api/vaults")).json()) as {
      vaults: { id: string; path: string; open: boolean }[];
    };
    found = body.vaults.find((v) => v.open && v.path === home)?.id;
    if (!found) await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!found) throw new Error(`no open vault is ${home}: the suite's own vault is not being served`);
  return (suite = found);
}
