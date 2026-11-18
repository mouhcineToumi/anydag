import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { BOARDS, ROOT } from "./boards";
import { expect, type Locator, type Page, test } from "./fixture";
import { newFile, openSettings, openSidebar, type SettingsTab, settingsTab } from "./sidebar";

/**
 * **Every top-level surface of the chrome, in light and dark** (#528): one screenshot baseline each,
 * so a change to how a page looks is a change somebody has to look at. The diagram surface is
 * `reference.spec.ts`'s; this is the app around it — the sidebar, the top bar and the dock, each page
 * a file opens to, every Settings pane and the dialogs.
 *
 * These are also the pictures the local visual review compares (`scripts/visual-review.mjs`): it
 * renders this spec at a pull request's merge base and at its head and hands the pairs that differ
 * to an agent. A surface added here is a surface that review sees.
 *
 * **What makes a picture the same twice.**
 *
 * - **A vault of its own** (`graph.spec.ts`'s reason): the suite's vault changes under a screenshot
 *   while other workers write to it, and the sidebar lists it. One per worker, named the same in
 *   every one, holding the fixed files below.
 * - **The clock is pinned** to 11 March 2031, 10:00 UTC (the image's zone), so the calendar's month,
 *   *today*, and every due date on the Tasks page say the same thing every run. The trash is the one
 *   page left on the real clock: the server stamps a deletion with its own time, and a page a few
 *   years ahead of it would count the days left from the wrong end.
 * - **What differs by machine or release is masked**: the version, the server's address, and a
 *   folder's path on disk (the vault is a fresh temp folder). The graph's WebGL drawing is hidden
 *   rather than masked, since its layout is a simulation's (`graph.spec.ts` says why it has no
 *   baseline of its own): what this one holds is the page around it.
 * - **A dialog's own focus is kept**: what has the caret on opening is part of how it looks.
 *
 * Settings → AI and Settings → Shortcuts are `settings.spec.ts`'s already, and a note's callouts
 * `callouts.spec.ts`'s.
 */

const THEMES = ["paper", "paper-dark"] as const;
type Theme = (typeof THEMES)[number];

/** The pinned *now*, a Tuesday: the calendar's month and the Tasks page's groups both read it. */
const NOW = new Date("2031-03-11T10:00:00Z");

test.use({ viewport: { width: 1280, height: 800 } });

const BOARD = `---
title: Launch plan
---

\`\`\`flow {#steps x=0 y=0}
lane team "Team" hue=teal {
  step 01 "Draft the copy" "docs · v2"
  decision 02 "Approved?"
  step 03 "Ship it" "beta · 14th" done
}
01 --> 02
02 --> 03 "yes"
\`\`\`

\`\`\`md {#why x=0 y=260 w=360}
**Why now.** The beta closes on the 14th, and the copy is the last thing open.
\`\`\`
`;

const NOTE = `---
tags: [launch, writing]
---
Five customers interviewed this week. What they asked for, in order: an export that keeps the
links, a dark theme, and [[Launch plan]] shared read-only.

## What to do with it

- Write the copy before the review.
- Price it at $p = 12$ a seat, and check the sum $\\sum_i p_i$ against the plan.
- Ask [[Interview customers]] for two more names.

> The export came up in every interview.
`;

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
| Umbrella {#rumbr} | 2400 | Lead | [ ] |
`;

const QUIZ = `---
title: Postgres basics
---

A short drill.

## What does VACUUM reclaim? {#qvac}

* [ ] Index bloat only
* [x] The space of dead tuples
* [ ] Old WAL segments

> Dead tuples stay until VACUUM marks their space reusable.

## Which fields decide visibility? {#qvis}

- [x] \`xmin\`
- [x] \`xmax\`
- [ ] \`ctid\`
`;

/** The vault's files, by path inside it. A project is a folder holding its note and its tasks. */
const FILES: Record<string, string> = {
  "Launch plan.board.md": BOARD,
  "Field notes.md": NOTE,
  "Pipeline.table.md": TABLE,
  "Postgres basics.quiz.md": QUIZ,
  "launch/Launch.md": "---\nproject: active\nhue: teal\n---\n# Launch\n\nThe spring release.\n",
  "launch/Write the copy.md": "---\nstatus: todo\ndue: 2031-03-12\npriority: high\n---\n# Write the copy\n",
  "launch/Interview customers.md": "---\nstatus: in-progress\ndue: 2031-03-11\n---\n# Interview customers\n",
  "launch/Book the room.md": "---\nstatus: done\n---\n# Book the room\n",
  "launch/Launch review.md": "---\nstart: 2031-03-13T14:00+00:00\nend: 2031-03-13T15:00+00:00\n---\n# Launch review\n",
  "launch/Beta closes.md": "---\nstart: 2031-03-14\n---\n# Beta closes\n",
  "Renew the domain.md": "---\nstatus: todo\ndue: 2031-03-20\n---\n# Renew the domain\n",
};

/* ── The vault ──────────────────────────────────────────────────────────────────────────────── */

let ws = "";
let parent = "";

test.beforeAll(async ({ request }) => {
  parent = fs.mkdtempSync(path.join(os.tmpdir(), "anydag-e2e-surfaces-"));
  const r = await request.post("/api/vaults/create", { data: { parent, name: "Surfaces" } });
  expect(r.ok(), await r.text()).toBe(true);
  const v = ((await r.json()) as { vault: { id: string; path: string } }).vault;
  ws = v.id;
  /* Written a week before the pinned *now*: the Tasks page says how old each one is. */
  const written = new Date(NOW.getTime() - 7 * 24 * 3600_000);
  for (const [file, text] of Object.entries(FILES)) {
    const at = path.join(v.path, file);
    fs.mkdirSync(path.dirname(at), { recursive: true });
    fs.writeFileSync(at, text);
    fs.utimesSync(at, written, written);
  }
  /* Creating a vault makes it the server's default; the suite's own goes back at once. */
  await request.post("/api/vaults/open", { data: { path: BOARDS } });
});

test.afterAll(async ({ request }) => {
  if (ws) await request.post("/api/vaults/close", { data: { id: ws, forget: true } }).catch(() => undefined);
  /* Only the temp folder this worker made, named in full. */
  if (parent.startsWith(os.tmpdir()) && parent.length > os.tmpdir().length + 1)
    fs.rmSync(parent, { recursive: true, force: true });
});

let problems: string[] = [];

test.beforeEach(({ page }) => {
  problems = [];
  page.on("pageerror", (e) => problems.push(String(e)));
});

test.afterEach(() => {
  expect(problems, "page errors").toEqual([]);
});

/* ── Getting to a surface ───────────────────────────────────────────────────────────────────── */

/** Opens `query` in the vault, in `theme`, with the clock pinned unless `clock` is false. */
async function go(page: Page, theme: Theme, query: string, { clock = true } = {}): Promise<void> {
  if (clock) await page.clock.setFixedTime(NOW);
  await page.goto(`/?${query}${query ? "&" : ""}vault=${ws}&theme=${theme}`);
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
}

/** Every font in, and nothing still moving. */
async function settled(page: Page): Promise<void> {
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}

async function boardReady(page: Page): Promise<void> {
  await page.waitForFunction(() => document.documentElement.dataset.dagReady === "1", null, { timeout: 20_000 });
}

/** The sidebar docked and listing the vault, which is what every page surface is drawn beside. */
async function withSidebar(page: Page): Promise<void> {
  await openSidebar(page);
  await expect(page.locator('[data-dag-sidebar-file="Launch plan"]')).toBeVisible({ timeout: 15_000 });
}

/** Takes focus off whatever has it, so a focus ring is not part of a page's picture. */
async function blur(page: Page): Promise<void> {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
}

/** What changes with the machine or the release, never with a change to the chrome. */
const volatile = (page: Page): Locator[] => [
  page.locator("[data-dag-setting-version]"),
  page.locator("[data-dag-setting-server]"),
  page.locator("[data-dag-setting-vault-path]"),
  /* The `anydag mcp` line names the vault's folder, a fresh temp folder every run. */
  page.locator("[data-dag-setting-copy-value]"),
];

async function shot(page: Page, target: Locator, name: string): Promise<void> {
  await settled(page);
  await expect(target).toHaveScreenshot(`${name}.png`, { mask: volatile(page) });
}

/* ── Pages ──────────────────────────────────────────────────────────────────────────────────── */

interface PageSurface {
  name: string;
  open: (page: Page, theme: Theme) => Promise<void>;
  tag?: "@smoke";
}

const PAGES: PageSurface[] = [
  {
    /* The shell at rest: the sidebar's tree, the top bar, the dock, a board drawn in it. */
    name: "board",
    tag: "@smoke",
    open: async (page, theme) => {
      await go(page, theme, `board=${encodeURIComponent("Launch plan")}`);
      await boardReady(page);
      /* A board that does not parse still draws: the picture would hold an error card. */
      await expect(page.locator(".dag-error, [data-dag-error], [data-dag-stale]")).toHaveCount(0);
      await withSidebar(page);
      await blur(page);
    },
  },
  {
    name: "home",
    open: async (page, theme) => {
      await go(page, theme, "");
      await expect(page.locator("[data-dag-welcome]")).toBeVisible();
      await withSidebar(page);
      await blur(page);
    },
  },
  {
    name: "note",
    open: async (page, theme) => {
      await go(page, theme, `note=${encodeURIComponent("Field notes")}`);
      await expect(page.locator("[data-dag-note-view]")).toBeVisible();
      await expect(page.locator(".katex").first()).toBeVisible({ timeout: 15_000 });
      await withSidebar(page);
      await blur(page);
    },
  },
  {
    name: "table",
    open: async (page, theme) => {
      await go(page, theme, "table=Pipeline");
      await expect(page.locator("[data-dag-grid-wrap]")).toBeVisible();
      await withSidebar(page);
      await blur(page);
    },
  },
  {
    name: "quiz",
    open: async (page, theme) => {
      await go(page, theme, `quiz=${encodeURIComponent("Postgres basics")}`);
      await expect(page.locator('[data-dag-quiz-question="qvac"]')).toBeVisible();
      await withSidebar(page);
      await blur(page);
    },
  },
  {
    name: "quizzes",
    open: async (page, theme) => {
      await go(page, theme, "quizzes=1");
      await expect(page.locator('[data-dag-quizzes-card="Postgres basics"]')).toBeVisible({ timeout: 15_000 });
      await withSidebar(page);
      await blur(page);
    },
  },
  {
    name: "tasks",
    open: async (page, theme) => {
      await go(page, theme, "tasks=1");
      await expect(page.locator('[data-dag-task-row="launch/Write the copy"]')).toBeVisible({ timeout: 15_000 });
      await expect(page.locator('[data-dag-task-row="Renew the domain"]')).toBeVisible();
      await withSidebar(page);
      await blur(page);
    },
  },
  {
    name: "calendar",
    open: async (page, theme) => {
      await go(page, theme, "calendar=month&date=2031-03-11");
      await expect(page.locator("[data-dag-calendar]")).toBeVisible();
      await expect(page.locator('[data-dag-cal-item="launch/Launch review"]').first()).toBeVisible({ timeout: 15_000 });
      await withSidebar(page);
      await blur(page);
    },
  },
  {
    name: "graph",
    open: async (page, theme) => {
      await go(page, theme, "graph=1");
      await expect(page.locator("[data-dag-graph-counts]")).toBeVisible({ timeout: 30_000 });
      await expect(page.locator('[data-dag-graph="rest"]')).toBeVisible({ timeout: 30_000 });
      await withSidebar(page);
      await blur(page);
      /* The drawing is the simulation's, not the chrome's: hidden, so the page around it is the picture. */
      await page.addStyleTag({ content: "[data-dag-graph-surface], .dag-graph__labels { visibility: hidden !important; }" });
      await expect(page.locator("[data-dag-graph-canvas]")).toBeHidden();
    },
  },
  {
    name: "trash",
    open: async (page, theme) => {
      /* Something in it, deleted just now, on the real clock (see the top of the file). */
      const r = await page.request.post(`/__board/create?vault=${ws}`, {
        data: { name: `Old plan ${theme}`, text: BOARD.replace("Launch plan", "Old plan") },
      });
      expect(r.ok(), await r.text()).toBe(true);
      const made = ((await r.json()) as { name: string }).name;
      await page.request.post(`/__board/delete?vault=${ws}`, { data: { name: made } });
      await go(page, theme, "trash=1", { clock: false });
      await expect(page.locator(`[data-dag-trash-entry="${made}"]`)).toBeVisible({ timeout: 15_000 });
      await withSidebar(page);
      await blur(page);
      /* Only this theme's own entry: the other theme's run may have put one in before it. */
      const other = THEMES.find((t) => t !== theme)!;
      await page
        .locator(`[data-dag-trash-entry="Old plan ${other}"]`)
        .evaluateAll((els) => els.forEach((el) => ((el as HTMLElement).style.display = "none")));
    },
  },
];

for (const theme of THEMES) {
  for (const s of PAGES) {
    test(`${s.name} · ${theme}`, s.tag && theme === "paper" ? { tag: s.tag } : {}, async ({ page }) => {
      await s.open(page, theme);
      await shot(page, page.locator("body"), `${s.name}-${theme}`);
    });
  }
}

/* ── Settings, a pane at a time ─────────────────────────────────────────────────────────────── */

/* AI and Shortcuts have theirs in `settings.spec.ts`. */
const PANES: SettingsTab[] = [
  "appearance",
  "calendar",
  "quizzes",
  "providers",
  "vault-general",
  "vault-files",
  "tags",
  "export",
  "sync",
  "agent-access",
  "board-layout",
  "privacy",
  "about",
];

for (const theme of THEMES) {
  for (const tab of PANES) {
    test(`settings › ${tab} · ${theme}`, async ({ page }) => {
      /* From a board, which is what draws the *This board* tab. */
      await go(page, theme, `board=${encodeURIComponent("Launch plan")}`);
      await boardReady(page);
      await openSettings(page);
      await settingsTab(page, tab);
      const pane = page.locator(`[data-dag-settings-pane="${tab}"]`);
      /* Off the tab button and its focus ring, onto the pane's blank top, as `settings.spec.ts` does. */
      const box = (await pane.boundingBox())!;
      await page.mouse.click(box.x + box.width / 2, box.y + 4);
      await shot(page, pane, `settings-${tab}-${theme}`);
    });
  }
}

/* ── Dialogs, menus and the one question the app asks ───────────────────────────────────────── */

interface DialogSurface {
  name: string;
  /** Opens it and answers what to photograph. */
  open: (page: Page, theme: Theme) => Promise<Locator>;
}

const feedback = JSON.parse(fs.readFileSync(path.join(ROOT, "test", "fixtures", "feedback.json"), "utf8")) as {
  get: unknown;
};

const DIALOGS: DialogSurface[] = [
  {
    name: "search",
    open: async (page, theme) => {
      await go(page, theme, `board=${encodeURIComponent("Launch plan")}`);
      await boardReady(page);
      await page.locator("[data-dag-open-boards]").click();
      const card = page.locator("[data-dag-boards]");
      await card.locator("input").fill("launch");
      await expect(card.locator('[data-dag-hit="Field notes"]').first()).toBeVisible({ timeout: 15_000 });
      return card;
    },
  },
  {
    name: "templates",
    open: async (page, theme) => {
      await go(page, theme, `note=${encodeURIComponent("Field notes")}`);
      await expect(page.locator("[data-dag-note-view]")).toBeVisible();
      await newFile(page, "template");
      const picker = page.locator("[data-dag-templates]");
      await expect(picker).toBeVisible();
      return picker;
    },
  },
  {
    name: "new-task",
    open: async (page, theme) => {
      await go(page, theme, "tasks=1");
      await expect(page.locator('[data-dag-task-row="Renew the domain"]')).toBeVisible({ timeout: 15_000 });
      await blur(page);
      await page.keyboard.press("c");
      const dialog = page.locator("[data-dag-task-dialog]");
      await expect(page.locator("[data-dag-task-dialog-title]")).toBeFocused();
      return dialog;
    },
  },
  {
    name: "vaults",
    open: async (page, theme) => {
      /* Every vault the server has open is listed, and the rest of the suite opens and closes its
         own while this runs: the answer is the server's own, cut to this vault and the suite's. */
      await page.route("**/api/vaults", async (route) => {
        const res = await route.fetch();
        const body = (await res.json()) as { vaults: { id: string; path: string }[] };
        const home = fs.realpathSync(BOARDS);
        body.vaults = body.vaults.filter((v) => v.id === ws || v.path === home);
        await route.fulfill({ response: res, json: body });
      });
      await go(page, theme, `board=${encodeURIComponent("Launch plan")}`);
      await boardReady(page);
      await openSidebar(page);
      await page.locator("[data-dag-vault-switcher]").click();
      const menu = page.locator("[data-dag-vault-menu]");
      await expect(menu).toBeVisible();
      return menu;
    },
  },
  {
    name: "feedback",
    open: async (page, theme) => {
      /* The relay is never reached: the route's answer as `test/server/feedback.test.ts` recorded it. */
      await page.route("**/api/feedback", (route) => route.fulfill({ json: feedback.get }));
      await page.route("**/api/feedback?**", (route) => route.fulfill({ json: feedback.get }));
      await go(page, theme, `board=${encodeURIComponent("Launch plan")}`);
      await boardReady(page);
      await openSidebar(page);
      await page.locator("[data-dag-feedback-open]").click();
      const card = page.locator("[data-dag-feedback]");
      await expect(card).toBeVisible();
      return card;
    },
  },
  {
    name: "logs-question",
    open: async (page, theme) => {
      /* Asked once per install, and the suite's home has answered: the question as a first run sees it. */
      const answer = (route: Parameters<Parameters<Page["route"]>[1]>[0]) =>
        route.fulfill({ json: { consent: null, destination: "sync.example" } });
      await page.route("**/api/telemetry", answer);
      await page.route("**/api/telemetry?**", answer);
      await go(page, theme, `board=${encodeURIComponent("Launch plan")}`);
      await boardReady(page);
      const ask = page.locator("[data-dag-telemetry-ask]");
      await expect(ask).toBeVisible({ timeout: 10_000 });
      await blur(page);
      return ask;
    },
  },
];

for (const theme of THEMES) {
  for (const d of DIALOGS) {
    test(`${d.name} · ${theme}`, async ({ page }) => {
      const target = await d.open(page, theme);
      await shot(page, target, `${d.name}-${theme}`);
    });
  }
}
