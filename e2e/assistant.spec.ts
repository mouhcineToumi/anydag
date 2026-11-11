import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

import { BOARDS } from "./boards";
import { openSidebar } from "./sidebar";

/**
 * The Assistant: the page, the panel and the composer, against the **fake
 * harness** (`ANYDAG_CHAT_FAKE=1`, which `playwright.config.ts` sets for the dev server it starts).
 * The fake reaches the vault the way a real agent does — over HTTP, with the chat's header, through
 * the guard, the approvals and the recorder — so these checks are of everything but the model.
 *
 * **It must never reach a real model**, and a dev server somebody left running is reused by the
 * suite, so `beforeAll` asks `/__board/chat/models` whether the server is the fake, and skips the
 * whole file when it is not.
 *
 * Serial, because a vault's newest chat is what the panel opens, and a second worker making chats in
 * it would change which that is. Every note a check makes is named for this run and removed after.
 */

test.describe.configure({ mode: "serial" });

const run = Date.now().toString(36);
const stems: string[] = [];
const chats: string[] = [];
let fake = false;

/* A note is a plain `.md` in a vault, and a board is `.board.md` (`server/names.ts`). */
const noteFile = (stem: string) => path.join(BOARDS, `${stem}.md`);

/** A name for a note this run owns, remembered for the cleanup. */
function stem(label: string): string {
  const s = `e2e-chat-${run}-${label}`;
  stems.push(s);
  return s;
}

async function forget(request: APIRequestContext, id: string) {
  await request.post("/__board/chat/stop", { data: { id } }).catch(() => undefined);
  await request.post("/__board/chat/delete", { data: { id } }).catch(() => undefined);
}

test.beforeAll(async ({ request }) => {
  /* Only a server running the scripted harness says `fake` — a reused dev server that is not one
     would send these words to a real model on the person's subscription. */
  const models = (await (await request.get("/__board/chat/models")).json()) as { fake?: boolean };
  fake = models.fake === true;
});

test.beforeEach(({}, info) => {
  info.skip(!fake, "the server is not running the fake harness (ANYDAG_CHAT_FAKE=1)");
});

test.afterAll(async ({ request }) => {
  /* Chats first: a chat in a vault that is closed before its chat is deleted cannot be found. */
  for (const id of chats.splice(0)) await forget(request, id);
  for (const id of made.splice(0)) {
    await request.post("/api/vaults/close", { data: { id, forget: true } }).catch(() => undefined);
  }
  for (const p of parents.splice(0)) fs.rmSync(p, { recursive: true, force: true });
  for (const s of stems.splice(0)) {
    if (!s.startsWith(`e2e-chat-${run}-`)) continue;
    fs.rmSync(noteFile(s), { force: true });
    fs.rmSync(path.join(BOARDS, `${s}.board.md`), { force: true });
  }
});

let problems: string[] = [];
test.beforeEach(({ page }) => {
  problems = [];
  page.on("console", (msg) => {
    if (msg.type() === "error" || msg.type() === "warning") problems.push(msg.text());
  });
  page.on("pageerror", (e) => problems.push(String(e)));
});
test.afterEach(() => {
  expect(problems, "console output").toEqual([]);
});

/** Type into the composer and send with Enter. */
async function say(page: Page, text: string) {
  await page.locator("[data-dag-chat-input]").fill(text);
  await page.locator("[data-dag-chat-input]").press("Enter");
}

/** The chat the page is on, once the first message has made it. */
async function chatId(page: Page): Promise<string> {
  await expect(page).toHaveURL(/chat=c[0-9a-z]+/);
  const id = new URL(page.url()).searchParams.get("chat")!;
  chats.push(id);
  return id;
}

test("the sidebar's Assistant row opens the page, and a first message makes the chat", async ({ page }) => {
  await page.goto("/?tasks=1");
  await openSidebar(page);
  await page.locator("[data-dag-sidebar-assistant]").click();
  await expect(page.locator("[data-dag-assistant-page]")).toBeVisible();
  await expect(page).toHaveURL(/chat=/);

  await page.goto("/?chat=new");
  await expect(page.locator("[data-dag-chat-welcome]")).toBeVisible();
  await say(page, "hello there");
  const id = await chatId(page);
  const turn = page.locator("[data-dag-chat-turn]");
  await expect(turn.locator("[data-dag-chat-asked]")).toHaveText("hello there");
  await expect(turn).toHaveAttribute("data-dag-chat-status", "done");
  await expect(turn.locator("[data-dag-chat-said]")).toContainText("You said: hello there");
  /* The turn's header names the model that wrote it, which is how a switch shows in the history. */
  await expect(turn.locator("[data-dag-chat-model]")).toContainText(/Claude Code|OpenCode/);
  /* The history lists it, under today. */
  await expect(page.locator(`[data-dag-chat-row="${id}"]`)).toBeVisible();
  await expect(page.locator('[data-dag-chat-day="Today"]')).toBeVisible();
});

test("a fresh page greets with a centred composer, and a panel chat joins the history", async ({ page }) => {
  await page.goto("/?chat=new");
  const welcome = page.locator("[data-dag-chat-welcome]");
  const input = page.locator("[data-dag-chat-input]");
  await expect(welcome).toBeVisible();
  await expect(welcome.getByRole("heading", { name: "What can I help you with?" })).toBeVisible();
  await expect(input).toBeFocused();
  /* One New chat control, not a button and a heading with the same words. */
  await expect(page.locator("[data-dag-chat-title]")).toHaveCount(0);
  /* The composer sits in the middle of the main area, not only in the middle of its column. */
  const area = (await page.locator(".dag-assistant__main").boundingBox())!;
  const box = (await page.locator("[data-dag-chat-welcome] [data-dag-chat-composer]").boundingBox())!;
  expect(Math.abs(box.x + box.width / 2 - (area.x + area.width / 2))).toBeLessThan(2);

  /* A conversation held in the panel is a chat in this vault like any other. */
  await page.goto("/?tasks=1");
  await page.locator("[data-dag-assistant-toggle]").click();
  const panel = page.locator("[data-dag-assistant-panel]");
  await panel.locator("[data-dag-assistant-panel-new]").click();
  await say(page, "from a note's panel");
  await expect(panel.locator("[data-dag-chat-turn]")).toHaveAttribute("data-dag-chat-status", "done");
  const id = await panel.locator("[data-dag-chat]").getAttribute("data-dag-chat");
  expect(id).toMatch(/^c[0-9a-z]+$/);
  chats.push(id!);

  await page.goto("/?chat=new");
  const row = page.locator(`[data-dag-chat-row="${id}"]`);
  await expect(row).toBeVisible();
  await expect(row).not.toHaveAttribute("aria-current", "page");
  await row.click();
  await expect(page).toHaveURL(new RegExp(`chat=${id}`));
  await expect(page.locator("[data-dag-chat-asked]")).toHaveText("from a note's panel");
});

test("deleting a chat drops its row and lands on New chat", async ({ page }) => {
  await page.goto("/?chat=new");
  await say(page, "throw this chat away");
  const id = await chatId(page);
  const row = page.locator(`[data-dag-chat-row="${id}"]`);
  await expect(row).toBeVisible();

  await page.locator("[data-dag-chat-delete]").click();
  await page.locator("[data-dag-chat-delete-confirm]").click();

  /* The row went with the chat — the list hears the delete's own event — and so did the page. */
  await expect(row).toHaveCount(0);
  await expect(page).toHaveURL(/chat=new/);
  await expect(page.locator("[data-dag-chat-welcome]")).toBeVisible();
  await expect(page.locator("[data-dag-chat-title]")).toHaveCount(0);
  await expect(page.locator("[data-dag-chat-missing]")).toHaveCount(0);

  /* A reload finds it gone from the list too, not just from the page's state. */
  await page.reload();
  await expect(page.locator(`[data-dag-chat-row="${id}"]`)).toHaveCount(0);
});

test("a turn makes a note and a block card; Undo takes it away and Redo brings it back", { tag: "@smoke" }, async ({ page }) => {
  const name = stem("make");
  await page.goto("/?chat=new");
  await say(page, `note ${name} hi there`);
  await chatId(page);

  const card = page.locator("[data-dag-chat-turns] [data-dag-chat-block]");
  await expect(card).toBeVisible();
  await expect(card).toContainText(`${name}.md`);
  expect(fs.existsSync(noteFile(name))).toBe(true);
  /* The same block is in the Changes column, with its own Undo. */
  await expect(page.locator("[data-dag-chat-changes] [data-dag-chat-block]")).toHaveCount(1);
  await expect(page.locator("[data-dag-chat-turn]").locator("[data-dag-chat-tool]").first()).toContainText("Made a note");

  await page.locator("[data-dag-chat-block-undo]").click();
  await expect(card).toHaveAttribute("data-dag-chat-block-state", "undone");
  expect(fs.existsSync(noteFile(name))).toBe(false);

  await page.locator("[data-dag-chat-block-redo]").click();
  await expect(card).toHaveAttribute("data-dag-chat-block-state", "done");
  expect(fs.existsSync(noteFile(name))).toBe(true);

  /* And the Changes column is a second way to the same undo. */
  await page.locator("[data-dag-chat-change-undo]").click();
  await expect(card).toHaveAttribute("data-dag-chat-block-state", "undone");
  expect(fs.existsSync(noteFile(name))).toBe(false);
});

test("a delete waits on an approval card, and Deny keeps the note", async ({ page }) => {
  const name = stem("keep");
  fs.writeFileSync(noteFile(name), "---\ntitle: Keep\n---\nkeep me\n");
  await page.goto("/?chat=new");
  await say(page, `delete ${name}`);
  await chatId(page);

  const card = page.locator("[data-dag-chat-approval]");
  await expect(card).toBeVisible();
  await expect(card).toHaveAttribute("data-dag-chat-answer", "waiting");
  /* The turn is held on the person's answer, and the note is still there. */
  await expect(page.locator("[data-dag-chat-turn]")).toHaveAttribute("data-dag-chat-status", "running");
  expect(fs.existsSync(noteFile(name))).toBe(true);
  await page.locator("[data-dag-chat-deny]").click();
  await expect(card).toHaveAttribute("data-dag-chat-answer", "no");
  await expect(page.locator("[data-dag-chat-turn]")).toHaveAttribute("data-dag-chat-status", "done");
  await expect(page.locator("[data-dag-chat-said]").last()).toContainText("Did not delete");
  expect(fs.existsSync(noteFile(name))).toBe(true);
});

test("a fresh chat writes with no switch to flip", async ({ page }) => {
  const name = stem("fresh");
  await page.goto("/?chat=new");
  await expect(page.locator("[data-dag-chat-mode]")).toHaveCount(0);
  await say(page, `note ${name} written`);
  await chatId(page);
  await expect(page.locator("[data-dag-chat-turn]")).toHaveAttribute("data-dag-chat-status", "done");
  expect(fs.existsSync(noteFile(name))).toBe(true);
  await expect(page.locator("[data-dag-chat-changes] [data-dag-chat-block]")).toHaveCount(1);
});

/**
 * A second vault for a grant test: made under a temp directory, with the suite's own put back as the
 * server's default at once (`e2e/vaults.spec.ts` is the pattern) — **opening a vault makes it the
 * default**, and the rest of the suite loads pages with no `vault=` and would land wherever that is.
 */
let parents: string[] = [];
const made: string[] = [];

async function secondVault(page: Page, name: string): Promise<string> {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "anydag-e2e-grant-"));
  parents.push(parent);
  const r = await page.request.post("/api/vaults/create", { data: { parent, name } });
  expect(r.ok(), await r.text()).toBe(true);
  const { vault } = (await r.json()) as { vault: { id: string } };
  made.push(vault.id);
  await page.request.post("/api/vaults/open", { data: { path: fs.realpathSync(BOARDS) } });
  return vault.id;
}

/** The suite's own vault — the one the dev server serves this repository's boards from. */
async function suiteVaultId(page: Page): Promise<string> {
  const listed = (await (await page.request.get("/api/vaults")).json()) as { vaults: { id: string; path: string }[] };
  return listed.vaults.find((v) => v.path === fs.realpathSync(BOARDS))!.id;
}

test("the scope popover never offers this tab's own vault, and a grant shows and takes back", async ({ page }) => {
  const other = await secondVault(page, `grant-${run}`);
  const home = await suiteVaultId(page);

  /* The page is pinned to the second vault, which is open but **not** the server's default — the
     case a popover that matched the default instead of the tab used to get wrong: it offered this
     tab's vault under "Grant another vault…", and granting it was refused. */
  await page.goto(`/?vault=${other}&chat=new`);
  await page.locator("[data-dag-chat-scope]").click();
  await expect(page.locator("[data-dag-chat-scope-menu]")).toBeVisible();
  await expect(page.locator("[data-dag-chat-scope-menu] strong").first()).toHaveText(`grant-${run}`);
  await expect(page.locator(`[data-dag-chat-grant-vault="${other}"]`)).toHaveCount(0);
  /* The suite's vault is open, so it is the one on offer. */
  await expect(page.locator(`[data-dag-chat-grant-vault="${home}"][data-dag-chat-grant-mode="ask"]`)).toBeVisible();

  await page.locator(`[data-dag-chat-grant-vault="${home}"][data-dag-chat-grant-mode="ask"]`).click();
  await chatId(page);
  await expect(page.locator(`[data-dag-chat-granted="${home}"]`)).toBeVisible();
  await expect(page.locator(`[data-dag-chat-grant-vault="${home}"]`)).toHaveCount(0);

  await page.locator(`[data-dag-chat-revoke="${home}"]`).click();
  await expect(page.locator(`[data-dag-chat-granted="${home}"]`)).toHaveCount(0);
  await expect(page.locator(`[data-dag-chat-grant-vault="${home}"][data-dag-chat-grant-mode="ask"]`)).toBeVisible();
});

test("a vault granted Read refuses a write", async ({ page }) => {
  const other = await secondVault(page, `read-${run}`);
  const home = await suiteVaultId(page);
  const name = stem("readonly");

  /* The chat is made in the tab's vault, and the suite's is granted Read — so the chat's own vault
     is not the one being written to, and the guard's refusal is the grant's. */
  await page.goto(`/?vault=${other}&chat=new`);
  await page.locator("[data-dag-chat-scope]").click();
  await page.locator(`[data-dag-chat-grant-vault="${home}"][data-dag-chat-grant-mode="ask"]`).click();
  await chatId(page);
  await expect(page.locator(`[data-dag-chat-granted="${home}"]`)).toBeVisible();
  await say(page, `note@${home} ${name} nope`);
  await expect(page.locator("[data-dag-chat-turn]")).toHaveAttribute("data-dag-chat-status", "done");
  await expect(page.locator("[data-dag-chat-said]").last()).toContainText(`Could not make ${name}`);
  await expect(page.locator("[data-dag-chat-turns] [data-dag-chat-block]")).toHaveCount(0);
});

test("a vault the agent asks for is the person's to give, on an access card", async ({ page, request }) => {
  const vaults = (
    (await (await request.get("/api/vaults")).json()) as { vaults: { id: string; open: boolean; default: boolean }[] }
  ).vaults;
  const other = vaults.find((v) => v.open && !v.default);
  test.skip(!other, "only one vault is open here");
  await page.goto("/?chat=new");
  await say(page, `vault ${other!.id}`);
  await chatId(page);
  const card = page.locator("[data-dag-chat-access]");
  await expect(card).toBeVisible();
  await page.locator("[data-dag-chat-notnow]").click();
  await expect(card).toHaveAttribute("data-dag-chat-answer", "no");
  await expect(page.locator("[data-dag-chat-said]").last()).toContainText("Not granted");
});

test("space A opens the panel on a board and on a note, and again closes it", async ({ page }) => {
  const board = stem("board");
  fs.writeFileSync(path.join(BOARDS, `${board}.board.md`), "---\ntitle: Board\n---\n\nhello\n");
  await page.goto(`/?board=${board}`);
  await page.waitForFunction(() => document.documentElement.dataset.dagReady === "1", null, { timeout: 20_000 });
  const panel = page.locator("[data-dag-assistant-panel]");
  await expect(panel).toHaveCount(0);
  await page.keyboard.press("Space");
  await page.keyboard.press("a");
  await expect(panel).toBeVisible();
  await expect(panel.locator("[data-dag-chat-input]")).toBeFocused();
  /* Typing in the box is not a chord: a space and an `a` are characters there. */
  await page.keyboard.type("a a");
  await expect(panel.locator("[data-dag-chat-input]")).toHaveValue("a a");
  await page.locator("[data-dag-assistant-panel-close]").click();
  await expect(panel).toHaveCount(0);

  /* The same chord on a page with no canvas. */
  const note = stem("note");
  fs.writeFileSync(noteFile(note), "---\ntitle: Note\n---\nhi\n");
  await page.goto(`/?note=${note}`);
  await expect(page.locator("[data-dag-toolbar]")).toBeVisible();
  await page.locator("body").click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("Space");
  await page.keyboard.press("a");
  await expect(panel).toBeVisible();
  /* The sparkle is the same switch. */
  await page.locator("[data-dag-assistant-toggle]").click();
  await expect(panel).toHaveCount(0);

  /* And on a page that is a list, which hears the keys through `usePageChrome`. */
  await page.goto("/?tasks=1");
  await expect(page.locator("[data-dag-tasks]").first()).toBeVisible();
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press("Space");
  await page.keyboard.press("a");
  await expect(panel).toBeVisible();
});

test("the panel keeps the chat it opens onto the page", async ({ page }) => {
  await page.goto("/?tasks=1");
  await page.locator("[data-dag-assistant-toggle]").click();
  const panel = page.locator("[data-dag-assistant-panel]");
  await panel.locator("[data-dag-assistant-panel-new]").click();
  await say(page, "from the panel");
  const turn = panel.locator("[data-dag-chat-turn]");
  await expect(turn.locator("[data-dag-chat-asked]")).toHaveText("from the panel");
  await expect(turn).toHaveAttribute("data-dag-chat-status", "done");
  await panel.locator("[data-dag-assistant-panel-page]").click();
  await expect(page.locator("[data-dag-assistant-page]")).toBeVisible();
  const id = await chatId(page);
  await expect(page.locator("[data-dag-assistant-panel]")).toHaveCount(0);
  await expect(page.locator("[data-dag-chat-turn] [data-dag-chat-asked]")).toHaveText("from the panel");
  await expect(page.locator(`[data-dag-chat-row="${id}"]`)).toHaveAttribute("aria-current", "page");
});

test("the composer's controls sit on one row, name the model, and the box can be made taller", async ({ page }) => {
  await page.goto("/?tasks=1");
  await page.locator("[data-dag-assistant-toggle]").click();
  const panel = page.locator("[data-dag-assistant-panel]");

  /* One row at the panel's own width: the scope chip and Send share a line, so nothing wrapped. */
  const scope = await panel.locator("[data-dag-chat-scope]").boundingBox();
  const send = await panel.locator("[data-dag-chat-send]").boundingBox();
  expect(scope && send).toBeTruthy();
  expect(Math.abs(send!.y - scope!.y)).toBeLessThan(8);

  /* The model chip names the model, not the harness — and the effort is never "Default effort". */
  const model = panel.locator("select[data-dag-chat-model]");
  await expect(model).toHaveValue(/^(claude|opencode)\|/);
  const shown = await model.evaluate((el) => (el as HTMLSelectElement).selectedOptions[0]?.textContent ?? "");
  expect(shown).not.toContain("·");
  const effort = await panel
    .locator("select[data-dag-chat-effort]")
    .evaluate((el) => (el as HTMLSelectElement).selectedOptions[0]?.textContent ?? "");
  expect(effort).not.toBe("Default effort");

  /* The box grows to most of the column, and goes back when it is told to. */
  const box = panel.locator("[data-dag-chat-input]");
  const before = (await box.boundingBox())!.height;
  await panel.locator("[data-dag-chat-expand]").click();
  const expanded = (await box.boundingBox())!.height;
  expect(expanded).toBeGreaterThan(before + 100);
  await panel.locator("[data-dag-chat-expand]").click();
  expect((await box.boundingBox())!.height).toBeLessThan(before + 20);

  /* And sending it collapses an expanded box. */
  await panel.locator("[data-dag-chat-expand]").click();
  await say(page, "taller box, then gone");
  await expect(panel.locator("[data-dag-chat-turn]").last()).toHaveAttribute("data-dag-chat-status", "done");
  expect((await box.boundingBox())!.height).toBeLessThan(before + 20);

  /* The chat the panel is now on is this run's to delete (the page never sees its id). */
  const made = await panel.locator("[data-dag-chat]").getAttribute("data-dag-chat");
  if (made && made !== "new") chats.push(made);
});
