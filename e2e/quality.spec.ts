import { expect, test } from "@playwright/test";

/**
 * The channel `anydag snapshot` reads the quality report out of.
 *
 * Every graph diagram scores its own layout and writes the result to `data-dag-quality` on the way
 * to being ready. Nothing on the page draws it, so nothing on the page would look wrong if it
 * stopped being written — and the skill's fix loop would quietly start reporting every board as
 * clean, which is worse than reporting nothing at all. This is the test that notices.
 *
 * The numbers themselves are frozen in `test/route-quality.test.ts` against an arithmetic measurer.
 * Here the layout is Chrome's, measured in the real webfonts, so what is asserted is the shape and
 * the verdict rather than the last digit: the board with nothing wrong says nothing, and the board
 * that has always been the worst in the set says so.
 */

interface Report {
  item: string;
  totals: Record<string, number>;
  findings: { code: string; ids: string[] }[];
}

async function reportsOn(page: import("@playwright/test").Page, board: string): Promise<Report[]> {
  await page.goto(`/?board=${encodeURIComponent(board)}&snapshot=1`);
  await page.waitForFunction(() => document.documentElement.dataset.dagReady === "1", null, { timeout: 20_000 });
  return page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>("[data-dag-quality]")).map((el) => ({
      item: el.closest<HTMLElement>("[data-dag-item]")?.dataset.dagItem ?? "?",
      ...(JSON.parse(el.dataset.dagQuality ?? "{}") as Omit<Report, "item">),
    })),
  );
}

test("a diagram publishes its own score, named by the item it belongs to", async ({ page }) => {
  const reports = await reportsOn(page, "reference/architecture");

  expect(reports.length).toBeGreaterThan(0);
  for (const r of reports) {
    expect(r.item, "a report has to name the item a person would go and edit").not.toBe("?");
    expect(Object.keys(r.totals).sort()).toEqual([
      "bends",
      "crossings",
      "labelOverNode",
      "labelOverlaps",
      "nodeOverlaps",
      "throughNode",
    ]);
  }
});

test("a board with nothing wrong reports nothing", async ({ page }) => {
  const reports = await reportsOn(page, "reference/workflow");

  expect(reports.length).toBeGreaterThan(0);
  expect(reports.flatMap((r) => r.findings)).toEqual([]);
});

test("the worst board in the set says so, and names ids that exist", async ({ page }) => {
  /* A use-case diagram is a dense bipartite graph: three actors reach seven use cases in one
     column, and some of their lines will cross whatever the order. It has never scored zero and
     is not expected to — what matters is that the report points at something real. (It used to
     route *through* the pills as well; since the column is ordered by the actors that reach it
     and an «include» is drawn beside it, only the crossings are left.) */
  const reports = await reportsOn(page, "reference/usecase");
  const findings = reports.flatMap((r) => r.findings);

  expect(findings.length).toBeGreaterThan(0);
  expect(findings.map((f) => f.code)).toContain("Q_EDGE_CROSSING");
  for (const f of findings) expect(f.ids.filter(Boolean)).toHaveLength(2);

  /* Never this one: two cards on top of each other is a layout defect, not a crowded diagram. */
  expect(findings.map((f) => f.code)).not.toContain("Q_NODE_OVERLAP");
});
