import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { exportAs, openExport } from "./export";
import { openSettings, settingsTab } from "./sidebar";
import { BOARDS, ROOT } from "./boards";

/**
 * Settings — what the app does, as opposed to what a board says. A modal of tabs.
 *
 * Checked on what actually changes: the theme the page is drawn in, the size a pasted image lands
 * at (that one is `io.spec.ts`, beside the import it belongs to), and the bytes of an export. The
 * modal itself is checked for the things a person would notice were missing — every way in and out,
 * the arrow keys, the tab it comes back to, a narrow window, that nothing pressed in it reaches the
 * board behind it, and that a tab's Reset puts back what that tab shows and nothing else.
 */

const DIR = BOARDS;

const BOARD = `---
title: Settings scratch
theme: paper-dark
---

\`\`\`md {#one x=0 y=0 w=320}
The first item.
\`\`\`

\`\`\`md {#two x=0 y=200 w=320}
The second item.
\`\`\`
`;

let name = "";
let file = "";
test.beforeEach(({}, info) => {
  name = `e2e-settings-${info.testId}`;
  file = path.join(DIR, `${name}.board.md`);
  fs.writeFileSync(file, BOARD);
});
test.afterEach(() => {
  fs.rmSync(file, { force: true });
  fs.rmSync(path.join(DIR, `${name}.assets`), { recursive: true, force: true });
});

async function open(page: Page, extra = "") {
  await page.goto(`/?board=${name}${extra}`);
  await page.evaluate(() => localStorage.setItem("dag:library", "0"));
  await page.waitForFunction(() => document.documentElement.dataset.dagReady === "1", null, { timeout: 20_000 });
  await page.evaluate(() => document.fonts.ready);
}

const dialog = (page: Page) => page.locator("[data-dag-settings]");

async function saved(page: Page, act: () => Promise<void>): Promise<{ name: string; bytes: Buffer }> {
  const [dl] = await Promise.all([page.waitForEvent("download"), act()]);
  const p = await dl.path();
  return { name: dl.suggestedFilename(), bytes: fs.readFileSync(p!) };
}

test("the gear and ctrl+, both open it, and Escape closes it without clearing the selection", { tag: "@smoke" }, async ({
  page,
}) => {
  await open(page);

  await openSettings(page);
  await expect(dialog(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog(page)).toHaveCount(0);

  /* With something selected, so the Escape chain is actually exercised: the card over the board is
     let go of first, and what is underneath is left exactly as it was. */
  await page.locator('[data-dag-item="one"]').click();
  await expect(page.locator("[data-dag-selected]")).toHaveCount(1);
  await page.keyboard.press("Control+Comma");
  await expect(dialog(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog(page)).toHaveCount(0);
  await expect(page.locator("[data-dag-selected]")).toHaveCount(1);

  /* And a second Escape does what one always did. */
  await page.keyboard.press("Escape");
  await expect(page.locator("[data-dag-selected]")).toHaveCount(0);
});

test("the PNG scale is a setting, and the Export caption says which", async ({ page }) => {
  await open(page);
  const svg = await saved(page, () => exportAs(page, "svg"));
  const size = /width="(\d+)" height="(\d+)"/.exec(svg.bytes.toString("utf8"))!;
  await openExport(page);
  await expect(page.locator("[data-dag-export-as=png]")).toHaveText("Board as PNG (2×)");

  await openSettings(page, "export");
  await page.locator("[data-dag-setting-export-scale]").selectOption("1");
  await page.keyboard.press("Escape");
  /* A caption stating a constant is a lie the moment the constant is a preference. */
  await openExport(page);
  await expect(page.locator("[data-dag-export-as=png]")).toHaveText("Board as PNG (1×)");

  const png = await saved(page, () => exportAs(page, "png"));
  expect(png.bytes.readUInt32BE(16)).toBe(Number(size[1]));
  expect(png.bytes.readUInt32BE(20)).toBe(Number(size[2]));
});

test("the paper can be turned off, and the margin changed, in the exported SVG", async ({ page }) => {
  await open(page);
  const before = (await saved(page, () => exportAs(page, "svg"))).bytes.toString("utf8");
  expect(before).toContain("<rect");
  const wide = /width="(\d+)"/.exec(before)!;

  await openSettings(page, "export");
  await page.locator("[data-dag-setting-export-paper]").click();
  await page.locator("[data-dag-setting-export-margin]").fill("0");
  await page.keyboard.press("Escape");

  const after = (await saved(page, () => exportAs(page, "svg"))).bytes.toString("utf8");
  /* Exported onto nothing, which is what a dark slide wants. */
  expect(after).not.toContain("<rect");
  /* And with the margin gone the page is exactly two margins narrower — the grid is 8, so 4 steps
     each side is 64. The items themselves are untouched. */
  expect(Number(/width="(\d+)"/.exec(after)![1])).toBe(Number(wide[1]) - 64);
  expect(after).toContain("The first item");
});

test("unused images are counted and swept, and what is still drawn is kept", async ({ page }) => {
  /* One image the board draws and one whose fence was deleted — which is what pasting a screenshot
     and then removing it leaves behind, and what nothing swept before. */
  const assets = path.join(DIR, `${name}.assets`);
  fs.mkdirSync(assets, { recursive: true });
  fs.writeFileSync(path.join(assets, "kept.png"), Buffer.alloc(100));
  fs.writeFileSync(path.join(assets, "orphan.png"), Buffer.alloc(2048));
  fs.writeFileSync(file, `${BOARD}\n\`\`\`image {#pic x=0 y=400 w=64 src=${name}.assets/kept.png}\n\`\`\`\n`);

  await open(page);
  await openSettings(page, "vault");

  /* The count is the server's and covers this board alone — never the workspace, for the reason
     `/rmdir` is not recursive — so it can only settle once the fetch lands. */
  const sweep = page.locator("[data-dag-setting-sweep]");
  await expect(sweep).toBeVisible();
  await expect(sweep).toContainText("2 KB");

  await sweep.click();
  await page.locator("[data-dag-setting-sweep-confirm]").click();

  await expect.poll(() => fs.existsSync(path.join(assets, "orphan.png")), { timeout: 5_000 }).toBe(false);
  /* The one the board draws stays, and so does the directory. */
  expect(fs.existsSync(path.join(assets, "kept.png"))).toBe(true);
  expect(fs.existsSync(assets)).toBe(true);
});

test("the vault's links switch is on by default, and is the vault's preference", async ({ page }) => {
  await open(page);
  await openSettings(page, "vault");
  /* Obsidian's default: a rename keeps the [[wikilinks]] to it. The server reads it off the vault's
     `.anydag/settings.json`, which the preference sync writes; this suite runs with the sync off, so
     what is checked is the key the sync carries (`test/server/relink.test.ts` holds the server half). */
  const toggle = page.locator("[data-dag-setting-update-links]");
  await expect(toggle).toBeChecked();
  await toggle.click();
  await expect(toggle).not.toBeChecked();
  /* Kept under this vault's own key, beside its theme and favourites. */
  const kept = await page.evaluate(() =>
    Object.keys(localStorage)
      .filter((k) => k === "dag:update-links" || k.startsWith("dag:update-links@"))
      .map((k) => [k, localStorage.getItem(k)]),
  );
  expect(kept).toHaveLength(1);
  expect(kept[0]![0]).toMatch(/^dag:update-links@./);
  expect(kept[0]![1]).toBe("0");
});

test("a tab's reset puts back what that tab shows, and nothing on another tab", async ({ page }) => {
  await open(page);
  await openSettings(page, "export");
  await page.locator("[data-dag-setting-export-scale]").selectOption("4");

  await settingsTab(page, "preferences");
  await page.locator("[data-dag-setting-theme]").selectOption("neutral");
  await page.locator("[data-dag-setting-paste-size]").selectOption("width");
  await expect(page.locator("[data-dag-setting-paste-width]")).toBeVisible();

  await page.locator("[data-dag-setting-reset]").click();
  await expect(page.locator("[data-dag-setting-paste-size]")).toHaveValue("screen");
  /* The fixed-width field is only there for the rule that uses it. */
  await expect(page.locator("[data-dag-setting-paste-width]")).toHaveCount(0);
  /* The theme is its own key, with its own sources and its own test; a board is not one of them. */
  await expect(page.locator("[data-dag-setting-theme]")).toHaveValue("neutral");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "neutral");

  /* The export tab's own setting was not this tab's to reset. */
  await settingsTab(page, "export");
  await expect(page.locator("[data-dag-setting-export-scale]")).toHaveValue("4");
  await page.locator("[data-dag-setting-reset]").click();
  await expect(page.locator("[data-dag-setting-export-scale]")).toHaveValue("2");
});

test("a board's theme: changes nothing; the reader's choice and the snapshot default do", async ({ page }) => {
  /* The fixture carries `theme: paper-dark`; the app's default is paper. */
  await open(page);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "paper");
  /* Opening it wrote nothing. */
  expect(fs.readFileSync(file, "utf8")).toBe(BOARD);

  /* The reader's own choice is what draws the board now. */
  await openSettings(page, "preferences");
  await page.locator("[data-dag-setting-theme]").selectOption("neutral");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "neutral");

  /* A snapshot reads no preference, and the board still contributes nothing: the default. */
  await page.goto(`/?board=${name}&snapshot=1`);
  await page.waitForFunction(() => document.documentElement.dataset.dagReady === "1", null, { timeout: 20_000 });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "paper");

  /* `?theme=` is an explicit instruction and still wins: `snapshot.mjs --theme` is that. */
  await page.goto(`/?board=${name}&theme=neutral&snapshot=1`);
  await page.waitForFunction(() => document.documentElement.dataset.dagReady === "1", null, { timeout: 20_000 });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "neutral");
});

test("the arrow keys walk the tabs across both groups, and the last tab is where it opens next", async ({ page }) => {
  await open(page);
  await page.keyboard.press("Control+Comma");
  await expect(dialog(page)).toBeVisible();
  const selected = page.locator('[data-dag-settings] [role="tab"][aria-selected="true"]');
  /* Nothing remembered in a fresh browser: the first tab, with the focus on it. */
  await expect(selected).toHaveAttribute("data-dag-settings-tab-button", "calendar");
  await expect(selected).toBeFocused();

  /* The calendar's tab. */
  await expect(page.locator('[data-dag-settings-pane="calendar"] [data-dag-setting-week-start]')).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await expect(selected).toHaveAttribute("data-dag-settings-tab-button", "shortcuts");
  await expect(page.locator('[data-dag-settings-pane="shortcuts"] .dag-shortcuts__row').first()).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  /* Out of the app's group and into the vault's, as though the heading were not there. */
  await expect(selected).toHaveAttribute("data-dag-settings-tab-button", "preferences");
  await expect(selected).toBeFocused();
  await page.keyboard.press("End");
  await expect(selected).toHaveAttribute("data-dag-settings-tab-button", "export");
  await page.keyboard.press("ArrowDown");
  await expect(selected).toHaveAttribute("data-dag-settings-tab-button", "calendar");
  await page.keyboard.press("ArrowUp");
  await expect(selected).toHaveAttribute("data-dag-settings-tab-button", "export");

  await page.locator('[data-dag-settings-tab-button="agents"]').click();
  await page.keyboard.press("Escape");
  await expect(dialog(page)).toHaveCount(0);
  await page.keyboard.press("Control+Comma");
  await expect(selected).toHaveAttribute("data-dag-settings-tab-button", "agents");

  /* And it survives a reload: this browser remembers it. */
  await page.keyboard.press("Escape");
  await open(page);
  await openSettings(page);
  await expect(selected).toHaveAttribute("data-dag-settings-tab-button", "agents");
});

test("a press outside it, the close button and ctrl+, close it, and Tab stays inside", async ({ page }) => {
  await open(page);
  await openSettings(page, "preferences");
  /* The corner of the window is the scrim: the modal is over everything, the sidebar included. */
  await page.mouse.click(4, 600);
  await expect(dialog(page)).toHaveCount(0);

  await page.keyboard.press("Control+Comma");
  await page.locator("[data-dag-settings-close]").click();
  await expect(dialog(page)).toHaveCount(0);

  /* ctrl+, from a control inside it — where the page's own handler cannot hear it. */
  await page.keyboard.press("Control+Comma");
  await page.locator("[data-dag-setting-theme]").focus();
  await page.keyboard.press("Control+Comma");
  await expect(dialog(page)).toHaveCount(0);

  await page.keyboard.press("Control+Comma");
  await settingsTab(page, "calendar");
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => !!document.activeElement?.closest("[data-dag-settings]"))).toBe(true);
  }
});

test("a key pressed in it never reaches what is selected on the board behind it", async ({ page }) => {
  await open(page);
  await page.locator('[data-dag-item="one"]').click();
  await expect(page.locator("[data-dag-selected]")).toHaveCount(1);
  const before = fs.readFileSync(file, "utf8");

  await page.keyboard.press("Control+Comma");
  await settingsTab(page, "about");
  /* A press on a blank part of the tab leaves the focus on the modal rather than on a control, which
     is where the board's own key handler used to take over. */
  const pane = page.locator('[data-dag-settings-pane="about"]');
  const box = (await pane.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height - 20);
  await page.keyboard.press("Delete");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Control+D");
  await expect(dialog(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog(page)).toHaveCount(0);

  await expect(page.locator('[data-dag-item="one"]')).toBeVisible();
  await expect(page.locator("[data-dag-selected]")).toHaveCount(1);
  expect(fs.readFileSync(file, "utf8")).toBe(before);
});

test("the model picker searches OpenCode's ids, writes provider and model together, and fits 390px", async ({ page }) => {
  await page.route("**/__board/llm*", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        default: "claude",
        providers: [
          {
            id: "claude",
            label: "Claude Code",
            description: "Uses your Claude plan.",
            kind: "cli",
            defaultModel: "sonnet",
            models: ["sonnet"],
            ready: true,
          },
          {
            id: "opencode",
            label: "OpenCode",
            description: "Uses your OpenCode login.",
            kind: "cli",
            defaultModel: "opencode-go/glm-5.3-flash",
            models: ["opencode-go/glm-5.3-flash", "opencode-go/kimi-k3"],
            ready: true,
          },
        ],
      }),
    }),
  );
  await open(page);
  await openSettings(page, "agents");
  const picker = page.locator("[data-dag-setting-llm-model]");
  await expect(picker).toContainText("Automatic");
  await picker.click();
  const search = page.locator("[data-dag-model-search]");
  await expect(search).toBeFocused();
  await search.fill("glm");
  await expect(page.getByRole("option", { name: /GLM 5\.3 Flash/ })).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(picker).toContainText("GLM 5.3 Flash");
  await expect(page.locator("[data-dag-setting-llm-provider]")).toHaveValue("opencode");

  const saved = await page.evaluate(() => {
    const key = Object.keys(localStorage).find((k) => k === "dag:settings" || k.startsWith("dag:settings@"));
    return JSON.parse(localStorage.getItem(key!) ?? "{}") as { llm?: { provider?: string; model?: string } };
  });
  expect(saved.llm).toMatchObject({ provider: "opencode", model: "opencode-go/glm-5.3-flash" });

  /* The popover is fixed to the viewport, so a phone-width window still holds the whole of it. */
  await page.setViewportSize({ width: 390, height: 800 });
  await picker.click();
  const box = await page.locator("[data-dag-model-popover]").boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  await page.keyboard.press("Escape");
});

test("the Assistant's model row is the same picker, and choosing another provider's model sets it", async ({ page }) => {
  await page.route("**/__board/chat/models*", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        providers: [
          {
            provider: "claude",
            label: "Claude Code",
            available: true,
            default: "claude-sonnet-5-5",
            models: [{ id: "claude-sonnet-5-5", label: "Sonnet 5.5" }],
            efforts: ["", "low", "medium", "high", "max"],
          },
          {
            provider: "opencode",
            label: "OpenCode",
            available: true,
            default: "opencode-go/glm-5.3-flash",
            models: [
              { id: "opencode-go/glm-5.3-flash", label: "GLM 5.3 Flash" },
              { id: "opencode-go/kimi-k3", label: "Kimi K3" },
            ],
            efforts: ["", "low", "medium", "high", "max"],
          },
        ],
      }),
    }),
  );
  await open(page);
  await openSettings(page, "agents");
  const picker = page.locator("[data-dag-setting-assistant-model]");
  await picker.click();
  await page.locator("[data-dag-model-search]").fill("glm");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(picker).toContainText("GLM 5.3 Flash");
  await expect(page.locator("[data-dag-setting-assistant-provider]")).toHaveValue("opencode");

  const saved = await page.evaluate(() => {
    const key = Object.keys(localStorage).find((k) => k === "dag:settings" || k.startsWith("dag:settings@"));
    return JSON.parse(localStorage.getItem(key!) ?? "{}") as { assistant?: { provider?: string; model?: string } };
  });
  expect(saved.assistant).toMatchObject({ provider: "opencode", model: "opencode-go/glm-5.3-flash" });
});

test("on a narrow window it is the list of tabs, then one tab with a way back", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await open(page);
  await page.keyboard.press("Control+Comma");
  const nav = page.locator(".dag-settings-modal__nav");
  const pane = page.locator(".dag-settings-modal__pane");
  await expect(nav).toBeVisible();
  await expect(pane).toBeHidden();
  /* The whole window, not a card in the middle of it. */
  const box = (await page.locator(".dag-settings-modal").boundingBox())!;
  expect(Math.round(box.width)).toBe(390);

  await page.locator('[data-dag-settings-tab-button="preferences"]').click();
  await expect(pane).toBeVisible();
  await expect(nav).toBeHidden();
  await expect(page.locator("[data-dag-setting-theme]")).toBeVisible();
  await expect(page.locator("[data-dag-settings-back]")).toBeFocused();

  await page.locator("[data-dag-settings-back]").click();
  await expect(nav).toBeVisible();
  await expect(page.locator('[data-dag-settings-tab-button="preferences"]')).toBeFocused();
});

test("About says which version this is", async ({ page }) => {
  await open(page);
  await openSettings(page, "about");
  const version = fs.readFileSync(path.join(ROOT, "VERSION"), "utf8").trim();
  await expect(page.locator("[data-dag-setting-version]")).toHaveText(version);
  await expect(page.locator("[data-dag-setting-server]")).toBeVisible();
});

test("its elevation is a soft shadow on paper and a dark one on paper-dark", async ({ page }) => {
  /* The shadow falls outside the card, so the screenshot is the scrim: the card and the space
     around it. The sidebar is away in a fresh context (`global-setup.ts`), so what shows through
     the veil is only this test's scratch board. */
  for (const theme of ["paper", "paper-dark"]) {
    await open(page, `&theme=${theme}`);
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await page.keyboard.press("Control+Comma");
    await expect(dialog(page)).toBeVisible();
    await settingsTab(page, "shortcuts");
    /* Off the tab and its focus ring, and onto the card's blank header: the screenshot is about the
       elevation, not about which control this browser happens to have focused. */
    const pane = page.locator('[data-dag-settings-pane="shortcuts"]');
    const box = (await pane.boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + 12);
    await expect(dialog(page)).toHaveScreenshot(`settings-${theme}.png`);
    await page.keyboard.press("Escape");
    await expect(dialog(page)).toHaveCount(0);
  }
});
