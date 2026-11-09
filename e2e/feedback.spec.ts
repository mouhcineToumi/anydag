import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page, type Route } from "@playwright/test";

import { BOARDS, ROOT } from "./boards";
import { openSidebar } from "./sidebar";

/**
 * Send feedback: the card says what leaves before anything does, a failed send keeps the draft,
 * and a sent one shows the issue. The relay is never reached from the suite: `/api/feedback` is
 * stood in for with `page.route`, and every answer is one `test/server/feedback.test.ts` recorded
 * from the real route in front of the real relay (`test/fixtures/feedback.json`).
 */

const recorded = JSON.parse(fs.readFileSync(path.join(ROOT, "test", "fixtures", "feedback.json"), "utf8")) as {
  get: { destination: string | null; env: { version: string; os: string; arch: string } };
  post: { url: string };
  failed: { status: number; body: unknown };
};

const BOARD = "---\ntitle: Feedback scratch\n---\n\n```md {#one x=0 y=0 w=320}\nA note.\n```\n";

let name = "";
let file = "";
test.beforeEach(({}, info) => {
  name = `e2e-feedback-${info.testId}`;
  file = path.join(BOARDS, `${name}.board.md`);
  fs.writeFileSync(file, BOARD);
});
test.afterEach(() => {
  if (name) fs.rmSync(file, { force: true });
});

/** The app's server, as recorded: `GET` says where it goes, each `POST` is the next answer queued. */
async function standIn(page: Page, get: unknown, answers: { status: number; body: unknown }[]) {
  const posts: Record<string, unknown>[] = [];
  const answer = async (route: Route) => {
    if (route.request().method() === "GET") return route.fulfill({ json: get });
    posts.push(route.request().postDataJSON() as Record<string, unknown>);
    const next = answers.shift() ?? { status: 500, body: { error: "no answer queued" } };
    return route.fulfill({ status: next.status, json: next.body });
  };
  await page.route("**/api/feedback", answer);
  await page.route("**/api/feedback?**", answer);
  return posts;
}

async function openCard(page: Page) {
  await page.goto(`/?board=${name}`);
  await page.waitForFunction(() => document.documentElement.dataset.dagReady === "1", null, { timeout: 20_000 });
  await openSidebar(page);
  await page.locator("[data-dag-feedback-open]").click();
  await expect(page.locator("[data-dag-feedback]")).toBeVisible();
}

test("says what leaves, keeps the draft when a send fails, and shows the issue when one goes", { tag: "@smoke" }, async ({
  page,
}) => {
  const posts = await standIn(page, recorded.get, [recorded.failed, { status: 201, body: recorded.post }]);
  await openCard(page);
  const card = page.locator("[data-dag-feedback]");
  const consent = page.locator("[data-dag-feedback-consent]");

  await page.locator("[data-dag-feedback-text]").fill("The arrows vanish after a tidy.");
  await page
    .locator("[data-dag-feedback-picker]")
    .setInputFiles({ name: "shot.png", mimeType: "image/png", buffer: Buffer.from("png") });
  await page.locator("[data-dag-feedback-attach]").check();

  /* Before Send: every file by name, the whole board, the version, system and arch — nothing sent. */
  const { version, os, arch } = recorded.get.env;
  await expect(consent).toContainText("Your text, as a bug report");
  await expect(consent).toContainText("The file shot.png");
  await expect(consent).toContainText(`The whole text of ${name}.board.md`);
  await expect(consent).toContainText(`AnyDag ${version}, ${os}, ${arch}`);
  await expect(consent).toContainText("public GitHub issue");
  expect(posts).toEqual([]);

  await page.locator("[data-dag-feedback-send]").click();
  await expect(page.locator("[data-dag-feedback-error]")).toContainText("no issue was made");
  await expect(page.locator("[data-dag-feedback-error]")).toContainText("Your draft is kept");
  await expect(page.locator("[data-dag-feedback-text]")).toHaveValue("The arrows vanish after a tidy.");
  await expect(page.locator('[data-dag-feedback-file="shot.png"]')).toBeVisible();
  expect(posts[0]).toEqual({
    kind: "bug",
    text: "The arrows vanish after a tidy.",
    boards: [name],
    notes: [],
    files: [{ name: "shot.png", type: "image/png", data: Buffer.from("png").toString("base64") }],
  });

  /* Closed and opened again, the draft is still there. */
  await page.locator("[data-dag-feedback-text]").press("Escape");
  await expect(card).toHaveCount(0);
  await page.locator("[data-dag-feedback-open]").click();
  await expect(page.locator("[data-dag-feedback-text]")).toHaveValue("The arrows vanish after a tidy.");

  await page.locator("[data-dag-feedback-send]").click();
  await expect(page.locator("[data-dag-feedback-link]")).toHaveAttribute("href", recorded.post.url);
  expect(posts).toHaveLength(2);
  /* The board behind the card heard none of it. */
  expect(fs.readFileSync(file, "utf8")).toBe(BOARD);
});

test("an app with no relay says feedback is not available, and sends nothing", async ({ page }) => {
  const posts = await standIn(page, { ...recorded.get, destination: null }, []);
  await openCard(page);
  await expect(page.locator("[data-dag-feedback-error]")).toContainText("not available");
  await page.locator("[data-dag-feedback-kind=idea]").click();
  await page.locator("[data-dag-feedback-text]").fill("A dark sidebar");
  await expect(page.locator("[data-dag-feedback-send]")).toBeDisabled();
  expect(posts).toEqual([]);
});
