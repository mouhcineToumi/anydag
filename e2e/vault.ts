import type { Page } from "@playwright/test";

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
