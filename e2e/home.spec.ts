import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

import { BOARDS } from "./boards";
import { vaulted } from "./vault";

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

test.beforeEach(({}, info) => {
  folder = `e2e-home-${info.testId.toLowerCase().replace(/[^a-z0-9]+/g, "")}`;
  fs.mkdirSync(path.join(BOARDS, folder), { recursive: true });
  fs.writeFileSync(path.join(BOARDS, `${board()}.board.md`), BOARD);
  fs.writeFileSync(path.join(BOARDS, `${note()}.note.md`), NOTE);
  fs.writeFileSync(path.join(BOARDS, `${quiz()}.quiz.md`), QUIZ);
  fs.writeFileSync(path.join(BOARDS, `${table()}.table.md`), TABLE);
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
    here: (page) => expect(page.locator('[data-dag-item="a"]')).toBeVisible(),
  },
  {
    what: "a note",
    url: () => `/?note=${note()}`,
    here: (page) => expect(page.locator(".dag-note-view")).toBeVisible(),
  },
  {
    what: "a quiz",
    url: () => `/?quiz=${quiz()}`,
    here: (page) => expect(page.locator("[data-dag-quiz-question]")).toBeVisible(),
  },
  {
    what: "a table",
    url: () => `/?table=${table()}`,
    here: (page) => expect(page.locator("[data-dag-grid]")).toBeVisible(),
  },
  {
    what: "the calendar",
    url: () => "/?calendar=1",
    here: (page) => expect(page.locator("[data-dag-calendar]")).toBeVisible(),
  },
  {
    what: "tasks",
    url: () => "/?tasks=1",
    here: (page) => expect(page.locator("[data-dag-tasks]")).toBeVisible(),
  },
  {
    what: "the assistant",
    url: () => "/?chat=new",
    here: (page) => expect(page.locator("[data-dag-chat-welcome]")).toBeVisible(),
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
  await expect(page.locator(".dag-note-view")).toBeVisible();

  await logo(page).focus();
  await expect(logo(page)).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(welcome(page)).toBeVisible();
});

test("the logo says it can be clicked", async ({ page }) => {
  await page.goto(await vaulted(page, "/?tasks=1"));
  await expect(page.locator("[data-dag-tasks]")).toBeVisible();

  /* Named for what it does, not for what it is. */
  await expect(logo(page)).toHaveAttribute("aria-label", "Home");
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
    await expect(page.locator('[data-dag-item="a"]')).toBeVisible();
    await expect(page.locator(".dag-toolbar .dag-toolbar__logo")).toHaveCount(0);

    await page.locator("[data-dag-sidebar-home]").click();
    await expect(welcome(page)).toBeVisible();
    await page.goBack();
    await expect(page.locator('[data-dag-item="a"]')).toBeVisible();
  });
});
