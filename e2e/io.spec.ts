import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { openMore } from "./more";
import { exportAs } from "./export";
import { BOARDS } from "./boards";
import { vaultKey } from "./vault";
import { openId } from "../src/board/envelope";

/**
 * Import and export.
 *
 * Export is checked on what the browser is handed: an SVG that carries every item and the fonts
 * once, a PNG that decodes at twice the SVG's size, and the board file byte for byte inside its id
 * envelope. Import is
 * checked on what lands in `boards/`: an image becomes an attachment and a fence drawn from it
 *, text becomes items where it was dropped, and a whole board file becomes a new board that
 * is then open. A pasted image is still the board's own, under its `.assets/`, and the width cap is
 * about that alone.
 */

const DIR = BOARDS;

const BOARD = `---
title: Ship me
---

\`\`\`md {#one x=0 y=0 w=320}
The first item.
\`\`\`

\`\`\`arch {#infra x=0 y=200 title="Infra"}
service api "API"
store db "DB"
api --> db
\`\`\`
`;

let name = "";
let file = "";
const made: string[] = [];
test.beforeEach(({}, info) => {
  name = `e2e-scratch-${info.testId}`;
  file = path.join(DIR, `${name}.board.md`);
  fs.writeFileSync(file, BOARD);
});
test.afterEach(async ({ page }) => {
  /* The attachments an import kept, through the api — which forgets their ids with them — and only
     the ones this board names, since an attachment lands at the top level beside it. */
  if (fs.existsSync(file))
    for (const id of new Set([...read().matchAll(/dag:([0-9a-z]{10})/g)].map((m) => m[1]!))) {
      const got = await page.request.get(`/__board/resolve?id=${id}`);
      if (got.ok())
        await page.request.post("/__board/delete", {
          data: { name: ((await got.json()) as { name: string }).name, kind: "file" },
        });
    }
  fs.rmSync(file, { force: true });
  fs.rmSync(path.join(DIR, `${name}.assets`), { recursive: true, force: true });
  for (const m of made.splice(0)) fs.rmSync(path.join(DIR, `${m}.board.md`), { force: true });
});

const read = () => fs.readFileSync(file, "utf8");

async function open(page: Page) {
  await page.goto(`/?board=${name}`);
  await page.evaluate(() => localStorage.setItem("dag:library", "0"));
  await page.waitForFunction(() => document.documentElement.dataset.dagReady === "1", null, { timeout: 20_000 });
  await page.evaluate(() => document.fonts.ready);
}

async function saved(page: Page, act: () => Promise<void>): Promise<{ name: string; bytes: Buffer }> {
  const [dl] = await Promise.all([page.waitForEvent("download"), act()]);
  const p = await dl.path();
  return { name: dl.suggestedFilename(), bytes: fs.readFileSync(p!) };
}

test("the board exports as one SVG with every item and the fonts once", { tag: "@smoke" }, async ({ page }) => {
  await open(page);
  const { name: fname, bytes } = await saved(page, () => exportAs(page, "svg"));
  expect(fname).toBe(`${name}.svg`);
  const svg = bytes.toString("utf8");
  expect(svg.startsWith("<svg")).toBe(true);
  expect(svg).toContain("The first item.");
  expect(svg).toContain("API");
  expect((svg.match(/<foreignObject/g) ?? []).length).toBe(2);
  /* Fonts embedded, and only once for the two items. */
  expect((svg.match(/@font-face/g) ?? []).length).toBeGreaterThan(0);
  expect((svg.match(/<style>/g) ?? []).length).toBe(1);
  expect(svg).not.toContain("var(--dag-");
  /* No editing chrome in the file. */
  expect(svg).not.toContain("dag-selbar");
  expect(svg).not.toContain("dag-handle");
});

test("the board exports as a PNG at twice the size, and the file as itself", async ({ page }) => {
  await open(page);
  const svg = await saved(page, () => exportAs(page, "svg"));
  const size = /width="(\d+)" height="(\d+)"/.exec(svg.bytes.toString("utf8"))!;

  const png = await saved(page, () => exportAs(page, "png"));
  expect(png.name).toBe(`${name}.png`);
  /* PNG signature, then the IHDR width and height. */
  expect(png.bytes.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  expect(png.bytes.readUInt32BE(16)).toBe(Number(size[1]) * 2);
  expect(png.bytes.readUInt32BE(20)).toBe(Number(size[2]) * 2);
  /* Not a blank raster: more than a handful of distinct bytes past the header. */
  expect(new Set(png.bytes.subarray(64)).size).toBeGreaterThan(20);

  const md = await saved(page, () => exportAs(page, "md"));
  expect(md.name).toBe(`${name}.board.md`);
  /* The board byte for byte inside the envelope that carries its permanent id:
     the id lives in the store, and the copy in transit is the one place a file says who it is. */
  const opened = openId(md.bytes.toString("utf8"));
  expect(opened.text).toBe(BOARD);
  expect(opened.id).toMatch(/^[0-9a-z]{10}$/);
});

test("one item exports as SVG and PNG from the toolbar's export menu", async ({ page }) => {
  await open(page);
  const at = (await page.locator('[data-dag-item="infra"]').boundingBox())!;
  await page.mouse.click(at.x + 30, at.y + 10);
  await page.locator("[data-dag-selbar-export]").click();
  const svg = await saved(page, () => page.locator("[data-dag-svg]").click());
  expect(svg.name).toBe(`${name}-infra.svg`);
  expect(svg.bytes.toString("utf8")).toContain("API");
  /* The item is selected while it is exported, so its handles are in the DOM: none of them may
     reach the file. The connect dots used to. */
  expect(svg.bytes.toString("utf8")).not.toContain("dag-connect-handle");
  expect(svg.bytes.toString("utf8")).not.toContain("dag-handle");
  await page.locator("[data-dag-selbar-export]").click();
  const png = await saved(page, () => page.locator("[data-dag-png]").click());
  expect(png.name).toBe(`${name}-infra.png`);
  expect(png.bytes.subarray(1, 4).toString()).toBe("PNG");
});

/** A 64×64 PNG, so an image lands at a width the placement rule actually chose. */
const SQUARE = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAT0lEQVR42u3PQQkAAAgEsItmNKMZzQi+hcEKLNXzWgQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQELgsexgFpBl5ifgAAAABJRU5ErkJggg==",
  "base64",
);

/** And a 256×64 one, to be wider than a cap. */
const WIDE = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAQAAAABACAIAAAB6Pz7pAAAAl0lEQVR42u3TAQkAAAgEsY9jHGMbyx46WIKDy3TBW5EAA4ABwABgADAAGAAMAAYAA4ABwABgADAAGAAMAAYAA4ABwABgADAAGAAMAAYAA4ABwABgADAAGAAMAAYAA4ABwABgADAAGAAMAAYAA4ABwABgADAAGAAMAAYAA4ABwAAYQAUMAAYAA4ABwABgADAAGAAMAAaAKxZzBQSxLhqcCgAAAABJRU5ErkJggg==",
  "base64",
);

/** The one image fence on the board, and the attachment it is drawn from. */
function imageFence(): { line: string; id: string } | null {
  const line = /```image \{[^}]*\}/.exec(read())?.[0];
  const id = line && /src="?dag:([0-9a-z]{10})"?/.exec(line)?.[1];
  return line && id ? { line, id } : null;
}

/** An attachment's bytes, as the page reads them. */
async function fileBytes(page: Page, id: string): Promise<Buffer> {
  const got = await page.request.get(`/__board/file?id=${id}`);
  expect(got.status()).toBe(200);
  return Buffer.from(await got.body());
}

test("importing text puts items on the board, and an image lands at its own size", async ({ page }) => {
  await open(page);
  await openMore(page);
  await page.locator("[data-dag-import]").setInputFiles([
    { name: "notes.md", mimeType: "text/markdown", buffer: Buffer.from("A paragraph that came in from a file.") },
    { name: "square.png", mimeType: "image/png", buffer: SQUARE },
  ]);
  await expect
    .poll(read, { timeout: 5_000 })
    .toMatch(/```md \{#md-[a-z0-9]{4} x=-?\d+ y=-?\d+\}\nA paragraph that came in from a file\.\n```/);
  /* An attachment, drawn by id. `w=64`, not the fixed `w=520` this used to assert: a fixed width
     was the whole of the "pasted images lose their quality" defect, and the default rule is now
     the image's own size. */
  await expect.poll(() => imageFence()?.line ?? "", { timeout: 5_000 }).toMatch(/\bw=64\b/);
  const { id } = imageFence()!;
  /* Nothing under the board's own pictures, and the bytes are the ones that were handed over, untouched. */
  expect(fs.existsSync(path.join(DIR, `${name}.assets`))).toBe(false);
  expect((await fileBytes(page, id)).equals(SQUARE)).toBe(true);
});

test("an image lands on the page you were looking at", async ({ page }) => {
  /* A board with pages of its own, so both halves of the defect are in view: the appended fence
     used to carry no `page=` at all, so a screenshot pasted on the second page landed on the first
     — and, because `page-1` is not a page a board like this has, it drew under an
     `EB_UNKNOWN_PAGE` naming a page nobody had written. */
  fs.writeFileSync(
    file,
    `---
title: Two pages
pages:
  - id: docs
    name: Docs
  - id: gap
    name: Gap
---

\`\`\`md {#intro page=docs}
On the first page.
\`\`\`
`,
  );
  await page.goto(`/?board=${name}&page=gap`);
  await page.evaluate(() => localStorage.setItem("dag:library", "0"));
  await page.waitForFunction(() => document.documentElement.dataset.dagReady === "1", null, { timeout: 20_000 });

  await openMore(page);
  await page.locator("[data-dag-import]").setInputFiles([{ name: "square.png", mimeType: "image/png", buffer: SQUARE }]);
  await expect.poll(() => imageFence()?.line ?? "", { timeout: 5_000 }).toMatch(/\bw=64\b.*\bpage=gap\}/);
  /* And no error card: the board says what it means. */
  await expect(page.locator("[data-dag-error]")).toHaveCount(0);
});

/** Paste a picture onto the board, the way a screenshot arrives: it stays the board's own. */
async function paste(page: Page, bytes: Buffer, fileName: string): Promise<void> {
  await page.evaluate(
    ({ b64, fileName }) => {
      const data = new DataTransfer();
      data.items.add(new File([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], fileName, { type: "image/png" }));
      document.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
    },
    { b64: bytes.toString("base64"), fileName },
  );
}

test("the placement rule is a setting, and so is the one cap that can lose a pixel", async ({ page }) => {
  await open(page);
  /* A fixed width is still one setting away — it is what the app did before, for anyone who liked it. */
  const settings = await vaultKey(page, "dag:settings");
  await page.evaluate((k) => localStorage.setItem(k, JSON.stringify({ paste: { size: "width", width: 240 } })), settings);
  await openMore(page);
  await page.locator("[data-dag-import]").setInputFiles([{ name: "square.png", mimeType: "image/png", buffer: SQUARE }]);
  await expect.poll(() => imageFence()?.line ?? "", { timeout: 5_000 }).toMatch(/\bw=240\b/);
  /* Placed at 240 and *kept* at its own 64: a placement rule may not touch the bytes. */
  expect((await fileBytes(page, imageFence()!.id)).readUInt32BE(16)).toBe(64);

  /* The cap is the one thing here that resamples, and only a pasted picture — an attachment is kept
     as it was uploaded. It stays a PNG: what lands on this board is a screenshot with text
     in it, and lossy encoding of text is the defect all of this was opened for. */
  await page.evaluate((k) => localStorage.setItem(k, JSON.stringify({ paste: { maxWidth: 64 } })), settings);
  await page.locator(".dag-viewport").click({ position: { x: 20, y: 20 } });
  await paste(page, WIDE, "wide.png");
  /* A pasted picture is an attachment too: the board's second image fence, drawn from
     a \`dag:<id>\` file in the vault's attachments folder. */
  const pasted = () => {
    const fences = [...read().matchAll(/```image \{[^}]*\}/g)].map((m) => m[0]);
    const line = fences[1];
    const id = line && /src="?dag:([0-9a-z]{10})"?/.exec(line)?.[1];
    return line && id ? { line, id } : null;
  };
  await expect.poll(() => pasted()?.line ?? "", { timeout: 5_000 }).toMatch(/\bw=64\b/);
  const bytes = await fileBytes(page, pasted()!.id);
  expect(bytes.readUInt32BE(16), "a 256-pixel image stored at the 64-pixel cap").toBe(64);
  expect(bytes.subarray(1, 4).toString()).toBe("PNG");
  expect(bytes.length).toBeLessThan(WIDE.length);
});

test("dropping a board file makes a new board and opens it", async ({ page }) => {
  await open(page);
  const vp = (await page.locator(".dag-viewport").boundingBox())!;
  const text = "---\ntitle: Came in\n---\n\n```md {#hello}\nHello from a dropped file.\n```\n";
  await page.evaluate(
    ([x, y, text]) => {
      const dt = new DataTransfer();
      dt.items.add(new File([text as string], "Came In.board.md", { type: "text/markdown" }));
      const target = document.querySelector(".dag-viewport")!;
      target.dispatchEvent(
        new DragEvent("dragover", {
          dataTransfer: dt,
          bubbles: true,
          cancelable: true,
          clientX: x as number,
          clientY: y as number,
        }),
      );
      target.dispatchEvent(
        new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true, clientX: x as number, clientY: y as number }),
      );
    },
    [vp.x + 200, vp.y + 200, text],
  );
  /* Called its title, verbatim, not the dropped file's name. */
  await page.waitForURL((u) => u.searchParams.get("board") === "Came in", { timeout: 5_000 });
  made.push("Came in");
  /* Its title is its name now, so the frontmatter line goes; the vault mints the id on create. */
  expect(fs.readFileSync(path.join(DIR, "Came in.board.md"), "utf8")).toMatch(
    /^---\nid: [0-9a-z]{10}\n---\n\n?```md \{#hello\}\nHello from a dropped file\.\n```\n$/,
  );
  await expect(page.locator('[data-dag-item="hello"]')).toBeVisible({ timeout: 10_000 });
  /* The board it came from is untouched. */
  expect(read()).toBe(BOARD);
});

test("dropping plain text puts a note where it was dropped", async ({ page }) => {
  await open(page);
  const vp = (await page.locator(".dag-viewport").boundingBox())!;
  const at = { x: vp.x + 300, y: vp.y + vp.height - 150 };
  const want = await page.evaluate(
    ([x, y]) => {
      const box = document.querySelector(".dag-viewport")!.getBoundingClientRect();
      const m = new DOMMatrix(getComputedStyle(document.querySelector(".dag-layer")!).transform);
      return { x: (x - box.left - m.e) / m.a, y: (y - box.top - m.f) / m.a };
    },
    [at.x, at.y],
  );
  await page.evaluate(
    ([x, y]) => {
      const dt = new DataTransfer();
      dt.items.add(new File(["Dropped words."], "words.txt", { type: "text/plain" }));
      const target = document.querySelector(".dag-viewport")!;
      target.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true, clientX: x, clientY: y }));
    },
    [at.x, at.y],
  );
  await expect.poll(read, { timeout: 5_000 }).toMatch(/```md \{#md-[a-z0-9]{4} x=(-?\d+) y=(-?\d+)\}\nDropped words\.\n```/);
  const got = /x=(-?\d+) y=(-?\d+)\}\nDropped words/.exec(read())!;
  expect(Math.abs(Number(got[1]) - want.x)).toBeLessThanOrEqual(8);
  expect(Math.abs(Number(got[2]) - want.y)).toBeLessThanOrEqual(8);
});
