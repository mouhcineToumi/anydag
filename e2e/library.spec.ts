import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

import { lead } from "./keys";
import { BOARDS } from "./boards";

/**
 * The component library: click to add, drag to place, a part onto its diagram.
 *
 * As in `select.spec.ts`, every check ends in the board file. What is specific here is the drop:
 * a part let go over a diagram of its type is appended to that diagram's source and nowhere else,
 * and the same part let go over the paper starts a diagram of its own.
 */

const DIR = BOARDS;

const BOARD = `---
title: Build me
---

\`\`\`md {#one x=0 y=0}
The first item.
\`\`\`

\`\`\`arch {#infra x=0 y=200 title="Infra"}
service api "API"
\`\`\`
`;

let name = "";
let file = "";
test.beforeEach(({}, info) => {
  name = `e2e-scratch-${info.testId}`;
  file = path.join(DIR, `${name}.board.md`);
  fs.writeFileSync(file, BOARD);
});
test.afterEach(() => fs.rmSync(file, { force: true }));

const read = () => fs.readFileSync(file, "utf8");

async function open(page: Page) {
  await page.goto(`/?board=${name}`);
  await page.evaluate(() => localStorage.setItem("dag:library", "0"));
  await page.waitForFunction(() => document.documentElement.dataset.dagReady === "1", null, { timeout: 20_000 });
}

async function dragTo(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 20, from.y + 20, { steps: 4 });
  await page.mouse.move(to.x, to.y, { steps: 8 });
}

const card = (page: Page, id: string) => page.locator(`[data-dag-component="${id}"]`);

/** Where to press on a card: the list scrolls, and a part is below the fold of a 1200px window. */
async function cardAt(page: Page, id: string) {
  const c = card(page, id);
  await c.scrollIntoViewIfNeeded();
  const b = (await c.boundingBox())!;
  return { x: b.x + 30, y: b.y + 15 };
}

test("the leader chord opens the library, the toolbar closes it, and the search filters", async ({ page }) => {
  await open(page);
  await expect(page.locator("[data-dag-library]")).toHaveCount(0);
  await lead(page, "l");
  await expect(page.locator("[data-dag-library]")).toBeVisible();
  await expect(card(page, "note")).toBeVisible();
  await expect(card(page, "part-arch-service")).toBeVisible();

  await page.fill("[data-dag-library-search]", "erd table");
  await expect(card(page, "part-erd-entity")).toBeVisible();
  await expect(card(page, "note")).toHaveCount(0);

  await page.locator("[data-dag-library-toggle]").click();
  await expect(page.locator("[data-dag-library]")).toHaveCount(0);
  /* Remembered. */
  await page.reload();
  await page.waitForFunction(() => document.documentElement.dataset.dagReady === "1", null, { timeout: 20_000 });
  await expect(page.locator("[data-dag-library]")).toHaveCount(0);
});

test("a click adds the component in the middle of the view and opens it for editing", { tag: "@smoke" }, async ({ page }) => {
  await open(page);
  await lead(page, "l");
  await card(page, "table").click();
  await expect
    .poll(read, { timeout: 5_000 })
    .toMatch(/```md \{#md-[a-z0-9]{4} w=520 x=-?\d+ y=-?\d+\}\n\| name \| type \| note \|/);
  await expect(page.locator("[data-dag-inspector]")).toBeVisible();
  await expect(page.locator("[data-dag-body]")).toHaveValue(/\| name \| type \| note \|/);
  await expect(page.locator('[data-dag-type="md"] table')).toHaveCount(1);
});

test("a diagram starter draws, which is the only route to one now", async ({ page }) => {
  /*
   * The toolbar's Diagram dropdown is gone: `TEMPLATES[type]` is `render(TEMPLATE_BY_TYPE.get(t))`
   * — byte for byte the library entry this clicks — so the two controls emitted the same text and
   * this one names the type, describes it and can be dropped where you want it. What the deleted
   * test proved is worth keeping though: a starter is a *drawing*, not an error card.
   */
  await open(page);
  await lead(page, "l");
  const starter = card(page, "diagram-state");
  await starter.scrollIntoViewIfNeeded();
  await starter.click();
  await expect.poll(read, { timeout: 5_000 }).toMatch(/```state \{#state-[a-z0-9]{4}[^}]*\}\nstate draft "Draft"/);
  await expect(page.locator('[data-dag-type="state"] .dag-frame')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('[data-dag-type="state"] .dag-error')).toHaveCount(0);
});

test("a drag places the component where it is let go", async ({ page }) => {
  await open(page);
  await lead(page, "l");
  const from = await cardAt(page, "note");
  const vp = (await page.locator(".dag-viewport").boundingBox())!;
  const to = { x: vp.x + 120, y: vp.y + vp.height - 120 };
  await dragTo(page, from, to);
  await expect(page.locator(".dag-ghost")).toBeVisible();
  /* Read the view before the drop: new content refits it, and the drop was computed against the
     view as it was. */
  const want = await page.evaluate(
    ([x, y]) => {
      const box = document.querySelector(".dag-viewport")!.getBoundingClientRect();
      const m = new DOMMatrix(getComputedStyle(document.querySelector(".dag-layer")!).transform);
      return { x: (x - box.left - m.e) / m.a, y: (y - box.top - m.f) / m.a };
    },
    [to.x, to.y],
  );
  await page.mouse.up();

  await expect.poll(read, { timeout: 5_000 }).toMatch(/```md \{#md-[a-z0-9]{4} note w=320 x=-?\d+ y=-?\d+\}\nA note\.\n```/);
  /* Where the pointer was, on the grid: the new item's top-left corner is within a grid step. */
  const got = /note w=320 x=(-?\d+) y=(-?\d+)/.exec(read())!;
  expect(Math.abs(Number(got[1]) - want.x)).toBeLessThanOrEqual(8);
  expect(Math.abs(Number(got[2]) - want.y)).toBeLessThanOrEqual(8);
});

test("a part dropped on a diagram of its type is appended to its source", async ({ page }) => {
  await open(page);
  await lead(page, "l");
  const from = await cardAt(page, "part-arch-store");
  const infra = (await page.locator('[data-dag-item="infra"]').boundingBox())!;
  await dragTo(page, from, { x: infra.x + infra.width / 2, y: infra.y + 40 });
  /* The diagram under the pointer is marked as the drop target. */
  await expect(page.locator('[data-dag-item="infra"]')).toHaveAttribute("data-dag-drop", "");
  await page.mouse.up();

  await expect.poll(read, { timeout: 5_000 }).toContain('service api "API"\n\nstore db1 "Store" icon=database\n```');
  /* Nothing else changed, and the diagram is open for naming. */
  expect((read().match(/```arch/g) ?? []).length).toBe(1);
  await expect(page.locator(".dag-inspector__type")).toHaveAttribute("data-dag-inspector-type", "arch");
  await expect(page.locator('[data-dag-item="infra"] [data-dag-node="db1"]')).toBeVisible({ timeout: 10_000 });
});

test("a part dropped on the paper starts a diagram of its own, and never lands on the wrong type", async ({ page }) => {
  await open(page);
  await lead(page, "l");
  const from = await cardAt(page, "part-erd-entity");
  /* Over the arch diagram — the wrong type — so it is not a drop target. */
  const infra = (await page.locator('[data-dag-item="infra"]').boundingBox())!;
  await dragTo(page, from, { x: infra.x + infra.width / 2, y: infra.y + 40 });
  await expect(page.locator('[data-dag-item="infra"]')).not.toHaveAttribute("data-dag-drop", "");
  await page.mouse.up();

  await expect
    .poll(read, { timeout: 5_000 })
    .toMatch(
      /```erd \{#erd-[a-z0-9]{4} x=-?\d+ y=-?\d+\}\nentity table1 \{ id uuid pk; name text; created_at timestamptz \}\n```/,
    );
  expect(read()).toContain('service api "API"\n```');
});
