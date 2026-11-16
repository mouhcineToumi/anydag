import fs from "node:fs";
import path from "node:path";

import { BOARDS } from "./boards";
import { expect, test, type Page } from "./fixture";
import { openSidebar } from "./sidebar";
import { suiteVault } from "./vault";

/**
 * Ten notes open in tabs cost at most half as much again as one (#264).
 *
 * Only the few notes most recently in front stay mounted behind it (`LIVE_NOTES`,
 * `src/ui/tabs/keep.ts`); the rest are a place and a kept scroll. Measured the way the bench measures
 * a page (`scripts/bench.mjs`): the renderer's JS heap after a forced collection, and the DOM's
 * node count, with one note open and then with ten — each brought to the front once, so each has
 * had its editor built. The numbers go into the report as annotations, which is where the pull
 * request reads them from.
 */

const COUNT = 10;
let folder = "";

/** A note of some size: forty paragraphs, a list and a heading or two — a working note, not a stub. */
const note = (i: number): string => {
  const paras = Array.from(
    { length: 40 },
    (_, p) => `Paragraph ${p} of note ${i}, long enough to wrap once or twice in the editor at the width the suite draws it at.`,
  );
  return `---\ntitle: Note ${i}\n---\n# Note ${i}\n\n${paras.join("\n\n")}\n\n## A list\n\n- one\n- two\n- three\n`;
};

test.beforeEach(async ({ page }, info) => {
  folder = `e2e-tabmem-${info.testId.toLowerCase().replace(/[^a-z0-9]+/g, "")}`;
  fs.mkdirSync(path.join(BOARDS, folder), { recursive: true });
  for (let i = 0; i < COUNT; i++) fs.writeFileSync(path.join(BOARDS, folder, `n${i}.note.md`), note(i));
  const vault = await suiteVault(page.request);
  await expect
    .poll(
      async () => {
        const body = (await (await page.request.get("/__board/list", { params: { vault } })).json()) as { notes: string[] };
        return Array.from({ length: COUNT }, (_, i) => `${folder}/n${i}`).every((n) => body.notes.includes(n));
      },
      { timeout: 10_000 },
    )
    .toBe(true);
});
test.afterEach(() => {
  if (folder) fs.rmSync(path.join(BOARDS, folder), { recursive: true, force: true });
  folder = "";
});

const ready = (page: Page) =>
  page.waitForFunction(() => document.documentElement.dataset.dagReady === "1", null, { timeout: 20_000 });

test("ten notes in tabs stay within 1.5 times the memory of one", async ({ page, context }) => {
  test.setTimeout(120_000);
  const cdp = await context.newCDPSession(page);
  await cdp.send("Performance.enable");
  const measure = async () => {
    /* Twice: a collection can leave what the first freed for the second to sweep. */
    await cdp.send("HeapProfiler.collectGarbage");
    await cdp.send("HeapProfiler.collectGarbage");
    const { usedSize } = (await cdp.send("Runtime.getHeapUsage")) as { usedSize: number };
    const { nodes } = (await cdp.send("Memory.getDOMCounters")) as { nodes: number };
    return { heap: usedSize, nodes };
  };

  await page.goto(`/?note=${folder}/n0`);
  await ready(page);
  await openSidebar(page);
  const row = (i: number) => page.locator(`[data-dag-sidebar-file="${folder}/n${i}"]`);
  await expect(row(COUNT - 1)).toHaveCount(1, { timeout: 10_000 });
  /* Settled: the sidebar drawn, the editor up, the fonts in. */
  await page.waitForTimeout(1_000);
  const one = await measure();

  for (let i = 1; i < COUNT; i++) {
    await row(i).click({ button: "middle" });
    await page
      .locator("[data-dag-doctab]")
      .filter({ hasText: `Note ${i}` })
      .click();
    await ready(page);
    await expect(page.locator(".dag-docs__page:not([data-dag-docs-away]) .bn-editor")).toBeVisible();
  }
  await expect(page.locator("[data-dag-doctab]")).toHaveCount(COUNT);
  await page.waitForTimeout(1_000);
  const ten = await measure();

  const ratio = ten.heap / one.heap;
  const mb = (b: number) => `${(b / 1024 / 1024).toFixed(1)} MB`;
  const said = `JS heap ${mb(one.heap)} → ${mb(ten.heap)} (×${ratio.toFixed(2)}); DOM nodes ${one.nodes} → ${ten.nodes} (×${(ten.nodes / one.nodes).toFixed(2)})`;
  test.info().annotations.push({ type: "memory", description: said });
  console.log(`doctabs memory: ${said}`);
  expect(ratio, said).toBeLessThanOrEqual(1.5);
});
