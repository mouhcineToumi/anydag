import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

import { BOARDS } from "./boards";
import { openSettings, openSidebar } from "./sidebar";

/**
 * Vaults: folders the one server serves, each with its own files and
 * preferences, switched from the top of the sidebar and named in the address as `?vault=<id>`.
 *
 * Every check reads the filesystem, as the rest of the suite does. Each test makes its own vaults in a
 * temp directory and puts them away afterwards (close and forget — **never the folder**, which is the
 * test's to remove).
 *
 * **Opening a vault makes it the server's default**, and the rest of the suite loads pages with no
 * `vault=` and so lands wherever the default is. So every vault opened here is followed at once by
 * opening the suite's own vault again, and a click that opens one through the page is answered
 * through a route that does the same before the page hears back.
 */

const BOARD = (title: string) => `---\ntitle: ${title}\n---\n\n\`\`\`md {#a x=0 y=0 w=320}\n${title}\n\`\`\`\n`;
const HOME = fs.realpathSync(BOARDS);

interface Listed {
  id: string;
  name: string;
  path: string;
  open: boolean;
  default: boolean;
  missing: boolean;
}

let id = "";
let parents: string[] = [];
let made: string[] = [];
let files: string[] = [];

test.beforeEach(({}, info) => {
  id = info.testId
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .slice(-10);
  parents = [];
  made = [];
  files = [];
});

test.afterEach(async ({ page }) => {
  /* Off the page first: closing the vault a tab is in sends that tab elsewhere. */
  await page.goto("about:blank").catch(() => undefined);
  await page.request.post("/api/vaults/open", { data: { path: HOME } }).catch(() => undefined);
  for (const v of made) await page.request.post("/api/vaults/close", { data: { id: v, forget: true } }).catch(() => undefined);
  for (const f of files) fs.rmSync(f, { recursive: true, force: true });
  for (const p of parents) fs.rmSync(p, { recursive: true, force: true });
});

const listed = async (page: Page): Promise<Listed[]> =>
  ((await (await page.request.get("/api/vaults")).json()) as { vaults: Listed[] }).vaults;
const homeId = async (page: Page): Promise<string> => (await listed(page)).find((v) => v.path === HOME)!.id;
const restore = (page: Page) => page.request.post("/api/vaults/open", { data: { path: HOME } });

/** A vault made through the route under a temp directory, named for the test; the suite's own put back as the default. */
async function vault(page: Page, name = `vault-${id}`): Promise<{ id: string; dir: string }> {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "anydag-e2e-vault-"));
  parents.push(parent);
  const r = await page.request.post("/api/vaults/create", { data: { parent, name } });
  expect(r.ok(), await r.text()).toBe(true);
  const made1 = ((await r.json()) as { vault: { id: string; path: string } }).vault;
  made.push(made1.id);
  await restore(page);
  return { id: made1.id, dir: made1.path };
}

/** A board written straight into a vault's directory, the way every fixture here is. */
function fixture(dir: string, name: string, title = name): string {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${name}.board.md`);
  fs.writeFileSync(file, BOARD(title));
  files.push(file);
  return file;
}

async function ready(page: Page): Promise<void> {
  await page.waitForFunction(() => document.documentElement.dataset.dagReady === "1", null, { timeout: 20_000 });
}

/** Every console message and page error, which the suite as a whole treats as a failure. */
function listen(page: Page, gone?: () => string): string[] {
  const heard: string[] = [];
  page.on("console", (m) => {
    if (m.type() !== "error" && m.type() !== "warning") return;
    const at = m.location().url;
    /* The one 404 that is the answer rather than a fault: a request already in flight when its vault
       was closed, answered for exactly that vault. Chromium prints any 4xx. */
    if (gone && m.text().includes("status of 404") && at.includes(`vault=${gone()}`)) return;
    heard.push(`${m.type()}: ${m.text()} @ ${at}`);
  });
  page.on("pageerror", (e) => heard.push(String(e)));
  return heard;
}

/** Opening a folder through the page, with the suite's own vault put back as the default before the page hears. */
async function keepDefault(page: Page): Promise<void> {
  await page.route("**/api/vaults/open", async (route) => {
    const response = await route.fetch();
    await restore(page);
    await route.fulfill({ response });
  });
}

const current = (page: Page) => page.locator("[data-dag-vault-current]");
const fileRow = (page: Page, name: string) => page.locator(`[data-dag-sidebar-file="${name}"]`);

async function openSwitcher(page: Page): Promise<void> {
  await openSidebar(page);
  await expect(async () => {
    if (await page.locator("[data-dag-vault-menu]").isVisible()) return;
    await page.locator("[data-dag-vault-switcher]").click({ timeout: 1_000 });
    await expect(page.locator("[data-dag-vault-menu]")).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
}

test("a tab names its vault in the address and in every request, and each vault has its own files", async ({ page }) => {
  const heard = listen(page);
  const other = await vault(page);
  fixture(other.dir, `away-${id}`, "Away");
  fixture(BOARDS, `home-${id}`, "Home");
  const home = await homeId(page);
  const asked: string[] = [];
  page.on("request", (r) => {
    const u = new URL(r.url());
    if (u.pathname.startsWith("/__board/")) asked.push(u.pathname + u.search);
  });

  /* No `vault=` in the link: the tab takes the server's default and writes it into the address. */
  await page.goto(`/?board=home-${id}`);
  await ready(page);
  await expect(page).toHaveURL((u) => u.searchParams.get("vault") === home);

  await page.goto(`/?vault=${other.id}&board=away-${id}`);
  await ready(page);
  await openSidebar(page);
  await expect(current(page)).toHaveText(`vault-${id}`);
  await expect(fileRow(page, `away-${id}`)).toBeVisible();
  await expect(fileRow(page, `home-${id}`)).toHaveCount(0);
  /* The stream, the list, the board: every one of them named the vault. */
  expect(asked.length).toBeGreaterThan(2);
  expect(asked.filter((u) => !u.includes(`vault=${other.id}`) && !u.includes(`vault=${home}`))).toEqual([]);
  expect(asked.filter((u) => u.includes(`vault=${other.id}`)).length).toBeGreaterThan(2);

  /* Switching is a page load into the other vault, and the server's default is not what decides it. */
  await openSwitcher(page);
  await expect(page.locator(`[data-dag-vault="${other.id}"]`)).toHaveAttribute("aria-checked", "true");
  await page.locator(`[data-dag-vault="${home}"]`).click();
  await expect(page).toHaveURL((u) => u.searchParams.get("vault") === home);
  await openSidebar(page);
  await expect(fileRow(page, `home-${id}`)).toBeVisible();
  await expect(fileRow(page, `away-${id}`)).toHaveCount(0);
  expect(heard).toEqual([]);
});

test("a folder opened from the switcher is the vault the tab goes to, and the typed path is refused when it is no folder", async ({
  page,
}) => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "anydag-e2e-vault-"));
  parents.push(parent);
  const folder = path.join(parent, `typed-${id}`);
  fs.mkdirSync(folder);
  fixture(folder, `typed-board-${id}`, "Typed");
  await keepDefault(page);

  await page.goto(`/?board=nothing-${id}`);
  await openSwitcher(page);
  await page.locator("[data-dag-vault-open]").click();
  const field = page.locator("[data-dag-vault-open-path]");
  await field.fill(path.join(parent, "no-such-folder"));
  await field.press("Enter");
  await expect(page.locator("[data-dag-vault-problem]")).toContainText("not a folder");

  await field.fill(folder);
  await field.press("Enter");
  await expect(page).toHaveURL((u) => Boolean(u.searchParams.get("vault")) && u.searchParams.get("vault") !== null);
  const now = (await listed(page)).find((v) => v.path === fs.realpathSync(folder))!;
  made.push(now.id);
  await expect(page).toHaveURL((u) => u.searchParams.get("vault") === now.id);
  await openSidebar(page);
  await expect(current(page)).toHaveText(`typed-${id}`);
  await expect(fileRow(page, `typed-board-${id}`)).toBeVisible();
  /* A vault is a folder the person already had: nothing was written into it but its own marker. */
  expect(fs.existsSync(path.join(folder, `typed-board-${id}.board.md`))).toBe(true);
});

test("a vault made from the switcher is opened, and the next board is filed in it", async ({ page }) => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "anydag-e2e-vault-"));
  parents.push(parent);
  await keepDefault(page);
  await page.goto(`/?board=nothing-${id}`);
  await openSwitcher(page);

  await page.locator("[data-dag-vault-create]").click();
  await page.locator("[data-dag-vault-create-name]").fill(`Made ${id}`);
  await page.locator("[data-dag-vault-create-parent]").fill(parent);
  await page.locator("[data-dag-vault-create-go]").click();
  await expect.poll(() => fs.existsSync(path.join(parent, `Made ${id}`, ".anydag", "vault.json"))).toBe(true);
  const created = (await listed(page)).find((v) => v.name === `Made ${id}`)!;
  made.push(created.id);
  await expect(page).toHaveURL((u) => u.searchParams.get("vault") === created.id);
  await openSidebar(page);
  await expect(current(page)).toHaveText(`Made ${id}`);
});

test("a board moves to another vault from its row, keeping its id", async ({ page }) => {
  const other = await vault(page);
  fixture(BOARDS, `home-${id}`, "Home");
  fixture(BOARDS, `moving-${id}`, "Moving");
  const home = await homeId(page);
  const ids = async (v: string) =>
    ((await (await page.request.get("/__board/list", { params: { vault: v } })).json()) as { ids: Record<string, string> }).ids;
  await expect.poll(async () => (await ids(home))[`moving-${id}`]).toBeTruthy();
  const ident = (await ids(home))[`moving-${id}`];

  await page.goto(`/?vault=${home}&board=home-${id}`);
  await ready(page);
  await openSidebar(page);
  await fileRow(page, `moving-${id}`).click({ button: "right" });
  await page.locator('[data-dag-sidebar-menu-item="transfer"]').click();
  await page.locator("[data-dag-sidebar-transfer-to]").selectOption(`vault:${other.id}`);

  await expect.poll(() => fs.existsSync(path.join(other.dir, `moving-${id}.board.md`))).toBe(true);
  /* A poll, not a read: a move is a copy and then a delete, so the original is still there for the
     moment between the two — which is the order that loses nothing when one of them fails. */
  await expect.poll(() => fs.existsSync(path.join(BOARDS, `moving-${id}.board.md`))).toBe(false);
  await expect(fileRow(page, `moving-${id}`)).toHaveCount(0);
  expect((await ids(other.id))[`moving-${id}`]).toBe(ident);
});

test("a theme chosen in one vault is the person's, the same in every vault", async ({ page }) => {
  /* It was the vault's until #191: opening another vault changed how the app looked. */
  const other = await vault(page);
  const home = await homeId(page);
  const scheme = () => page.evaluate(() => document.documentElement.style.colorScheme);

  await page.goto(`/?vault=${other.id}`);
  await openSettings(page, "appearance");
  await expect(page.locator("[data-dag-settings-scope]")).toHaveText("You");
  await page.locator("[data-dag-setting-theme]").selectOption("paper-dark");
  await expect.poll(scheme).toBe("dark");

  await page.goto(`/?vault=${home}&tasks=1`);
  await expect.poll(scheme).toBe("dark");

  /* Back to the default, so the next check in this worker starts light. */
  await openSettings(page, "appearance");
  await page.locator("[data-dag-setting-theme]").selectOption("paper");
  await expect.poll(scheme).toBe("light");
});

test("a vault's old theme is carried over to the person once", async ({ page }) => {
  /* Before #191 the theme was kept per vault, as `dag:theme@<vault>` in this browser. */
  const other = await vault(page);
  const scheme = () => page.evaluate(() => document.documentElement.style.colorScheme);
  await page.goto(`/?vault=${other.id}&tasks=1`);
  await page.evaluate((v) => {
    localStorage.removeItem("dag:theme");
    localStorage.setItem(`dag:theme@${v}`, "paper-dark");
  }, other.id);
  await page.reload();
  await expect.poll(scheme).toBe("dark");
  expect(await page.evaluate(() => localStorage.getItem("dag:theme"))).toBe("paper-dark");
  /* Once: the vault's copy is left as it was, and a later change is the person's alone. */
  await openSettings(page, "appearance");
  await page.locator("[data-dag-setting-theme]").selectOption("paper");
  await page.reload();
  await expect.poll(scheme).toBe("light");
  await page.evaluate((v) => localStorage.removeItem(`dag:theme@${v}`), other.id);
});

test("closing one from its Settings tab leaves its folder, keeps it on the list, and the tab goes to another vault", async ({
  page,
}) => {
  const other = await vault(page);
  fixture(other.dir, `kept-${id}`, "Kept");
  const home = await homeId(page);
  await page.goto(`/?vault=${other.id}&board=kept-${id}`);
  await ready(page);
  await openSwitcher(page);
  await page.locator("[data-dag-vault-settings]").click();
  await expect(page.locator('[data-dag-settings-pane="vault-general"]')).toBeVisible();
  await expect(page.locator("[data-dag-setting-vault-path]")).toHaveText(other.dir);
  await expect(page.locator("[data-dag-setting-vault-name]")).toHaveText(`vault-${id}`);

  await page.locator("[data-dag-vault-close-setting]").click();
  await expect(page).toHaveURL((u) => u.searchParams.get("vault") === home);
  const after = (await listed(page)).find((v) => v.id === other.id)!;
  expect(after.open).toBe(false);
  expect(fs.existsSync(path.join(other.dir, `kept-${id}.board.md`))).toBe(true);
});

test("a closed vault can be opened again from the list, and a missing one is greyed and can be removed", async ({ page }) => {
  const back = await vault(page, `back-${id}`);
  const gone = await vault(page, `gone-${id}`);
  await page.request.post("/api/vaults/close", { data: { id: back.id } });
  await page.request.post("/api/vaults/close", { data: { id: gone.id } });
  fs.rmSync(gone.dir, { recursive: true, force: true });
  await keepDefault(page);

  await page.goto("/?tasks=1");
  await openSwitcher(page);
  const missing = page.locator(`[data-dag-vault="${gone.id}"]`);
  await expect(missing).toBeDisabled();
  await expect(missing).toContainText("not found");
  await page.locator(`[data-dag-vault-forget="${gone.id}"]`).click();
  await expect(missing).toHaveCount(0);
  expect((await listed(page)).some((v) => v.id === gone.id)).toBe(false);

  await page.locator(`[data-dag-vault="${back.id}"]`).click();
  await expect(page).toHaveURL((u) => u.searchParams.get("vault") === back.id);
  expect((await listed(page)).find((v) => v.id === back.id)!.open).toBe(true);
});

test("a tab whose vault is closed somewhere else goes to another one, and says nothing on the console", async ({ page }) => {
  let shut = "";
  const heard = listen(page, () => shut);
  const other = await vault(page);
  shut = other.id;
  fixture(other.dir, `there-${id}`, "There");
  const home = await homeId(page);
  await page.goto(`/?vault=${other.id}&board=there-${id}`);
  await ready(page);

  const r = await page.request.post("/api/vaults/close", { data: { id: other.id } });
  expect(r.ok()).toBe(true);

  await expect(page).toHaveURL((u) => u.searchParams.get("vault") === home, { timeout: 15_000 });
  await openSidebar(page);
  await expect(page.locator("[data-dag-vault-switcher]")).toBeVisible();
  expect(heard).toEqual([]);
});

test("a link to a vault that is not open opens the default one", async ({ page }) => {
  fixture(BOARDS, `home-${id}`, "Home");
  const home = await homeId(page);
  await page.goto(`/?vault=gone${id}&board=home-${id}`);
  await ready(page);
  await expect(page).toHaveURL((u) => u.searchParams.get("vault") === home && u.searchParams.get("board") === `home-${id}`);
});

test("with no vault open the page is the picker: open a folder, create a vault, or choose a recent one", async ({ page }) => {
  const heard = listen(page);
  const recent = {
    id: "r1",
    name: "Recent one",
    path: "/nowhere/recent-one",
    opened: "2026-01-01T00:00:00Z",
    open: false,
    default: false,
    missing: false,
  };
  await page.route("**/api/vaults", (route) =>
    route.fulfill({ json: { vaults: [recent, { ...recent, id: "r2", name: "Lost", missing: true }], home: "/home/someone" } }),
  );
  await page.goto("/");

  await expect(page.locator("[data-dag-novault]")).toBeVisible();
  await expect(page.locator("[data-dag-welcome-open-folder]")).toBeVisible();
  await expect(page.locator(`[data-dag-vault="r1"]`)).toBeEnabled();
  await expect(page.locator(`[data-dag-vault="r2"]`)).toBeDisabled();
  await expect(page.locator(`[data-dag-vault="r2"]`)).toContainText("not found");

  await page.locator("[data-dag-welcome-create-vault]").click();
  await expect(page.locator("[data-dag-vault-create-parent]")).toHaveValue("/home/someone");
  expect(heard).toEqual([]);
});

/**
 * What the first screen says about the form it is showing, and which action finishes it.
 *
 * The heading used to stay *Open a vault* while the create form was up, the labels read as centred
 * captions over their fields, and every action was the same quiet text. A new person had nothing to
 * tell them where to type or which button completes the job. The error's line is reserved in the
 * form so a refusal from the server does not move the actions under the pointer.
 */
test("the first-run card names the form it shows, and only its submit is the filled action", async ({ page }) => {
  const heard = listen(page);
  await page.route("**/api/vaults", (route) => route.fulfill({ json: { vaults: [], home: "/home/someone" } }));
  await page.goto("/");
  const card = page.locator("[data-dag-novault]");
  const title = card.locator("h1");
  await expect(title).toHaveText("Open a vault");

  /* The open half keeps the heading, and offers one filled action: Open. */
  await page.locator("[data-dag-welcome-open-folder]").click();
  await expect(page.locator("[data-dag-vault-open-form]")).toBeVisible();
  await expect(title).toHaveText("Open a vault");
  await expect(page.locator("[data-dag-vault-open-form] label")).toContainText("Folder to open");
  await expect(page.locator("[data-dag-vault-open-go]")).toHaveClass(/dag-button--primary/);
  await expect(page.locator("[data-dag-vault-open-go]")).toBeDisabled();
  await page.locator("[data-dag-vault-open-form]").getByRole("button", { name: "Cancel" }).click();

  /* The create half says what it is, and puts its labels above their fields, left-aligned. */
  await page.locator("[data-dag-welcome-create-vault]").click();
  await expect(page.locator("[data-dag-vault-create-form]")).toBeVisible();
  await expect(title).toHaveText("Create a vault");
  await expect(card.locator(".dag-welcome__hint")).toContainText("Give it a name");
  const form = page.locator("[data-dag-vault-create-form]");
  const name = page.locator("[data-dag-vault-create-name]");
  const create = page.locator("[data-dag-vault-create-go]");
  const cancel = form.getByRole("button", { name: "Cancel" });
  await expect(form.locator("label").first()).toContainText("Name");
  await expect(form.locator("label").nth(1)).toContainText("In the folder");
  expect(
    await form
      .locator("label")
      .first()
      .evaluate((el) => getComputedStyle(el).textAlign),
  ).toBe("left");
  const labelBox = await form.locator("label").first().locator("span").first().boundingBox();
  const fieldBox = await name.boundingBox();
  expect(labelBox!.y + labelBox!.height).toBeLessThanOrEqual(fieldBox!.y);
  await expect(create).toHaveText("Create");
  await expect(create).toBeDisabled();
  await expect(create).toHaveClass(/dag-button--primary/);
  await expect(create).toHaveClass(/dag-button/);
  await expect(cancel).toHaveClass(/dag-button/);
  await expect(cancel).not.toHaveClass(/dag-button--primary/);

  /* Both fields filled is what makes the one action available. */
  await name.fill(`First run ${id}`);
  await expect(create).toBeEnabled();

  /* Enter from a field submits; a refusal lands under the form and the actions stay put. */
  await page.route("**/api/vaults/create", (route) =>
    route.fulfill({ status: 400, json: { error: "That folder already holds a vault." } }),
  );
  const acts = form.locator(".dag-vault__form-acts");
  const before = await acts.boundingBox();
  await name.press("Enter");
  await expect(page.locator("[data-dag-vault-problem]")).toContainText("already holds a vault");
  const after = await acts.boundingBox();
  expect(Math.abs(after!.y - before!.y)).toBeLessThan(0.5);
  expect(Math.abs(after!.height - before!.height)).toBeLessThan(0.5);

  /* Escape lets go of the form, and the card goes back to its chooser title. */
  await name.focus();
  await page.keyboard.press("Escape");
  await expect(page.locator("[data-dag-vault-create-form]")).toHaveCount(0);
  await expect(title).toHaveText("Open a vault");
  /* Chromium prints any 4xx; the one here is the refusal this check asked for. */
  expect(heard.filter((line) => !line.includes("/api/vaults/create"))).toEqual([]);
});

test("the create form tabs through its fields, Browse, Cancel, then Create", async ({ page }) => {
  await page.addInitScript(() => {
    window.anydagDesktop = { pickFolder: async () => null };
  });
  await page.route("**/api/vaults", (route) => route.fulfill({ json: { vaults: [], home: "/home/someone" } }));
  await page.goto("/");
  await page.locator("[data-dag-welcome-create-vault]").click();
  const form = page.locator("[data-dag-vault-create-form]");
  const browse = page.locator("[data-dag-vault-create-browse]");
  await expect(browse).toBeVisible();
  await expect(browse).toHaveClass(/dag-button/);
  await expect(browse).not.toHaveClass(/dag-button--primary/);
  await expect(page.locator("[data-dag-vault-create-name]")).toBeFocused();

  /* A disabled Create is not in the tab order: name it first, so all five stops are live. */
  await page.locator("[data-dag-vault-create-name]").fill(`Tab order ${id}`);

  /* Name has the focus when the form opens; four tabs reach Browse, Cancel and Create in that order. */
  const focus = () =>
    page.evaluate(() => {
      const el = document.activeElement;
      if (!(el instanceof HTMLElement)) return "none";
      for (const key of ["Name", "Parent", "Browse", "Go"]) {
        if (el.hasAttribute(`data-dag-vault-create-${key.toLowerCase()}`)) return key.toLowerCase();
      }
      if (el.closest("[data-dag-vault-create-form]") && el.textContent?.trim() === "Cancel") return "cancel";
      return el.tagName.toLowerCase();
    });
  const order = [await focus()];
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press("Tab");
    order.push(await focus());
  }
  expect(order).toEqual(["name", "parent", "browse", "cancel", "go"]);
  await expect(form).toBeVisible();
});

test("the desktop shell's folder dialog is used when there is one", async ({ page }) => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "anydag-e2e-vault-"));
  parents.push(parent);
  const folder = path.join(parent, `picked-${id}`);
  fs.mkdirSync(folder);
  await keepDefault(page);
  await page.addInitScript((picked) => {
    (window as unknown as { anydagDesktop: unknown }).anydagDesktop = {
      pickFolder: async () => picked,
      revealInFolder: async () => undefined,
    };
  }, folder);

  await page.goto(`/?board=nothing-${id}`);
  await openSwitcher(page);
  await page.locator("[data-dag-vault-open]").click();
  await expect(page.locator("[data-dag-vault-open-path]")).toHaveCount(0);
  const now = async () => (await listed(page)).find((v) => v.path === fs.realpathSync(folder));
  await expect.poll(async () => Boolean(await now())).toBe(true);
  const opened = (await now())!;
  made.push(opened.id);
  await expect(page).toHaveURL((u) => u.searchParams.get("vault") === opened.id);
  await openSettings(page, "vault-general");
  await expect(page.locator("[data-dag-setting-vault-reveal]")).toBeVisible();
});

test("the Agent access tab gives the lines that connect Claude Code and Claude Desktop to this vault", async ({ page }) => {
  await page.goto(`/?board=nothing-${id}`);
  await openSettings(page, "agent-access");
  await expect(page.locator('[data-dag-setting-copy-value="mcp-claude-code"]')).toContainText(
    `claude mcp add anydag -- anydag mcp --vault ${HOME}`,
  );
  await page.locator('[data-dag-agent-client="claude-desktop"]').click();
  const json = await page.locator('[data-dag-setting-copy-value="mcp-claude-desktop"]').textContent();
  expect(JSON.parse(json ?? "{}")).toEqual({ mcpServers: { anydag: { command: "anydag", args: ["mcp", "--vault", HOME] } } });
});
