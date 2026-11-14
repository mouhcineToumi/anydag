import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

import { BOARDS } from "./boards";
import { lead } from "./keys";
import { newFile, openSettings } from "./sidebar";

/**
 * Note templates: **New note from template** — the sidebar's New menu, the search card's miss and
 * the leader key — and what a template is left out of.
 *
 * A template is an ordinary note in the vault's templates folder, which is a *vault* setting, so the
 * tests of this file run one after another (`serial`) and each names a folder of its own, inside its
 * own test folder, through the vault's settings route and puts the setting back. Sync is off in the
 * suite, so the Settings field is held to the key it writes; the route's half is in
 * `test/server/templates.test.ts`.
 */

test.describe.configure({ mode: "serial" });

let folder = "";
let dir = "";
let tpl = "";
let problems: string[] = [];

test.beforeEach(({ page }, info) => {
  folder = `e2e-templates-${info.testId}`;
  dir = path.join(BOARDS, folder);
  tpl = `${folder}/Templates`;
  fs.mkdirSync(dir, { recursive: true });
  problems = [];
  page.on("console", (msg) => {
    if (msg.type() === "error" || msg.type() === "warning") problems.push(msg.text());
  });
  page.on("pageerror", (e) => problems.push(String(e)));
});

test.afterEach(async ({ page }) => {
  /* The setting first, then only the folder this test made, and only when it knows which. */
  await templatesFolder(page, null);
  if (folder) fs.rmSync(dir, { recursive: true, force: true });
  folder = "";
  expect(problems, "console output").toEqual([]);
});

/** The vault's bundle as the server holds it, with `dag:templates` set to `name` — or taken out. */
async function templatesFolder(page: Page, name: string | null): Promise<void> {
  const got = (await (await page.request.get("/api/vault/settings")).json()) as { settings: Record<string, unknown> | null };
  const next = { ...(got.settings ?? {}) };
  if (name === null) delete next["dag:templates"];
  else next["dag:templates"] = name;
  expect((await page.request.put("/api/vault/settings", { data: { settings: next } })).ok()).toBe(true);
}

const put = (rel: string, text: string): void => {
  fs.mkdirSync(path.dirname(path.join(BOARDS, rel)), { recursive: true });
  fs.writeFileSync(path.join(BOARDS, rel), text);
};
const read = (rel: string): string => fs.readFileSync(path.join(BOARDS, rel), "utf8");

/** The days a note made around now may say it is, as the server reads them — a midnight between is allowed for. */
const days = (from: Date, to: Date): string[] => [...new Set([from, to].map((d) => d.toLocaleDateString("sv")))];

async function ready(page: Page) {
  await page.waitForFunction(() => document.documentElement.dataset.dagReady === "1", null, { timeout: 20_000 });
}

/** A note open, so the New menu makes in its folder and the page has no caret in a text. */
async function openAnchor(page: Page): Promise<void> {
  put(`${folder}/anchor.md`, "# Anchor\n");
  await page.goto(`/?note=${folder}/anchor`);
  await ready(page);
}

/** The note the page is on — the address writes its `/` as `%2F`. */
const opened = (page: Page, name: string) => expect.poll(() => new URL(page.url()).searchParams.get("note")).toBe(name);

const picker = (page: Page) => page.locator("[data-dag-templates]");

test("New note from template makes a note with the variables filled in, and opens it", { tag: "@smoke" }, async ({ page }) => {
  put(`${tpl}/Meeting.md`, "---\ntags: [meeting]\n---\n# {{title}}\n\nOn {{date}} at {{time}}.\n\nLeft as written: {{note}}\n");
  await templatesFolder(page, tpl);
  await openAnchor(page);

  const before = new Date();
  await newFile(page, "template");
  await expect(picker(page)).toBeVisible();
  /* The title is asked for first, with the caret in it. */
  await expect(page.locator("[data-dag-templates-title]")).toBeFocused();
  await page.locator("[data-dag-templates-title]").fill("Standup");
  await page.locator(`[data-dag-template="${tpl}/Meeting"]`).click();
  const after = new Date();

  await opened(page, `${folder}/Standup`);
  await expect(picker(page)).toHaveCount(0);
  await expect.poll(() => fs.existsSync(path.join(dir, "Standup.md"))).toBe(true);
  const text = read(`${folder}/Standup.md`);
  expect(text).toContain("tags: [meeting]");
  expect(text).toContain("# Standup\n");
  expect(text).toMatch(new RegExp(`On (${days(before, after).join("|")}) at \\d\\d:\\d\\d\\.`));
  expect(text).toContain("Left as written: {{note}}");
  expect(text).not.toContain("{{title}}");
  /* The template is as it was. */
  expect(read(`${tpl}/Meeting.md`)).toContain("{{title}}");
  /* Named already, so the page asks no second question. */
  await expect(page.locator("[data-dag-note-title]")).toHaveValue("Standup");
});

test("with no title the note starts Untitled, and its title is the first thing asked for", async ({ page }) => {
  put(`${tpl}/Blank.md`, "Body.\n");
  await templatesFolder(page, tpl);
  await openAnchor(page);
  await newFile(page, "template");
  /* One template, so Enter in the title field makes it. */
  await page.locator("[data-dag-templates-title]").press("Enter");
  await opened(page, `${folder}/Untitled`);
  await expect(page.locator("[data-dag-note-title]")).toBeFocused();
  await expect.poll(() => fs.existsSync(path.join(dir, "Untitled.md"))).toBe(true);
});

test("a template that carries a status makes a task, and the template is never on the Tasks page", async ({ page }) => {
  put(`${tpl}/Chore.md`, "---\nstatus: todo\ndue: {{date:YYYY-MM-DD}}\n---\n# {{title}}\n");
  await templatesFolder(page, tpl);
  await openAnchor(page);
  await newFile(page, "template");
  await page.locator("[data-dag-templates-title]").fill("Ship it");
  await expect(page.locator(`[data-dag-template="${tpl}/Chore"]`)).toHaveAttribute("data-dag-template-makes", "task");
  await page.locator(`[data-dag-template="${tpl}/Chore"]`).click();
  await opened(page, `${folder}/Ship it`);
  await expect.poll(() => fs.existsSync(path.join(dir, "Ship it.md"))).toBe(true);
  expect(read(`${folder}/Ship it.md`)).toMatch(/^---\nstatus: todo\ndue: \d{4}-\d\d-\d\d\nid: \w+\n---\n/);

  await page.goto("/?tasks=1");
  await page.locator("[data-dag-tasks-filter]").fill(folder);
  await expect(page.locator(`[data-dag-task-row="${folder}/Ship it"]`)).toBeVisible();
  /* The template carries a status too, and is not a row. */
  await expect(page.locator(`[data-dag-task-row="${tpl}/Chore"]`)).toHaveCount(0);
});

test("a template that carries a date is not on the calendar", async ({ page }) => {
  const day = new Date().toLocaleDateString("sv");
  put(`${tpl}/Trip.md`, `---\nstart: ${day}\n---\nA template.\n`);
  put(`${folder}/real.md`, `---\nstart: ${day}\n---\nAn event.\n`);
  await templatesFolder(page, tpl);
  await page.goto(`/?calendar=month&date=${day}`);
  await expect(page.locator("[data-dag-calendar]")).toBeVisible();
  await expect(page.locator(`[data-dag-cal-item="${folder}/real"]`).first()).toBeVisible({ timeout: 15_000 });
  await expect(page.locator(`[data-dag-cal-item="${tpl}/Trip"]`)).toHaveCount(0);
});

test("the leader key opens the picker on a note, Escape leaves it, and nothing is made", async ({ page }) => {
  put(`${tpl}/Meeting.md`, "# {{title}}\n");
  await templatesFolder(page, tpl);
  await openAnchor(page);
  const before = fs.readdirSync(dir).sort();
  await lead(page, "m");
  await expect(picker(page)).toBeVisible();
  await expect(page.locator(`[data-dag-template="${tpl}/Meeting"]`)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(picker(page)).toHaveCount(0);
  expect(fs.readdirSync(dir).sort()).toEqual(before);
});

test("with no templates it says so, and writes the starters only when asked", async ({ page }) => {
  await templatesFolder(page, tpl);
  await openAnchor(page);
  await lead(page, "m");
  await expect(page.locator("[data-dag-templates-empty]")).toBeVisible();
  /* Opening the vault, and the dialog, wrote nothing. */
  expect(fs.existsSync(path.join(BOARDS, tpl))).toBe(false);

  await page.locator("[data-dag-templates-starters]").click();
  for (const name of ["ADR", "Daily", "Meeting"])
    await expect(page.locator(`[data-dag-template="${tpl}/${name}"]`)).toBeVisible();
  expect(fs.readdirSync(path.join(BOARDS, tpl)).sort()).toEqual(["ADR.md", "Daily.md", "Meeting.md"]);

  /* A starter makes a plain note named by the title typed. */
  await page.locator("[data-dag-templates-title]").fill("Retro");
  await page.locator(`[data-dag-template="${tpl}/Meeting"]`).click();
  await expect.poll(() => fs.existsSync(path.join(dir, "Retro.md"))).toBe(true);
  expect(read(`${folder}/Retro.md`)).not.toContain("{{");
});

test("the templates folder is set in Settings, under Files and images", async ({ page }) => {
  await openAnchor(page);
  await openSettings(page, "vault-files");
  const field = page.locator("[data-dag-setting-templates]");
  await expect(field).toHaveAttribute("placeholder", "Templates");
  await field.fill("Notes/Mine/");
  await field.press("Enter");
  await expect(field).toHaveValue("Notes/Mine");
  const kept = await page.evaluate(() =>
    Object.keys(localStorage)
      .filter((k) => k === "dag:templates" || k.startsWith("dag:templates@"))
      .map((k) => localStorage.getItem(k)),
  );
  expect(kept).toEqual(["Notes/Mine"]);
  /* A folder that leaves the vault is refused, and nothing is stored. */
  await field.fill("../elsewhere");
  await field.press("Enter");
  await expect(page.locator("[data-dag-setting-templates-problem]")).toBeVisible();
  /* Reset puts it back to the default. */
  await page.locator("[data-dag-setting-reset]").click();
  await expect(field).toHaveValue("");
});
