import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

import { BOARDS } from "./boards";
import { openSettings } from "./sidebar";

/**
 * The logs question: asked once, on the first page, before anything is sent; answered either way,
 * it goes; and Settings → Privacy changes it after.
 *
 * The answer is the dev server's home, which every worker shares and which `global-setup.ts`
 * answers *no* for the rest of the suite — so each check here stands in its own server with
 * `page.route`, and the requests the page makes are what is asserted.
 */

const BOARD = "---\ntitle: Telemetry scratch\n---\n\n```md {#one x=0 y=0 w=320}\nA note.\n```\n";

let name = "";
let file = "";
test.beforeEach(({}, info) => {
  name = `e2e-telemetry-${info.testId}`;
  file = path.join(BOARDS, `${name}.board.md`);
  fs.writeFileSync(file, BOARD);
});
test.afterEach(() => {
  if (name) fs.rmSync(file, { force: true });
});

/** A server whose answer starts as `consent`, records every PUT and every batch of events. */
async function fakeServer(page: Page, consent: boolean | null) {
  const state = { consent, puts: [] as unknown[], events: [] as unknown[] };
  await page.route("**/api/telemetry?**", (route) => answer(route));
  await page.route("**/api/telemetry", (route) => answer(route));
  await page.route("**/api/telemetry/events**", async (route) => {
    const body = route.request().postDataJSON() as { events: unknown[] };
    state.events.push(...body.events);
    await route.fulfill({ json: { accepted: body.events.length } });
  });
  async function answer(route: Parameters<Parameters<Page["route"]>[1]>[0]) {
    if (route.request().method() === "PUT") {
      const { enabled } = route.request().postDataJSON() as { enabled: boolean | null };
      state.puts.push(enabled);
      state.consent = enabled;
    }
    await route.fulfill({ json: { consent: state.consent, destination: "sync.example" } });
  }
  return state;
}

async function open(page: Page) {
  await page.goto(`/?board=${name}`);
  await page.waitForFunction(() => document.documentElement.dataset.dagReady === "1", null, { timeout: 20_000 });
}

test("asks once when nobody has answered, sends nothing before, and a no is the end of it", { tag: "@smoke" }, async ({
  page,
}) => {
  const server = await fakeServer(page, null);
  await open(page);
  const ask = page.locator("[data-dag-telemetry-ask]");
  await expect(ask).toBeVisible();
  await expect(ask).toContainText("Never sent");
  /* The board's keys do not act behind the question: `space N` would add a note to the file. */
  await expect(page.locator(".dag-telemetry-ask")).toBeFocused();
  await page.keyboard.press("Space");
  await page.keyboard.press("n");
  await page.locator("[data-dag-telemetry-no]").click();
  await expect(ask).toHaveCount(0);
  expect(server.puts).toEqual([false]);
  await page.reload();
  await page.waitForFunction(() => document.documentElement.dataset.dagReady === "1");
  await expect(ask).toHaveCount(0);
  expect(server.events).toEqual([]);
  expect(fs.readFileSync(file, "utf8")).toBe(BOARD);
});

test("Escape is no", async ({ page }) => {
  const server = await fakeServer(page, null);
  await open(page);
  await expect(page.locator("[data-dag-telemetry-ask]")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("[data-dag-telemetry-ask]")).toHaveCount(0);
  expect(server.puts).toEqual([false]);
});

test("a yes sends events that name no document, and Privacy turns it off", async ({ page }) => {
  const server = await fakeServer(page, null);
  await open(page);
  await page.locator("[data-dag-telemetry-yes]").click();
  await expect(page.locator("[data-dag-telemetry-ask]")).toHaveCount(0);
  expect(server.puts).toEqual([true]);
  /* What is held goes when the page does. */
  await page.evaluate(() => dispatchEvent(new Event("pagehide")));
  await expect.poll(() => server.events.length).toBeGreaterThan(0);
  const sent = JSON.stringify(server.events);
  expect(sent).toContain("app.open");
  expect(sent).not.toContain(name);
  expect(sent).not.toContain("Telemetry scratch");

  await openSettings(page, "privacy");
  const toggle = page.locator("[data-dag-setting-telemetry]");
  await expect(toggle).toBeChecked();
  await expect(page.locator("[data-dag-setting-telemetry-to]")).toContainText("sync.example");
  await toggle.click();
  await expect(toggle).not.toBeChecked();
  expect(server.puts).toEqual([true, false]);
});

test("a snapshot never asks and never sends", async ({ page }) => {
  const server = await fakeServer(page, null);
  let asked = false;
  page.on("request", (r) => {
    if (r.url().includes("/api/telemetry")) asked = true;
  });
  await page.goto(`/?board=${name}&snapshot=1`);
  await page.waitForFunction(() => document.documentElement.dataset.dagReady === "1");
  await expect(page.locator("[data-dag-telemetry-ask]")).toHaveCount(0);
  expect(asked).toBe(false);
  expect(server.puts).toEqual([]);
});
