import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { BOARDS } from "./boards";

/**
 * C2: what a chart puts on the page.
 *
 * `reference.spec.ts` already photographs `reference/chart` in all three themes, and a screenshot
 * is the wrong instrument for the two claims that matter here. The first is that a chart is
 * *reachable*: every series and every wedge is one `data-dag-node`, and `data-dag-layout` carries a
 * box for each — the pair is what lets a board link end on a series and, next milestone, a pick
 * reach one. The second is that a chart's box is the **author's**: `resizeOf("chart")` is `box`, so
 * changing `w=`/`h=` in the file has to change the `<svg>` the layout sized, and nothing else does.
 *
 * The second one works on a scratch board in `boards/`, for the reason `edit.spec.ts` gives: the
 * thing being checked is a document a person also owns, so the test writes the bytes and reads the
 * drawing back.
 */

const DIR = BOARDS;
const THEMES = ["paper", "neutral", "paper-dark"];

/** Every series and slice on the reference board, in declaration order — which is drawing order. */
const MARKS: Record<string, string[]> = {
  quarters: ["web", "mob"],
  hours: ["plan", "build", "fix"],
  latency: ["api", "web", "job"],
  sources: ["organic", "referral", "paid", "social", "other"],
  plans: ["free", "pro", "team"],
  load: ["hits"],
};

async function ready(page: Page): Promise<void> {
  await page.waitForFunction(() => document.documentElement.dataset.dagReady === "1", null, { timeout: 20_000 });
  await page.evaluate(() => document.fonts.ready);
}

for (const theme of THEMES) {
  test(`every series and slice is a node, and the layout says where · ${theme}`, async ({ page }) => {
    const problems: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error" || msg.type() === "warning") problems.push(msg.text());
    });
    page.on("pageerror", (e) => problems.push(String(e)));

    await page.goto(`/?board=reference%2Fchart&theme=${theme}&snapshot=1`);
    await ready(page);

    await expect(page.locator(".dag-error")).toHaveCount(0);
    await expect(page.locator(".dag-warnings")).toHaveCount(0);
    await expect(page.locator("svg.dag-chart")).toHaveCount(Object.keys(MARKS).length);

    for (const [item, ids] of Object.entries(MARKS)) {
      const scope = `[data-dag-item="${item}"]`;
      const marks = page.locator(`${scope} [data-dag-node]`);
      await expect(marks, `${item} draws one group per series or slice`).toHaveCount(ids.length);
      expect(await marks.evaluateAll((els) => els.map((e) => e.getAttribute("data-dag-node")))).toEqual(ids);

      /* The other half of the pair: `usePublishedLayout` writes the boxes a board link lands on. */
      const published = await page.locator(`${scope} [data-dag-layout]`).getAttribute("data-dag-layout");
      const laid = JSON.parse(published ?? "{}") as { nodes: Record<string, { w: number; h: number }>; groups: unknown };
      expect(Object.keys(laid.nodes).sort()).toEqual([...ids].sort());
      expect(laid.groups).toEqual({});
      for (const id of ids) expect(laid.nodes[id]!.w, `${item}.${id} has a box`).toBeGreaterThan(0);
    }

    /* A photographed board is drawn, not used: no hit strokes, and no chart of ours draws an edge
       to need one in the first place. */
    await expect(page.locator(".dag-edge-hit")).toHaveCount(0);

    expect(problems, "console output on reference/chart").toEqual([]);
  });
}

test.describe("a chart resizes by its own attributes", () => {
  let name = "";
  let file = "";

  test.beforeEach(({}, info) => {
    name = `e2e-chart-${info.testId}`;
    file = path.join(DIR, `${name}.board.md`);
    fs.writeFileSync(file, board(400, 300));
  });
  test.afterEach(() => fs.rmSync(file, { force: true }));

  function board(w: number, h: number): string {
    return `---
title: Resize me
---

\`\`\`chart {#rev x=0 y=0 w=${w} h=${h}}
bar
x Q1 Q2 Q3
series web "Web" 12 30 21
\`\`\`
`;
  }

  test("`w=` and `h=` change the svg the layout sized, and nothing else moves", async ({ page }) => {
    await page.goto(`/?board=${name}`);
    await page.evaluate(() => localStorage.setItem("dag:library", "0"));
    await ready(page);

    const svg = page.locator('[data-dag-item="rev"] svg.dag-chart');
    /* The svg's own attributes, not its client rect: the board is fitted to the viewport, so a
       rect is the layout multiplied by a zoom that changes when the item does. */
    const box = async () => ({
      w: Number(await svg.getAttribute("width")),
      h: Number(await svg.getAttribute("height")),
    });
    const before = await box();
    expect(before.w).toBeGreaterThan(0);

    fs.writeFileSync(file, board(600, 400));
    /* The watcher pushes the new text; a chart's layout is synchronous, so the next size is the
       answer rather than an intermediate one. */
    await expect.poll(async () => (await box()).w, { timeout: 10_000 }).toBe(before.w + 200);
    expect((await box()).h).toBe(before.h + 100);

    /* Still one series, and its box came back from a layout that ran at the new width. */
    await expect(page.locator('[data-dag-item="rev"] [data-dag-node]')).toHaveCount(1);
    const laid = JSON.parse(
      (await page.locator('[data-dag-item="rev"] [data-dag-layout]').getAttribute("data-dag-layout")) ?? "{}",
    ) as { nodes: Record<string, { x: number; w: number }> };
    expect(laid.nodes.web!.x + laid.nodes.web!.w).toBeLessThanOrEqual(before.w + 200);
    expect(laid.nodes.web!.x + laid.nodes.web!.w).toBeGreaterThan(before.w);
  });
});

/* -------------------------------------------------------------- C3: editing one on the canvas */

/**
 * What the pointer can reach inside a chart.
 *
 * Everything here was already expressible in the fence and unreachable without typing into it: the
 * numbers a series draws, the shape the whole thing takes, the order the bars sit in, and the name
 * on a wedge. Each check reads the bytes back, for the reason `props.spec.ts` gives — the thing
 * being tested is that a control turns into a small, correct edit to a document a person also owns.
 */
test.describe("editing a chart", () => {
  let name = "";
  let file = "";

  const BOARD = `---
title: Charts
---

\`\`\`chart {#rev x=0 y=0 w=520 h=360}
bar
x Q1 Q2 Q3
series web "Web" 12 30 21
series mob "Mobile" 4 6 9
\`\`\`

\`\`\`chart {#share x=640 y=0 w=440 h=360}
bar
slice a "Alpha" 40
slice b "Beta" 35
slice c "Gamma" 25
\`\`\`
`;

  test.beforeEach(({}, info) => {
    name = `e2e-chart-edit-${info.testId}`;
    file = path.join(DIR, `${name}.board.md`);
    fs.writeFileSync(file, BOARD);
  });
  test.afterEach(() => fs.rmSync(file, { force: true }));

  const read = () => fs.readFileSync(file, "utf8");

  async function open(page: Page) {
    await page.goto(`/?board=${name}`);
    await page.evaluate(() => {
      localStorage.setItem("dag:library", "0");
      localStorage.setItem("dag:inspector-mode", "props");
    });
    await ready(page);
  }

  /**
   * Click a *mark*, twice: the second press is what picks a series out of its chart.
   *
   * Never the `<g>` itself — its box is the union of the marks, and for a series of bars the centre
   * of that box is paper. Playwright would aim there, find nothing to hit, and retry until it timed
   * out. A bar is a shape, so its own centre is on it.
   */
  async function pickMark(page: Page, item: string, id: string) {
    const mark = page.locator(`[data-dag-item="${item}"] [data-dag-node="${id}"] .dag-chart__bar`).first();
    await mark.click();
    await page.waitForTimeout(400);
    await mark.click();
    await expect(page.locator(`[data-dag-item="${item}"] [data-dag-node="${id}"][data-dag-picked]`)).toHaveCount(1);
  }

  /** The boxes the layout published, which is where the marks actually are. */
  async function laid(page: Page, item: string) {
    const raw = await page.locator(`[data-dag-item="${item}"] [data-dag-layout]`).getAttribute("data-dag-layout");
    return (JSON.parse(raw ?? "{}") as { nodes: Record<string, { x: number; y: number; w: number; h: number }> }).nodes;
  }

  test("a picked series takes its values from the panel, and the bars move", { tag: "@smoke" }, async ({ page }) => {
    await open(page);
    await pickMark(page, "rev", "web");

    /* The handles a card wears in every other dialect are not here: a chart has no edge to write,
       so there is nothing for a `+` or a connect handle to append. The *item's* own stay. */
    await expect(page.locator(".dag-nodetools")).toHaveCount(0);
    await expect(page.locator('[data-dag-item="rev"] [data-dag-connect]')).toHaveCount(4);

    await page.keyboard.press("Enter");
    await expect(page.locator("[data-dag-props]")).toHaveCount(1);
    /* Its statement, and nothing that would be read as data: no kind, no meta, no status, no flags. */
    await expect(page.locator("[data-dag-prop-kind]")).toHaveCount(0);
    await expect(page.locator("[data-dag-prop-meta]")).toHaveCount(0);
    await expect(page.locator("[data-dag-prop-status]")).toHaveCount(0);
    await expect(page.locator("[data-dag-prop-flag]")).toHaveCount(0);
    await expect(page.locator("[data-dag-prop-values]")).toHaveValue("12 30 21");

    const before = (await laid(page, "rev")).mob!.h;

    await page.locator("[data-dag-prop-values]").fill("60 10 5");
    await page.locator("[data-dag-prop-values]").blur();
    await expect.poll(read, { timeout: 5_000 }).toContain('series web "Web" 60 10 5');

    /* The drawing followed: the ceiling doubled, so every one of Mobile's bars is half as tall. */
    await expect.poll(async () => (await laid(page, "rev")).mob!.h, { timeout: 10_000 }).toBeLessThan(before * 0.75);
    await expect(page.locator("[data-dag-error]")).toHaveCount(0);

    /* One keystroke's worth of undo takes the whole edit back. */
    await page.locator(".dag-viewport").focus();
    await page.keyboard.press("Control+z");
    await expect.poll(read, { timeout: 15_000 }).toContain('series web "Web" 12 30 21');
  });

  test("a value that is not one is refused in the row, and the file stands", async ({ page }) => {
    await open(page);
    await pickMark(page, "rev", "web");
    await page.keyboard.press("Enter");

    await page.locator("[data-dag-prop-values]").fill("12 lots 21");
    await page.locator("[data-dag-prop-values]").blur();

    await expect(page.locator("[data-dag-prop-values-error]")).toHaveCount(1);
    await expect(page.locator("[data-dag-prop-values]")).toHaveValue("12 30 21");
    await page.waitForTimeout(400);
    expect(read()).toContain('series web "Web" 12 30 21');
  });

  test("the item view changes the form, and the same data draws as wedges", async ({ page }) => {
    await open(page);
    await page.locator('[data-dag-item="share"]').click();
    await page.keyboard.press("Enter");

    const form = page.locator("[data-dag-prop-form]");
    await expect(form).toHaveValue("bar");
    /* The two flags only a bar has. */
    await expect(page.locator('[data-dag-prop-chart-flag="stacked"]')).toHaveCount(1);

    await form.selectOption("donut");
    await expect.poll(read, { timeout: 5_000 }).toMatch(/```chart[^`]*\ndonut\n/);
    await expect(page.locator('[data-dag-item="share"] .dag-chart__wedge')).toHaveCount(3);
    await expect(page.locator('[data-dag-prop-chart-flag="stacked"]')).toHaveCount(0);
    await expect(page.locator("[data-dag-error]")).toHaveCount(0);

    /* And the rest of a chart's own settings write their own statements. */
    await page.locator("[data-dag-prop-unit]").fill("k€");
    await page.locator("[data-dag-prop-unit]").blur();
    await expect.poll(read, { timeout: 5_000 }).toContain('unit "k€"');
    await page.locator("[data-dag-prop-legend]").selectOption("bottom");
    await expect.poll(read, { timeout: 5_000 }).toContain("legend bottom");
    await page.locator("[data-dag-prop-categories]").fill("One, Two, Three");
    await page.locator("[data-dag-prop-categories]").blur();
    await expect.poll(read, { timeout: 5_000 }).toContain("x One Two Three");
  });

  test("a donut's centre figure and caption are typed in the panel", async ({ page }) => {
    await open(page);
    await page.locator('[data-dag-item="share"]').click();
    await page.keyboard.press("Enter");

    /* A bar has no hole, so the fields are not offered until the form is a donut. */
    await expect(page.locator("[data-dag-prop-hero]")).toHaveCount(0);
    await page.locator("[data-dag-prop-form]").selectOption("donut");
    await expect(page.locator("[data-dag-prop-hero]")).toHaveCount(1);

    await page.locator("[data-dag-prop-hero]").fill("1.2M");
    await page.locator("[data-dag-prop-hero]").blur();
    await expect.poll(read, { timeout: 5_000 }).toMatch(/\ndonut "1\.2M"\n/);
    await page.locator("[data-dag-prop-hero-label]").fill("users");
    await page.locator("[data-dag-prop-hero-label]").blur();
    await expect.poll(read, { timeout: 5_000 }).toContain('donut "1.2M" "users"');
    await expect(page.locator('[data-dag-item="share"] .dag-chart__text--hero')).toHaveCount(1);
    await expect(page.locator("[data-dag-error]")).toHaveCount(0);

    /* Emptying the figure takes the caption with it. */
    await page.locator("[data-dag-prop-hero]").fill("");
    await page.locator("[data-dag-prop-hero]").blur();
    await expect.poll(read, { timeout: 5_000 }).toMatch(/\ndonut\n/);
  });

  test("a legend's key rows are added, retyped and removed in the panel", async ({ page }) => {
    await open(page);
    await page.locator('[data-dag-item="rev"]').click();
    await page.keyboard.press("Enter");

    await page.locator("[data-dag-prop-key-add]").click();
    await expect.poll(read, { timeout: 5_000 }).toContain('legend solid "New entry"');
    await page.locator('[data-dag-prop-key-text="0"]').fill("in sync");
    await page.locator('[data-dag-prop-key-text="0"]').blur();
    await expect.poll(read, { timeout: 5_000 }).toContain('legend solid "in sync"');
    await page.locator('[data-dag-prop-key-glyph="0"]').selectOption("dashed");
    await expect.poll(read, { timeout: 5_000 }).toContain('legend dashed "in sync"');
    await expect(page.locator('[data-dag-item="rev"] .dag-legend__item')).toHaveCount(1);

    /* The placement is the other `legend` statement and must not be mistaken for a row. */
    await page.locator("[data-dag-prop-legend]").selectOption("bottom");
    await expect.poll(read, { timeout: 5_000 }).toContain("legend bottom");
    expect(read()).toContain('legend dashed "in sync"');

    await page.locator('[data-dag-prop-key-remove="0"]').click();
    await expect.poll(read, { timeout: 5_000 }).not.toContain("in sync");
    expect(read()).toContain("legend bottom");
    await expect(page.locator("[data-dag-error]")).toHaveCount(0);
  });

  test("a series and a slice are added from the panel, and the new one is picked", async ({ page }) => {
    await open(page);
    await page.locator('[data-dag-item="rev"]').click();
    await page.keyboard.press("Enter");

    await page.locator('[data-dag-prop-chart-add="series"]').click();
    await expect.poll(read, { timeout: 5_000 }).toContain('series series1 "Series 1" 1 1 1');
    await expect(page.locator('[data-dag-item="rev"] [data-dag-node]')).toHaveCount(3);
    /* Picked, so the values it was given are one click from being the person's own. */
    await expect(page.locator('[data-dag-props="series1"]')).toHaveCount(1);
    await page.locator("[data-dag-prop-values]").fill("5 6 7");
    await page.locator("[data-dag-prop-values]").blur();
    await expect.poll(read, { timeout: 5_000 }).toContain('series series1 "Series 1" 5 6 7');

    await page.locator('[data-dag-item="share"]').click();
    await page.keyboard.press("Enter");
    await page.locator('[data-dag-prop-chart-add="slice"]').click();
    await expect.poll(read, { timeout: 5_000 }).toContain('slice slice1 "Slice 1" 1');
    await expect(page.locator('[data-dag-item="share"] [data-dag-node]')).toHaveCount(4);
    await expect(page.locator("[data-dag-error]")).toHaveCount(0);
  });

  test("a series' id is changed in the panel, and a clash is refused in the box", async ({ page }) => {
    /* A note beside the charts and links into them: `rev.web` is the series being renamed, the
       rest are lookalikes that must come through byte for byte. */
    fs.writeFileSync(
      file,
      `${BOARD}
\`\`\`md {#notes x=0 y=460}
Why it grew.
\`\`\`

\`\`\`edges
notes --> rev.web "why it grew"
notes --> rev.mob
notes --> share.a
notes --> rev
\`\`\`
`,
    );
    await open(page);
    await pickMark(page, "rev", "web");
    await page.keyboard.press("Enter");

    await page.locator("[data-dag-prop-chart-id]").fill("mob");
    await page.locator("[data-dag-prop-chart-id]").blur();
    await expect(page.locator("[data-dag-prop-chart-id-error]")).toHaveCount(1);
    await expect(page.locator("[data-dag-prop-chart-id]")).toHaveValue("web");

    await page.locator("[data-dag-prop-chart-id]").fill("site");
    await page.locator("[data-dag-prop-chart-id]").blur();
    await expect.poll(read, { timeout: 5_000 }).toContain('series site "Web" 12 30 21');
    expect(read()).not.toContain("series web");
    /* The link that named the series follows it, in the same write; the others stay as written. */
    expect(read()).toContain('notes --> rev.site "why it grew"');
    expect(read()).not.toContain("rev.web");
    expect(read()).toContain("notes --> rev.mob\nnotes --> share.a\nnotes --> rev\n");
    /* One write, so one undo gives back the series and the link together. */
    await page.locator(".dag-viewport").focus();
    await page.keyboard.press("Control+z");
    await expect.poll(read, { timeout: 15_000 }).toContain('series web "Web" 12 30 21');
    expect(read()).toContain('notes --> rev.web "why it grew"');
    expect(read()).not.toContain("rev.site");
    await page.keyboard.press("Control+Shift+z");
    await expect.poll(read, { timeout: 15_000 }).toContain('notes --> rev.site "why it grew"');
    /* The pick followed the id, so the panel is still open on the same series. */
    await expect(page.locator('[data-dag-props="site"]')).toHaveCount(1);
    await expect(page.locator('[data-dag-item="rev"] [data-dag-node="site"]')).toHaveCount(1);
    await expect(page.locator("[data-dag-error]")).toHaveCount(0);
  });

  test("a picked slice dragged past its neighbour is a line of the fence moving", async ({ page }) => {
    await open(page);
    await pickMark(page, "share", "a");

    /* Aim at the far side of Beta's own bar: which half of the target the pointer let go over is
       the whole of what a drop in `order` mode asks. */
    const from = (await page.locator('[data-dag-item="share"] [data-dag-node="a"] .dag-chart__bar').first().boundingBox())!;
    const to = (await page.locator('[data-dag-item="share"] [data-dag-node="b"] .dag-chart__bar').first().boundingBox())!;
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(to.x + to.width * 0.85, to.y + to.height / 2, { steps: 16 });
    await page.mouse.up();

    const order = () => (read().match(/slice (\w+)/g) ?? []).join(" ");
    await expect.poll(order, { timeout: 5_000 }).toBe("slice b slice a slice c");
    await expect(page.locator("[data-dag-error]")).toHaveCount(0);

    /* The bytes have moved; the *page* may not know it yet, and ctrl+Z is a question asked of the
       page. `history.push` runs once the patch resolves, so a key pressed between the file
       changing and the response landing finds an empty stack and does nothing at all — no request,
       no error, and then a fifteen-second poll on an order that is never going back. One run in
       five against `npm run dev` and three in five against the compose stack, where the answer
       returns through nginx and Caddy after the container's write has already reached the disk.
       The undo control going live is the page saying the entry exists. Same wait, same reason, as
       the one in `tidy.spec.ts`. */
    await expect(page.locator("[data-dag-dock] [data-dag-undo]")).toBeEnabled({ timeout: 5_000 });

    await page.locator(".dag-viewport").focus();
    await page.keyboard.press("Control+z");
    await expect.poll(order, { timeout: 15_000 }).toBe("slice a slice b slice c");
  });

  test("a legend label is renamed where it is drawn", async ({ page }) => {
    await open(page);
    /* The label is drawn *outside* the group carrying the id — SVG has no z-index, so every label
       goes after every mark — which makes this the one title on the board that `data-dag-title-of`
       has to find rather than nesting. (A slice in a bar chart is labelled on the axis and has no
       legend row; the two series here do.) */
    const label = page.locator('[data-dag-item="rev"] [data-dag-title-of="web"]');
    await expect(label).toHaveCount(1);
    await label.dblclick();

    const box = page.locator('[data-dag-rename-box="web"]');
    await expect(box).toBeVisible({ timeout: 10_000 });
    await box.fill("Traffic");
    await box.press("Enter");

    await expect.poll(read, { timeout: 5_000 }).toContain('series web "Traffic" 12 30 21');
    await expect(page.locator("[data-dag-error]")).toHaveCount(0);
  });

  test("a wedge's own label renames the slice it names", async ({ page }) => {
    await open(page);
    await page.locator('[data-dag-item="share"]').click();
    await page.keyboard.press("Enter");
    await page.locator("[data-dag-prop-form]").selectOption("pie");
    await expect(page.locator('[data-dag-item="share"] .dag-chart__wedge')).toHaveCount(3);

    /* A pie names a slice twice — its legend row, and the share written on the wedge — so the class
       says which of the two is meant here. A wedge draws no name of its own, so that share *is* the
       slice as far as the pointer is concerned, and the box opens with the name out of the parse
       rather than with the percentage under it. */
    await page.locator('[data-dag-item="share"] .dag-chart__text--value[data-dag-title-of="a"]').dblclick();
    const box = page.locator('[data-dag-rename-box="a"]');
    await expect(box).toBeVisible({ timeout: 10_000 });
    await expect(box).toHaveValue("Alpha");
    await box.fill("Alfa");
    await box.press("Enter");

    await expect.poll(read, { timeout: 5_000 }).toContain('slice a "Alfa" 40');
  });

  test("Delete takes a picked series, ctrl+D copies one, and undo returns each", async ({ page }) => {
    await open(page);
    await pickMark(page, "rev", "mob");
    await page.keyboard.press("Delete");
    await expect.poll(read, { timeout: 5_000 }).not.toContain("series mob");
    await expect(page.locator('[data-dag-item="rev"] [data-dag-node]')).toHaveCount(1);

    await page.locator(".dag-viewport").focus();
    await page.keyboard.press("Control+z");
    await expect.poll(read, { timeout: 15_000 }).toContain('series mob "Mobile" 4 6 9');

    await pickMark(page, "rev", "mob");
    await page.keyboard.press("Control+d");
    await expect.poll(read, { timeout: 5_000 }).toContain('series mob2 "Mobile" 4 6 9');
    await expect(page.locator('[data-dag-item="rev"] [data-dag-node]')).toHaveCount(3);
    await expect(page.locator("[data-dag-error]")).toHaveCount(0);
  });
});
