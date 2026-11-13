import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

import { BOARDS } from "./boards";
import { suiteVault, vaulted } from "./vault";

/**
 * Home: the AnyDag logo goes back to the welcome card.
 *
 * The welcome card is what the page shows when the address names no page — and, before this,
 * nothing took you back to it once anything was open. The logo now does: the column's own while it
 * is docked, the toolbar's while the column is away. Going home clears every page's key from the
 * address and **pushes** the history entry, so Back returns to the page that was left — the same
 * rule following a reference has always had.
 *
 * Each test owns a folder of its own, because the suite runs eight wide over one `boards/`, and
 * every page names the suite's vault, so none can pin whichever vault was opened last
 * (`e2e/vault.ts`).
 */

const BOARD = `---
title: Home plan
---

\`\`\`md {#a x=0 y=0 w=320}
hi
\`\`\`
`;
const NOTE = "# Idea\n\nA paragraph.\n";
const QUIZ = `---
title: Drill
---

## What does VACUUM reclaim? {#qvac}

- [x] The space of dead tuples
- [ ] Index bloat only
`;
const TABLE = `---
title: Pipeline
---

## Deals {#deals}

| Name {#name} | Stage {#stage} |
| --- | --- |
| Acme {#racme} | Won |
`;

let folder = "";
const board = () => `${folder}/plan`;
const note = () => `${folder}/idea`;
const quiz = () => `${folder}/drill`;
const table = () => `${folder}/grid`;

/** Tomorrow, written as a task's `due:` is — what "due soon" has to include. */
function tomorrow(): string {
  const at = new Date();
  at.setDate(at.getDate() + 1);
  return `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, "0")}-${String(at.getDate()).padStart(2, "0")}`;
}

test.beforeEach(async ({ page }, info) => {
  folder = `e2e-home-${info.testId.toLowerCase().replace(/[^a-z0-9]+/g, "")}`;
  fs.mkdirSync(path.join(BOARDS, folder), { recursive: true });
  fs.writeFileSync(path.join(BOARDS, `${board()}.board.md`), BOARD);
  fs.writeFileSync(path.join(BOARDS, `${note()}.note.md`), NOTE);
  fs.writeFileSync(path.join(BOARDS, `${quiz()}.quiz.md`), QUIZ);
  fs.writeFileSync(path.join(BOARDS, `${table()}.table.md`), TABLE);
  /* **Writing a file is not the server knowing it.** The four fixtures land with `fs` and the
     watcher reports them a moment later; a page opened in that window asks about a file the
     listing does not name yet and draws *Nothing open* instead of the page this check is about.
     Waiting on the list is the same one-round-trip rule the rest of the suite follows. */
  const vault = await suiteVault(page);
  await expect
    .poll(
      async () => {
        const body = (await (await page.request.get("/__board/list", { params: { vault } })).json()) as {
          boards: string[];
          notes: string[];
          quizzes: string[];
          tables: string[];
        };
        const names = new Set([...body.boards, ...body.notes, ...body.quizzes, ...body.tables]);
        return [board(), note(), quiz(), table()].every((name) => names.has(name));
      },
      { timeout: 10_000 },
    )
    .toBe(true);
});
test.afterEach(() => {
  /* Only the folder this check made, and only when it knows which (`CLAUDE.md`, *Things that will bite*). */
  if (folder) fs.rmSync(path.join(BOARDS, folder), { recursive: true, force: true });
  folder = "";
});

/** The one logo on the page: the column's while it is docked, the toolbar's while it is away. */
const logo = (page: Page) => page.locator("[data-dag-sidebar-home], [data-dag-toolbar-home]");
const welcome = (page: Page) => page.locator("[data-dag-welcome]");

/** The page each address opens, and the element that says it has arrived. The addresses are
    functions: they name this test's folder, which exists only once `beforeEach` has made it. */
const PAGES: { what: string; url: () => string; here: (page: Page) => Promise<void> }[] = [
  {
    what: "a board",
    url: () => `/?board=${board()}`,
    here: (page) => expect(page.locator('[data-dag-item="a"]')).toBeVisible({ timeout: 10_000 }),
  },
  {
    what: "a note",
    url: () => `/?note=${note()}`,
    here: (page) => expect(page.locator(".dag-note-view")).toBeVisible({ timeout: 10_000 }),
  },
  {
    what: "a quiz",
    url: () => `/?quiz=${quiz()}`,
    here: (page) => expect(page.locator("[data-dag-quiz-question]")).toBeVisible({ timeout: 10_000 }),
  },
  {
    what: "a table",
    url: () => `/?table=${table()}`,
    here: (page) => expect(page.locator("[data-dag-grid]")).toBeVisible({ timeout: 10_000 }),
  },
  {
    what: "the calendar",
    url: () => "/?calendar=1",
    here: (page) => expect(page.locator("[data-dag-calendar]")).toBeVisible({ timeout: 10_000 }),
  },
  {
    what: "tasks",
    url: () => "/?tasks=1",
    here: (page) => expect(page.locator("[data-dag-tasks]")).toBeVisible({ timeout: 10_000 }),
  },
  {
    what: "the assistant",
    url: () => "/?chat=new",
    here: (page) => expect(page.locator("[data-dag-chat-welcome]")).toBeVisible({ timeout: 10_000 }),
  },
];

for (const { what, url, here } of PAGES) {
  test(`the logo goes home from ${what}, and Back returns to it`, async ({ page }) => {
    const address = await vaulted(page, url());
    const search = address.slice(address.indexOf("?"));
    await page.goto(address);
    await here(page);
    await expect(welcome(page)).toHaveCount(0);

    await logo(page).click();
    await expect(welcome(page)).toBeVisible();
    /* Home is an address that names no page — and still names this vault. */
    const q = new URL(page.url()).searchParams;
    expect([...q.keys()]).toEqual(["vault"]);

    /* A normal navigation, not a replacement: Back is the page that was left. Compared a pair at a
        time, not as a string — `go` re-serialises the address, and `/` comes back as `%2F`. */
    await page.goBack();
    const pairs = (s: string) =>
      [...new URLSearchParams(s).entries()]
        .map(([k, v]) => `${k}=${v}`)
        .sort()
        .join("&");
    expect(pairs(new URL(page.url()).search)).toBe(pairs(search));
    await here(page);
  });
}

test("pressing Enter on the logo goes home from a note", async ({ page }) => {
  await page.goto(await vaulted(page, `/?note=${note()}`));
  await expect(page.locator(".dag-note-view")).toBeVisible({ timeout: 10_000 });

  await logo(page).focus();
  await expect(logo(page)).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(welcome(page)).toBeVisible();
});

test("the logo says it can be clicked", async ({ page }) => {
  await page.goto(await vaulted(page, "/?tasks=1"));
  await expect(page.locator("[data-dag-tasks]")).toBeVisible({ timeout: 10_000 });

  /* Named for what it does — and, since #203, holding the wordmark it shows, because a spoken
     name must contain the visible one (WCAG 2.5.3, label in name). */
  await expect(logo(page)).toHaveAttribute("aria-label", "AnyDag home");
  /* A hand over it sees a pointer and a fill, and the keyboard reaches it. */
  const fill = () => logo(page).evaluate((el) => getComputedStyle(el).backgroundColor);
  const resting = await fill();
  await logo(page).hover();
  await expect.poll(fill).not.toBe(resting);
  await logo(page).focus();
  await expect(logo(page)).toBeFocused();
});

test.describe("docked", () => {
  /*
   * The suite's own session, less the one key `global-setup.ts` seeds to put the sidebar away — so
   * this one check sees the column docked, where its own logo is the one on the page.
   */
  test.use({
    storageState: async ({}, use) => {
      const seeded = JSON.parse(fs.readFileSync(path.resolve("e2e/.auth/state.json"), "utf8"));
      for (const o of seeded.origins) o.localStorage = o.localStorage.filter((e: { name: string }) => e.name !== "dag:sidebar");
      await use(seeded);
    },
  });

  test("the column's own logo goes home from a board", async ({ page }) => {
    await page.goto(await vaulted(page, `/?board=${board()}`));
    await expect(page.locator('[data-dag-item="a"]')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator(".dag-toolbar .dag-toolbar__logo")).toHaveCount(0);

    await page.locator("[data-dag-sidebar-home]").click();
    await expect(welcome(page)).toBeVisible();
    await page.goBack();
    await expect(page.locator('[data-dag-item="a"]')).toBeVisible({ timeout: 10_000 });
  });
});

test("opening three files and going home lists them newest first", async ({ page }) => {
  await page.goto(await vaulted(page, `/?board=${board()}`));
  await expect(page.locator('[data-dag-item="a"]')).toBeVisible({ timeout: 10_000 });
  await page.goto(await vaulted(page, `/?note=${note()}`));
  await expect(page.locator(".dag-note-view")).toBeVisible({ timeout: 10_000 });
  await page.goto(await vaulted(page, `/?quiz=${quiz()}`));
  await expect(page.locator("[data-dag-quiz-question]")).toBeVisible({ timeout: 10_000 });

  await logo(page).click();
  await expect(welcome(page)).toBeVisible();

  const rows = page.locator("[data-dag-home-recent-item]");
  await expect(rows).toHaveCount(3);
  /* The stored order, not the list's: the newest file first — the quiz, the note, then the board. */
  expect(await rows.evaluateAll((els) => els.map((el) => el.getAttribute("data-dag-home-recent-item")))).toEqual([
    quiz(),
    note(),
    board(),
  ]);

  /* A row opens what it names. */
  await rows.first().click();
  await expect(page.locator("[data-dag-quiz-question]")).toBeVisible({ timeout: 10_000 });
});

test("a task due this week is on Home, and a done one is not", async ({ page }) => {
  const due = tomorrow();
  const task = (name: string, title: string, status: string) =>
    fs.writeFileSync(
      path.join(BOARDS, `${folder}/${name}.note.md`),
      `---\ntitle: ${title}\nstatus: ${status}\ndue: ${due}\n---\n`,
    );
  task("rent", "Pay rent", "todo");
  task("settled", "Already settled", "done");

  await page.goto(await vaulted(page, "/"));
  /* The watcher may report the two files a moment after the page's first listing; the row arrives
     when the list does, which is what `useBoardList` redraws on. Other workers share the vault, so
     this looks for its own two rows rather than counting the list. */
  const dueRow = page.locator(`[data-dag-home-due-item="${folder}/rent"]`);
  await expect(dueRow).toBeVisible({ timeout: 10_000 });
  await expect(dueRow).toContainText("Pay rent");
  await expect(page.locator(`[data-dag-home-due-item="${folder}/settled"]`)).toHaveCount(0);
});

test("an empty vault says so, offers every kind, and no Search", async ({ page }) => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "anydag-e2e-home-"));
  const name = `empty-${test
    .info()
    .testId.toLowerCase()
    .replace(/[^a-z0-9]+/g, "")}`;
  let made = "";
  try {
    const r = await page.request.post("/api/vaults/create", { data: { parent, name } });
    expect(r.ok(), await r.text()).toBe(true);
    made = ((await r.json()) as { vault: { id: string } }).vault.id;
    /* Opening a vault makes it the server's default, and a page that names no vault lands there.
       The suite's own is put back at once, as `vaults.spec.ts` does. */
    await page.request.post("/api/vaults/open", { data: { path: fs.realpathSync(BOARDS) } });

    await page.goto(`/?vault=${made}`);
    await expect(welcome(page)).toBeVisible({ timeout: 15_000 });
    await expect(page.locator("[data-dag-welcome-empty]")).toBeVisible();
    await expect(welcome(page)).toContainText("This vault is empty");

    /* Every kind is a tile, and Search — which can find nothing — is not offered. */
    await expect(page.locator("[data-dag-welcome-start]")).toHaveCount(6);
    await expect(page.locator("[data-dag-welcome-open]")).toHaveCount(0);
    await expect(page.getByText("Nothing here yet")).toHaveCount(0);
  } finally {
    /* Off the page first: closing the vault a tab is in sends it elsewhere, with a 404 on the way. */
    await page.goto("about:blank").catch(() => undefined);
    await page.request.post("/api/vaults/open", { data: { path: fs.realpathSync(BOARDS) } }).catch(() => undefined);
    if (made) await page.request.post("/api/vaults/close", { data: { id: made, forget: true } }).catch(() => undefined);
    fs.rmSync(parent, { recursive: true, force: true });
  }
});
