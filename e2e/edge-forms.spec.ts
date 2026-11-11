import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

import { BOARDS } from "./boards";

/**
 * #133: a control for every form of edge, so none of them needs the Source tab.
 *
 * The forms the connect handle cannot say on its own — the second string, a bus and a fan, a chain,
 * an end that is a group or a row — each have one control in the panel on a picked edge, and the
 * three that are a gesture (a drop on a row, a drop on a boundary, shift or alt on a drop) have the
 * gesture. Every check reads the bytes: each of these is a small edit to a file a person also owns.
 *
 * One board per test: the suite runs in parallel and these write to disk.
 */

const DIR = BOARDS;

const diagram = (body: string, type = "arch") => `---
title: Edge forms
---

\`\`\`${type} {#infra x=0 y=0 title="Infra"}
${body}
\`\`\`

\`\`\`md {#note x=700 y=60 w=200}
A note.
\`\`\`

\`\`\`md {#other x=700 y=360 w=200}
Another.
\`\`\`
`;

const CARDS = `service web "Web"
service api "The API" {
  content "Content"
  search "Search"
}
store fs "Files"
service jobs "Jobs"

group workspace "Workspace" {
  service intake "Intake"
}
`;

let name = "";
let file = "";
test.beforeEach(({}, info) => {
  name = `e2e-edge-forms-${info.testId}`;
  file = path.join(DIR, `${name}.board.md`);
});
test.afterEach(() => fs.rmSync(file, { force: true }));

const read = () => fs.readFileSync(file, "utf8");

async function open(page: Page, board: string) {
  fs.writeFileSync(file, board);
  await page.goto(`/?board=${name}`);
  await page.evaluate(() => localStorage.setItem("dag:library", "0"));
  await page.waitForFunction(() => document.documentElement.dataset.dagReady === "1", null, { timeout: 20_000 });
}

/** The diagram's body only, so a check about it cannot be answered by anything further down. */
const bodyOf = (id: string) => {
  const after = read().split(`{#${id}`)[1] ?? "";
  return (after.split("```")[0] ?? "").split("\n").slice(1).join("\n");
};

/** Click, pause, click: the second press picks the card out, and Chromium pairs fast ones. */
async function pick(page: Page, selector: string) {
  await page.locator(selector).click();
  await page.waitForTimeout(400);
  await page.locator(selector).click();
  await expect(page.locator(`${selector}[data-dag-picked]`)).toHaveCount(1);
}

const centreOf = async (page: Page, selector: string) => {
  const b = (await page.locator(selector).boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
};

/** Pick the diagram's first edge and open the panel on it. */
async function pickEdge(page: Page, nth = 0) {
  await page.locator('[data-dag-item="infra"] .dag-edge-hit').nth(nth).click({ force: true });
  await page.keyboard.press("Enter");
  await expect(page.locator("[data-dag-props]")).toHaveCount(1);
}

/** Click a drawn line where it is, not at the middle of its bounding box, which a bend can miss. */
async function clickLine(page: Page, selector: string) {
  const at = await page
    .locator(selector)
    .first()
    .evaluate((el) => {
      const path = el as unknown as SVGGeometryElement;
      const p = path.getPointAtLength(path.getTotalLength() / 2);
      const m = path.getScreenCTM()!;
      return { x: p.x * m.a + p.y * m.c + m.e, y: p.x * m.b + p.y * m.d + m.f };
    });
  await page.mouse.click(at.x, at.y);
}

/** Pull a link out of a picked card's handle and let go over `to`, with the modifiers held. */
async function pull(page: Page, card: string, to: { x: number; y: number }, keys: ("Shift" | "Alt")[] = []) {
  await pick(page, `[data-dag-node="${card}"]`);
  const handle = await centreOf(page, '.dag-nodetools [data-dag-connect="s"]');
  await page.mouse.move(handle.x, handle.y);
  await page.mouse.down();
  await page.mouse.move((handle.x + to.x) / 2, (handle.y + to.y) / 2, { steps: 6 });
  await page.mouse.move(to.x, to.y, { steps: 8 });
  for (const k of keys) await page.keyboard.down(k);
  await page.mouse.up();
  for (const k of keys) await page.keyboard.up(k);
}

/* ------------------------------------------------------------------------ the second string */

test("a picked edge writes its technology, behind the label", { tag: "@smoke" }, async ({ page }) => {
  await open(page, diagram('person u "User"\ncontainer api "Api" "tech" "desc"\n\nu --> api "Uses"', "c4"));
  await pickEdge(page);

  const tech = page.locator("[data-dag-prop-label2]");
  await expect(tech).toBeEnabled();
  await tech.fill("HTTPS");
  await tech.blur();
  await expect.poll(() => bodyOf("infra"), { timeout: 5_000 }).toContain('u --> api "Uses" "HTTPS"');
  /* And the line on the canvas wears it: C4 draws the second string under the label. */
  await expect(page.locator('[data-dag-item="infra"] .dag-edge-label__tech')).toHaveText("HTTPS");

  await tech.fill("");
  await tech.blur();
  await expect.poll(() => bodyOf("infra"), { timeout: 5_000 }).toContain('u --> api "Uses"\n');
  expect(bodyOf("infra")).not.toContain("HTTPS");
});

test("the technology waits for a label, because nothing would draw it", async ({ page }) => {
  await open(page, diagram('person u "User"\ncontainer api "Api" "tech" "desc"\n\nu --> api', "c4"));
  await pickEdge(page);
  await expect(page.locator("[data-dag-prop-label2]")).toBeDisabled();
  await page.locator("[data-dag-prop-label]").fill("Uses");
  await page.locator("[data-dag-prop-label]").blur();
  await expect.poll(() => bodyOf("infra"), { timeout: 5_000 }).toContain('u --> api "Uses"');
  await expect(page.locator("[data-dag-prop-label2]")).toBeEnabled();
});

test("a drawn link takes the same second label", async ({ page }) => {
  await open(page, `${diagram('service web "Web"\nservice api "Api"')}\n\`\`\`edges\nnote --> infra.api "uses"\n\`\`\`\n`);
  await clickLine(page, ".dag-board-edges .dag-edge-hit");
  await expect(page.locator(".dag-board-edges [data-dag-picked]")).toHaveCount(1);
  await page.keyboard.press("Enter");
  await expect(page.locator("[data-dag-props]")).toHaveCount(1);
  await page.locator("[data-dag-prop-label2]").fill("gRPC");
  await page.locator("[data-dag-prop-label2]").blur();
  await expect.poll(read, { timeout: 5_000 }).toContain('note --> infra.api "uses" "gRPC"');
  await expect(page.locator(".dag-board-edges .dag-edge-label__tech")).toHaveText("gRPC");
  await expect(page.locator("[data-dag-error]")).toHaveCount(0);
});

/* ------------------------------------------------------------------------- a bus and a fan */

test("adding a source to a picked edge makes a bus, and removing it takes it back", async ({ page }) => {
  await open(page, diagram(`${CARDS}\nweb --> fs "reject"`));
  await pickEdge(page);

  await page.locator('[data-dag-prop-end-add="from"]').selectOption("jobs");
  await expect.poll(() => bodyOf("infra"), { timeout: 5_000 }).toContain('web & jobs --> fs "reject"');
  /* One statement, so the router draws one family: both edges carry the same trunk. */
  await expect(page.locator('[data-dag-item="infra"] .dag-edge-hit')).toHaveCount(2);

  await page.locator('[data-dag-prop-end-remove="from:1"]').click();
  await expect.poll(() => bodyOf("infra"), { timeout: 5_000 }).toContain('web --> fs "reject"');
  await expect(page.locator("[data-dag-prop-end-remove]")).toHaveCount(0);
});

test("adding a target to a picked edge makes a fan", async ({ page }) => {
  await open(page, diagram(`${CARDS}\nweb --> api`));
  await pickEdge(page);
  await page.locator('[data-dag-prop-end-add="to"]').selectOption("fs");
  await expect.poll(() => bodyOf("infra"), { timeout: 5_000 }).toContain("web --> api & fs");
  await expect(page.locator("[data-dag-error]")).toHaveCount(0);
});

test("shift on the drop joins a bus instead of writing a second line", async ({ page }) => {
  await open(page, diagram(`${CARDS}\nweb --> fs`));
  await pull(page, "jobs", await centreOf(page, '[data-dag-node="fs"]'), ["Shift"]);
  await expect.poll(() => bodyOf("infra"), { timeout: 5_000 }).toContain("web & jobs --> fs");
  expect(bodyOf("infra")).not.toMatch(/^jobs --> fs/m);
});

test("shift with nothing to join writes the plain edge", async ({ page }) => {
  await open(page, diagram(`${CARDS}\nweb --> api`));
  await pull(page, "jobs", await centreOf(page, '[data-dag-node="fs"]'), ["Shift"]);
  await expect.poll(() => bodyOf("infra"), { timeout: 5_000 }).toContain("jobs --> fs");
});

/* ----------------------------------------------------------------------------- a chain */

test("a picked edge carries on into a chain, and the last hop comes off again", async ({ page }) => {
  await open(page, diagram(`${CARDS}\nweb -.-> api "calls"`));
  await pickEdge(page);

  await page.locator("[data-dag-prop-hop-add]").selectOption("fs");
  await expect.poll(() => bodyOf("infra"), { timeout: 5_000 }).toContain('web -.-> api "calls" -.-> fs');
  /* Two segments now, and the new one is its own edge to pick. */
  await expect(page.locator('[data-dag-item="infra"] .dag-edge-hit')).toHaveCount(2);

  await page.locator("[data-dag-prop-hop-drop]").click();
  await expect.poll(() => bodyOf("infra"), { timeout: 5_000 }).toContain('web -.-> api "calls"\n');
  expect(bodyOf("infra")).not.toContain("fs\n-.->");
});

test("alt on the drop carries a chain on from where a statement ends", async ({ page }) => {
  await open(page, diagram(`${CARDS}\nweb --> api`));
  await pull(page, "api", await centreOf(page, '[data-dag-node="fs"]'), ["Alt"]);
  await expect.poll(() => bodyOf("infra"), { timeout: 5_000 }).toContain("web --> api --> fs");
});

/* ------------------------------------------------------------------- a group and a row */

test("an end of a picked edge can be a group, or a row of a card", async ({ page }) => {
  await open(page, diagram(`${CARDS}\nweb --> fs`));
  await pickEdge(page);

  await page.locator('[data-dag-prop-end="to:0"]').selectOption("workspace");
  await expect.poll(() => bodyOf("infra"), { timeout: 5_000 }).toContain("web --> workspace");

  await page.locator('[data-dag-prop-end="from:0"]').selectOption("api.content");
  await expect.poll(() => bodyOf("infra"), { timeout: 5_000 }).toContain("api.content --> workspace");
  await expect(page.locator("[data-dag-error]")).toHaveCount(0);
});

test("dropping on a row of a card writes an edge to that row", async ({ page }) => {
  await open(page, diagram(CARDS));
  await pull(page, "web", await centreOf(page, '[data-dag-row="content"]'));
  await expect.poll(() => bodyOf("infra"), { timeout: 5_000 }).toContain("web --> api.content");
  expect(read()).not.toContain("```edges");
  await expect(page.locator("[data-dag-error]")).toHaveCount(0);
});

test("dropping on the header of a card still writes an edge to the card", async ({ page }) => {
  await open(page, diagram(CARDS));
  const head = await page.locator('[data-dag-node="api"] [data-dag-title]').first().boundingBox();
  await pull(page, "web", { x: head!.x + head!.width / 2, y: head!.y + head!.height / 2 });
  await expect.poll(() => bodyOf("infra"), { timeout: 5_000 }).toMatch(/web --> api\n?$/);
});

test("dropping on a group's boundary writes an edge to the group", async ({ page }) => {
  await open(page, diagram(CARDS));
  const label = await centreOf(page, '[data-dag-group="workspace"] .dag-group__label');
  await pull(page, "web", label);
  await expect.poll(() => bodyOf("infra"), { timeout: 5_000 }).toContain("web --> workspace");
  expect(read()).not.toContain("```edges");
  await expect(page.locator("[data-dag-error]")).toHaveCount(0);
});

test("a row dropped on from another item is the whole card in the edges fence", async ({ page }) => {
  await open(page, diagram(CARDS));
  const hit = await centreOf(page, '[data-dag-row="content"]');
  await page.locator('[data-dag-item="note"]').click();
  const handle = await centreOf(page, '[data-dag-item="note"] [data-dag-connect="w"]');
  await page.mouse.move(handle.x, handle.y);
  await page.mouse.down();
  await page.mouse.move((handle.x + hit.x) / 2, (handle.y + hit.y) / 2, { steps: 6 });
  await page.mouse.move(hit.x, hit.y, { steps: 8 });
  await page.mouse.up();
  /* A link cannot name `infra.api.content`, so it names the card — and parses clean. */
  await expect.poll(read, { timeout: 5_000 }).toContain("note --> infra.api");
  expect(read()).not.toContain("infra.api.content");
  await expect(page.locator("[data-dag-error]")).toHaveCount(0);
});
