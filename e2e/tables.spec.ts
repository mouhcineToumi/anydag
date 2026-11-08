import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

import { BOARDS } from "./boards";
import { clickOnHover } from "./hover";
import { openMore } from "./more";
import { openSidebar } from "./sidebar";
import { suiteVault, vaulted } from "./vault";

/**
 * Tables. A table is `<name>.table.md`, and the grid's checks read the
 * **file**, because an edit is supposed to rewrite one cell, one line or one heading and no other
 * byte of it.
 *
 * Each check writes into a folder of its own and removes only that folder (`CLAUDE.md`, *Things
 * that will bite*: a cleanup that matches by prefix must refuse an empty one).
 */

let folder = "";
let dir = "";
let problems: string[] = [];

test.beforeEach(({ page }, info) => {
  folder = `e2e-table-${info.testId}`;
  dir = path.join(BOARDS, folder);
  fs.mkdirSync(dir, { recursive: true });
  problems = [];
  page.on("console", (msg) => {
    if (msg.type() === "error" || msg.type() === "warning") problems.push(msg.text());
  });
  page.on("pageerror", (e) => problems.push(String(e)));
});

test.afterEach(() => {
  if (folder) fs.rmSync(dir, { recursive: true, force: true });
  folder = "";
  expect(problems, "console output").toEqual([]);
});

const tableFile = (leaf: string) => path.join(dir, `${leaf}.table.md`);
const read = (leaf: string) => fs.readFileSync(tableFile(leaf), "utf8");

const TABLE = `---
title: Pipeline
---

Deals this quarter.

## Deals {#deals}

| Name {#name} | Amount {#amount number} | Stage {#stage select options="Lead, Won, Lost"} | Signed {#signed checkbox} |
| --- | ---: | --- | --- |
| Acme {#racme} | 1200 | Won | [x] |
| Globex {#rglob} | 300 | Lead | [ ] |
| Initech {#rinit} | 900 | Lost | [ ] |

## People {#people}

| Name {#name} | Role {#role} |
| --- | --- |
| Ada {#rada1} | Engineer |
`;

function write(leaf: string, text = TABLE): string {
  fs.writeFileSync(tableFile(leaf), text);
  return `${folder}/${leaf}`;
}

async function open(page: Page, name: string, extra = ""): Promise<void> {
  await page.goto(await vaulted(page, `/?table=${encodeURIComponent(name)}${extra}`));
  await expect(page.locator("[data-dag-grid-wrap]")).toBeVisible();
}

async function idOf(page: Page, name: string): Promise<string> {
  let id: string | undefined;
  await expect
    .poll(async () => {
      const list = await page.request.get(`/__board/list?vault=${await suiteVault(page)}`);
      id = ((await list.json()) as { ids: Record<string, string> }).ids[name];
      return id;
    })
    .toBeTruthy();
  return id!;
}

/** The names down the first column, in the order the grid shows them. */
const names = (page: Page) => page.locator("[data-dag-grid-wrap] tbody tr td:nth-child(2)").allTextContents();

test("a table written as a file is a grid of its first tab, and opening it writes nothing", async ({ page }) => {
  const name = write("pipeline");
  await open(page, name);
  await expect(page.locator("[data-dag-grid-col]")).toHaveText(["Name", "Amount", "Stage", "Signed"]);
  expect(await names(page)).toEqual(["Acme", "Globex", "Initech"]);
  await expect(page.locator('[data-dag-grid-check="on"]')).toHaveCount(1);
  await expect(page.locator("[data-dag-tablepage-count]")).toHaveText("3 rows");
  await expect(page.locator("[data-dag-page]")).toHaveText(["Deals", "People"]);
  expect(read("pipeline")).toBe(TABLE);
});

test("typing into a cell rewrites that cell and no other byte, and Escape takes a draft back", { tag: "@smoke" }, async ({
  page,
}) => {
  const name = write("pipeline");
  await open(page, name);
  await page.locator('[data-dag-grid-at="1:1"]').click();
  await page.keyboard.type("450");
  await page.keyboard.press("Enter");
  await expect.poll(() => read("pipeline")).toBe(TABLE.replace("| Globex {#rglob} | 300 |", "| Globex {#rglob} | 450 |"));
  /* Enter went down a row; Escape abandons what is typed there. */
  await expect(page.locator('[data-dag-grid-at="2:1"]')).toHaveAttribute("data-dag-grid-active", "");
  await page.keyboard.type("1");
  await page.keyboard.press("Escape");
  await expect(page.locator('[data-dag-grid-at="2:1"]')).toHaveText("900");
  /* A tick is a press on its box. */
  await page.locator('[data-dag-grid-at="1:3"] .dag-grid__check').click();
  await expect.poll(() => read("pipeline")).toContain("| Globex {#rglob} | 450 | Lead | [x] |");
});

test("a select edits in its options, and a column's menu retypes, sorts and renames", async ({ page }) => {
  const name = write("pipeline");
  await open(page, name);
  await page.locator('[data-dag-grid-at="1:2"]').dblclick();
  await page.locator('[data-dag-grid-option="Won"]').click();
  await expect.poll(() => read("pipeline")).toContain("| Globex {#rglob} | 300 | Won | [ ] |");

  await page.locator('[data-dag-grid-col="amount"]').click();
  await page.locator('[data-dag-grid-sort="desc"]').click();
  await expect.poll(() => read("pipeline")).toContain('## Deals {#deals sort="amount:desc"}');
  expect(await names(page)).toEqual(["Acme", "Initech", "Globex"]);
  /* The rows in the file are where they were: a sort is how a tab shows them. */
  expect(read("pipeline")).toMatch(/Acme[^\n]*\n\| Globex[^\n]*\n\| Initech/);

  await page.locator('[data-dag-grid-col="name"]').click();
  await page.locator('[data-dag-grid-type="link"]').click();
  await expect.poll(() => read("pipeline")).toContain("| Name {#name link} |");
  await page.locator('[data-dag-grid-col="name"]').click();
  await page.locator("[data-dag-grid-col-name]").fill("Company");
  await page.keyboard.press("Enter");
  await expect.poll(() => read("pipeline")).toContain("| Company {#name link} |");
});

test("the Filter card writes the tab's filter, and the bar says how many rows show", async ({ page }) => {
  const name = write("pipeline");
  await open(page, name);
  await page.locator("[data-dag-tablepage-filter]").click();
  await page.locator("[data-dag-tablepage-filter-add]").click();
  const rule = page.locator('[data-dag-tablepage-rule="0"]');
  await rule.locator("select").first().selectOption("amount");
  await rule.locator("[data-dag-tablepage-test]").selectOption(">=");
  await rule.locator("[data-dag-tablepage-value]").fill("900");
  await rule.locator("[data-dag-tablepage-value]").press("Enter");
  await expect.poll(() => read("pipeline")).toContain('## Deals {#deals filter="amount>=900"}');
  await expect(page.locator("[data-dag-tablepage-count]")).toHaveText("2 of 3 rows");
  expect(await names(page)).toEqual(["Acme", "Initech"]);
});

test("a new row is written with an id, its menu deletes it, and ctrl+Z brings it back", async ({ page }) => {
  const name = write("pipeline");
  await open(page, name);
  await page.locator("[data-dag-grid-add-row]").click();
  await expect(page.locator('[data-dag-grid-at="3:0"]')).toHaveAttribute("data-dag-grid-active", "");
  await page.keyboard.type("Umbrella");
  await page.keyboard.press("Enter");
  await expect
    .poll(() => read("pipeline"))
    .toMatch(/\| Initech \{#rinit\} \| 900 \| Lost \| \[ \] \|\n\| Umbrella \{#r[0-9a-z]{5}\} \| \| \| \|\n/);
  const withRow = read("pipeline");

  await page.locator('tr[data-dag-grid-row-index="3"] .dag-grid__gutter').click();
  await page.locator("[data-dag-grid-row-delete]").click();
  await expect.poll(() => read("pipeline")).not.toContain("Umbrella");
  await page.locator("[data-dag-grid-wrap]").focus();
  await page.keyboard.press("Control+z");
  await expect.poll(() => read("pipeline")).toBe(withRow);
});

test("the tabs are the strip along the bottom: one is added, renamed and opened", async ({ page }) => {
  const name = write("pipeline");
  await open(page, name);
  await page.locator('[data-dag-page="people"]').click();
  await expect(page).toHaveURL(/tab=people/);
  expect(await names(page)).toEqual(["Ada"]);

  await page.locator("[data-dag-page-add]").click();
  await expect.poll(() => read("pipeline")).toContain("## Tab 3 {#tab-3}");
  await expect(page).toHaveURL(/tab=tab-3/);
  await page.locator('[data-dag-page="tab-3"]').dblclick();
  await page.locator("[data-dag-page-name]").fill("Leads");
  await page.locator("[data-dag-page-name]").press("Enter");
  await expect.poll(() => read("pipeline")).toContain("## Leads {#tab-3}");
  /* Every tab before it is byte for byte what it was. */
  expect(read("pipeline").startsWith(TABLE)).toBe(true);
});

test("Source is the file, with its problems under it, and the grid will not guess between two rows with one id", async ({
  page,
}) => {
  const twice = TABLE.replace("{#rinit}", "{#rglob}");
  const name = write("pipeline", twice);
  await open(page, name);
  await expect(page.locator("[data-dag-tablepage-status]")).toContainText("1 problem");
  /* A write to the second `rglob` would land on the first; it is refused, and says why. */
  await page.locator('[data-dag-grid-at="2:1"]').click();
  await page.keyboard.type("1");
  await page.keyboard.press("Enter");
  await expect(page.locator("[data-dag-tablepage-status]")).toContainText("two rows share the id `rglob`");
  expect(read("pipeline")).toBe(twice);
  await page.locator("[data-dag-tablepage-mode]").click();
  await expect(page.locator("[data-dag-tablepage-source]")).toHaveValue(twice);
  await expect(page.locator('[data-dag-tablepage-problem="ET_DUPLICATE_ID"]')).toBeVisible();
});

test("a CSV comes in as a tab, and a tab goes out as CSV", async ({ page }) => {
  const name = write("pipeline");
  await open(page, name);
  await page.locator("[data-dag-tablepage-import-file]").setInputFiles({
    name: "supplies.csv",
    mimeType: "text/csv",
    buffer: Buffer.from('Item;Qty;Done\n"Nails, steel";100;yes\nGlue;3;no\n'),
  });
  await expect(page).toHaveURL(/tab=supplies/);
  await expect.poll(() => read("pipeline")).toContain("| Item {#item} | Qty {#qty number} | Done {#done checkbox} |");
  expect(read("pipeline")).toMatch(/\| Nails, steel \{#r[0-9a-z]{5}\} \| 100 \| \[x\] \|/);

  await page.locator("[data-dag-export]").click();
  const [dl] = await Promise.all([page.waitForEvent("download"), page.locator('[data-dag-export-as="csv"]').click()]);
  expect(dl.suggestedFilename()).toMatch(/-pipeline-supplies\.csv$/);
  expect(fs.readFileSync((await dl.path())!, "utf8")).toBe('Item,Qty,Done\r\n"Nails, steel",100,true\r\nGlue,3,false\r\n');
});

test("an edit somebody else makes arrives on the page, and the page's next edit keeps it", async ({ page }) => {
  const name = write("pipeline");
  await open(page, name);
  /* Another writer — an agent, the CLI — changes Acme while the page is open. */
  fs.writeFileSync(tableFile("pipeline"), TABLE.replace("| Acme {#racme} | 1200 |", "| Acme {#racme} | 1250 |"));
  await expect(page.locator('[data-dag-grid-at="0:1"]')).toHaveText("1250");
  await page.locator('[data-dag-grid-at="2:1"]').click();
  await page.keyboard.type("950");
  await page.keyboard.press("Enter");
  await expect
    .poll(() => read("pipeline"))
    .toBe(
      TABLE.replace("| Acme {#racme} | 1200 |", "| Acme {#racme} | 1250 |").replace(
        "| Initech {#rinit} | 900 |",
        "| Initech {#rinit} | 950 |",
      ),
    );
});

test("a table on a board is a live card of its tab, and a double-click opens it", async ({ page }) => {
  const name = write("pipeline");
  const id = await idOf(page, name);
  fs.writeFileSync(
    path.join(dir, "board.board.md"),
    `---\ntitle: Plan\n---\n\n\`\`\`md {#t1 x=0 y=0 w=560}\n![Pipeline](dag:${id})\n\`\`\`\n\n\`\`\`md {#t2 x=640 y=0 w=360}\n![Pipeline](dag:${id}#people)\n\`\`\`\n`,
  );
  await page.goto(await vaulted(page, `/?board=${folder}/board`));
  await page.waitForFunction(() => document.documentElement.dataset.dagReady === "1", null, { timeout: 20_000 });
  const deals = page.locator('[data-dag-tablecard="deals"]');
  await expect(deals).toContainText("Deals · 3 rows");
  await expect(deals.locator("tbody tr")).toHaveCount(3);
  await expect(page.locator('[data-dag-tablecard="people"]')).toContainText("Ada");

  /* The table changes, and the card with it — nothing on the board was written. */
  fs.writeFileSync(
    tableFile("pipeline"),
    TABLE.replace("| Ada {#rada1} | Engineer |", "| Ada {#rada1} | Engineer |\n| Grace {#rgrac} | Admiral |"),
  );
  await expect(page.locator('[data-dag-tablecard="people"]')).toContainText("Grace");

  await page.locator('[data-dag-tablecard="people"] tbody tr').first().dblclick();
  await expect(page).toHaveURL(/table=/);
  await expect(page.locator('[data-dag-page][aria-selected="true"]')).toHaveText("People");
});

test("a search finds a row, and opens the table on it, marked", async ({ page }) => {
  const name = write("pipeline", TABLE.replace("Engineer", "Cartographer"));
  await idOf(page, name);
  await open(page, name);
  await page.keyboard.press("Space");
  await page.keyboard.press("o");
  await page.locator(".dag-browser .dag-panel__input").fill("cartographer");
  const hit = page.locator(`[data-dag-hit="${name}"]`).first();
  await expect(hit).toBeVisible({ timeout: 10_000 });
  await hit.click();
  await expect(page).toHaveURL(/tab=people/);
  await expect(page.locator("[data-dag-grid-marked]")).toContainText("Ada");
});

test("?view=1 draws the grid with nothing to edit, and a snapshot draws every tab", async ({ page }) => {
  const name = write("pipeline");
  await page.goto(await vaulted(page, `/?table=${encodeURIComponent(name)}&view=1`));
  await expect(page.locator(".dag-grid--read")).toBeVisible();
  await expect(page.locator("[data-dag-grid-wrap]")).toHaveCount(0);
  await expect(page.locator(".dag-tablepage__title")).toHaveText("Pipeline");

  await page.goto(await vaulted(page, `/?table=${encodeURIComponent(name)}&snapshot=1`));
  await page.waitForFunction(() => document.documentElement.dataset.dagReady === "1", null, { timeout: 20_000 });
  await expect(page.locator(".dag-tablepage__tabname")).toHaveText(["Deals", "People"]);
});

test("the sidebar's New table makes one in a folder and opens it", async ({ page }) => {
  const name = write("pipeline");
  await open(page, name);
  await openSidebar(page);
  await expect(page.locator(`[data-dag-sidebar-file="${name}"]`)).toBeVisible();
  await clickOnHover(page, `[data-dag-sidebar-folder="${folder}"]`, `[data-dag-sidebar-add="${folder}"]`);
  await page.locator('[data-dag-sidebar-menu-item="new-table"]').click();
  await expect.poll(() => fs.readdirSync(dir).filter((f) => f.startsWith("Untitled") && f.endsWith(".table.md"))).toHaveLength(1);
  await expect.poll(() => new URL(page.url()).searchParams.get("table"), { timeout: 10_000 }).toBe(`${folder}/Untitled`);
  /* Named in the top bar, where its title is drawn; Escape keeps *Untitled*. */
  const box = page.locator("[data-dag-toolbar-name]");
  await expect(box).toHaveValue("Untitled");
  await box.press("Escape");
  await expect(page.locator("[data-dag-sidebar-name]")).toHaveCount(0);
  await expect(page.locator("[data-dag-grid-col]")).toHaveText(["Name", "Notes"]);
});

test("a CSV imported onto a board becomes a table, and its card is placed", async ({ page }) => {
  const name = write("pipeline");
  fs.writeFileSync(path.join(dir, "board.board.md"), `---\ntitle: Plan\n---\n`);
  await idOf(page, name);
  await page.goto(await vaulted(page, `/?board=${folder}/board`));
  await page.waitForFunction(() => document.documentElement.dataset.dagReady === "1", null, { timeout: 20_000 });
  await openMore(page);
  const leaf = `csv-${Date.now().toString(36)}`;
  await page
    .locator("[data-dag-import]")
    .setInputFiles({ name: `${leaf}.csv`, mimeType: "text/csv", buffer: Buffer.from("City,Pop\nOslo,700000\n") });
  await expect(page.locator("[data-dag-tablecard]")).toContainText("Oslo");
  await expect
    .poll(() => fs.readFileSync(path.join(dir, "board.board.md"), "utf8"))
    .toMatch(/```md \{#[^}]*w=560[^}]*\}\n!\[[^\]]+\]\(dag:[0-9a-z]{10}\)\n```/);
  /* The table is made at the top level, named after the file; it is this check's to take away. */
  const made = path.join(BOARDS, `${leaf}.table.md`);
  try {
    expect(fs.readFileSync(made, "utf8")).toContain("| Oslo {#r");
  } finally {
    await page.request.post(`/__board/delete?vault=${await suiteVault(page)}`, { data: { name: leaf, kind: "table" } });
  }
});
