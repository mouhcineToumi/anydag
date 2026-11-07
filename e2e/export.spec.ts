import { expect, test, type Page } from "@playwright/test";

/**
 * The exported SVG is the diagram, not a picture of something like it.
 *
 * A serialiser like this fails quietly: it produces a valid file that opens and looks *nearly*
 * right, because one property was left off the copied list or a font did not travel. So the test
 * does not inspect the markup — it renders the export in a blank page and compares it against a
 * screenshot of the real item. If a font is missing or a rule was dropped, the text reflows and the
 * comparison fails.
 */

const BOARD = "reference/architecture";
const SHOT = "architecture-item.png";
/* Two screenshots of the same live page differ by a hundred antialiased pixels between runs. */
const TOLERANCE = 0.02;

/*
 * **`ANYDAG_NO_SNAPSHOTS` holds the export to the item itself rather than to the committed image**
 *, as `reference.spec.ts` stops comparing its 45. The image is Playwright's own
 * Chromium's, and another browser — the one `ANYDAG_CHROMIUM` names — draws this item 28px
 * narrower, so the committed size failed before a single pixel was compared: on every push, from
 * a worktree whose `.env` named the system browser, reading like a regression in the export. What
 * the test is about — the export against the thing it was exported from — holds in any browser,
 * so it is still asked, of the two pictures this run took.
 */
const PIXELS = !process.env.ANYDAG_NO_SNAPSHOTS;

test("an exported item renders the same as the item", async ({ page }) => {
  /*
   * Only against the dev server, and that is a property of this check rather than a gap.
   *
   * It reaches into the module graph — `import("/src/export/svg.ts")` — to call `itemToSvg` with
   * the page's own fonts and theme loaded, which is the only way to compare an export against the
   * thing it was exported from. A production build has no `/src/` to import: Vite has bundled it
   * into a hashed chunk, and asking for the source path is a 404. So under the compose stack this
   * skips, and what it covers is covered there by the Export menu's own checks in `io.spec.ts`.
   */
  const devServer = (await page.request.get("/src/export/svg.ts")).ok();
  test.skip(!devServer, "imports a TypeScript source path, which only the dev server serves");

  await page.goto(`/?board=${encodeURIComponent(BOARD)}`);
  await page.waitForFunction(() => document.documentElement.dataset.dagReady === "1", null, { timeout: 20_000 });
  await page.evaluate(() => document.fonts.ready);

  /* Park the canvas at 1:1 so the on-screen item and the export are the same size. */
  await page.evaluate(() => {
    const layer = document.querySelector<HTMLElement>(".dag-layer");
    if (layer) layer.style.transform = "translate(40px, 40px) scale(1)";
    const vp = document.querySelector<HTMLElement>(".dag-viewport");
    if (vp) vp.dataset.zoom = "1";
  });
  /* Two frames rather than a guess at how long one takes: the transform above is painted on the
     next one, and the screenshot below is compared pixel for pixel. */
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

  const item = page.locator("[data-dag-item]").first();

  /*
   * One baseline, two comparisons, in this order.
   *
   * The on-screen item writes the baseline; the export is then held to it. That is the whole test:
   * a serialiser fails by producing a valid file that is *nearly* right, so freezing whatever it
   * happens to emit would have passed while icons rendered as black rectangles and every edge was
   * missing — which is exactly what the first version of this did.
   */
  const before = await item.screenshot();
  /* The same tolerance as the export gets: a zero-difference baseline would be a flake. */
  if (PIXELS) expect(before).toMatchSnapshot(SHOT, { maxDiffPixelRatio: TOLERANCE });

  const svg = await page.evaluate(async () => {
    const { itemToSvg } = (await import("/src/export/svg.ts")) as typeof import("@/export/svg");
    const el = document.querySelector<HTMLElement>("[data-dag-item]")!;
    const inner = el.querySelector<HTMLElement>(".dag-item__body")!;
    return itemToSvg(el, {
      width: Math.ceil(el.getBoundingClientRect().width),
      height: Math.ceil(inner.getBoundingClientRect().height),
      title: "export test",
    });
  });

  expect(svg.startsWith("<svg")).toBe(true);
  /* The face itself, not a link to it: this is what makes the file portable. */
  expect(svg).toContain("@font-face");
  expect(svg).toContain("data:font");
  /* Every var() is resolved by getComputedStyle, so the file carries answers, not a theme. */
  expect(svg).not.toContain("var(--dag-");

  /* Guards the font filter, which is the difference between a file you can paste into a doc and
     one you cannot. Embedding every face `@fontsource` ships — forty-nine of them, one per weight
     per unicode range — was 960KB; the loaded-faces filter brings it to about a third of that, which
     is the Latin ranges at the weights this diagram actually sets. Shrinking it further means
     subsetting to the glyphs used, which is a different project. */
  expect(svg.length).toBeLessThan(400_000);

  /* Render it cold, in a page that has never loaded the app, and compare. */
  const blank = await page.context().newPage();
  const size = await page.evaluate(() => {
    const el = document.querySelector<HTMLElement>("[data-dag-item]")!;
    const inner = el.querySelector<HTMLElement>(".dag-item__body")!;
    return { width: Math.ceil(el.getBoundingClientRect().width), height: Math.ceil(inner.getBoundingClientRect().height) };
  });
  await blank.setViewportSize(size);
  await blank.setContent(`<body style="margin:0">${svg}</body>`);
  await blank.evaluate(() => document.fonts.ready);
  await blank.waitForTimeout(300);
  /* A page screenshot rather than a locator one: `foreignObject` never satisfies Playwright's
     element-stability check, which waits for two identical bounding boxes in a row. */
  const after = await blank.screenshot();
  await blank.close();

  /* The export, against the picture of the real thing. A dropped property or a font that did not
     travel reflows the text, which this catches; sub-pixel antialiasing it tolerates. */
  if (PIXELS) {
    expect(after).toMatchSnapshot(SHOT, { maxDiffPixelRatio: TOLERANCE });
  } else {
    const { size, ratio } = await differing(page, before, after);
    expect(size.after, "the export's size").toEqual(size.before);
    expect(ratio, "the share of pixels the export draws differently").toBeLessThan(TOLERANCE);
  }
});

/**
 * The share of pixels two PNGs disagree on, worked out in the page — for a run that compares no
 * committed screenshots and still has to hold the export to the item.
 *
 * Playwright's comparator is not public, so this is a blunter one: a pixel differs when its three
 * channels are further apart than a fifth of the way from black to white in all, which is what
 * antialiasing stays under and a glyph in another face or a missing edge does not.
 */
async function differing(
  page: Page,
  a: Buffer,
  b: Buffer,
): Promise<{ size: { before: [number, number]; after: [number, number] }; ratio: number }> {
  const url = (png: Buffer) => `data:image/png;base64,${png.toString("base64")}`;
  return page.evaluate(
    async ([a, b]) => {
      const pixels = async (src: string) => {
        const img = new Image();
        img.src = src;
        await img.decode();
        const canvas = new OffscreenCanvas(img.naturalWidth, img.naturalHeight);
        const g = canvas.getContext("2d")!;
        g.drawImage(img, 0, 0);
        return { w: img.naturalWidth, h: img.naturalHeight, data: g.getImageData(0, 0, img.naturalWidth, img.naturalHeight).data };
      };
      const [p, q] = await Promise.all([pixels(a), pixels(b)]);
      const size = { before: [p.w, p.h] as [number, number], after: [q.w, q.h] as [number, number] };
      if (p.w !== q.w || p.h !== q.h) return { size, ratio: 1 };
      let off = 0;
      for (let i = 0; i < p.data.length; i += 4) {
        const d = Math.abs(p.data[i]! - q.data[i]!) + Math.abs(p.data[i + 1]! - q.data[i + 1]!) + Math.abs(p.data[i + 2]! - q.data[i + 2]!);
        if (d > 153) off++;
      }
      return { size, ratio: off / (p.w * p.h) };
    },
    [url(a), url(b)] as const,
  );
}
