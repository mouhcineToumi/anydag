import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page, type Route } from "@playwright/test";

import { BOARDS } from "./boards";

/**
 * Changing a diagram with a model, from the selection toolbar's icon and dialog.
 *
 * `POST /__board/generate` is **mocked** in every check, for the reason `prompt.spec.ts` gives:
 * what is under test is what the page does with an answer, and a real model would make the suite
 * slow, paid for and different every run. The rewrite had no browser check at all for a while —
 * only the text writers under it were tested — so these are also the first proof that the preview,
 * Accept and Discard do what `App` says they do.
 */

const DIR = BOARDS;

const BOARD = `\`\`\`arch {#svc x=400 y=400}
service api "API" icon=server
db pg "Postgres" icon=postgresql
api --> pg
\`\`\`

\`\`\`md {#note x=400 y=800 w=280}
A note.
\`\`\`
`;

const DRAFT = {
  type: "arch",
  attrs: {},
  body: [
    'service api "API" icon=server',
    'db pg "Postgres" icon=postgresql',
    'store redis "Redis cluster" icon=redis',
    "api --> redis",
    "api --> pg",
  ].join("\n"),
};

let name = "";
let file = "";
test.beforeEach(({}, info) => {
  name = `e2e-rewrite-${info.testId}`;
  file = path.join(DIR, `${name}.board.md`);
  fs.writeFileSync(file, BOARD);
});
test.afterEach(() => fs.rmSync(file, { force: true }));

const read = () => fs.readFileSync(file, "utf8");

async function open(page: Page) {
  await page.goto(`/?board=${name}`);
  await page.evaluate(() => localStorage.setItem("dag:library", "0"));
  await page.waitForFunction(() => document.documentElement.dataset.dagReady === "1", null, { timeout: 20_000 });
}

/** Answer `/generate` with `body`, and keep what the page asked. */
async function answer(
  page: Page,
  body: unknown,
  delay = 0,
): Promise<{ prompt: string; source?: string; as?: string; from?: string }[]> {
  const asked: { prompt: string; source?: string; as?: string; from?: string }[] = [];
  await page.route("**/__board/generate*", async (route: Route) => {
    asked.push(route.request().postDataJSON());
    if (delay) await new Promise((r) => setTimeout(r, delay));
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });
  return asked;
}

async function select(page: Page, id: string) {
  const at = (await page.locator(`[data-dag-item="${id}"]`).boundingBox())!;
  await page.mouse.click(at.x + 6, at.y + 6);
  await expect(page.locator(`[data-dag-item="${id}"][data-dag-selected]`)).toHaveCount(1);
}

test("the ✨ opens a dialog with the caret in it, and Escape closes only the dialog", async ({ page }) => {
  await open(page);
  await select(page, "svc");
  await page.locator("[data-dag-rewrite-open]").click();
  const box = page.locator("[data-dag-rewrite-input]");
  await expect(box).toBeFocused();
  await expect(page.locator("[data-dag-rewrite-go]")).toBeDisabled();

  await page.keyboard.press("Escape");
  await expect(page.locator("[data-dag-rewrite-dialog]")).toHaveCount(0);
  /* The dialog's Escape is the dialog's: the selection it was opened on is still standing. */
  await expect(page.locator('[data-dag-item="svc"][data-dag-selected]')).toHaveCount(1);
  await expect(page.locator("[data-dag-selbar]")).toBeVisible();
  expect(read()).toBe(BOARD);
});

test("ctrl+Enter sends the change with the diagram's source; the answer is a preview until Accept, which is one undo", {
  tag: "@smoke",
}, async ({ page }) => {
  const asked = await answer(page, { ok: true, draft: DRAFT, diagnostics: [], attempts: 1 }, 300);
  await open(page);
  await select(page, "svc");
  await page.locator("[data-dag-rewrite-open]").click();
  await page.locator("[data-dag-rewrite-input]").fill("Put a Redis cluster in front of the database");
  await page.keyboard.press("Control+Enter");

  /* The dialog closes on send, so the drawing the answer lands on can be seen. */
  await expect(page.locator("[data-dag-rewrite-dialog]")).toHaveCount(0);
  await expect(page.locator("[data-dag-rewrite-running]")).toBeVisible();
  await expect(page.locator("[data-dag-rewrite-accept]")).toBeVisible();
  expect(asked).toHaveLength(1);
  expect(asked[0]!.prompt).toContain("Put a Redis cluster in front of the database");
  /* What it is now, never pinned: the change may ask for another kind of diagram. */
  expect(asked[0]!.from).toBe("arch");
  expect(asked[0]!.as).toBeUndefined();
  expect(asked[0]!.source).toContain('service api "API"');

  /* The preview is drawn; the file is untouched. */
  await expect(page.locator('[data-dag-item="svc"] [data-dag-node="redis"]')).toBeVisible();
  expect(read()).toBe(BOARD);

  await page.locator("[data-dag-rewrite-accept]").click();
  await expect.poll(read).toContain('store redis "Redis cluster"');
  expect(read()).toContain("```arch {#svc x=400 y=400}");
  await expect(page.locator("[data-dag-rewrite-accept]")).toHaveCount(0);

  await page.locator(".dag-viewport").focus();
  await page.keyboard.press("Control+z");
  await expect.poll(read).toBe(BOARD);
});

test("an answer in another type is previewed as that type, and Accept retypes the item in place", async ({ page }) => {
  /* "Use another diagram type" used to fail on every attempt, because the type was pinned. */
  const FLOW = {
    type: "flow",
    attrs: {},
    body: ['lane app "App" {', '  step api "API"', "}", 'lane data "Data" {', '  step pg "Postgres"', "}", "api --> pg"].join(
      "\n",
    ),
  };
  await answer(page, { ok: true, draft: FLOW, diagnostics: [], attempts: 1 });
  await open(page);
  await select(page, "svc");
  await page.locator("[data-dag-rewrite-open]").click();
  await page.locator("[data-dag-rewrite-input]").fill("Show the same thing as a flowchart");
  await page.locator("[data-dag-rewrite-go]").click();

  await expect(page.locator('[data-dag-item="svc"] [data-dag-lane="app"]')).toBeVisible();
  expect(read()).toBe(BOARD);

  await page.locator("[data-dag-rewrite-accept]").click();
  await expect.poll(read).toContain("```flow {#svc x=400 y=400}");
  expect(read()).toContain('step pg "Postgres"');
  expect(read()).not.toContain("```arch");

  /* The file lands before the response does, and the history entry is pushed on the response — so
     ctrl+Z pressed on the file alone can find an empty stack and do nothing. The undo control going
     live is the page saying the entry is there: `tidy.spec.ts`'s wait, which this check lacked and
     which the full suite under load found. */
  await expect(page.locator("[data-dag-dock] [data-dag-undo]")).toBeEnabled({ timeout: 5_000 });
  await page.locator(".dag-viewport").focus();
  await page.keyboard.press("Control+z");
  await expect.poll(read).toBe(BOARD);
});

test("Discard throws the answer away and writes nothing", async ({ page }) => {
  await answer(page, { ok: true, draft: DRAFT, diagnostics: [], attempts: 1 });
  await open(page);
  await select(page, "svc");
  await page.locator("[data-dag-rewrite-open]").click();
  await page.locator("[data-dag-rewrite-input]").fill("Add a cache");
  await page.locator("[data-dag-rewrite-go]").click();
  await expect(page.locator('[data-dag-item="svc"] [data-dag-node="redis"]')).toBeVisible();

  await page.locator("[data-dag-rewrite-discard]").click();
  await expect(page.locator('[data-dag-item="svc"] [data-dag-node="redis"]')).toHaveCount(0);
  await expect(page.locator("[data-dag-selbar-edit]")).toBeVisible();
  expect(read()).toBe(BOARD);
});

test("a refusal says why, and Try again reopens the dialog with what was written", async ({ page }) => {
  await answer(page, {
    ok: false,
    error: "The model's answer still has problems.",
    diagnostics: [{ code: "E_UNKNOWN_KIND", line: 3, col: 1, severity: "error", message: "`cash` is not a kind" }],
    attempts: 3,
  });
  await open(page);
  await select(page, "svc");
  await page.locator("[data-dag-rewrite-open]").click();
  await page.locator("[data-dag-rewrite-input]").fill("Add a cache");
  await page.locator("[data-dag-rewrite-go]").click();

  await expect(page.locator("[data-dag-selbar]")).toContainText("still has problems");
  await expect(page.locator("[data-dag-selbar]")).toContainText("E_UNKNOWN_KIND");
  await page.locator("[data-dag-rewrite-retry]").click();
  await expect(page.locator("[data-dag-rewrite-input]")).toHaveValue("Add a cache");
  await expect(page.locator("[data-dag-rewrite-input]")).toBeFocused();
  expect(read()).toBe(BOARD);
});

test("a paste into the dialog stays in the dialog", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await open(page);
  await select(page, "svc");
  await page.locator("[data-dag-rewrite-open]").click();
  await page.evaluate(() => navigator.clipboard.writeText("Split the API in two"));
  await page.keyboard.press("Control+v");
  await expect(page.locator("[data-dag-rewrite-input]")).toHaveValue("Split the API in two");
  /* Nothing landed on the board behind the card. */
  await page.waitForTimeout(500);
  expect(read()).toBe(BOARD);
});
