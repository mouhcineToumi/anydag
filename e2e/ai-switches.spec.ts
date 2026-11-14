import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

import { BOARDS } from "./boards";
import { lead } from "./keys";
import { openSettings, openSidebar } from "./sidebar";

/**
 * Turning AI features off (#296): the AI tab's master switch and one switch per feature.
 *
 * **Off means gone.** Each check looks for the control's absence, not for a disabled look: no dock
 * button, no chord, no selection-bar sparkle, no sidebar row, no page. And it holds the one promise
 * that is about the vault rather than the page: a prompt card already in a file is drawn read-only,
 * and nothing writes a byte of the file.
 *
 * The switches are the person's (`dag:ai`), so a check that starts with one off seeds it before the
 * page loads. The suite runs with `dag:sync=off` (`global-setup.ts`), so nothing seeded here reaches
 * the server or another spec.
 */

const DIR = BOARDS;

const BOARD = `---
title: AI switches
---

\`\`\`arch {#svc x=400 y=400}
service api "API" icon=server
db pg "Postgres" icon=postgresql
api --> pg
\`\`\`

\`\`\`prompt {#ask x=80 y=800 w=420}
A browser talking to an API that stores orders in Postgres.
\`\`\`
`;

const QUIZ = "---\ntitle: Postgres\n---\n\n## What is MVCC? {card}\n\n> Multi-version concurrency control.\n";

let name = "";
let board = "";
let quiz = "";
let problems: string[] = [];
test.beforeEach(({ page }, info) => {
  name = `e2e-ai-switches-${info.testId}`;
  board = path.join(DIR, `${name}.board.md`);
  quiz = path.join(DIR, `${name}.quiz.md`);
  fs.writeFileSync(board, BOARD);
  fs.writeFileSync(quiz, QUIZ);
  problems = [];
  page.on("pageerror", (e) => problems.push(String(e)));
});
test.afterEach(() => {
  fs.rmSync(board, { force: true });
  fs.rmSync(quiz, { force: true });
  expect(problems, "page errors").toEqual([]);
});

type Features = Partial<Record<"ai" | "prompts" | "rewrite" | "flashcards" | "assistant", boolean>>;

/** Start every page of this check with these switches, as the AI tab would have stored them. */
async function seed(page: Page, features: Features) {
  await page.addInitScript((f) => localStorage.setItem("dag:ai", JSON.stringify({ features: f })), features);
}

async function open(page: Page) {
  await page.goto(`/?board=${name}`);
  await page.waitForFunction(() => document.documentElement.dataset.dagReady === "1", null, { timeout: 20_000 });
}

async function select(page: Page, id: string) {
  const at = (await page.locator(`[data-dag-item="${id}"]`).boundingBox())!;
  await page.mouse.click(at.x + 6, at.y + 6);
  await expect(page.locator(`[data-dag-item="${id}"][data-dag-selected]`)).toHaveCount(1);
}

const prompts = (page: Page) => page.locator('[data-dag-item][data-dag-type="prompt"]');

test("the master switch hides every AI surface at once, and brings each back", { tag: "@smoke" }, async ({ page }) => {
  await open(page);
  await openSettings(page, "ai");
  const master = page.locator('[data-dag-setting-feature="ai"]');
  await expect(master).toBeChecked();
  await expect(page.locator('[data-dag-settings-tab-button="providers"]')).toBeVisible();

  await master.click();
  await expect(master).not.toBeChecked();
  /* Each feature keeps its own value and waits, disabled, for the master. */
  for (const f of ["prompts", "rewrite", "flashcards", "assistant"]) {
    await expect(page.locator(`[data-dag-setting-feature="${f}"]`)).toBeDisabled();
    await expect(page.locator(`[data-dag-setting-feature="${f}"]`)).toBeChecked();
  }
  /* Nothing left to pick a model for, and no provider to set up. */
  await expect(page.locator("[data-dag-setting-llm-provider]")).toHaveCount(0);
  await expect(page.locator("[data-dag-setting-assistant-provider]")).toHaveCount(0);
  await expect(page.locator('[data-dag-settings-tab-button="providers"]')).toHaveCount(0);
  await expect(page.locator('[data-dag-settings-tab-button="ai"]')).toBeVisible();
  await page.keyboard.press("Escape");

  await expect(page.locator("[data-dag-dock-prompt]")).toHaveCount(0);
  await expect(page.locator("[data-dag-sidebar-assistant]")).toHaveCount(0);
  await expect(page.locator("[data-dag-assistant-toggle]")).toHaveCount(0);
  /* The card in the file is still drawn: what was asked, with nothing to run. */
  await expect(prompts(page)).toHaveCount(1);
  await expect(page.locator(".dag-prompt--still")).toContainText("A browser talking to an API");
  await expect(page.locator("[data-dag-prompt-go]")).toHaveCount(0);
  await select(page, "svc");
  await expect(page.locator("[data-dag-rewrite-open]")).toHaveCount(0);

  /* Back on, every feature as it was. */
  await openSettings(page, "ai");
  await master.click();
  await page.keyboard.press("Escape");
  await expect(page.locator("[data-dag-dock-prompt]")).toBeVisible();
  await expect(page.locator("[data-dag-sidebar-assistant]")).toBeVisible();
  await expect(page.locator("[data-dag-prompt-go]")).toBeVisible();

  /* Turning features off and on wrote nothing to the board. */
  expect(fs.readFileSync(board, "utf8")).toBe(BOARD);
});

test("prompt cards off: no dock button, no chord, no library entry, and the card is read-only", async ({ page }) => {
  await seed(page, { prompts: false });
  await open(page);
  await expect(page.locator("[data-dag-dock-prompt]")).toHaveCount(0);
  await expect(page.locator("[data-dag-prompt-go]")).toHaveCount(0);
  await expect(page.locator("[data-dag-prompt-text]")).toHaveCount(0);

  await page.locator(".dag-viewport").focus();
  await lead(page, "p");
  /* Nothing was added: the chord is gone with the feature. */
  await expect(prompts(page)).toHaveCount(1);

  await page.locator("[data-dag-library-toggle]").click();
  await expect(page.locator("[data-dag-library] [data-dag-component]").first()).toBeVisible();
  await expect(page.locator('[data-dag-library] [data-dag-component="prompt"]')).toHaveCount(0);
  await page.locator("[data-dag-library-toggle]").click();

  /* The other features are untouched. */
  await select(page, "svc");
  await expect(page.locator("[data-dag-rewrite-open]")).toBeVisible();
  expect(fs.readFileSync(board, "utf8")).toBe(BOARD);
});

test("Change with AI off: the selection bar has no sparkle and no model chip", async ({ page }) => {
  await seed(page, { rewrite: false });
  await open(page);
  await select(page, "svc");
  await expect(page.locator("[data-dag-selbar]")).toBeVisible();
  await expect(page.locator("[data-dag-rewrite-open]")).toHaveCount(0);
  await expect(page.locator("[data-dag-selbar] [data-dag-model-chip]")).toHaveCount(0);
  await expect(page.locator("[data-dag-dock-prompt]")).toBeVisible();
});

test("Generate flashcards off: the quiz editor offers only the questions a person writes", async ({ page }) => {
  await seed(page, { flashcards: false });
  await page.goto(`/?quiz=${name}`);
  await expect(page.locator("[data-dag-quiz-question]")).toHaveCount(1);
  await expect(page.locator("[data-dag-quiz-add-flashcard]")).toBeVisible();
  await expect(page.locator("[data-dag-quiz-generate]")).toHaveCount(0);
});

test("the Assistant off: no row, no sparkle, no chord, and its address opens home", async ({ page }) => {
  await seed(page, { assistant: false });
  await page.goto("/?tasks=1");
  await openSidebar(page);
  await expect(page.locator("[data-dag-sidebar-tasks]")).toBeVisible();
  await expect(page.locator("[data-dag-sidebar-assistant]")).toHaveCount(0);
  await expect(page.locator("[data-dag-assistant-toggle]")).toHaveCount(0);
  await page.locator("body").press(" ");
  await page.locator("body").press("a");
  await expect(page.locator("[data-dag-assistant-panel]")).toHaveCount(0);

  await page.goto("/?chat=new");
  await expect(page.locator("[data-dag-welcome]")).toBeVisible();
  await expect(page.locator("[data-dag-assistant-page]")).toHaveCount(0);
});

test("the Assistant turned off while its panel is open shuts the panel", async ({ page }) => {
  await page.goto("/?tasks=1");
  await page.locator("[data-dag-assistant-toggle]").click();
  await expect(page.locator("[data-dag-assistant-panel]")).toBeVisible();
  await openSettings(page, "ai");
  await page.locator('[data-dag-setting-feature="assistant"]').click();
  await page.keyboard.press("Escape");
  await expect(page.locator("[data-dag-assistant-panel]")).toHaveCount(0);
  await expect(page.locator("[data-dag-assistant-toggle]")).toHaveCount(0);
});

test("the shortcut sheet does not list a chord whose feature is off", async ({ page }) => {
  await seed(page, { ai: false });
  await open(page);
  await page.locator(".dag-viewport").focus();
  await lead(page, "?");
  const sheet = page.locator("[data-dag-shortcuts]");
  await expect(sheet).toBeVisible();
  await expect(sheet).toContainText("A note under the pointer");
  await expect(sheet).not.toContainText("A prompt card");
  await expect(sheet).not.toContainText("The Assistant");
});
