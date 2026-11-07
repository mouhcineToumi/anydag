import fs from "node:fs";

import type { Page } from "@playwright/test";

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
 * **A page that names no vault lands in the server's default — and the default moves.** Opening a
 * vault makes it the default, `vaults.spec.ts` and `sync.spec.ts` open one or more as the point of
 * their checks, and each puts the suite's own back a request later: a window of a few
 * milliseconds on a quiet machine and a good deal more on a loaded one. A page that starts in it
 * pins the wrong vault for its whole life (`src/vault/current.ts`, `settleVault`), so the file its
 * test wrote a moment ago is in *another* vault: every document request answers 404, the page shows
 * *Nothing open*, and Chromium prints each 404 on the console, which the suite counts as a failure.
 * A spec that loads a page and cannot afford that names the vault in the address, as a tab does once
 * it has settled, with {@link vaulted}.
 */
export async function suiteVault(page: Page): Promise<string> {
  if (suite) return suite;
  const home = fs.realpathSync(BOARDS);
  let found: string | undefined;
  /* Polled, because the answer is wrong for as long as the list has not heard of the folder. */
  for (let i = 0; i < 50 && !found; i++) {
    const body = (await (await page.request.get("/api/vaults")).json()) as {
      vaults: { id: string; path: string; open: boolean }[];
    };
    found = body.vaults.find((v) => v.open && v.path === home)?.id;
    if (!found) await page.waitForTimeout(100);
  }
  if (!found) throw new Error(`no open vault is ${home}: the suite's own vault is not being served`);
  return (suite = found);
}

/** `url` with the suite's vault named in it, so the page cannot settle into whichever vault was opened last. */
export async function vaulted(page: Page, url: string): Promise<string> {
  const id = await suiteVault(page);
  return `${url}${url.includes("?") ? "&" : "?"}vault=${encodeURIComponent(id)}`;
}
