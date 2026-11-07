import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { unzipSync } from "fflate";

import { BOARDS } from "./boards";
import { openSettings, openSidebar } from "./sidebar";

/**
 * Attachments. Any file a person works with, kept as a document of
 * its own and referred to by id from a note or a board.
 *
 * Each test works in a folder of its own, named for the test **and the run**: a share link and an id
 * belong to a file the store has seen, and a name a second run reused would inherit the first run's
 * (`CLAUDE.md`, *Things that will bite*, on the files index). It is emptied through the api, which
 * forgets the ids and the links with the files, and then off the disk for anything left.
 */

let folder = "";
let dir = "";
let problems: string[] = [];

test.beforeEach(({ page }, info) => {
  folder = `e2e-file-${info.testId}-${Date.now().toString(36)}`;
  dir = path.join(BOARDS, folder);
  fs.mkdirSync(dir, { recursive: true });
  problems = [];
  watch(page);
});

test.afterEach(async ({ page }) => {
  /* Only the folder this test made, and only when it knows which: a cleanup matching an empty name
     would be every file in the account. */
  if (folder) {
    await page.request.post("/__board/rmdir", { data: { name: folder, recursive: true } }).catch(() => undefined);
    fs.rmSync(dir, { recursive: true, force: true });
  }
  folder = "";
  expect(problems, "console output").toEqual([]);
});

function watch(page: Page, allowed: RegExp[] = []): void {
  page.on("console", (msg) => {
    if (msg.type() !== "error" && msg.type() !== "warning") return;
    if (allowed.some((re) => re.test(msg.text()))) return;
    problems.push(msg.text());
  });
  page.on("pageerror", (e) => problems.push(String(e)));
}

const ready = (page: Page) => page.waitForFunction(() => document.documentElement.dataset.dagReady === "1", null, { timeout: 20_000 });

/** A one-page PDF with a filled rectangle on it: real enough for pdf.js, and no font to fetch. */
function pdf(): Buffer {
  const content = "0 0.4 0.8 rg 40 40 220 120 re f";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents 4 0 R /Resources << >> >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ];
  let out = "%PDF-1.4\n";
  const at: number[] = [];
  objects.forEach((o, i) => {
    at.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${at.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

/** A one-pixel PNG. */
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");

/** Bytes nobody draws: what a spreadsheet is to a page. */
const SHEET = Buffer.from("PK\u0003\u0004 not really a workbook", "latin1");

interface Dropped {
  name: string;
  type: string;
  b64: string;
}
const file = (name: string, type: string, data: Buffer): Dropped => ({ name, type, b64: data.toString("base64") });

/**
 * Files dragged in from the computer, let go over `selector` — or over the point `at` inside it. A
 * `DataTransfer` built in the page, since a real one only comes from outside it.
 */
async function drop(page: Page, selector: string, files: Dropped[], at?: { x: number; y: number }): Promise<void> {
  await page.locator(selector).first().scrollIntoViewIfNeeded();
  await page.evaluate(
    ({ selector, files, at }) => {
      const el = document.querySelector(selector)!;
      const box = el.getBoundingClientRect();
      const x = at?.x ?? box.left + box.width / 2;
      const y = at?.y ?? box.top + box.height / 2;
      const target = (at ? document.elementFromPoint(x, y) : el) ?? el;
      const dt = new DataTransfer();
      for (const f of files) dt.items.add(new File([Uint8Array.from(atob(f.b64), (c) => c.charCodeAt(0))], f.name, { type: f.type }));
      for (const type of ["dragenter", "dragover", "drop"])
        target.dispatchEvent(new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true, clientX: x, clientY: y }));
    },
    { selector, files, at },
  );
}

/** Keep a file through the route, as the CLI and an agent do: the body is the bytes. */
async function upload(page: Page, name: string, data: Buffer): Promise<{ name: string; id: string }> {
  const res = await page.request.post(`/__board/file?name=${encodeURIComponent(name)}&folder=${encodeURIComponent(folder)}`, {
    data,
    headers: { "content-type": "application/octet-stream" },
  });
  expect(res.status(), await res.text()).toBe(200);
  return (await res.json()) as { name: string; id: string };
}

function writeNote(leaf: string, body: string): string {
  fs.writeFileSync(path.join(dir, `${leaf}.note.md`), `---\ntitle: A note\n---\n${body}`);
  return `${folder}/${leaf}`;
}

/** The folder's rows, opened. */
async function openFolder(page: Page): Promise<void> {
  await openSidebar(page);
  const row = page.locator(`[data-dag-sidebar-folder="${folder}"]`);
  await expect(row).toBeVisible({ timeout: 10_000 });
  if ((await row.getAttribute("aria-expanded")) !== "true") await row.click();
}

test("files dropped on a folder in the sidebar are kept there, each with the icon of its sort, and a PDF opens drawn", async ({ page }) => {
  await page.goto("/");
  await openSidebar(page);
  await expect(page.locator(`[data-dag-sidebar-folder="${folder}"]`)).toBeVisible({ timeout: 10_000 });
  await drop(page, `[data-dag-sidebar-folder="${folder}"]`, [
    file("Q3 Report.pdf", "application/pdf", pdf()),
    file("Budget.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", SHEET),
    file("shot.png", "image/png", PNG),
  ]);
  /* Named off what they were called, and exactly the bytes that were dropped. */
  await expect.poll(() => fs.readdirSync(dir).sort(), { timeout: 10_000 }).toEqual(["Budget.xlsx", "Q3 Report.pdf", "shot.png"]);
  expect(fs.readFileSync(path.join(dir, "Q3 Report.pdf")).equals(pdf())).toBe(true);

  await openFolder(page);
  for (const [name, sort] of [
    ["Q3 Report.pdf", "pdf"],
    ["Budget.xlsx", "sheet"],
    ["shot.png", "image"],
  ] as const) {
    const row = page.locator(`[data-dag-sidebar-file="${folder}/${name}"]`);
    await expect(row).toHaveAttribute("data-dag-kind", "file");
    await expect(row.locator(`[data-dag-file-sort="${sort}"]`)).toHaveCount(1);
  }
  /* A row says what the file was called, not its name on disk. */
  await expect(page.locator(`[data-dag-sidebar-file="${folder}/Q3 Report.pdf"]`)).toContainText("Q3 Report.pdf");

  await page.locator(`[data-dag-sidebar-file="${folder}/Q3 Report.pdf"]`).click();
  await expect.poll(() => new URL(page.url()).searchParams.get("file")).toBe(`${folder}/Q3 Report.pdf`);
  const view = page.locator(`[data-dag-file-view="${folder}/Q3 Report.pdf"]`);
  await expect(view).toBeVisible({ timeout: 10_000 });
  await expect(page.locator("[data-dag-pdf-pages]")).toHaveAttribute("data-dag-pdf-pages", "1", { timeout: 15_000 });
  await expect(page.locator('[data-dag-pdf-page="1"]')).toBeVisible();
  await expect(page.locator("[data-dag-note-title]")).toHaveValue("Q3 Report.pdf");

  /* What a page cannot draw is a card with its type, its size and a download under the name it had. */
  await page.locator(`[data-dag-sidebar-file="${folder}/Budget.xlsx"]`).click();
  await expect(page.locator('[data-dag-file-block="sheet"]')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('[data-dag-file-block="sheet"]')).toContainText("Spreadsheet");
  const [saved] = await Promise.all([page.waitForEvent("download"), page.locator("[data-dag-file-download]").click()]);
  expect(saved.suggestedFilename()).toBe("Budget.xlsx");
  expect(fs.readFileSync((await saved.path())!).equals(SHEET)).toBe(true);
});

test("a type this server does not take is refused where it was dropped, and nothing is kept", async ({ page }) => {
  await page.goto("/");
  await openSidebar(page);
  await expect(page.locator(`[data-dag-sidebar-folder="${folder}"]`)).toBeVisible({ timeout: 10_000 });
  await drop(page, `[data-dag-sidebar-folder="${folder}"]`, [file("setup.exe", "application/octet-stream", SHEET)]);
  await expect(page.locator("[data-dag-sidebar-upload-problem]")).toContainText(".exe files cannot be uploaded here");
  expect(fs.readdirSync(dir)).toEqual([]);
});

test("a file dropped into a note is kept beside it and embedded there: a picture drawn, a PDF a card that previews in place", async ({ page }) => {
  const name = writeNote("n", "The first paragraph.\n\nThe last paragraph.\n");
  await page.goto(`/?note=${encodeURIComponent(name)}`);
  const last = page.locator(".bn-editor [data-content-type='paragraph']", { hasText: "The last paragraph." });
  await expect(last).toBeVisible({ timeout: 15_000 });
  const box = (await last.boundingBox())!;
  await drop(page, "[data-dag-note-drop]", [file("shot.png", "image/png", PNG), file("Q3 Report.pdf", "application/pdf", pdf())], {
    x: box.x + box.width / 2,
    y: box.y + box.height / 2,
  });

  const note = () => fs.readFileSync(path.join(dir, "n.note.md"), "utf8");
  await expect.poll(note, { timeout: 10_000 }).toMatch(/!\[Q3 Report\.pdf\]\(dag:[0-9a-z]{10}\)/);
  expect(note()).toMatch(/!\[shot\.png\]\(dag:[0-9a-z]{10}\)/);
  /* Beside the note, and no copy under its pictures: an attachment is not a pasted image. */
  expect(fs.readdirSync(dir).sort()).toEqual(["Q3 Report.pdf", "n.note.md", "shot.png"]);

  await expect(page.locator("[data-dag-embed-picture]")).toBeVisible({ timeout: 10_000 });
  expect(await page.locator("[data-dag-embed-picture]").evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(1);
  const card = page.locator('.dag-embed--file[data-dag-embed-kind="file"]');
  await expect(card).toContainText("Q3 Report.pdf");
  await card.locator("[data-dag-embed-preview]").click();
  await expect(card.locator('[data-dag-pdf-page="1"]')).toBeVisible({ timeout: 15_000 });
});

test("dropped on a board, a picture is an image fence drawn from the file and anything else a card", async ({ page }) => {
  fs.writeFileSync(path.join(dir, "b.board.md"), "---\ntitle: B\n---\n\n```md {#hello x=0 y=0}\nHello.\n```\n");
  await page.goto(`/?board=${encodeURIComponent(`${folder}/b`)}`);
  await ready(page);
  const vp = (await page.locator(".dag-viewport").boundingBox())!;
  await drop(page, ".dag-viewport", [file("shot.png", "image/png", PNG), file("Budget.xlsx", "application/octet-stream", SHEET)], {
    x: vp.x + vp.width / 2,
    y: vp.y + vp.height / 2,
  });
  const board = () => fs.readFileSync(path.join(dir, "b.board.md"), "utf8");
  await expect.poll(board, { timeout: 10_000 }).toMatch(/```image \{[^}]*src="?dag:[0-9a-z]{10}"?/);
  await expect.poll(board, { timeout: 10_000 }).toMatch(/!\[Budget\.xlsx\]\(dag:[0-9a-z]{10}\)/);
  expect(fs.readdirSync(dir).sort()).toEqual(["Budget.xlsx", "b.board.md", "shot.png"]);

  const img = page.locator(".dag-item img[src*='/__board/file?id=']");
  await expect(img).toBeVisible({ timeout: 10_000 });
  await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBe(1);
  await expect(page.locator('[data-dag-embed-kind="file"][data-dag-embed-placed]')).toContainText("Budget.xlsx");
});

test("deleting a file a note uses moves it to the trash at once, and Undo brings it back", async ({ page }) => {
  const kept = await upload(page, "Q3 Report.pdf", pdf());
  writeNote("uses", `Read ![Q3 Report.pdf](dag:${kept.id}) first.\n`);
  await page.goto("/");
  await openFolder(page);
  const row = page.locator(`[data-dag-sidebar-file="${kept.name}"]`);
  await expect(row).toBeVisible();

  /* No question first, as there was when nothing could bring it back: it goes, and the
     note that names it shows it as missing until it is restored. */
  await row.click({ button: "right" });
  await page.locator('[data-dag-sidebar-menu-item="delete"]').click();
  await expect.poll(() => fs.existsSync(path.join(dir, "Q3 Report.pdf"))).toBe(false);
  await expect(row).toHaveCount(0);
  await expect(page.locator("[data-dag-trash-notice]")).toContainText("Moved “Q3 Report.pdf” to the trash.");

  await page.locator("[data-dag-trash-undo]").click();
  await expect.poll(() => fs.existsSync(path.join(dir, "Q3 Report.pdf"))).toBe(true);
  await expect(row).toBeVisible();
  /* The same file, under the same id, so the note's reference to it works again. */
  const back = (await (await page.request.get("/__board/files")).json()) as { files: { name: string; id: string }[] };
  expect(back.files.find((f) => f.name === kept.name)?.id).toBe(kept.id);
});

test("a note that names a file exports as a zip with the file beside the Markdown", async ({ page }) => {
  const kept = await upload(page, "Q3 Report.pdf", pdf());
  const name = writeNote("n", `See [the report](dag:${kept.id}).\n`);
  await page.goto(`/?note=${encodeURIComponent(name)}`);
  await expect(page.locator(".bn-editor")).toBeVisible({ timeout: 15_000 });
  await page.locator("[data-dag-export]").click();
  const [saved] = await Promise.all([page.waitForEvent("download"), page.locator('[data-dag-export-as="md"]').click()]);
  expect(saved.suggestedFilename()).toMatch(/\.zip$/);
  const zip = unzipSync(new Uint8Array(fs.readFileSync((await saved.path())!)));
  const md = Object.keys(zip).find((k) => k.endsWith(".note.md"))!;
  /* The reference is the file's path in the zip, and the file is there, byte for byte. */
  expect(new TextDecoder().decode(zip[md])).toBe("---\ntitle: A note\n---\nSee [the report](Q3 Report.pdf).\n");
  expect(Buffer.from(zip["Q3 Report.pdf"]!).equals(pdf())).toBe(true);
});

test("Settings says the largest file this server takes, and which", async ({ page }) => {
  await page.goto("/");
  await openSettings(page, "export");
  await expect(page.locator("[data-dag-setting-upload-max]")).toHaveText(/\d+ MB/);
  await expect(page.locator("[data-dag-setting-upload-types]")).toContainText(".pdf");
});
