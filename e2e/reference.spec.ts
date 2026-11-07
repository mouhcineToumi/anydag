import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { BOARDS } from "./boards";

/* The fourteen reference boards, inside whichever account the suite signed in as. */
const DIR = path.join(BOARDS, "reference");
const boards = fs
  .readdirSync(DIR)
  .filter((f) => f.endsWith(".board.md"))
  .map((f) => `reference/${f.replace(".board.md", "")}`);

const THEMES = ["paper", "neutral", "paper-dark"];

for (const theme of THEMES) {
  for (const board of boards) {
    test(`${board} · ${theme}`, async ({ page }) => {
      const problems: string[] = [];
      page.on("console", (msg) => {
        if (msg.type() === "error" || msg.type() === "warning") problems.push(msg.text());
      });
      page.on("pageerror", (e) => problems.push(String(e)));

      await page.goto(`/?board=${encodeURIComponent(board)}&theme=${theme}&snapshot=1`);
      await page.waitForFunction(() => document.documentElement.dataset.dagReady === "1", null, {
        timeout: 20_000,
      });
      await page.evaluate(() => document.fonts.ready);

      /* Nothing broken anywhere: a board that fails to parse still renders, so a screenshot alone
         would happily pass on a broken diagram. A diagram that cannot be drawn is a grey
         placeholder carrying `data-dag-error` now, not the red `.dag-error` card this used to look
         for — asking only for the card would pass on a broken board by matching nothing. */
      await expect(page.locator(".dag-error, [data-dag-error], [data-dag-stale]")).toHaveCount(0);

      /* The size assertion and the token audit both report here. */
      expect(problems, `console output on ${board}`).toEqual([]);

      /* **The baseline is this machine's font rasterisation, and only this machine's.** A GitHub
         runner measures text a shade narrower, so every card is smaller, the layout shrinks with
         them, and the image arrives 1091x818 against a 1117x837 baseline — a uniform 2.3%, which
         is a size mismatch rather than something the 1% tolerance could absorb. 17 of the 45
         failed the first time CI ran them. So CI sets `ANYDAG_NO_SNAPSHOTS` and compares no pixels;
         everything above this line still runs there — the board still has to become ready, draw
         no error card and leave the console silent, which is where the dev size assertion
         reports. The pixel gate is `npm run gate`, on the machine the baselines were made on.
         `CLAUDE.md` already says these are `-linux` and not portable; this is that, enforced. */
      if (!process.env.ANYDAG_NO_SNAPSHOTS) {
        await expect(page.locator(".dag-layer")).toHaveScreenshot(`${board.replace("/", "-")}-${theme}.png`);
      }
    });
  }
}
