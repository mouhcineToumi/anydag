import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { exportAs, openExport } from "./export";
import { openSettings, settingsTab, type SettingsTab } from "./sidebar";
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
  await openSettings(page, "vault-files");

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
  await openSettings(page, "vault-files");
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

  await settingsTab(page, "appearance");
  await page.locator("[data-dag-setting-theme]").selectOption("neutral");
  await settingsTab(page, "vault-general");
  await page.locator("[data-dag-setting-problems]").selectOption("off");

  await settingsTab(page, "vault-files");
  await page.locator("[data-dag-setting-paste-size]").selectOption("width");
  await expect(page.locator("[data-dag-setting-paste-width]")).toBeVisible();

  /* The paste controls and the attachments folder are this tab's; the theme and the problems row
     are not, even though they used to share one Preferences tab. */
  await page.locator("[data-dag-setting-reset]").click();
  await expect(page.locator("[data-dag-setting-paste-size]")).toHaveValue("screen");
  /* The fixed-width field is only there for the rule that uses it. */
  await expect(page.locator("[data-dag-setting-paste-width]")).toHaveCount(0);

  await settingsTab(page, "vault-general");
  await expect(page.locator("[data-dag-setting-problems]")).toHaveValue("off");

  /* General's reset covers the problems row, and nothing on Appearance or Export. */
  await page.locator("[data-dag-setting-reset]").click();
  await expect(page.locator("[data-dag-setting-problems]")).toHaveValue("notify");

  /* The theme is the person's and has its own tab (#191); its reset puts the default back. */
  await settingsTab(page, "appearance");
  await expect(page.locator("[data-dag-setting-theme]")).toHaveValue("neutral");
  await page.locator("[data-dag-setting-reset]").click();
  await expect(page.locator("[data-dag-setting-theme]")).toHaveValue("paper");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "paper");

  await settingsTab(page, "export");
  await expect(page.locator("[data-dag-setting-export-scale]")).toHaveValue("4");
  await page.locator("[data-dag-setting-reset]").click();
  await expect(page.locator("[data-dag-setting-export-scale]")).toHaveValue("2");
});

test("a change says Saved, and a reset's Undo puts the value back after a reload", async ({ page }) => {
  await open(page);
  await openSettings(page, "export");
  const scale = page.locator("[data-dag-setting-export-scale]");

  await scale.selectOption("4");
  /* The row that changed says so, and the tick goes away on its own. */
  const saved = page.locator('[data-dag-settings-pane="export"] [data-dag-setting-saved]');
  await expect(saved).toContainText("Saved");
  await expect(saved).toHaveCount(0, { timeout: 5_000 });

  await page.locator("[data-dag-setting-reset]").click();
  const toast = page.locator("[data-dag-setting-reset-toast]");
  await expect(toast).toContainText("Export reset");
  await expect(scale).toHaveValue("2");

  await toast.locator("[data-dag-setting-reset-undo]").click();
  await expect(scale).toHaveValue("4");
  await expect(toast).toHaveCount(0);

  /* Undo wrote through the same setter as the control, so the value is a preference like any other. */
  await open(page);
  await openSettings(page, "export");
  await expect(page.locator("[data-dag-setting-export-scale]")).toHaveValue("4");
});

test("a board's theme: changes nothing; the reader's choice and the snapshot default do", async ({ page }) => {
  /* The fixture carries `theme: paper-dark`; the app's default is paper. */
  await open(page);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "paper");
  /* Opening it wrote nothing. */
  expect(fs.readFileSync(file, "utf8")).toBe(BOARD);

  /* The reader's own choice is what draws the board now. */
  await openSettings(page, "appearance");
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

test("the arrow keys walk the tabs across every group, and the last tab is where it opens next", async ({ page }) => {
  await open(page);
  await page.keyboard.press("Control+Comma");
  await expect(dialog(page)).toBeVisible();
  const selected = page.locator('[data-dag-settings] [role="tab"][aria-selected="true"]');
  /* Nothing remembered in a fresh browser: the first tab, with the focus on it. */
  await expect(selected).toHaveAttribute("data-dag-settings-tab-button", "appearance");
  await expect(selected).toBeFocused();
  await expect(page.locator('[data-dag-settings-pane="appearance"] [data-dag-setting-theme]')).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await expect(selected).toHaveAttribute("data-dag-settings-tab-button", "ai");
  await page.keyboard.press("ArrowDown");

  /* The calendar's tab. */
  await expect(selected).toHaveAttribute("data-dag-settings-tab-button", "calendar");
  await expect(page.locator('[data-dag-settings-pane="calendar"] [data-dag-setting-week-start]')).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await expect(selected).toHaveAttribute("data-dag-settings-tab-button", "quizzes");
  await expect(page.locator('[data-dag-settings-pane="quizzes"] [data-dag-setting-graduate]')).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await expect(selected).toHaveAttribute("data-dag-settings-tab-button", "providers");
  await page.keyboard.press("ArrowDown");
  /* Out of This computer and into This vault, as though the heading were not there. */
  await expect(selected).toHaveAttribute("data-dag-settings-tab-button", "vault-general");
  await expect(selected).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(selected).toHaveAttribute("data-dag-settings-tab-button", "vault-files");
  /* The vault's remaining tabs, then This board, then the foot: one walk in drawn order. */
  await page.locator('[data-dag-settings-tab-button="agent-access"]').click();
  await page.keyboard.press("ArrowDown");
  await expect(selected).toHaveAttribute("data-dag-settings-tab-button", "board-layout");
  await expect(page.locator('[data-dag-settings-pane="board-layout"] [data-dag-board-flow-width]')).toBeVisible();
  await page.keyboard.press("End");
  /* The reference pages are tabs too, walked after the last group. */
  await expect(selected).toHaveAttribute("data-dag-settings-tab-button", "about");
  await expect(page.locator('[data-dag-settings-pane="about"] [data-dag-setting-version]')).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await expect(selected).toHaveAttribute("data-dag-settings-tab-button", "appearance");
  await page.keyboard.press("ArrowUp");
  await expect(selected).toHaveAttribute("data-dag-settings-tab-button", "about");

  await page.locator('[data-dag-settings-tab-button="ai"]').click();
  await page.keyboard.press("Escape");
  await expect(dialog(page)).toHaveCount(0);
  await page.keyboard.press("Control+Comma");
  await expect(selected).toHaveAttribute("data-dag-settings-tab-button", "ai");

  /* And it survives a reload: this browser remembers it. */
  await page.keyboard.press("Escape");
  await open(page);
  await openSettings(page);
  await expect(selected).toHaveAttribute("data-dag-settings-tab-button", "ai");
});

test("every tab says which scope it belongs to, under a heading that says what it means", async ({ page }) => {
  await open(page);
  await openSettings(page);

  const scopes: [SettingsTab, string][] = [
    ["appearance", "You"],
    ["ai", "You"],
    ["calendar", "You"],
    ["quizzes", "You"],
    ["providers", "This computer"],
    ["vault-general", "This vault"],
    ["vault-files", "This vault"],
    ["export", "This vault"],
    ["sync", "This vault"],
    ["agent-access", "This vault"],
    ["board-layout", "This board"],
    ["privacy", "This computer"],
    ["shortcuts", "You"],
    ["about", "This computer"],
  ];
  for (const [tab, scope] of scopes) {
    await settingsTab(page, tab);
    await expect(page.locator("[data-dag-settings-scope]"), tab).toHaveText(scope);
  }

  await expect(page.locator('[data-dag-settings-group="you"] .dag-settings-modal__heading')).toHaveText("You");
  await expect(page.locator('[data-dag-settings-group="computer"] .dag-settings-modal__heading')).toHaveText("This computer");
  await expect(page.locator('[data-dag-settings-group="vault"] .dag-settings-modal__heading')).toHaveText("This vault");
  await expect(page.locator('[data-dag-settings-group="vault"] .dag-settings-modal__note')).toContainText(
    "Another vault has its own.",
  );
  await expect(page.locator('[data-dag-settings-group="board"] .dag-settings-modal__heading')).toHaveText("This board");
  await expect(page.locator('[data-dag-settings-group="board"] .dag-settings-modal__note')).toContainText(
    "Saved in this board's file. Another board has its own.",
  );
});

test("a press outside it, the close button and ctrl+, close it, and Tab stays inside", async ({ page }) => {
  await open(page);
  await openSettings(page, "vault-general");
  /* The corner of the window is the scrim: the modal is over everything, the sidebar included. */
  await page.mouse.click(4, 600);
  await expect(dialog(page)).toHaveCount(0);

  await page.keyboard.press("Control+Comma");
  await page.locator("[data-dag-settings-close]").click();
  await expect(dialog(page)).toHaveCount(0);

  /* ctrl+, from a control inside it — where the page's own handler cannot hear it. */
  await page.keyboard.press("Control+Comma");
  await page.locator("[data-dag-setting-problems]").focus();
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
  await openSettings(page, "ai");
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

  /* The person's, in every vault (#191): kept under `dag:ai`, not in the vault's settings. */
  const saved = await page.evaluate(
    () => JSON.parse(localStorage.getItem("dag:ai") ?? "{}") as { llm?: { provider?: string; model?: string } },
  );
  expect(saved.llm).toMatchObject({ provider: "opencode", model: "opencode-go/glm-5.3-flash" });

  /* The popover is fixed to the viewport, so a phone-width window still holds the whole of it.
     At phone width the AI tab is one row per feature, so the picker is behind the diagrams row. */
  await page.setViewportSize({ width: 390, height: 800 });
  await page.locator('[data-dag-setting-ai-feature="diagrams"]').click();
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
  await openSettings(page, "ai");
  const picker = page.locator("[data-dag-setting-assistant-model]");
  await picker.click();
  await page.locator("[data-dag-model-search]").fill("glm");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(picker).toContainText("GLM 5.3 Flash");
  await expect(page.locator("[data-dag-setting-assistant-provider]")).toHaveValue("opencode");

  /* The person's, in every vault (#191): kept under `dag:ai`, not in the vault's settings. */
  const saved = await page.evaluate(
    () => JSON.parse(localStorage.getItem("dag:ai") ?? "{}") as { assistant?: { provider?: string; model?: string } },
  );
  expect(saved.assistant).toMatchObject({ provider: "opencode", model: "opencode-go/glm-5.3-flash" });
});

test("Agent access changes the command with Read only, for each client", async ({ page }) => {
  await open(page);
  await openSettings(page, "agent-access");
  const code = page.locator('[data-dag-setting-copy-value="mcp-claude-code"]');
  await expect(code).toContainText("anydag mcp --vault");
  await expect(code).not.toContainText("--read-only");

  await page.locator("[data-dag-setting-agent-readonly]").click();
  await expect(code).toContainText("--read-only");

  await page.locator('[data-dag-agent-client="claude-desktop"]').click();
  const json = page.locator('[data-dag-setting-copy-value="mcp-claude-desktop"]');
  await expect(json).toBeVisible();
  const parsed = JSON.parse((await json.textContent()) ?? "{}") as {
    mcpServers: { anydag: { args: string[] } };
  };
  expect(parsed.mcpServers.anydag.args).toContain("--read-only");

  await page.locator('[data-dag-agent-client="other"]').click();
  await expect(page.locator('[data-dag-setting-copy-value="mcp-other-client"]')).toContainText("--read-only");
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

  await page.locator('[data-dag-settings-tab-button="vault-general"]').click();
  await expect(pane).toBeVisible();
  await expect(nav).toBeHidden();
  await expect(page.locator("[data-dag-setting-problems]")).toBeVisible();
  await expect(page.locator("[data-dag-settings-back]")).toBeFocused();

  await page.locator("[data-dag-settings-back]").click();
  await expect(nav).toBeVisible();
  await expect(page.locator('[data-dag-settings-tab-button="vault-general"]')).toBeFocused();
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

test("the AI tab wears the prompt card's look in every theme", async ({ page }) => {
  /* Both lists are fixed so the picture is the tab's look and not this machine's sign-ins: Claude
     Code ready for the diagrams, and the Assistant on the same. */
  const llm = providerList();
  llm.providers[0] = { ...llm.providers[0], ready: true, error: undefined, reason: undefined } as (typeof llm.providers)[0];
  await page.route("**/__board/llm*", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(llm) }));
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
        ],
      }),
    }),
  );
  for (const theme of ["neutral", "paper", "paper-dark"]) {
    await open(page, `&theme=${theme}`);
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await openSettings(page, "ai");
    const pane = page.locator('[data-dag-settings-pane="ai"]');
    await expect(pane.locator(".dag-settings__group--prompt")).toHaveCount(2);
    await expect(pane.locator("[data-dag-setting-assistant-hint]")).toBeVisible();
    /* Off any control and its focus ring, as the elevation picture does. */
    const box = (await pane.boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + 4);
    await expect(pane).toHaveScreenshot(`settings-ai-${theme}.png`);
    await page.keyboard.press("Escape");
    await expect(dialog(page)).toHaveCount(0);
  }
});

/** A `/__board/llm` answer with one provider in each state the pill knows: three rows remain. */
function providerList(over: { customReady?: boolean } = {}) {
  const row = (id: string, label: string, kind: "cli" | "http", keyEnv: string[], ready: boolean, code?: string) => ({
    id,
    label,
    description: `${label}, as described.`,
    kind,
    keyEnv,
    defaultModel: "m",
    models: [],
    ready,
    ...(ready ? {} : { error: `${label} is not ready`, reason: { code, provider: id, ...(keyEnv.length ? { keyEnv } : {}) } }),
  });
  return {
    default: "claude",
    providers: [
      row("claude", "Claude Code", "cli", [], false, "not-signed-in"),
      row("opencode", "OpenCode", "cli", [], false, "not-installed"),
      row("custom", "OpenAI-compatible", "http", ["ANYDAG_LLM_API_KEY"], over.customReady ?? false, "needs-base-url"),
    ],
  };
}

test("every provider's state reads as a pill, Check again asks afresh, and the tab carries a dot", async ({ page }) => {
  const asked: string[] = [];
  await page.route("**/__board/llm*", (route) => {
    asked.push(route.request().url());
    return route.fulfill({ contentType: "application/json", body: JSON.stringify(providerList()) });
  });
  await open(page);
  await openSettings(page, "providers");
  const pill = (id: string) => page.locator(`[data-dag-provider="${id}"] [data-dag-provider-pill]`);
  await expect(pill("claude")).toHaveText("Not signed in");
  await expect(pill("opencode")).toHaveText("Not installed");
  await expect(pill("custom")).toHaveText("Needs an address");
  /* Claude Code is the default and is not signed in, so the tab that can fix it says so. */
  await expect(page.locator('[data-dag-settings-tab-button="providers"] [data-dag-settings-attention]')).toBeVisible();
  /* A browser has no field to type a key in: it names the variable the server reads. */
  await expect(page.locator('[data-dag-provider="custom"] [data-dag-provider-env]')).toContainText("ANYDAG_LLM_API_KEY");
  await expect(page.locator("[data-dag-provider] input")).toHaveCount(0);

  await page.locator("[data-dag-providers-check]").click();
  await expect.poll(() => asked.some((u) => new URL(u).searchParams.get("fresh") === "1")).toBe(true);
});

test("in the app, a key is saved in its own row and tested with one short call", async ({ page }) => {
  await page.addInitScript(() => {
    const stored = new Set<string>();
    const env: Record<string, string> = {};
    const w = window as unknown as { anydagDesktop: unknown; desktopCalls: string[] };
    w.desktopCalls = [];
    w.anydagDesktop = {
      keys: {
        set: async (name: string) => {
          w.desktopCalls.push(`key:${name}`);
          stored.add(name);
          return true;
        },
        unset: async (name: string) => {
          stored.delete(name);
          return true;
        },
        names: async () => [...stored],
      },
      providerEnv: {
        get: async () => ({ ...env }),
        set: async (name: string, value: string) => {
          w.desktopCalls.push(`env:${name}=${value}`);
          env[name] = value;
          return true;
        },
      },
    };
  });
  let saved = false;
  /* The page adds `?vault=` to what it asks, so the routes match by pattern rather than glob. */
  await page.route(/\/__board\/llm\/test(\?|$)/, (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ ok: true, provider: "custom", model: "qwen3:32b", ms: 1200 }),
    }),
  );
  await page.route(/\/__board\/llm(\?|$)/, (route) =>
    route.fulfill({ contentType: "application/json", body: JSON.stringify(providerList({ customReady: saved })) }),
  );
  await open(page);
  await openSettings(page, "providers");

  /* OpenAI-compatible is the one keyed row left: it takes a key, an address and a model, and
     refuses an address that is not http(s). */
  const custom = page.locator('[data-dag-provider="custom"]');
  await custom.locator('[data-dag-setting-key="ANYDAG_LLM_API_KEY"] input').fill("sk-test");
  await custom.locator("input[data-dag-provider-base-url]").fill("ftp://nope");
  await expect(custom.locator("[data-dag-provider-save]")).toBeDisabled();
  await custom.locator("input[data-dag-provider-base-url]").fill("http://localhost:11434/v1");
  await custom.locator("input[data-dag-provider-model]").fill("qwen3:32b");
  saved = true;
  await custom.locator("[data-dag-provider-save]").click();
  await expect(custom.locator("[data-dag-provider-test]")).toHaveText("qwen3:32b answered in 1.2 s.");
  await expect(custom.locator("[data-dag-provider-pill]")).toHaveText("Ready");
  /* The key went to the shell, and the field let go of it: it is never shown again. */
  expect(await page.evaluate(() => (window as unknown as { desktopCalls: string[] }).desktopCalls)).toContain(
    "key:ANYDAG_LLM_API_KEY",
  );
  await expect(custom.locator('[data-dag-setting-key="ANYDAG_LLM_API_KEY"] input')).toHaveValue("");
  expect(await page.evaluate(() => (window as unknown as { desktopCalls: string[] }).desktopCalls)).toEqual(
    expect.arrayContaining(["env:ANYDAG_LLM_BASE_URL=http://localhost:11434/v1", "env:ANYDAG_LLM_MODEL=qwen3:32b"]),
  );
});
