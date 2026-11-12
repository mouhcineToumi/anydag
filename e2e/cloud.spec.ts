import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

import { BOARDS } from "./boards";
import { openSettings, openSidebar } from "./sidebar";

/**
 * The build's `cloud` switch (`server/features.ts`), as a person meets it: a build that answers
 * `/api/health` with `features: { cloud: false }` carries none of the features that talk to an
 * AnyDag server, and everything the page would have drawn of them is invisible — no sync row in the
 * sidebar, no Sync tab and no Privacy tab in Settings (the logs are all Privacy holds), no first-run
 * logs question — and the page makes no request to what is not there.
 *
 * **The page half runs here, the server half in the unit suite** (`test/features.test.ts`): the
 * spec's server is the dev server, which has the switch on, so it must be *told* off the way a
 * release build is. `page.route` stands in for its one answer, exactly as `telemetry.spec.ts` does
 * for the logs — the health answer behind it is the real route's own, with `features` said off, so
 * what the page reads is the shape `/api/health` really answers. The requests it counts are the
 * page's own: a `/api/telemetry` ask is what the page does on every first page when the switch is
 * on, so its absence is a fact about the gate, not about the feature.
 */

const BOARD = "---\ntitle: Cloud scratch\n---\n\n```md {#one x=0 y=0 w=320}\nA note.\n```\n";

let name = "";
let file = "";
test.beforeEach(({}, info) => {
  name = `e2e-cloud-${info.testId}`;
  file = path.join(BOARDS, `${name}.board.md`);
  fs.writeFileSync(file, BOARD);
});
test.afterEach(() => {
  if (name) fs.rmSync(file, { force: true });
});

/** The server answers its own health, with `features.cloud` said off. */
async function cloudOff(page: Page): Promise<void> {
  await page.route("**/api/health", async (route) => {
    const said = (await (await route.fetch()).json()) as Record<string, unknown>;
    await route.fulfill({ json: { ...said, features: { cloud: false } } });
  });
}

test("hides every server-backed feature, and asks for none of them", { tag: "@smoke" }, async ({ page }) => {
  await cloudOff(page);
  const reached: string[] = [];
  page.on("request", (r) => {
    const url = new URL(r.url());
    if (/^\/api\/(sync|telemetry|feedback)/.test(url.pathname)) reached.push(`${r.method()} ${url.pathname}`);
  });

  await page.goto(`/?board=${name}`);
  await page.waitForFunction(() => document.documentElement.dataset.dagReady === "1", null, { timeout: 20_000 });

  /* No sign of a server anywhere the chrome draws. */
  await expect(page.locator("[data-dag-telemetry-ask]")).toHaveCount(0);
  await openSidebar(page);
  await expect(page.locator("[data-dag-sync-row]")).toHaveCount(0);
  await expect(page.locator("[data-dag-feedback-open]")).toHaveCount(0);

  /* Settings opens, and its tab list is the one a build without the features has: no Sync, no
     Privacy, and the tabs that are not about a server still drawn beside the vault's own. */
  await openSettings(page);
  await expect(page.locator('[data-dag-settings-tab-button="sync"]')).toHaveCount(0);
  await expect(page.locator('[data-dag-settings-tab-button="privacy"]')).toHaveCount(0);
  await expect(page.locator('[data-dag-settings-tab-button="vault-general"]')).toBeVisible();
  for (const still of [
    "calendar",
    "quizzes",
    "providers",
    "vault-general",
    "vault-ai",
    "vault-files",
    "export",
    "agent-access",
    "shortcuts",
    "about",
  ])
    await expect(page.locator(`[data-dag-settings-tab-button="${still}"]`)).toBeVisible();

  /* Nothing went looking for what this build does not have — the logs answer the page would have
     asked for on its first page among them. */
  expect(reached).toEqual([]);
});

test("a snapshot draws the same with the switch off", { tag: "@smoke" }, async ({ page }) => {
  await cloudOff(page);
  const reached: string[] = [];
  page.on("request", (r) => {
    const url = new URL(r.url());
    if (/^\/api\/(sync|telemetry|feedback)/.test(url.pathname)) reached.push(`${r.method()} ${url.pathname}`);
  });
  await page.goto(`/?board=${name}&snapshot=1`);
  await page.waitForFunction(() => document.documentElement.dataset.dagReady === "1", null, { timeout: 60_000 });
  await expect(page.locator("[data-dag-telemetry-ask]")).toHaveCount(0);
  expect(reached).toEqual([]);
  expect(fs.readFileSync(file, "utf8")).toBe(BOARD);
});
