import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { BOARDS } from "./boards";
import { expect, test, type Page } from "./fixture";

/**
 * The Graph page (#459): it settles and then **nothing runs** — no frame at rest, no worker and no
 * GL context once the page is closed — and a file found by name is pressed to open it, with Back
 * returning to the graph as it was. No screenshot: what the graph looks like is the theme's and the
 * simulation's, and is checked by looking (the PR), not by a baseline.
 *
 * **Every test is in a vault of its own**, `trash.spec.ts`'s reason with another cause: the suite runs
 * wide over one vault, every file another worker writes there is a change the graph refreshes for,
 * and "nothing runs at rest" cannot be held on a vault that never rests.
 */

let id = "";
let made: string[] = [];
let parents: string[] = [];
let problems: string[] = [];

test.beforeEach(({ page }, info) => {
  id = info.testId
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .slice(-10);
  made = [];
  parents = [];
  problems = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") problems.push(msg.text());
  });
  page.on("pageerror", (e) => problems.push(String(e)));
});

test.afterEach(async ({ page }) => {
  /* Off the page first: closing the vault a tab is in sends it elsewhere (`vaults.spec.ts`). */
  await page.goto("about:blank").catch(() => undefined);
  await page.request.post("/api/vaults/open", { data: { path: BOARDS } }).catch(() => undefined);
  for (const v of made) await page.request.post("/api/vaults/close", { data: { id: v, forget: true } }).catch(() => undefined);
  /* Only the temp folders this test made, each named in full. */
  for (const p of parents)
    if (p.startsWith(os.tmpdir()) && p.length > os.tmpdir().length + 1) fs.rmSync(p, { recursive: true, force: true });
  expect(problems, "console errors").toEqual([]);
});

/**
 * A vault of the test's own: a ring of linked notes, a few apart, and the suite's vault put back as
 * the one a bare `/` opens. Its files are written before the page asks for the graph.
 */
async function vault(page: Page): Promise<string> {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "anydag-e2e-graph-"));
  parents.push(parent);
  const r = await page.request.post("/api/vaults/create", { data: { parent, name: `graph${id}` } });
  expect(r.ok(), await r.text()).toBe(true);
  const v = ((await r.json()) as { vault: { id: string; path: string } }).vault;
  made.push(v.id);
  const names = ["Harbour", "Lighthouse", "Tide tables", "Ferry", "Pier", "Gulls", "Nets", "Buoys"];
  names.forEach((name, i) => {
    const next = names[(i + 1) % names.length]!;
    const across = names[(i + 3) % names.length]!;
    fs.writeFileSync(
      path.join(v.path, `${name}.md`),
      `---\ntags: [${i % 2 ? "sea" : "shore"}]\n---\nSee [[${next}]] and [[${across}]].\n`,
    );
  });
  fs.writeFileSync(path.join(v.path, "Alone.md"), "Nothing links here.\n");
  await page.request.post("/api/vaults/open", { data: { path: BOARDS } });
  return v.id;
}

/** Counts the page's graph workers and WebGL contexts, before the page's own scripts run. */
async function probe(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const seen = { made: 0, ended: 0, contexts: [] as WebGL2RenderingContext[] };
    (window as unknown as { __probe: typeof seen }).__probe = seen;
    const Native = window.Worker;
    window.Worker = class extends Native {
      private sim: boolean;
      constructor(url: string | URL, opts?: WorkerOptions) {
        super(url, opts);
        this.sim = /sim\.worker/.test(String(url));
        if (this.sim) seen.made++;
      }
      override terminate(): void {
        if (this.sim) seen.ended++;
        super.terminate();
      }
    };
    const get = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
      const c = (get as (...a: unknown[]) => unknown).call(this, type, ...rest);
      if (type === "webgl2" && c && !seen.contexts.includes(c as WebGL2RenderingContext))
        seen.contexts.push(c as WebGL2RenderingContext);
      return c;
    } as typeof get;
  });
}

const counts = (page: Page) =>
  page.evaluate(() => {
    const p = (window as unknown as { __probe: { made: number; ended: number; contexts: WebGL2RenderingContext[] } }).__probe;
    return { workers: p.made - p.ended, contexts: p.contexts.filter((c) => !c.isContextLost()).length };
  });

const frames = (page: Page) => page.evaluate(() => (window as unknown as { __dagGraph: { frames: number } }).__dagGraph.frames);

/** The page's chunk and the graph's answer have come: the first visit compiles both on a cold dev server. */
async function opened(page: Page, files: string): Promise<void> {
  await expect(page.locator("[data-dag-graph-counts]")).toContainText(files, { timeout: 30_000 });
}

async function atRest(page: Page): Promise<void> {
  await expect(page.locator('[data-dag-graph="rest"]')).toBeVisible({ timeout: 30_000 });
}

test("settles and then draws nothing; a file found by name opens on a press, and Back returns", { tag: "@smoke" }, async ({
  page,
}) => {
  const ws = await vault(page);
  await probe(page);
  await page.goto(`/?graph=1&vault=${ws}`);
  await opened(page, "9 of 9 files");
  await atRest(page);
  expect(await counts(page)).toEqual({ workers: 1, contexts: 1 });

  /* At rest, no frame: the counter stands still. */
  const still = await frames(page);
  await page.waitForTimeout(1_000);
  expect(await frames(page)).toBe(still);

  /* Find a file by name: it is listed, lit and centred. */
  await page.locator("[data-dag-graph-find-field]").fill("lighth");
  await expect(page.locator("[data-dag-graph-match]")).toHaveText(["Lighthouse"]);
  await atRest(page);
  const spot = await page.evaluate(() => {
    const g = (window as unknown as { __dagGraph: { found: number; at(i: number): { x: number; y: number } | null } }).__dagGraph;
    return g.at(g.found);
  });
  expect(spot).not.toBeNull();
  const box = (await page.locator("[data-dag-graph]").boundingBox())!;

  /* A press on its dot opens it; the page, its worker and its GL context are gone. */
  await page.mouse.click(box.x + spot!.x, box.y + spot!.y);
  await expect(page).toHaveURL(/[?&]note=Lighthouse/);
  await expect(page.locator("[data-dag-graph]")).toHaveCount(0);
  await expect.poll(() => counts(page)).toEqual({ workers: 0, contexts: 0 });

  /* Back: the graph as it was left, at rest again. */
  await page.goBack();
  await opened(page, "9 of 9 files");
  await atRest(page);
  expect(await counts(page)).toEqual({ workers: 1, contexts: 1 });
});

test("the panel colours by a field, filters by its legend, and a chip takes a filter off", async ({ page }) => {
  const ws = await vault(page);
  await page.goto(`/?graph=1&vault=${ws}`);
  await opened(page, "9 of 9 files");
  const shown = page.locator("[data-dag-graph-counts]");

  await page.locator("[data-dag-graph-colour-by]").selectOption({ label: "Tag" });
  await expect(page.locator('[data-dag-graph-value="sea"]')).toBeVisible();
  await page.locator('[data-dag-graph-value="sea"] [data-dag-graph-only]').click();
  await expect(shown).toContainText("4 of 9 files");
  await expect(page.locator('[data-dag-graph-value="shore"] [data-dag-graph-toggle]')).toHaveAttribute("aria-pressed", "false");

  /* Coloured by something else, the filter is a chip, and the chip takes it off. */
  await page.locator("[data-dag-graph-colour-by]").selectOption({ label: "Kind" });
  await page.locator('[data-dag-graph-chip="tag"]').click();
  await expect(shown).toContainText("9 of 9 files");

  /* Files with no links go and come back. */
  await page.locator("[data-dag-graph-orphans]").click();
  await expect(shown).toContainText("8 of 9 files");
  await page.locator("[data-dag-graph-orphans]").click();
  await expect(shown).toContainText("9 of 9 files");

  /* Grouping turns the group sliders on; it settles again. */
  await expect(page.locator('[data-dag-graph-force="gap"]')).toBeDisabled();
  await page.locator("[data-dag-graph-group-by]").selectOption({ label: "Linked clusters" });
  await expect(page.locator('[data-dag-graph-force="gap"]')).toBeEnabled();
  await atRest(page);
});
