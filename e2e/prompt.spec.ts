import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page, type Route } from "@playwright/test";

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

/** Answer `/generate` with `body` at `status`, and keep what the page asked. */
async function answer(page: Page, status: number, body: unknown): Promise<unknown[]> {
  const asked: unknown[] = [];
  await page.route("**/__board/generate*", async (route: Route) => {
    asked.push(route.request().postDataJSON());
    await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  });
  return asked;
}

test("P puts an empty card under the pointer with the caret in it, and typing writes the file", async ({ page }) => {
  await open(page);
  await page.mouse.move(900, 700);
  await lead(page, "p");
  const box = page.locator(".dag-prompt:not(:has-text('A browser talking')) [data-dag-prompt-text]");
  await expect(box).toBeFocused();
  /* No panel: the card is where the typing happens. */
  await expect(page.locator("[data-dag-body]")).toHaveCount(0);
  await page.keyboard.type("A queue between two workers");
  await expect.poll(read).toMatch(/```prompt \{#prompt-[a-z0-9]{4} x=\d+ y=\d+ w=420\}\nA queue between two workers\n```/);
});

test("the type select writes `as=` on the card", async ({ page }) => {
  await open(page);
  await page.locator("[data-dag-prompt-as]").selectOption("erd");
  await expect.poll(read).toContain("```prompt {#ask x=80 y=240 w=420 as=erd}");
});

test("Generate puts the diagram exactly where the card was, and one ctrl+Z brings the card back", async ({ page }) => {
  const asked = await answer(page, 200, { ok: true, draft: DRAFT, diagnostics: [], attempts: 1, provider: "gemini", model: "gemini-3.8-flash", ms: 900 });
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
