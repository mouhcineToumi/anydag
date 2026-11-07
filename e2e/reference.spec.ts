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

/* **The smoke tier's share of the 45.** One board per way of laying a diagram out — ELK's layered
   graph (`architecture`, `erd`), swimlanes (`workflow`), the five layouts of our own (`sequence`,
   `timeline`, `gitgraph`, `sketch`, `chart`) and the mind map's tree — under the default theme, and
   the dark theme once. The rest run in the full suite. */
const SMOKE = new Set([
  "paper reference/architecture",
  "paper reference/erd",
  "paper reference/workflow",
  "paper reference/sequence",
  "paper reference/timeline",
  "paper reference/gitgraph",
  "paper reference/sketch",
  "paper reference/chart",
  "paper reference/mindmap",
  "paper-dark reference/architecture",
]);

for (const theme of THEMES) {
  for (const board of boards) {
    test(`${board} · ${theme}`, SMOKE.has(`${theme} ${board}`) ? { tag: "@smoke" } : {}, async ({ page }) => {
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

      /* **The baselines are the Docker image's, and only the image's.** They are taken and compared
         in `mcr.microsoft.com/playwright:v<version>-noble` (`npm run e2e:docker`, and CI runs the
         same image), because the same page rasterises differently in another Chromium build and
         with other system fonts — and the `neutral` theme *is* `system-ui`, so its cards are
         measured, and its whole layout sized, by whatever the machine has installed: a GitHub
         runner's came out 2.3% smaller than a laptop's. A host run (`npm run e2e:local`) sets
         `ANYDAG_NO_SNAPSHOTS` and compares no pixels; everything above this line still runs there —
         the board still has to become ready, draw no error card and leave the console silent,
         which is where the dev size assertion reports. */
      if (!process.env.ANYDAG_NO_SNAPSHOTS) {
        await expect(page.locator(".dag-layer")).toHaveScreenshot(`${board.replace("/", "-")}-${theme}.png`);
      }
    });
  }
}
