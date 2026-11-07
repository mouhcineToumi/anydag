import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

import { lead } from "./keys";
import { BOARDS } from "./boards";

/**
 * Editing on the canvas: select, move together, delete, duplicate, copy and paste, add, type, undo.
 *
 * Every one of these ends in the board file, so every check reads the bytes on disk — the thing
 * being tested is that a gesture in a browser turns into a small, correct edit to a document a
 * person also owns, and that an undo puts exactly the old bytes back. Selection state is read off
 * `data-dag-selected`, which is rendered, because the selection *is* React state; gestures in
 * progress are painted and are not asserted on here.
 *
 * One board per test, because the suite runs in parallel and these tests write to disk.
 */

const DIR = BOARDS;

const BOARD = `---
title: Select me
---

\`\`\`md {#one}
The first item.
\`\`\`

\`\`\`md {#two}
The second item.
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

async function open(page: Page, query = "") {
  await page.goto(`/?board=${name}${query}`);
  await page.waitForFunction(() => document.documentElement.dataset.dagReady === "1", null, { timeout: 20_000 });
}

/* The modifier is held on the keyboard rather than passed to `mouse.click`: in headless Chromium
   the `modifiers` option reached the pointer events with `shiftKey` false. */
async function clickItem(page: Page, id: string, modifier?: "Shift") {
  const at = (await page.locator(`[data-dag-item="${id}"]`).boundingBox())!;
  if (modifier) await page.keyboard.down(modifier);
  await page.mouse.click(at.x + 40, at.y + 12);
  if (modifier) await page.keyboard.up(modifier);
}

/** A point on the paper with nothing under it: the corner of the view, well clear of the fit. */
async function paper(page: Page) {
  const vp = (await page.locator(".dag-viewport").boundingBox())!;
  return { x: vp.x + 20, y: vp.y + vp.height - 20, vp };
}

const selectedIds = (page: Page) =>
  page.locator("[data-dag-selected]").evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.dagItem));

test("a click selects, shift-click adds, and a click on the paper clears", async ({ page }) => {
  await open(page);
  await clickItem(page, "one");
  expect(await selectedIds(page)).toEqual(["one"]);
  /* The one selected item wears the handles, and the toolbar offers what one item can do. */
  await expect(page.locator("[data-dag-selbar-edit]")).toHaveCount(1);
  await expect(page.locator("[data-dag-handle]")).toHaveCount(8);

  await clickItem(page, "two", "Shift");
  expect(await selectedIds(page)).toEqual(["one", "two"]);
  await expect(page.locator("[data-dag-selbar-edit]")).toHaveCount(0);

  await clickItem(page, "one", "Shift");
  expect(await selectedIds(page)).toEqual(["two"]);

  const p = await paper(page);
  await page.mouse.click(p.x, p.y);
  expect(await selectedIds(page)).toEqual([]);

  /* Nothing was written: selecting is not an edit. */
  await page.waitForTimeout(300);
  expect(read()).toBe(BOARD);
});

test("a marquee on the paper selects what it crosses, and escape clears", async ({ page }) => {
  await open(page);
  const { vp } = await paper(page);
  const two = (await page.locator('[data-dag-item="two"]').boundingBox())!;

  /* From the top-left corner of the view to the middle of the second item: both are crossed. */
  await page.mouse.move(vp.x + 10, vp.y + 10);
  await page.mouse.down();
  await page.mouse.move(vp.x + 200, vp.y + 200, { steps: 4 });
  await page.mouse.move(two.x + two.width / 2, two.y + two.height / 2, { steps: 4 });
  await expect(page.locator(".dag-marquee")).toBeVisible();
  await page.mouse.up();
  expect(await selectedIds(page)).toEqual(["one", "two"]);
  await expect(page.locator(".dag-marquee")).toBeHidden();

  await page.keyboard.press("Escape");
  expect(await selectedIds(page)).toEqual([]);

  /* And the view did not move: a marquee is not a pan. */
  const m = await page.evaluate(() => getComputedStyle(document.querySelector(".dag-layer")!).transform);
  expect(m).not.toBe("none");
  expect(read()).toBe(BOARD);
});

test("the hand tool makes a left drag on the paper a pan again", async ({ page }) => {
  await open(page);
  await lead(page, "h");
  await expect(page.locator(".dag-viewport")).toHaveAttribute("data-tool", "hand");
  const before = await page.evaluate(() => new DOMMatrix(getComputedStyle(document.querySelector(".dag-layer")!).transform).e);
  const { vp } = await paper(page);
  await page.mouse.move(vp.x + 10, vp.y + 10);
  await page.mouse.down();
  await page.mouse.move(vp.x + 110, vp.y + 60, { steps: 4 });
  await page.mouse.move(vp.x + 210, vp.y + 110, { steps: 4 });
  await page.mouse.up();
  const after = await page.evaluate(() => new DOMMatrix(getComputedStyle(document.querySelector(".dag-layer")!).transform).e);
  expect(after - before).toBeCloseTo(200, 0);
  expect(await selectedIds(page)).toEqual([]);
  await lead(page, "v");
  await expect(page.locator(".dag-viewport")).toHaveAttribute("data-tool", "select");
});

test("dragging one selected item moves every selected item, keeping their distance", async ({ page }) => {
  await open(page);
  await clickItem(page, "one");
  await clickItem(page, "two", "Shift");

  const from = (await page.locator('[data-dag-item="one"]').boundingBox())!;
  await page.mouse.move(from.x + 40, from.y + 12);
  await page.mouse.down();
  await page.mouse.move(from.x + 140, from.y + 112, { steps: 8 });
  await page.mouse.move(from.x + 240, from.y + 212, { steps: 8 });
  await page.mouse.up();

  await expect.poll(read, { timeout: 5_000 }).toMatch(/```md \{#two x=\d+ y=\d+\}/);
  const text = read();
  const one = /```md \{#one x=(\d+) y=(\d+)\}/.exec(text)!;
  const two = /```md \{#two x=(\d+) y=(\d+)\}/.exec(text)!;
  /* Both moved, on the grid, and `two` is still exactly one width plus one gap to the right. */
  expect(Number(one[1])).toBeGreaterThan(0);
  expect(Number(one[1]) % 8).toBe(0);
  expect(Number(two[1]) - Number(one[1])).toBe(600);
  expect(Number(two[2]) - Number(one[2])).toBe(0);
  /* Still selected after the drop. */
  expect(await selectedIds(page)).toEqual(["one", "two"]);
});

test("delete removes the item from the file, and undo puts it back byte for byte", { tag: "@smoke" }, async ({ page }) => {
  await open(page);
  await clickItem(page, "one");
  await page.keyboard.press("Delete");

  await expect.poll(read, { timeout: 5_000 }).not.toContain("#one");
  expect(read()).toContain("The second item.");
  expect(read()).not.toContain("The first item.");
  await expect(page.locator('[data-dag-item="one"]')).toHaveCount(0);
  expect(await selectedIds(page)).toEqual([]);
  await expect(page.locator("[data-dag-undo]")).toBeEnabled();

  await page.keyboard.press("Control+z");
  await expect.poll(read, { timeout: 5_000 }).toBe(BOARD);
  await expect(page.locator('[data-dag-item="one"]')).toHaveCount(1);

  await page.keyboard.press("Control+Shift+z");
  await expect.poll(read, { timeout: 5_000 }).not.toContain("#one");
});

test("undo refuses a snapshot from before someone else wrote the file", async ({ page }) => {
  await open(page);
  await clickItem(page, "one");
  await page.keyboard.press("Delete");
  await expect.poll(read, { timeout: 5_000 }).not.toContain("#one");

  /* Claude rewrites the board in the meantime. */
  const theirs = read().replace("The second item.", "The second item, rewritten.");
  fs.writeFileSync(file, theirs);
  await expect(page.locator('[data-dag-item="two"]')).toContainText("rewritten", { timeout: 5_000 });

  await page.keyboard.press("Control+z");
  /* The dropped stack is the observable signal that the refusal has been processed; waiting a fixed
     half-second and then reading the file was asking whether it had happened yet. */
  await expect(page.locator("[data-dag-undo]")).toBeDisabled();
  expect(read()).toBe(theirs);
});

test("duplicate adds a copy beside the original", async ({ page }) => {
  await open(page);
  await clickItem(page, "one");
  await page.keyboard.press("Control+d");

  await expect.poll(() => (read().match(/```md/g) ?? []).length, { timeout: 5_000 }).toBe(3);
  const text = read();
  const copy = /```md \{#(md-[a-z0-9]{4}) x=(\d+) y=(\d+)\}\nThe first item\.\n```/.exec(text)!;
  expect(copy).not.toBeNull();
  /* Three grid steps down and right of the original, which was pinned where it was flowing. */
  const one = /```md \{#one x=(\d+) y=(\d+)\}/.exec(text)!;
  expect(Number(copy[2]) - Number(one[1])).toBe(24);
  expect(Number(copy[3]) - Number(one[2])).toBe(24);
  /* The copy is what is selected now — once the page has heard back, which the file cannot say. */
  await expect(page.locator("[data-dag-selected]")).toHaveAttribute("data-dag-item", copy[1]);
});

test("copy puts the item's own source on the clipboard, and paste reads it back", { tag: "@smoke" }, async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await open(page);
  await clickItem(page, "one");
  await page.keyboard.press("Control+c");
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  expect(clip).toBe("```md {#one}\nThe first item.\n```");

  /* Paste lands under the pointer. */
  const p = await paper(page);
  await page.mouse.move(p.x + 100, p.y - 100);
  await page.keyboard.press("Control+v");
  await expect.poll(() => (read().match(/```md/g) ?? []).length, { timeout: 5_000 }).toBe(3);
  const text = read();
  /* `one` is taken, so the paste took a fresh id — and it is pinned, on the grid. */
  const pasted = /```md \{#(md-[a-z0-9]{4}) x=(-?\d+) y=(-?\d+)\}\nThe first item\.\n```/.exec(text)!;
  expect(pasted).not.toBeNull();
  expect(Number(pasted[2]) % 8).toBe(0);
  await expect(page.locator("[data-dag-selected]")).toHaveAttribute("data-dag-item", pasted[1]);
});

test("cut removes the item and paste brings it back under its own id", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await open(page);
  await clickItem(page, "two");
  await page.keyboard.press("Control+x");
  await expect.poll(read, { timeout: 5_000 }).not.toContain("#two");
  /* The page, not just the file, has to have let go of `two` before the paste can reuse the id. */
  await expect(page.locator('[data-dag-item="two"]')).toHaveCount(0);
  await page.keyboard.press("Control+v");
  await expect.poll(read, { timeout: 5_000 }).toMatch(/```md \{#two x=-?\d+ y=-?\d+\}\nThe second item\.\n```/);
});

test("pasting plain text makes a note of it", async ({ page }) => {
  await open(page);
  await page.locator(".dag-viewport").focus();
  await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.setData("text/plain", "Hello from the clipboard.\nTwo lines of it.");
    document.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  await expect
    .poll(read, { timeout: 5_000 })
    .toMatch(/```md \{#md-[a-z0-9]{4} x=-?\d+ y=-?\d+\}\nHello from the clipboard\.\nTwo lines of it\.\n```/);
});

test("the leader chord adds a note and opens the editor on it", async ({ page }) => {
  /* The toolbar's Note button is gone — it wrote `TEMPLATES.md` where the library's own Note and
     Text entries write the same thing with better defaults, and it duplicated two lighter routes.
     These are those two: the key here, and the double-click below. */
  await open(page);
  await page.locator(".dag-viewport").click({ position: { x: 700, y: 500 } });
  await lead(page, "n");
  await expect.poll(read, { timeout: 5_000 }).toMatch(/```md \{#md-[a-z0-9]{4} x=-?\d+ y=-?\d+\}\nNew note\n```/);
  await expect(page.locator("[data-dag-inspector]")).toBeVisible();
  await expect(page.locator("[data-dag-body]")).toHaveValue("New note");
  await expect(page.locator("[data-dag-body]")).toBeFocused();
});

test("a double-click on the paper makes a note there", async ({ page }) => {
  await open(page);
  const p = await paper(page);
  await page.mouse.dblclick(p.x + 60, p.y - 60);
  await expect.poll(read, { timeout: 5_000 }).toMatch(/```md \{#md-[a-z0-9]{4} x=-?\d+ y=-?\d+\}\nNew note\n```/);
  await expect(page.locator("[data-dag-body]")).toBeFocused();
});

test("typing in the editor writes the body, and escape closes it", async ({ page }) => {
  await open(page);
  await clickItem(page, "one");
  await page.keyboard.press("Enter");
  const body = page.locator("[data-dag-body]");
  await expect(body).toBeFocused();
  await body.fill("Rewritten **by hand**.");
  await expect.poll(read, { timeout: 5_000 }).toContain("```md {#one}\nRewritten **by hand**.\n```");
  await expect(page.locator('[data-dag-item="one"] strong')).toHaveText("by hand");

  await page.keyboard.press("Escape");
  await expect(page.locator("[data-dag-inspector]")).toHaveCount(0);
  await expect(page.locator(".dag-viewport")).toBeFocused();

  /* The whole run of typing is one undo. */
  await page.keyboard.press("Control+z");
  await expect.poll(read, { timeout: 5_000 }).toBe(BOARD);
});

test("the editor's fields write the fence line", async ({ page }) => {
  fs.writeFileSync(file, `${BOARD}\n\`\`\`arch {#infra}\nservice api "API"\n\`\`\`\n`);
  await open(page);
  await clickItem(page, "infra");
  await page.keyboard.press("Enter");
  /* The title is in the Advanced disclosure now, addressed by its own hook — the first
     `input.dag-input` in the panel is no longer the title, and on a one-node item it is not an
     item field at all. */
  await page.locator("[data-dag-advanced-toggle]").click();
  const title = page.locator("[data-dag-item-title]");
  await title.fill("What runs where");
  await title.press("Enter");
  await expect.poll(read, { timeout: 5_000 }).toContain('```arch {#infra title="What runs where"}');
  await expect(page.locator('[data-dag-item="infra"] .dag-frame__title')).toHaveText("What runs where");
});

test("arrows nudge the selection by the grid", async ({ page }) => {
  await open(page);
  await clickItem(page, "one");
  await page.keyboard.press("ArrowRight");
  await expect.poll(read, { timeout: 5_000 }).toMatch(/```md \{#one x=8 y=0\}/);
  await page.keyboard.press("Shift+ArrowDown");
  await expect.poll(read, { timeout: 5_000 }).toMatch(/```md \{#one x=8 y=80\}/);
  /* Never the viewport's pan: the layer did not move. */
});

test("a held arrow is one write, not one per repeat", async ({ page }) => {
  await open(page);
  await clickItem(page, "one");

  /* Counted rather than timed: the defect this covers is a *write rate*, and thirty writes a second
     against a file is invisible — `writeAtomic` on a few hundred bytes — which is exactly why it
     survived until the store was going to be one that refuses them. */
  let writes = 0;
  page.on("request", (r) => {
    if (r.method() === "POST" && r.url().includes("/__board/patch")) writes += 1;
  });

  /* An OS repeat is a run of keydowns with no keyup between them, about thirty a second.
     Dispatched rather than pressed, because Playwright's `press` is a keydown *and* a keyup, which
     is a run of one; spaced, because a real repeat lets React render in between and the point here
     is the number of writes rather than the accumulator. */
  await page.evaluate(async () => {
    for (let i = 0; i < 10; i += 1) {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", repeat: i > 0, bubbles: true }));
      await new Promise((r) => setTimeout(r, 30));
    }
  });
  /* Painted before anything is written: ten steps of the 8px grid have already moved the item. */
  await expect(page.locator('[data-dag-item="one"]')).toHaveAttribute("style", /translate\(80px/);
  expect(writes).toBe(0);

  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent("keyup", { key: "ArrowRight", bubbles: true })));
  await expect.poll(read, { timeout: 5_000 }).toMatch(/```md \{#one x=80 y=0\}/);
  expect(writes).toBe(1);
});

test("the handle sets the width", async ({ page }) => {
  await open(page);
  await clickItem(page, "one");
  const h = (await page.locator('[data-dag-handle="e"]').boundingBox())!;
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
  await page.mouse.down();
  await page.mouse.move(h.x + 100, h.y, { steps: 4 });
  await page.mouse.move(h.x + 200, h.y, { steps: 4 });
  await page.mouse.up();
  await expect.poll(read, { timeout: 5_000 }).toMatch(/```md \{#one w=\d+\}/);
  const w = Number(/w=(\d+)/.exec(read())![1]);
  expect(w).toBeGreaterThan(520);
  expect(w % 8).toBe(0);
});

test("select all, then delete, empties the board; undo fills it again", async ({ page }) => {
  await open(page);
  await page.locator(".dag-viewport").focus();
  await page.keyboard.press("Control+a");
  expect(await selectedIds(page)).toEqual(["one", "two"]);
  await page.keyboard.press("Backspace");
  await expect.poll(read, { timeout: 5_000 }).toBe("---\ntitle: Select me\n---\n");
  /* The file is empty before the page has heard back; the undo button says when it has. */
  await expect(page.locator("[data-dag-undo]")).toBeEnabled();
  await page.keyboard.press("Control+z");
  await expect.poll(read, { timeout: 5_000 }).toBe(BOARD);
});

test("the snapshot view has no editing chrome", async ({ page }) => {
  await open(page, "&snapshot=1");
  await expect(page.locator("[data-dag-movable]")).toHaveCount(0);
  await clickItem(page, "one");
  await expect(page.locator("[data-dag-selected]")).toHaveCount(0);
  await page.keyboard.press("Delete");
  await page.waitForTimeout(400);
  expect(read()).toBe(BOARD);
});

test("the same picture pasted twice is two images, each with an id of its own", async ({ page }) => {
  /* The route named the fence after the picture's digest, so the second paste of one screenshot
     wrote a second `#image-<sha8>`: EB_DUPLICATE_ID on the board, and every op on the new item
     aimed at the old one. The item is not shared, whatever the file is. */
  const attached = (): string[] => [...read().matchAll(/src="dag:([0-9a-z]{10})"/g)].map((m) => m[1]!);
  try {
    await open(page);
    await page.locator(".dag-viewport").focus();
    const paste = () =>
      page.evaluate(() => {
        /* A 1×1 PNG: the bytes, not the size, are what the id comes from. */
        const b64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
        const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        const dt = new DataTransfer();
        dt.items.add(new File([bytes], "shot.png", { type: "image/png" }));
        document.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
      });
    const ids = () => [...read().matchAll(/```image \{#(image-[0-9a-f]+(?:-\d+)?) /g)].map((m) => m[1]);

    await paste();
    await expect.poll(ids, { timeout: 5_000 }).toHaveLength(1);
    const [first] = ids();
    /* The page has to have the first one before the second is anything but a race with the write. */
    await expect(page.locator(`[data-dag-item="${first}"]`)).toHaveCount(1);
    await paste();
    await expect.poll(ids, { timeout: 5_000 }).toEqual([first, `${first}-2`]);

    await expect(page.locator(`[data-dag-item="${first}-2"]`)).toHaveCount(1);
    await expect(page.locator('[data-dag-item^="image-"] img')).toHaveCount(2);
    await expect(page.locator("[data-dag-problems-pill]")).toHaveCount(0);
    /* A pasted picture is an attachment (decision 13), so each paste is a file of its own in the
       vault's attachments folder — and each item names its own. */
    const [a, b] = attached();
    expect(a).toBeTruthy();
    expect(b).toBeTruthy();
    expect(a).not.toBe(b);
  } finally {
    for (const id of attached()) {
      const got = await page.request.get(`/__board/resolve?id=${id}`);
      if (got.ok()) await page.request.post("/__board/delete", { data: { name: ((await got.json()) as { name: string }).name, kind: "file" } });
    }
  }
});
