import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

import { BOARDS } from "./boards";
import { pageMore } from "./more";
import { newFile, openSettings, openSidebar } from "./sidebar";

/** Open the calendar's Show menu — the kinds and the project — unless it is open. */
async function showMenu(page: import("@playwright/test").Page): Promise<void> {
  if (await page.locator("[data-dag-calendar-show-menu]").isVisible()) return;
  await page.locator("[data-dag-calendar-show]").click();
  await expect(page.locator("[data-dag-calendar-show-menu]")).toBeVisible();
}

/**
 * The calendar. Tasks, events and notes on one timeline, and an event
 * is a note with a `start:`: so every check that makes or changes one reads the **file**.
 *
 * Each test works inside a project of its own — a folder with a project note in it — and opens the
 * calendar filtered to that project. The suite runs eight wide over one `boards/`, and every note any
 * other test makes lands on today as a note: the filter is what lets a test see only its own. The
 * events and tasks sit in March 2031, far from anybody else's today.
 */

let folder = "";
let dir = "";
let problems: string[] = [];

test.beforeEach(({ page }, info) => {
  folder = `e2e-cal-${info.testId}`;
  dir = path.join(BOARDS, folder);
  fs.mkdirSync(dir, { recursive: true });
  problems = [];
  page.on("console", (msg) => {
    if (msg.type() === "error" || msg.type() === "warning") problems.push(msg.text());
  });
  page.on("pageerror", (e) => problems.push(String(e)));
});

test.afterEach(() => {
  /* Only the folder this test made, and only when it knows which (`CLAUDE.md`, *Things that will bite*). */
  if (folder) fs.rmSync(dir, { recursive: true, force: true });
  folder = "";
  expect(problems, "console output").toEqual([]);
});

const file = (leaf: string) => path.join(dir, `${leaf}.note.md`);
/* A note a test writes is `.note.md`; one the app makes is `.md` (decision 7) and is called its title (decision 14). */
const read = (leaf: string) => {
  for (const f of [path.join(dir, `${leaf}.md`), file(leaf)]) if (fs.existsSync(f)) return fs.readFileSync(f, "utf8");
  return "";
};

function write(leaf: string, title: string, lines: string[] = [], body = "What it is about.\n"): string {
  fs.writeFileSync(file(leaf), `---\ntitle: ${JSON.stringify(title)}\n${lines.map((l) => `${l}\n`).join("")}---\n${body}`);
  return `${folder}/${leaf}`;
}

/** Today here, as a `start:` or a `due:` is written. */
const today = (): string => {
  const at = new Date();
  return `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, "0")}-${String(at.getDate()).padStart(2, "0")}`;
};

async function idOf(page: Page, name: string): Promise<string> {
  let id: string | undefined;
  await expect
    .poll(async () => {
      id = ((await (await page.request.get("/__board/list")).json()) as { ids: Record<string, string> }).ids[name];
      return id;
    })
    .toBeTruthy();
  return id!;
}

/** Make this test's folder a project and open the calendar filtered to it. */
async function calendar(page: Page, query: string, expectItem?: string) {
  const project = write("project", "Calendar check", ["project: active"]);
  const id = await idOf(page, project);
  await page.goto(`/?project=${id}&${query}`);
  await expect(page.locator("[data-dag-calendar]")).toBeVisible();
  if (expectItem) await expect(page.locator(`[data-dag-cal-item="${expectItem}"]`).first()).toBeVisible({ timeout: 15_000 });
}

test("a month draws each thing on its days, and a click opens it", async ({ page }) => {
  const trip = write("trip", "Conference", ["start: 2031-03-12", "end: 2031-03-14"]);
  const talk = write("talk", "Keynote", ["start: 2031-03-13T09:00Z", "end: 2031-03-13T10:00Z"]);
  const ship = write("ship", "Ship it", ["status: in-progress", "start: 2031-03-10", "due: 2031-03-11"]);
  const done = write("done", "Old thing", ["status: done", "due: 2031-03-17"]);
  await calendar(page, "calendar=month&date=2031-03-15", trip);

  await expect(page.locator("[data-dag-calendar-title]")).toHaveText("March 2031");
  /* The week starts on Monday unless the account says otherwise: 2031-03-01 is a Saturday. */
  await expect(page.locator("[data-dag-calendar]")).toHaveAttribute("data-dag-calendar-first", "2031-02-24");
  await expect(page.locator(".dag-cal-names__day").first()).toHaveText("Mon");

  /* A span is one bar across the days it covers, in the week row they are in. */
  const bar = page.locator(`[data-dag-cal-item="${trip}"]`);
  await expect(bar).toHaveCount(1);
  await expect(bar).toHaveCSS("grid-column-end", "span 3");
  await expect(page.locator(`[data-dag-cal-item="${ship}"]`)).toHaveCSS("grid-column-end", "span 2");
  /* A timed event says its hour; a done task is struck through. */
  await expect(page.locator(`[data-dag-cal-item="${talk}"] .dag-calendar__time`)).toBeVisible();
  await expect(page.locator(`[data-dag-cal-item="${done}"]`)).toHaveAttribute("data-done", "");

  await bar.click();
  await expect.poll(() => new URL(page.url()).searchParams.get("note")).toBe(trip);
  await expect(page.locator("[data-dag-eventbar]")).toBeVisible({ timeout: 15_000 });
});

test("a note is on the day it was made, and each kind switches off at once and stays off", async ({ page }) => {
  const idea = write("idea", "An idea");
  const event = write("event", "Lunch", [`start: ${today()}`]);
  await calendar(page, "calendar=week", idea);
  await expect(page.locator(`[data-dag-cal-item="${idea}"]`)).toHaveAttribute("data-kind", "note");
  await expect(page.locator(`[data-dag-cal-item="${event}"]`)).toBeVisible();

  /* The three kinds are behind Show, with the project, in the one cluster at the right. */
  await showMenu(page);
  await page.locator('[data-dag-calendar-kind="note"]').click();
  await expect(page.locator('[data-dag-calendar-kind="note"]')).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator(`[data-dag-cal-item="${idea}"]`)).toHaveCount(0);
  await expect(page.locator(`[data-dag-cal-item="${event}"]`)).toBeVisible();

  /* Remembered — the account's, through the preferences the sync carries. */
  await page.reload();
  await expect(page.locator(`[data-dag-cal-item="${event}"]`)).toBeVisible({ timeout: 15_000 });
  await expect(page.locator(`[data-dag-cal-item="${idea}"]`)).toHaveCount(0);
  /* And Show says that something is held back. */
  await expect(page.locator("[data-dag-calendar-show] .dag-calendar__held")).toBeVisible();
  await showMenu(page);
  await page.locator('[data-dag-calendar-kind="note"]').click();
  await expect(page.locator(`[data-dag-cal-item="${idea}"]`)).toBeVisible();
});

test("a week's all-day row shows three lanes, then how many more, which unfolds it", async ({ page }) => {
  const names = ["one", "two", "three", "four", "five"].map((n) => write(`busy-${n}`, `Busy ${n}`, ["start: 2031-03-12"]));
  await calendar(page, "calendar=week&date=2031-03-12", names[0]);
  const row = page.locator("[data-dag-cal-allday]");
  await expect(row.locator("[data-dag-cal-item]")).toHaveCount(3);
  const more = row.locator('[data-dag-cal-allday-more="2031-03-12"]');
  await expect(more).toHaveText("2 more");
  await more.click();
  await expect(row.locator("[data-dag-cal-item]")).toHaveCount(5);
  await row.locator("[data-dag-cal-allday-less]").click();
  await expect(row.locator("[data-dag-cal-item]")).toHaveCount(3);
});

test("the week starts on the day Settings says, Monday until then", async ({ page }) => {
  write("x", "Something", ["start: 2031-03-12"]);
  await calendar(page, "calendar=week&date=2031-03-12");
  await expect(page.locator("[data-dag-calendar]")).toHaveAttribute("data-dag-calendar-first", "2031-03-10");
  await openSettings(page, "calendar");
  await page.locator("[data-dag-setting-week-start]").selectOption("0");
  await page.keyboard.press("Escape");
  await expect(page.locator("[data-dag-calendar]")).toHaveAttribute("data-dag-calendar-first", "2031-03-09");
  await expect(page.locator(".dag-cal-cols__weekday").first()).toHaveText("Sun");
  /* And back, so the next test to run in this browser profile starts on Monday. */
  await openSettings(page, "calendar");
  await page.locator("[data-dag-setting-week-start]").selectOption("1");
  await page.keyboard.press("Escape");
  await expect(page.locator("[data-dag-calendar]")).toHaveAttribute("data-dag-calendar-first", "2031-03-10");
});

test("times are shown and written in the time zone Settings says", async ({ page }) => {
  const talk = write("talk", "Keynote", ["start: 2031-03-13T09:00Z", "end: 2031-03-13T10:00Z"]);
  await page.goto(`/?note=${encodeURIComponent(talk)}`);
  await expect(page.locator("[data-dag-eventbar]")).toHaveAttribute("data-dag-eventbar", "timed", { timeout: 15_000 });
  await openSettings(page, "calendar");
  await page.locator("[data-dag-setting-time-zone]").selectOption("Asia/Tokyo");
  await page.keyboard.press("Escape");
  /* 09:00 UTC is 18:00 in Tokyo, whatever zone the machine running this is in. */
  await expect(page.locator("[data-dag-eventbar-start-time]")).toHaveValue("18:00");
  await expect(page.locator("[data-dag-eventbar-zone]")).toHaveText("GMT+9");
  await page.locator("[data-dag-eventbar-start-time]").fill("10:00");
  await page.locator("[data-dag-eventbar-start-time]").blur();
  await expect.poll(() => read("talk")).toContain("start: 2031-03-13T10:00+09:00");
  expect(read("talk")).toContain("end: 2031-03-13T11:00+09:00");
  /* And back to the browser's own, so the next test in this profile starts where it expects. */
  await openSettings(page, "calendar");
  await page.locator("[data-dag-setting-time-zone]").selectOption("");
  await page.keyboard.press("Escape");
});

test("a run of days is as long as it is asked, and the arrows move by that many", async ({ page }) => {
  const talk = write("talk", "Keynote", ["start: 2031-03-13T09:00Z", "end: 2031-03-13T10:30Z"]);
  await calendar(page, "calendar=days&days=5&date=2031-03-11", talk);
  await expect(page.locator(".dag-cal-column")).toHaveCount(5);
  await expect(page.locator("[data-dag-calendar]")).toHaveAttribute("data-dag-calendar-last", "2031-03-15");
  /* In its day's column, at its hour, as tall as it lasts. */
  const block = page.locator(`[data-dag-cal-column="2031-03-13"] [data-dag-cal-item="${talk}"]`);
  await expect(block).toBeVisible();
  const style = await block.getAttribute("style");
  const at = await page.evaluate(() => new Date("2031-03-13T09:00Z").getHours() * 60 + new Date("2031-03-13T09:00Z").getMinutes());
  expect(style).toContain(`--at: ${at}`);
  expect(style).toContain("--len: 90");

  await page.locator("[data-dag-calendar-count]").fill("3");
  await expect(page.locator(".dag-cal-column")).toHaveCount(3);
  await page.locator("[data-dag-calendar-next]").click();
  await expect(page.locator("[data-dag-calendar]")).toHaveAttribute("data-dag-calendar-first", "2031-03-14");
  await expect(page).toHaveURL(/days=3/);
});

test("a drag in the hour grid makes an event with that start and end, in the project's folder", async ({ page }) => {
  write("anchor", "Anchor", ["start: 2031-03-12"]);
  await calendar(page, "calendar=week&date=2031-03-12", `${folder}/anchor`);
  /* From 10:00 to 11:30. The grid opens scrolled to the working day, so both are on screen, and the
     column's box — most of it scrolled out of the top — still says where each minute is. */
  const column = page.locator('[data-dag-cal-column="2031-03-12"]');
  const b = (await column.boundingBox())!;
  const minute = b.height / 1440;
  const x = b.x + b.width / 2;
  await page.mouse.move(x, b.y + 600 * minute + 2);
  await page.mouse.down();
  await page.mouse.move(x, b.y + 650 * minute, { steps: 4 });
  await page.mouse.move(x, b.y + 680 * minute, { steps: 4 });
  await page.mouse.up();

  const card = page.locator("[data-dag-calendar-new]");
  await expect(card).toBeVisible();
  await expect(card.locator("[data-dag-calendar-new-when]")).toContainText("10:00 – 11:30");
  await card.locator("[data-dag-calendar-new-title]").fill("Planning");
  await card.locator("[data-dag-calendar-new-title]").press("Enter");
  await expect(card).toHaveCount(0);

  await expect.poll(() => read("Planning")).toMatch(/^---\nstart: 2031-03-12T10:00[+-]\d{2}:\d{2}\nend: 2031-03-12T11:30[+-]\d{2}:\d{2}\nid: [0-9a-z]{10}\n---\n$/);
  await expect(page.locator(`[data-dag-cal-item="${folder}/Planning"]`)).toBeVisible();
});

test("a click on a month's day asks for an all-day event on it, and Escape leaves nothing", async ({ page }) => {
  write("anchor", "Anchor", ["start: 2031-03-03"]);
  await calendar(page, "calendar=month&date=2031-03-15", `${folder}/anchor`);
  const cell = page.locator('[data-dag-cal-day="2031-03-19"]');
  const b = (await cell.boundingBox())!;
  await page.mouse.click(b.x + b.width / 2, b.y + b.height - 10);
  const card = page.locator("[data-dag-calendar-new]");
  await expect(card.locator("[data-dag-calendar-new-when]")).toContainText("Wed, Mar 19, 2031");
  await card.locator("[data-dag-calendar-new-title]").press("Escape");
  await expect(card).toHaveCount(0);

  /* A drag across three days is three days. */
  const to = (await page.locator('[data-dag-cal-day="2031-03-21"]').boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height - 10);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height - 10, { steps: 6 });
  await page.mouse.up();
  await card.locator("[data-dag-calendar-new-title]").fill("Retreat");
  await card.locator("[data-dag-calendar-new-make]").click();
  await expect.poll(() => read("Retreat")).toMatch(/^---\nstart: 2031-03-19\nend: 2031-03-21\nid: [0-9a-z]{10}\n---\n$/);
  expect(fs.readdirSync(dir).sort()).toEqual(["Retreat.md", "anchor.note.md", "project.note.md"]);
});

test("New event makes one at the next hour, and its bar moves it and makes it all day", async ({ page }) => {
  await page.goto(`/?calendar=1`);
  await newFile(page, "event");
  await expect(page.locator("[data-dag-eventbar]")).toHaveAttribute("data-dag-eventbar", "timed", { timeout: 15_000 });
  const name = new URL(page.url()).searchParams.get("note")!;
  const leaf = name.slice(name.lastIndexOf("/") + 1);
  const at = path.join(BOARDS, `${name}.md`);
  const text = () => fs.readFileSync(at, "utf8");
  try {
    expect(text()).toMatch(/^---\nstart: \d{4}-\d{2}-\d{2}T\d{2}:00[+-]\d{2}:\d{2}\nend: \d{4}-\d{2}-\d{2}T\d{2}:00[+-]\d{2}:\d{2}\nid: [0-9a-z]{10}\n---\n$/);
    /* Moving the start keeps how long it is. */
    await page.locator("[data-dag-eventbar-start-day]").fill("2031-03-12");
    await page.locator("[data-dag-eventbar-start-time]").fill("14:30");
    await expect.poll(text).toMatch(/start: 2031-03-12T14:30[+-]\d{2}:\d{2}\nend: 2031-03-12T15:30[+-]\d{2}:\d{2}\n/);
    await page.locator("[data-dag-eventbar-allday]").check();
    await expect.poll(text).toMatch(/^---\nstart: 2031-03-12\nid: [0-9a-z]{10}\n---\n$/);
    await expect(page.locator("[data-dag-eventbar]")).toHaveAttribute("data-dag-eventbar", "all-day");
    /* The way back is in the top bar's `⋯`. */
    await pageMore(page, "data-dag-eventbar-unevent");
    await expect.poll(text).toMatch(/^---\nid: [0-9a-z]{10}\n---\n$/);
    /* The way back is in the top bar's `⋯`. */
    await page.locator("[data-dag-page-more]").click();
    await expect(page.locator("[data-dag-note-make-event]")).toBeVisible();
    expect(leaf).toMatch(/^Untitled/);
  } finally {
    fs.rmSync(at, { force: true });
  }
});

test("a plain note is made an event from its row, and the row says so", async ({ page }) => {
  const plain = write("plain", "Meeting notes");
  await page.goto(`/?note=${encodeURIComponent(plain)}`);
  await openSidebar(page);
  const row = page.locator(`[data-dag-sidebar-file="${plain}"]`);
  await expect(row).toBeVisible({ timeout: 15_000 });
  await row.click({ button: "right" });
  await page.locator('[data-dag-sidebar-menu-item="make-event"]').click();
  await expect.poll(() => read("plain")).toMatch(/start: \d{4}-\d{2}-\d{2}T\d{2}:00[+-]\d{2}:\d{2}\nend: /);
  await expect(row).toHaveAttribute("data-dag-sidebar-event", /T\d{2}:00/);
  /* An event is not offered as a task: a status would make its start a task's. */
  await row.click({ button: "right" });
  await expect(page.locator('[data-dag-sidebar-menu-item="make-task"]')).toHaveCount(0);
  await page.locator('[data-dag-sidebar-menu-item="unmake-event"]').click();
  await expect.poll(() => read("plain")).toBe('---\ntitle: "Meeting notes"\n---\nWhat it is about.\n');
});

test("a project's bar opens its calendar, and an event placed on a board or viewed read-only says when", async ({ page }) => {
  const project = write("project", "Calendar check", ["project: active"]);
  const trip = write("trip", "Conference", ["start: 2031-03-12", "end: 2031-03-14"]);
  const pid = await idOf(page, project);
  const tid = await idOf(page, trip);
  await page.goto(`/?note=${encodeURIComponent(project)}`);
  await page.locator("[data-dag-projectbar-calendar]").click();
  await expect.poll(() => new URL(page.url()).searchParams.get("project")).toBe(pid);
  await expect(page.locator("[data-dag-calendar]")).toBeVisible();
  await showMenu(page);
  await expect(page.locator("[data-dag-calendar-project]")).toHaveValue(project);

  fs.writeFileSync(path.join(dir, "board.board.md"), `---\ntitle: Trip board\n---\n\n\`\`\`md {#t1 x=0 y=0 w=360}\n![Conference](dag:${tid})\n\`\`\`\n`);
  await page.goto(`/?board=${folder}/board`);
  await page.waitForFunction(() => document.documentElement.dataset.dagReady === "1", null, { timeout: 20_000 });
  await expect(page.locator(`[data-dag-embed="${tid}"][data-dag-embed-kind="event"]`)).toContainText("Event · Wed, Mar 12, 2031 – Fri, Mar 14, 2031");

  await page.goto(`/?view=1&note=${encodeURIComponent(trip)}`);
  await expect(page.locator('[data-dag-eventline="2031-03-12"]')).toContainText("Mar 12, 2031");
  await expect(page.locator("[data-dag-eventbar]")).toHaveCount(0);
});

/** Press on `from`, cross the slop, and let go `dx`/`dy` away — with `mid` run while it is held. */
async function drag(page: Page, from: { x: number; y: number }, dx: number, dy: number, mid?: () => Promise<void>) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 4, from.y + 4, { steps: 2 });
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 8 });
  if (mid) await mid();
  await page.mouse.up();
}

test("a drag moves an event along the days, and a task with both its dates", async ({ page }) => {
  const trip = write("trip", "Conference", ["start: 2031-03-12", "end: 2031-03-14"]);
  const ship = write("ship", "Ship it", ["status: todo", "start: 2031-03-10", "due: 2031-03-11"]);
  await calendar(page, "calendar=month&date=2031-03-15", trip);
  const cell = async (d: string) => (await page.locator(`.dag-cal-month [data-dag-cal-day="${d}"]`).boundingBox())!;
  const step = (await cell("2031-03-13")).x - (await cell("2031-03-12")).x;

  const bar = page.locator(`[data-dag-cal-item="${trip}"]`);
  const b = (await bar.boundingBox())!;
  /* While it is held, the bar it came from is dimmed and the days it would land on are marked. */
  await drag(page, { x: b.x + 12, y: b.y + b.height / 2 }, step * 2, 0, async () => {
    await expect(bar).toHaveAttribute("data-dag-cal-moving", "");
    await expect(page.locator('[data-dag-cal-day="2031-03-16"][data-dag-cal-picked]')).toHaveCount(1);
    await expect(page.locator("[data-dag-cal-picked]")).toHaveCount(3);
  });
  await expect.poll(() => read("trip")).toContain("start: 2031-03-14\nend: 2031-03-16\n");
  /* The drop is not a click: the calendar is still what is open. */
  expect(new URL(page.url()).searchParams.get("note")).toBeNull();

  /* A Monday to the Sunday before it is a row up and across: the drag goes where the day is drawn. */
  const t = (await page.locator(`[data-dag-cal-item="${ship}"]`).boundingBox())!;
  const mon = await cell("2031-03-10");
  const sun = await cell("2031-03-09");
  await drag(page, { x: t.x + 12, y: t.y + t.height / 2 }, sun.x - mon.x, sun.y - mon.y);
  await expect.poll(() => read("ship")).toContain("status: todo\nstart: 2031-03-09\ndue: 2031-03-10\n");
});

test("a drag in the hour grid moves an event by quarter hours and days, keeping its length; Escape puts it back", async ({ page }) => {
  /* In UTC, and every expectation read in the browser: the machine's Node and its Chromium need not
     agree about a zone's offset in 2031, and the browser's is the one the grid is drawn in. */
  const talk = write("talk", "Keynote", ["start: 2031-03-12T09:00Z", "end: 2031-03-12T10:30Z"]);
  write("idea", "An idea", [], "Made today, so it is not in this week.\n");
  await calendar(page, "calendar=week&date=2031-03-12", talk);
  const block = page.locator(`[data-dag-cal-item="${talk}"]`);
  const col = async (d: string) => (await page.locator(`[data-dag-cal-column="${d}"]`).boundingBox())!;
  const c12 = await col("2031-03-12");
  const c13 = await col("2031-03-13");
  const hour = c12.height / 24;
  const b = (await block.boundingBox())!;
  const from = { x: b.x + b.width / 2, y: b.y + 8 };

  /* Escape while it is held puts it back, and writes nothing. */
  const before = read("talk");
  await drag(page, from, 0, hour * 3, async () => {
    await expect(page.locator("[data-dag-cal-moving-to]")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator("[data-dag-cal-moving-to]")).toHaveCount(0);
  });
  await page.waitForTimeout(300);
  expect(read("talk")).toBe(before);

  /* A day on and an hour and a quarter later, the ghost saying when it would start. */
  const wall = (iso: string) => page.evaluate((at) => new Date(at).toTimeString().slice(0, 5), iso);
  const starts = await wall("2031-03-13T10:15Z");
  const ends = await wall("2031-03-13T11:45Z");
  await drag(page, from, c13.x - c12.x, hour * 1.25, async () => {
    await expect(page.locator(`[data-dag-cal-column="2031-03-13"] [data-dag-cal-moving-to="${starts}"]`)).toBeVisible();
  });
  await expect.poll(() => read("talk")).toMatch(new RegExp(`start: 2031-03-13T${starts}[+-]\\d{2}:\\d{2}\nend: 2031-03-13T${ends}[+-]\\d{2}:\\d{2}\n`));
  await expect(page.locator(`[data-dag-cal-column="2031-03-13"] [data-dag-cal-item="${talk}"]`)).toBeVisible();
  expect(new URL(page.url()).searchParams.get("note")).toBeNull();

  /* And a press that does not move is still a click that opens it. */
  await page.locator(`[data-dag-cal-item="${talk}"]`).click();
  await expect.poll(() => new URL(page.url()).searchParams.get("note")).toBe(talk);
});

test("an end is pulled: a bar's by days, a task's due date, a block's by quarter hours", async ({ page }) => {
  const trip = write("trip", "Conference", ["start: 2031-03-12", "end: 2031-03-14"]);
  const ship = write("ship", "Ship it", ["status: todo", "start: 2031-03-10", "due: 2031-03-11"]);
  const talk = write("talk", "Keynote", ["start: 2031-03-12T09:00Z", "end: 2031-03-12T10:30Z"]);
  await calendar(page, "calendar=month&date=2031-03-15", trip);
  const cell = async (d: string) => (await page.locator(`.dag-cal-month [data-dag-cal-day="${d}"]`).boundingBox())!;
  const step = (await cell("2031-03-13")).x - (await cell("2031-03-12")).x;
  const mid = async (sel: string) => {
    const b = (await page.locator(sel).boundingBox())!;
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  };

  /* The trip's last day two later; its first stays. */
  await drag(page, await mid(`[data-dag-cal-item="${trip}"] [data-dag-cal-edge="end"]`), step * 2, 0, async () => {
    await expect(page.locator("[data-dag-cal-picked]")).toHaveCount(5);
  });
  await expect.poll(() => read("trip")).toContain("start: 2031-03-12\nend: 2031-03-16\n");
  expect(new URL(page.url()).searchParams.get("note")).toBeNull();

  /* The task's due date two later; its start stays. */
  await drag(page, await mid(`[data-dag-cal-item="${ship}"] [data-dag-cal-edge="end"]`), step * 2, 0);
  await expect.poll(() => read("ship")).toContain("start: 2031-03-10\ndue: 2031-03-13\n");

  /* A block's bottom half an hour lower, the ghost saying where it would end. */
  await page.goto(page.url().replace("calendar=month&date=2031-03-15", "calendar=week&date=2031-03-12"));
  const block = page.locator(`[data-dag-cal-item="${talk}"]`);
  await expect(block).toBeVisible();
  const hour = (await page.locator('[data-dag-cal-column="2031-03-12"]').boundingBox())!.height / 24;
  const wall = (iso: string) => page.evaluate((at) => new Date(at).toTimeString().slice(0, 5), iso);
  const starts = await wall("2031-03-12T09:00Z");
  const ends = await wall("2031-03-12T11:00Z");
  await drag(page, await mid(`[data-dag-cal-item="${talk}"] [data-dag-cal-edge="end"]`), 0, hour / 2, async () => {
    await expect(page.locator(`[data-dag-cal-moving-end="${ends}"]`)).toBeVisible();
  });
  await expect.poll(() => read("talk")).toMatch(new RegExp(`start: 2031-03-12T09:00Z\nend: 2031-03-12T${ends}[+-]\\d{2}:\\d{2}\n`));
  expect(starts).toBe(await wall("2031-03-12T09:00Z"));
});

test("a timed event let go on the all-day row is all day there, and an all-day one let go in the grid is an hour", async ({ page }) => {
  const talk = write("talk", "Keynote", ["start: 2031-03-12T09:00Z", "end: 2031-03-12T10:00Z"]);
  const trip = write("trip", "Offsite", ["start: 2031-03-13"]);
  await calendar(page, "calendar=week&date=2031-03-12", talk);
  const box = async (sel: string) => (await page.locator(sel).boundingBox())!;

  const b = await box(`[data-dag-cal-item="${talk}"]`);
  const cell = await box('.dag-cal-allday [data-dag-cal-day="2031-03-14"]');
  const from = { x: b.x + b.width / 2, y: b.y + 8 };
  await drag(page, from, cell.x + cell.width / 2 - from.x, cell.y + cell.height / 2 - from.y, async () => {
    await expect(page.locator('.dag-cal-allday [data-dag-cal-day="2031-03-14"][data-dag-cal-picked]')).toHaveCount(1);
  });
  await expect.poll(() => read("talk")).toMatch(/start: 2031-03-14\n---/);
  await expect(page.locator(`.dag-cal-allday [data-dag-cal-item="${talk}"]`)).toBeVisible();

  /* An all-day bar into the grid, inside the quarter hour from two in the afternoon on the 15th. */
  const t = await box(`[data-dag-cal-item="${trip}"]`);
  const col = await box('[data-dag-cal-column="2031-03-15"]');
  const hour = col.height / 24;
  const start = { x: t.x + 12, y: t.y + t.height / 2 };
  await page.locator('[data-dag-cal-column="2031-03-15"]').scrollIntoViewIfNeeded();
  const col2 = await box('[data-dag-cal-column="2031-03-15"]');
  await drag(page, start, col2.x + col2.width / 2 - start.x, col2.y + hour * 14 + hour / 8 - start.y, async () => {
    await expect(page.locator('[data-dag-cal-column="2031-03-15"] [data-dag-cal-moving-to="14:00"]')).toBeVisible();
  });
  await expect.poll(() => read("trip")).toMatch(/start: 2031-03-15T14:00[+-]\d{2}:\d{2}\nend: 2031-03-15T15:00[+-]\d{2}:\d{2}\n/);
});
