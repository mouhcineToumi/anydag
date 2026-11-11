import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { BOARDS } from "./boards";

/**
 * #136: growing and restructuring a mindmap without typing its source.
 *
 * A topic is a line whose indent says where it hangs, so every control here is a line moving or
 * appearing, and every check reads the file to prove it. The ids are the parser's counter — shared
 * with the edges it invents — so for the map below `m0` is Board, `m1` Dialects, `m3` Arch, `m5`
 * Erd and `m7` Editing.
 *
 * One board per test: the suite runs in parallel and these write to disk.
 */

const MAP = "root Board\n  Dialects\n    Arch\n    Erd\n  Editing";

let name = "";
let file = "";
test.beforeEach(({}, info) => {
  name = `e2e-mindmap-${info.testId}`;
  file = path.join(BOARDS, `${name}.board.md`);
  fs.writeFileSync(file, `\`\`\`mindmap {#m x=0 y=0}\n${MAP}\n\`\`\`\n`);
});
test.afterEach(() => fs.rmSync(file, { force: true }));

const read = () => fs.readFileSync(file, "utf8");
/** The fence's body and nothing else. */
const bodyOf = () => {
  const after = read().split("{#m")[1] ?? "";
  return (after.split("```")[0] ?? "").split("\n").slice(1).join("\n").replace(/\n$/, "");
};

async function open(page: Page) {
  await page.goto(`/?board=${name}`);
  await page.evaluate(() => localStorage.setItem("dag:library", "0"));
  /* The panel opens on whichever half was used last; these checks are about the controls. */
  await page.evaluate(() => localStorage.setItem("dag:inspector-mode", "props"));
  await page.waitForFunction(() => document.documentElement.dataset.dagReady === "1", null, { timeout: 20_000 });
}

/** Click, pause, click: the second press picks the topic out, and Chromium pairs fast ones. */
async function pick(page: Page, node: string) {
  const sel = `[data-dag-node="${node}"]`;
  await page.locator(sel).click();
  await page.waitForTimeout(400);
  await page.locator(sel).click();
  await expect(page.locator(`${sel}[data-dag-picked]`)).toHaveCount(1);
}

/** The rename box open on a new topic: type its name and let go of it. */
async function nameIt(page: Page, text: string) {
  const box = page.locator("[data-dag-rename-box]");
  await expect(box).toBeVisible({ timeout: 10_000 });
  await box.fill(text);
  await box.press("Enter");
  await expect(box).toHaveCount(0);
}

/** The panel, opened on the pick the way a person with the pointer would. */
async function panel(page: Page) {
  await page.locator("[data-dag-selbar-edit]").click();
  await expect(page.locator("[data-dag-props]")).toHaveCount(1);
}

/* ------------------------------------------------------------------------ the + handles */

test("a picked topic wears a child + and a sibling +, and no round handles", { tag: "@smoke" }, async ({ page }) => {
  await open(page);
  await pick(page, "m1");
  await expect(page.locator("[data-dag-topic-plus]")).toHaveCount(2);
  await expect(page.locator('[data-dag-topic-plus="child"]')).toHaveCount(1);
  await expect(page.locator('[data-dag-topic-plus="sibling"]')).toHaveCount(1);
  /* The round handles would write `m1 --> m2` into a body where that line is a topic's name. */
  await expect(page.locator(".dag-nodetools [data-dag-connect]")).toHaveCount(0);
});

test("the root has a child + and no sibling +", async ({ page }) => {
  await open(page);
  await pick(page, "m0");
  await expect(page.locator('[data-dag-topic-plus="child"]')).toHaveCount(1);
  await expect(page.locator('[data-dag-topic-plus="sibling"]')).toHaveCount(0);
});

test("the child + writes an indented line, opens the rename, and keeps the pick on the new topic", async ({ page }) => {
  await open(page);
  await pick(page, "m1");
  await page.locator('[data-dag-topic-plus="child"]').click();
  await nameIt(page, "Behaviour");

  await expect.poll(bodyOf, { timeout: 5_000 }).toBe("root Board\n  Dialects\n    Arch\n    Erd\n    Behaviour\n  Editing");
  await expect(page.locator("[data-dag-error]")).toHaveCount(0);
  /* The pick followed the new topic, so its own + grows from *it*. */
  await expect(page.locator("[data-dag-topic-plus]")).not.toHaveCount(0);
  await expect(page.locator("[data-dag-node][data-dag-picked]")).toHaveText("Behaviour");
});

test("the sibling + lands after the whole branch, at the same indent", async ({ page }) => {
  await open(page);
  await pick(page, "m1");
  await page.locator('[data-dag-topic-plus="sibling"]').click();
  /* Escape leaves the default name, which is what a person who only wanted the place gets. */
  await page.locator("[data-dag-rename-box]").press("Escape");

  await expect.poll(bodyOf, { timeout: 5_000 }).toBe("root Board\n  Dialects\n    Arch\n    Erd\n  New topic\n  Editing");
});

/* --------------------------------------------------------------------------- the keys */

test("Tab, a name, Enter, a name: an outline written without leaving the keyboard", async ({ page }) => {
  await open(page);
  await pick(page, "m3");

  await page.keyboard.press("Tab");
  await nameIt(page, "Erd2");
  await expect.poll(bodyOf, { timeout: 5_000 }).toContain("    Arch\n      Erd2\n    Erd");

  await page.keyboard.press("Enter");
  await nameIt(page, "Fox");
  await expect.poll(bodyOf, { timeout: 5_000 }).toContain("      Erd2\n      Fox\n    Erd");

  /* Shift+Tab: out one level, after the parent it left. */
  await page.keyboard.press("Shift+Tab");
  await expect.poll(bodyOf, { timeout: 5_000 }).toContain("    Arch\n      Erd2\n    Fox\n    Erd");
  await expect(page.locator("[data-dag-error]")).toHaveCount(0);
});

test("Alt+arrows move the picked topic among its siblings, and the pick goes with it", async ({ page }) => {
  await open(page);
  await pick(page, "m7");

  await page.keyboard.press("Alt+ArrowUp");
  await expect.poll(bodyOf, { timeout: 5_000 }).toBe("root Board\n  Editing\n  Dialects\n    Arch\n    Erd");
  /* Still Editing that is picked, so the same key moves it back. */
  await expect(page.locator("[data-dag-node][data-dag-picked]")).toHaveText("Editing");
  await page.keyboard.press("Alt+ArrowDown");
  await expect.poll(bodyOf, { timeout: 5_000 }).toBe(MAP);
});

test("Enter on the root grows a child, since the root has no sibling", async ({ page }) => {
  await open(page);
  await pick(page, "m0");
  await page.keyboard.press("Enter");
  await page.locator("[data-dag-rename-box]").press("Escape");
  await expect.poll(bodyOf, { timeout: 5_000 }).toBe(`${MAP}\n  New topic`);
});

test("Shift+Tab from directly under the root writes nothing — that would be a second root", async ({ page }) => {
  await open(page);
  await pick(page, "m7");
  await page.keyboard.press("Shift+Tab");
  await page.waitForTimeout(600);
  expect(bodyOf()).toBe(MAP);
});

/* ------------------------------------------------------------------------------ the panel */

test("the panel offers no hue, status, icon or flags on a topic: a mindmap line is its name", async ({ page }) => {
  await open(page);
  await pick(page, "m1");
  await panel(page);

  await expect(page.locator("[data-dag-prop-title]")).toHaveValue("Dialects");
  await expect(page.locator("[data-dag-prop-hue]")).toHaveCount(0);
  await expect(page.locator("[data-dag-prop-status]")).toHaveCount(0);
  await expect(page.locator("[data-dag-prop-flag]")).toHaveCount(0);
  await expect(page.locator("[data-dag-prop-icon]")).toHaveCount(0);
  expect(bodyOf()).toBe(MAP);
});

test("Make root hangs the whole map from the picked topic", async ({ page }) => {
  await open(page);
  await pick(page, "m1");
  await panel(page);

  await page.locator('[data-dag-topic-op="root"]').click();
  await expect.poll(bodyOf, { timeout: 5_000 }).toBe("root Dialects\n  Arch\n  Erd\n  Board\n    Editing");
  await expect(page.locator("[data-dag-error]")).toHaveCount(0);
  /* The pick followed Dialects to the top, where there is nothing left to make root. */
  await expect(page.locator('[data-dag-topic-op="root"]')).toBeDisabled();
});

test("Indent, Outdent, Move up and Move down are buttons for what a drag would do", async ({ page }) => {
  await open(page);
  await pick(page, "m7");
  await panel(page);

  /* Editing is the last child of the root: nothing below it, and outdenting would be depth 0. */
  await expect(page.locator('[data-dag-topic-op="down"]')).toBeDisabled();
  await expect(page.locator('[data-dag-topic-op="outdent"]')).toBeDisabled();

  await page.locator('[data-dag-topic-op="indent"]').click();
  await expect.poll(bodyOf, { timeout: 5_000 }).toBe("root Board\n  Dialects\n    Arch\n    Erd\n    Editing");

  await page.locator('[data-dag-topic-op="up"]').click();
  await expect.poll(bodyOf, { timeout: 5_000 }).toBe("root Board\n  Dialects\n    Arch\n    Editing\n    Erd");

  await page.locator('[data-dag-topic-op="outdent"]').click();
  await expect.poll(bodyOf, { timeout: 5_000 }).toBe("root Board\n  Dialects\n    Arch\n    Erd\n  Editing");
  await expect(page.locator("[data-dag-error]")).toHaveCount(0);
});
