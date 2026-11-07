import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

import { lead } from "./keys";
import { BOARDS } from "./boards";

/**
 * Pictures on the board.
 *
 * "A sticky man, a house, a building, a book and many many other objects … each of them could have
 * a text right below it to indicate what it actually means. And that text is of course optional."
 * What a screenshot cannot show is what is held here: that one comes out of the library as one
 * `figure` with its picture drawn, that a board of them is not *ready* until the lazily loaded art
 * is on it, that its caption is typed where it is drawn and can be taken off, that the picker
 * changes the picture and its ink, and that a line into one ends on the picture rather than a
 * caption's width short of it.
 */

const BOARD = `\`\`\`sketch {#one x=0 y=0}
figure f "Home" icon=emoji:house
\`\`\`

\`\`\`sketch {#row x=0 y=240}
figure a "Customer" icon=emoji:person x=0 y=0
figure b "Everybody who orders on the app" icon=emoji:mobile-phone x=320 y=0
figure c icon=mono:emoji:package hue=teal x=640 y=0
figure d "Stick" x=880 y=0
a --> b
\`\`\`
`;

let name = "";
let file = "";
test.beforeEach(({}, info) => {
  name = `e2e-figures-${info.testId}`;
  file = path.join(BOARDS, `${name}.board.md`);
  fs.writeFileSync(file, BOARD);
});
test.afterEach(() => fs.rmSync(file, { force: true }));

const read = () => fs.readFileSync(file, "utf8");

/** At zoom 1, so a pointer's pixels are the board's. */
async function open(page: Page) {
  await page.goto(`/?board=${name}`);
  await page.evaluate(() => localStorage.setItem("dag:library", "0"));
  await page.waitForFunction(() => document.documentElement.dataset.dagReady === "1", null, { timeout: 20_000 });
  await page.locator(".dag-viewport").focus();
  await page.keyboard.press("0");
  await page.mouse.move(800, 600);
  await page.mouse.wheel(0, 1);
  await expect(page.locator(".dag-viewport")).toHaveAttribute("data-zoom", "1");
}

const centreOf = async (page: Page, sel: string) => {
  const b = (await page.locator(sel).boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
};

test("a board of pictures is ready only once every picture is drawn", async ({ page }) => {
  await page.goto(`/?board=${name}`);
  await page.waitForFunction(() => document.documentElement.dataset.dagReady === "1", null, { timeout: 20_000 });
  /* Read at the moment of readiness, before anything else can land: the emoji art is a chunk of its
     own, and a `data-dag-ready` that fired over blank squares would photograph a board that does
     not exist. Every picture holds an `<svg>` — the stick figure's is Lucide's. */
  const blank = await page.evaluate(() =>
    [...document.querySelectorAll(".dag-figure__pic")].filter((p) => !p.querySelector("svg")).length,
  );
  expect(blank).toBe(0);
  await expect(page.locator('[data-dag-kind="figure"]')).toHaveCount(5);
  /* The colour cut is drawn as a brand, the mono cut and the stick figure take the ink or the hue. */
  await expect(page.locator('[data-dag-node="f"]')).toHaveAttribute("data-dag-art", "brand");
  await expect(page.locator('[data-dag-node="c"]')).toHaveAttribute("data-dag-art", "mono");
  await expect(page.locator('[data-dag-node="d"]')).toHaveAttribute("data-dag-art", "concept");
  await expect(page.locator("[data-dag-error]")).toHaveCount(0);
});

/* The dev size assertion reports through `console.error` when a card draws at another size than it
   was laid out at — the check that holds `layout/figure.ts` and the CSS to one box — so the console
   is read under every theme, where the caption's font and the picture's ink both change. */
for (const theme of ["paper", "neutral", "paper-dark"]) {
  test(`pictures draw at the size they were laid out at, under ${theme}`, async ({ page }) => {
    const problems: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error" || msg.type() === "warning") problems.push(msg.text());
    });
    page.on("pageerror", (e) => problems.push(String(e)));
    await page.goto(`/?board=${name}&theme=${theme}&snapshot=1`);
    await page.waitForFunction(() => document.documentElement.dataset.dagReady === "1", null, { timeout: 20_000 });
    await page.evaluate(() => document.fonts.ready);
    await expect(page.locator(".dag-figure__pic svg")).toHaveCount(5);
    expect(problems, `console output under ${theme}`).toEqual([]);
  });
}

test("a picture comes from the library as one figure with its caption", async ({ page }) => {
  await open(page);
  await lead(page, "l");
  await page.locator("[data-dag-library-search]").fill("delivery truck");
  const tile = page.locator('[data-dag-component="object-delivery-truck"]');
  await expect(tile).toBeVisible();
  /* The tile shows the picture itself, not a word. */
  await expect(tile.locator("svg")).toHaveCount(1);
  await tile.click();
  await expect
    .poll(read, { timeout: 5_000 })
    .toMatch(/```sketch \{#sketch-[a-z0-9]{4}[^}]*\}\nfigure delivery-truck1 "Delivery truck" icon=emoji:delivery-truck/);
  await expect(page.locator('[data-dag-node="delivery-truck1"] .dag-figure__pic svg')).toBeVisible();
  await expect(page.locator("[data-dag-error]")).toHaveCount(0);
});

test("the library opens on shelves of pictures, the stick figure first", async ({ page }) => {
  await open(page);
  await lead(page, "l");
  const objects = page.locator("[data-dag-objects]");
  await objects.scrollIntoViewIfNeeded();
  const first = objects.locator("[data-dag-shelf] [data-dag-component]").first();
  await expect(first).toHaveAttribute("data-dag-component", "object-line-stick-figure");
  /* A shelf shows a handful and says how many it holds; "Show all" opens the rest. */
  const people = objects.locator('[data-dag-shelf="People"]');
  const shown = await people.locator("[data-dag-component]").count();
  await people.locator("[data-dag-shelf-more]").click();
  await expect.poll(() => people.locator("[data-dag-component]").count()).toBeGreaterThan(shown);
});

test("a caption is typed where it is drawn, and emptying it leaves the picture", async ({ page }) => {
  await open(page);
  const at = await centreOf(page, '[data-dag-node="f"] .dag-figure__pic');
  await page.mouse.click(at.x, at.y);
  await page.mouse.dblclick(at.x, at.y);
  const box = page.locator("[data-dag-rename-box] input, input[data-dag-rename-box]");
  await expect(box).toBeVisible();
  await expect(box).toHaveValue("Home");
  await box.fill("Our office");
  await box.press("Enter");
  await expect.poll(read).toContain('figure f "Our office" icon=emoji:house');

  /* The text is optional — the brief's own word — so an empty box takes it off rather than being
     refused the way it is on a card, where a nameless card would draw as nothing. */
  await page.mouse.dblclick(at.x, at.y);
  await expect(box).toBeVisible();
  await box.fill("");
  await box.press("Enter");
  await expect.poll(read).toMatch(/figure f icon=emoji:house/);
  await expect(page.locator('[data-dag-node="f"] .dag-figure__pic svg')).toBeVisible();
});

test("the picker changes the picture, and draws it in the hue when asked", async ({ page }) => {
  await open(page);
  await page.locator('[data-dag-item="one"]').click();
  await expect(page.locator("[data-dag-selected]")).toHaveCount(1);
  await page.locator(".dag-viewport").focus();
  await page.keyboard.press("Enter");
  const style = page.locator("[data-dag-item-style]");
  await expect(style).toBeVisible();
  /* A figure's picker opens on the pictures. */
  await expect(style.locator('[data-dag-iconpick-mode="emoji"]')).toHaveAttribute("aria-pressed", "true");
  await style.locator("[data-dag-prop-icon]").fill("rocket");
  await style.locator('[data-dag-iconpick-opt="emoji:rocket"]').click();
  await expect.poll(read).toContain('figure f "Home" icon=emoji:rocket');
  await style.locator("[data-dag-iconpick-tint]").click();
  await expect.poll(read).toContain('figure f "Home" icon=mono:emoji:rocket');
});

test("a line into a figure ends on its picture, not a caption's width short of it", async ({ page }) => {
  await open(page);
  const line = page.locator('[data-dag-item="row"] [data-dag-edge] .dag-edge-line');
  await expect(line).toHaveCount(1);
  const end = await line.evaluate((p: SVGPathElement) => {
    const at = p.getPointAtLength(p.getTotalLength());
    const m = p.getScreenCTM()!;
    return { x: at.x * m.a + m.e, y: at.y * m.d + m.f };
  });
  const pic = (await page.locator('[data-dag-node="b"] .dag-figure__pic').boundingBox())!;
  const card = (await page.locator('[data-dag-node="b"]').boundingBox())!;
  /* The caption makes the box far wider than the phone; the arrow's head sits at the phone. */
  expect(card.width).toBeGreaterThan(pic.width + 40);
  expect(end.x).toBeGreaterThan(pic.x - 16);
  expect(end.x).toBeLessThan(pic.x + 4);
});
