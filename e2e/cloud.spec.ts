import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page, type Route } from "@playwright/test";

import { BOARDS } from "./boards";
import { openSettings, openSidebar } from "./sidebar";

/**
 * The build's `cloud` switch (`server/features.ts`), as a person meets it: a build that answers
 * `/api/health` with `features: { cloud: false }` carries none of the features that talk to an
 * AnyDag server — no sync row in the sidebar, no Sync tab in Settings, no Send feedback, no first-run
 * logs question — and the page makes no request to what is not there.
 *
 * **One exception (#326): Settings → Privacy is drawn in every build.** Off, it is the anonymous-logs
 * toggle and one sentence saying logs are not sent from this version yet. The toggle records the
 * choice in this browser, with no request, and the first build whose switch says on carries that
 * choice to the server before it asks anything.
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

/** A server whose logs answer starts as `consent`, and which records every PUT. */
async function fakeTelemetry(page: Page, consent: boolean | null) {
  const state = { consent, puts: [] as unknown[] };
  const answer = async (route: Route) => {
    if (route.request().method() === "PUT") {
      const { enabled } = route.request().postDataJSON() as { enabled: boolean | null };
      state.puts.push(enabled);
      state.consent = enabled;
    }
    await route.fulfill({ json: { consent: state.consent, destination: "sync.example" } });
  };
  await page.route("**/api/telemetry?**", answer);
  await page.route("**/api/telemetry", answer);
  return state;
}

/** Every request the page makes to a route a build without the switch would not have. */
function watchReached(page: Page): string[] {
  const reached: string[] = [];
  page.on("request", (r) => {
    const url = new URL(r.url());
    if (/^\/api\/(sync|telemetry|feedback)/.test(url.pathname)) reached.push(`${r.method()} ${url.pathname}`);
  });
  return reached;
}

const ready = (page: Page) =>
  page.waitForFunction(() => document.documentElement.dataset.dagReady === "1", null, { timeout: 20_000 });

test("hides every server-backed feature but the logs toggle, and asks for none of them", { tag: "@smoke" }, async ({ page }) => {
  await cloudOff(page);
  const reached = watchReached(page);

  await page.goto(`/?board=${name}`);
  await ready(page);

  /* No sign of a server anywhere the chrome draws. */
  await expect(page.locator("[data-dag-telemetry-ask]")).toHaveCount(0);
  await openSidebar(page);
  await expect(page.locator("[data-dag-sync-row]")).toHaveCount(0);
  await expect(page.locator("[data-dag-feedback-open]")).toHaveCount(0);

  /* Settings opens, and its tab list is the one a build without the features has: no Sync, but
     Privacy stays — it is where the logs toggle records a choice a later build carries up. */
  await openSettings(page, "privacy");
  await expect(page.locator('[data-dag-settings-tab-button="sync"]')).toHaveCount(0);
  const toggle = page.locator("[data-dag-setting-telemetry]");
  await expect(toggle).toBeVisible();
  await expect(toggle).not.toBeChecked();
  await expect(page.locator('[data-dag-settings-pane="privacy"]')).toContainText("Logs are not sent from this version yet.");
  /* It records the choice with no request: there is no route to ask and nothing to send. */
  await toggle.click();
  await expect(toggle).toBeChecked();
  expect(reached).toEqual([]);

  /* The tabs that are not about a server are all still drawn. */
  await page.locator('[data-dag-settings-tab-button="vault-general"]').click();
  for (const still of [
    "appearance",
    "ai",
    "calendar",
    "quizzes",
    "providers",
    "vault-general",
    "vault-files",
    "export",
    "agent-access",
    "privacy",
    "shortcuts",
    "about",
  ])
    await expect(page.locator(`[data-dag-settings-tab-button="${still}"]`)).toBeVisible();
});

test("the choice made in an off build is the one the next on build starts with", async ({ page }) => {
  await cloudOff(page);
  await page.goto(`/?board=${name}`);
  await ready(page);

  await openSettings(page, "privacy");
  const toggle = page.locator("[data-dag-setting-telemetry]");
  await expect(toggle).not.toBeChecked();
  await toggle.click();
  await expect(toggle).toBeChecked();
  /* Held in this browser, not sent: the off build has no route to write it to. */
  expect(await page.evaluate(() => localStorage.getItem("dag:telemetry-pending"))).toBe("1");

  /* The switch says on: the held answer goes up before anything is asked, so the page starts from
     it and the first-run question does not ask somebody who has already answered. */
  await page.unroute("**/api/health");
  const server = await fakeTelemetry(page, null);
  await page.reload();
  await ready(page);
  await expect.poll(() => server.puts).toEqual([true]);
  /* Longer than the question's own wait. */
  await page.waitForTimeout(3500);
  await expect(page.locator("[data-dag-telemetry-ask]")).toHaveCount(0);
  /* The held copy is spent once the server has it. */
  expect(await page.evaluate(() => localStorage.getItem("dag:telemetry-pending"))).toBeNull();
  await openSettings(page, "privacy");
  await expect(page.locator("[data-dag-setting-telemetry]")).toBeChecked();
});

test("a snapshot draws the same with the switch off", { tag: "@smoke" }, async ({ page }) => {
  await cloudOff(page);
  const reached = watchReached(page);
  await page.goto(`/?board=${name}&snapshot=1`);
  await page.waitForFunction(() => document.documentElement.dataset.dagReady === "1", null, { timeout: 60_000 });
  await expect(page.locator("[data-dag-telemetry-ask]")).toHaveCount(0);
  expect(reached).toEqual([]);
  expect(fs.readFileSync(file, "utf8")).toBe(BOARD);
});
