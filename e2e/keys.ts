import type { Page } from "@playwright/test";

import { LEADER_CODE } from "../src/edit/bindings";

/**
 * Press a leader chord: the leader, then the letter.
 *
 * Two presses rather than `down`/`press`/`up`, because the tap-then-letter form is the one a person
 * who is not already holding the board will use, and it exercises the half of the mechanism that
 * outlives the key being released. The held form has its own check in `shortcuts.spec.ts`.
 *
 * `LEADER_CODE` is a `KeyboardEvent.code` and Playwright takes one directly, so a suite of sixty
 * presses is not what is holding the binding in place — the table is.
 */
export async function lead(page: Page, key: string) {
  await page.keyboard.press(LEADER_CODE);
  await page.keyboard.press(key);
}
