import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, type Page } from "@playwright/test";

/**
 * Where the suite's fixtures go.
 *
 * **The e2e suite is the files store, structurally**: every spec writes its board with
 * `fs.writeFileSync` and reads the result back off disk, which is the right shape for proving a
 * gesture wrote what it claims. A board lives at `boards/<handle>/<name>.board.md`, and the
 * handle the suite uses is spelled here and nowhere else.
 *
 * **The handle is read, not assumed.** The obvious version of this file says `boards/local`,
 * and on a fresh checkout that is usually right. But the suite's server can run for a different
 * handle, and `global-setup.ts` knows which it actually got; a spec assuming `local` would write
 * fifty fixtures into boards that server does not serve and every spec would time out waiting for
 * a board the server correctly refuses to answer about. `global-setup.ts` records what it used;
 * this reads it.
 */

const here = path.dirname(fileURLToPath(import.meta.url));

export const ROOT = path.resolve(here, "..");

/** Where `global-setup.ts` leaves the record of which board directory the fixtures go in. */
export const AUTH_DIR = path.join(here, ".auth");
export const STATE_FILE = path.join(AUTH_DIR, "state.json");
export const ACCOUNT_FILE = path.join(AUTH_DIR, "account.json");

function handle(): string {
  try {
    const raw = JSON.parse(fs.readFileSync(ACCOUNT_FILE, "utf8")) as { handle?: string };
    if (raw.handle) return raw.handle;
  } catch {
    /* Before the first `global-setup` run there is no file. `local` is the right guess — the dev
       vault the suite is set up against — and the setup rewrites this the moment it knows better. */
  }
  return process.env.ANYDAG_OWNER || "local";
}

/** The suite's board directory: what every spec's `DIR` is. */
export const BOARDS = path.join(ROOT, "boards", handle());

/**
 * Open the board browser.
 *
 * The list is a dialog, so every check that reaches a board row, a folder heading or the search box
 * opens it first. The toolbar's board name is what opens it — one control, which is the whole of
 * what is left up there.
 *
 * Idempotent, and retried as a pair, for the two reasons `openMore` states: the button is a toggle,
 * so a second click on an open card would shut it; and the toolbar re-renders whenever the board
 * does, so a click can land between the press and the card appearing.
 */
export async function openBoards(page: Page): Promise<void> {
  await expect(async () => {
    if (await page.locator("[data-dag-boards]").isVisible()) return;
    await page.locator("[data-dag-open-boards]").click({ timeout: 1_000 });
    await expect(page.locator("[data-dag-boards]")).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
}

/**
 * A board's permanent id, once the server's list names the file.
 *
 * A spec writes its fixture with `fs` and the server's id index is fed by the file watcher, so one
 * `GET /__board/list` straight after the write is a race: under load the answer does not have the
 * file yet and `ids[name]` is `undefined`. The index is eventually consistent by design, so poll the
 * list until it names the file, then read the id.
 */
export async function boardId(page: Page, name: string): Promise<string> {
  let id: string | undefined;
  await expect
    .poll(async () => {
      const list = (await (await page.request.get("/__board/list")).json()) as { ids: Record<string, string> };
      id = list.ids[name];
      return id;
    })
    .toBeTruthy();
  return id!;
}
