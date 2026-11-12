import fs from "node:fs";
import path from "node:path";
import { expect, test, type Locator, type Page, type Route } from "@playwright/test";

import { lead } from "./keys";
import { settingsTab } from "./sidebar";
import { BOARDS } from "./boards";

/**
 * The prompt card: describe a diagram, and a model draws it in the card's place.
 *
 * `POST /__board/generate` is **mocked** in every check here. The suite proves what the page does
 * with an answer — where it lands, what one ctrl+Z undoes, what a bad answer looks like — and a real
 * model would make that slow, paid for and different every run. `test/generate.test.ts` holds the
 * server's half with a scripted model; `scripts/generate.mjs` is how a real one is tried.
 */

const DIR = BOARDS;

const BOARD = `---
title: Prompt me
---

\`\`\`md {#one x=0 y=0}
The first item.
\`\`\`

\`\`\`prompt {#ask x=80 y=240 w=420}
A browser talking to an API that stores orders in Postgres.
\`\`\`
`;

const DRAFT = {
  type: "arch",
  attrs: {},
  body: ['client web "Browser"', 'service api "API"', 'db pg "Postgres" icon=postgresql', "web --> api", "api --> pg"].join("\n"),
};

let name = "";
let file = "";
let problems: string[] = [];
test.beforeEach(({ page }, info) => {
  name = `e2e-scratch-${info.testId}`;
  file = path.join(DIR, `${name}.board.md`);
  fs.writeFileSync(file, BOARD);
  problems = [];
  page.on("console", (msg) => {
    if (msg.type() === "error" || msg.type() === "warning") problems.push(msg.text());
  });
  page.on("pageerror", (e) => problems.push(String(e)));
});
test.afterEach(() => {
  fs.rmSync(file, { force: true });
  expect(problems, "console output").toEqual([]);
});

const read = () => fs.readFileSync(file, "utf8");

async function open(page: Page, query = "") {
  await page.goto(`/?board=${name}${query}`);
  await page.waitForFunction(() => document.documentElement.dataset.dagReady === "1", null, { timeout: 20_000 });
}

/**
 * 100%, and the view marked as the person's so the next content change does not re-fit it.
 *
 * **`0` alone is not enough.** It returns to 100% but leaves the view the automatic one, so adding
 * a card would fit the whole board again and the placement this spec is about would be measured
 * against a view that had just moved. The wheel notch is what takes the view; the key is then only
 * the zoom, and the focus goes to the board rather than a button so a chord still reaches it.
 */
async function atActual(page: Page) {
  const view = await page.locator(".dag-viewport").boundingBox();
  if (!view) throw new Error("the view has no box");
  /* A wheel notch is how a person takes the view: it is the pan, and it is what stops the next
     content change from fitting the board again. The far corner clears the empty-board card. */
  await page.mouse.move(view.x + view.width - 40, view.y + 40);
  await page.mouse.wheel(0, 16);
  await page.locator(".dag-viewport").focus();
  await page.keyboard.press("0");
  await expect(page.locator(".dag-viewport")).toHaveAttribute("data-zoom", "1");
}

/** Answer `/generate` with `body` at `status`, and keep what the page asked. */
async function answer(page: Page, status: number, body: unknown): Promise<unknown[]> {
  const asked: unknown[] = [];
  await page.route("**/__board/generate*", async (route: Route) => {
    asked.push(route.request().postDataJSON());
    await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  });
  return asked;
}

test("P puts an empty card in the middle of the view with the caret in it, and typing writes the file", async ({ page }) => {
  await open(page);
  await atActual(page);
  await lead(page, "p");
  const box = page.locator(".dag-prompt:not(:has-text('A browser talking')) [data-dag-prompt-text]");
  await expect(box).toBeFocused();
  /* No panel: the card is where the typing happens. */
  await expect(page.locator("[data-dag-body]")).toHaveCount(0);
  await page.keyboard.type("A queue between two workers");
  await expect.poll(read).toMatch(/```prompt \{#prompt-[a-z0-9]{4} x=\d+ y=\d+ w=420\}\nA queue between two workers\n```/);
});

test("the model chip names who would answer, and opens the AI settings", async ({ page }) => {
  /* `*` for the `vault=` every scoped request carries (`src/vault/current.ts`). */
  await page.route("**/__board/llm*", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        default: "claude",
        providers: [
          {
            id: "claude",
            label: "Claude Code",
            description: "Uses your Claude plan, through the Claude Code signed in on this computer.",
            kind: "cli",
            defaultModel: "sonnet",
            models: ["sonnet"],
            ready: true,
          },
        ],
      }),
    }),
  );
  await open(page);
  const chip = page.locator('[data-dag-model-chip="prompt"]');
  await expect(chip).toHaveText("Claude Code · sonnet");
  await chip.click();
  await expect(page.locator("[data-dag-settings]")).toBeVisible();
  await expect(page.locator("[data-dag-settings-pane=agents]")).toBeVisible();
  /* The default is worded the same way as the Assistant's, and the model's default is in the hint,
     not only in a placeholder that disappears as soon as somebody types. */
  await expect(page.locator("[data-dag-setting-llm-provider] option").first()).toHaveText("Automatic · Claude Code");
  await expect(page.locator("[data-dag-setting-llm-model]")).toHaveValue("");
  await expect(page.getByText("Uses sonnet unless you enter another.")).toBeVisible();
  await expect(page.getByText("Prompt cards, Rewrite in the panel, and Generate flashcards use this model.")).toBeVisible();
});

/**
 * The card's box against the view's, on the glass.
 *
 * A box measure is screen pixels at the current zoom, which is what a person sees and what the
 * acceptance says: the card's *centre* is the view's centre. One grid step is allowed because the
 * placement snaps to the board grid.
 */
async function centring(page: Page, card: Locator) {
  await expect(card).toBeVisible();
  const box = await card.boundingBox();
  const view = await page.locator(".dag-viewport").boundingBox();
  if (!box || !view) throw new Error("the card or the view has no box");
  return {
    dx: box.x + box.width / 2 - (view.x + view.width / 2),
    dy: box.y + box.height / 2 - (view.y + view.height / 2),
    box,
    view,
  };
}

/* A grid step, 8px, is the snap's own allowance; the card's height is the empty card's, so a couple
   of pixels of font difference are allowed on top. */
const CENTRED = 8;

for (const width of [1280, 1600]) {
  test(`the dock's prompt card is centred and whole in a ${width}px window`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await open(page);
    await atActual(page);
    await page.locator("[data-dag-dock-prompt]").click();
    const { dx, dy, box, view } = await centring(page, page.locator(".dag-prompt:not(:has-text('A browser talking'))"));
    expect(Math.abs(dx)).toBeLessThanOrEqual(CENTRED);
    expect(Math.abs(dy)).toBeLessThanOrEqual(CENTRED);
    expect(box.x).toBeGreaterThanOrEqual(view.x - 0.5);
    expect(box.y).toBeGreaterThanOrEqual(view.y - 0.5);
    expect(box.x + box.width).toBeLessThanOrEqual(view.x + view.width + 0.5);
    expect(box.y + box.height).toBeLessThanOrEqual(view.y + view.height + 0.5);
  });
}

test("P centres the card even with the pointer over the board", async ({ page }) => {
  await open(page);
  await atActual(page);
  await page.mouse.move(900, 700);
  await lead(page, "p");
  const { dx, dy } = await centring(page, page.locator(".dag-prompt:not(:has-text('A browser talking'))"));
  expect(Math.abs(dx)).toBeLessThanOrEqual(CENTRED);
  expect(Math.abs(dy)).toBeLessThanOrEqual(CENTRED);
});

test("Describe a diagram on a new board centres the card", async ({ page }) => {
  /* A blank board rather than the fixture, so this is the empty-board card and not the dock. */
  fs.writeFileSync(file, "---\ntitle: Blank\n---\n");
  await open(page);
  await atActual(page);
  await page.locator('[data-dag-empty-board-act="prompt"]').click();
  const { dx, dy } = await centring(page, page.locator(".dag-prompt"));
  expect(Math.abs(dx)).toBeLessThanOrEqual(CENTRED);
  expect(Math.abs(dy)).toBeLessThanOrEqual(CENTRED);
});

test("the type select writes `as=` on the card", async ({ page }) => {
  await open(page);
  await page.locator("[data-dag-prompt-as]").selectOption("erd");
  await expect.poll(read).toContain("```prompt {#ask x=80 y=240 w=420 as=erd}");
});

test("Generate puts the diagram exactly where the card was, and one ctrl+Z brings the card back", { tag: "@smoke" }, async ({
  page,
}) => {
  const asked = await answer(page, 200, {
    ok: true,
    draft: DRAFT,
    diagnostics: [],
    attempts: 1,
    provider: "gemini",
    model: "gemini-3.8-flash",
    ms: 900,
  });
  await open(page);
  await page.locator("[data-dag-prompt-go]").click();

  await expect.poll(read).not.toContain("```prompt");
  expect(read()).toMatch(/```arch \{#arch-[a-z0-9]{4} x=80 y=240\}\nclient web "Browser"/);
  expect(asked).toEqual([
    { prompt: "A browser talking to an API that stores orders in Postgres.", provider: null, model: null, reasoning: null },
  ]);
  /* The diagram is drawn and selected; the card is gone from the page, not only from the file. */
  await expect(page.locator(".dag-prompt")).toHaveCount(0);
  await expect(page.locator("[data-dag-selected] .dag-diagram")).toBeVisible();

  await page.keyboard.press("Control+z");
  await expect.poll(read).toContain("```prompt {#ask x=80 y=240 w=420}\nA browser talking to an API");
  await expect.poll(read).not.toContain("```arch");
  await expect(page.locator(".dag-prompt")).toBeVisible();
});

test("sends the text on the card and the type it asks for, with ctrl+Enter", async ({ page }) => {
  const asked = await answer(page, 200, { ok: true, draft: { ...DRAFT, type: "arch" }, diagnostics: [], attempts: 1 });
  await open(page);
  await page.locator("[data-dag-prompt-as]").selectOption("arch");
  await expect.poll(read).toContain("as=arch");
  const box = page.locator("[data-dag-prompt-text]");
  await box.fill("Three services and a queue");
  await box.press("Control+Enter");
  await expect.poll(read).not.toContain("```prompt");
  expect(asked).toEqual([{ prompt: "Three services and a queue", as: "arch", provider: null, model: null, reasoning: null }]);
});

test("a draft that still has errors is shown, and Insert anyway puts it down to be fixed there", async ({ page }) => {
  await answer(page, 200, {
    ok: false,
    draft: { type: "arch", attrs: {}, body: 'database pg "Postgres"' },
    diagnostics: [{ line: 1, code: "E_UNKNOWN_KIND", message: "`database` is not a kind in arch", severity: "error" }],
    attempts: 3,
    model: "glm-5.3-flash",
  });
  await open(page);
  await page.locator("[data-dag-prompt-go]").click();
  const fail = page.locator("[data-dag-prompt-fail]");
  await expect(fail).toContainText("E_UNKNOWN_KIND");
  await expect(fail).toContainText("glm-5.3-flash, 3 attempts");
  expect(read()).toContain("```prompt");

  await page.locator("[data-dag-prompt-anyway]").click();
  await expect.poll(read).toMatch(/```arch \{#arch-[a-z0-9]{4} x=80 y=240\}\ndatabase pg "Postgres"\n```/);
  expect(read()).not.toContain("```prompt");
});

test("a refusal is said on the card, and the card stays", async ({ page }) => {
  await answer(page, 400, { error: "provider `gemini` has no key — set GEMINI_API_KEY or GOOGLE_API_KEY in .env.local" });
  await open(page);
  await page.locator("[data-dag-prompt-go]").click();
  await expect(page.locator("[data-dag-prompt-fail]")).toContainText("GEMINI_API_KEY");
  expect(read()).toContain("```prompt {#ask");
  /* A 400 is a console error in Chromium's own words; it is the answer this check is about. */
  problems = problems.filter((p) => !p.includes("400"));
});

test("a no-key refusal says what is missing in plain words, and opens the AI settings", async ({ page }) => {
  await answer(page, 400, {
    error: "provider `gemini` has no key — set GEMINI_API_KEY or GOOGLE_API_KEY in .env.local",
    reason: { code: "no-key", provider: "gemini", keyEnv: ["GEMINI_API_KEY", "GOOGLE_API_KEY"] },
  });
  await open(page);
  await page.locator("[data-dag-prompt-go]").click();

  const fail = page.locator("[data-dag-prompt-fail]");
  await expect(fail).toContainText("Gemini needs an API key in the server's environment");
  await expect(fail.locator("code").first()).toContainText("GEMINI_API_KEY");
  await expect(fail).not.toContainText("`");
  await expect(fail).not.toContainText(".env.local");

  const action = fail.getByRole("button", { name: "Open AI settings" });
  await expect(action).toBeVisible();
  await action.click();
  await expect(page.locator("[data-dag-settings]")).toBeVisible();
  await expect(page.locator("[data-dag-settings-pane=agents]")).toBeVisible();
  problems = problems.filter((p) => !p.includes("400"));
});

test("the thinking level picked in Settings rides with the request", async ({ page }) => {
  const asked = await answer(page, 200, { ok: true, draft: DRAFT, diagnostics: [], attempts: 1 });
  await open(page);
  /* Chosen the way a person chooses it: the card, not `localStorage`. */
  await page.keyboard.press("Control+Comma");
  await settingsTab(page, "agents");
  await page.locator("[data-dag-setting-llm-reasoning]").selectOption("high");
  await page.keyboard.press("Escape");
  await expect(page.locator("[data-dag-settings]")).toHaveCount(0);

  await page.locator("[data-dag-prompt-go]").click();
  await expect.poll(read).not.toContain("```prompt");
  expect(asked).toEqual([
    { prompt: "A browser talking to an API that stores orders in Postgres.", provider: null, model: null, reasoning: "high" },
  ]);
});

test("a snapshot draws the prompt as text, with nothing to press", async ({ page }) => {
  await open(page, "&snapshot=1");
  await expect(page.locator(".dag-prompt--still")).toContainText("A browser talking to an API");
  await expect(page.locator("[data-dag-prompt-text]")).toHaveCount(0);
});
