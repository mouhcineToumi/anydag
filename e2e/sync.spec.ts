import { execFile, spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { expect, test } from "@playwright/test";

import { BOARDS } from "./boards";
import { openSettings, openSidebar } from "./sidebar";

/**
 * Sync, the way a person meets it: pair this vault with a server in Settings → Sync,
 * upload it under a passphrase, write the recovery code down, and watch the status; then a second
 * device — the CLI in-process on its own home and folder — downloads it, edits a note, and the open
 * note here picks the edit up.
 *
 * **The second device is a second app home.** Linking adopts the remote's id, so a download into
 * another vault of the same app server would rekey it to an id already open there and be refused.
 *
 * **The api server is this spec's own**: PGlite in a temp folder on a free port, with the account and
 * both pairing codes made through its admin CLI *before* it starts (PGlite is opened by one process
 * at a time). Everything lives in one temp folder, which is the only thing removed afterwards.
 *
 * The vault is made through the route, opened for the page and the suite's own put back as the
 * default at once (`vaults.spec.ts`'s rule: every other spec loads pages with no `vault=`).
 */

test.describe.configure({ mode: "serial" });

const run = promisify(execFile);
const HOME = fs.realpathSync(BOARDS);
const PASS = "correct horse battery";
const ROOT = process.cwd();
const SYNC_BIN = path.join(ROOT, "api", "dist", "anydag-api.mjs");

let tmp = "";
let server: ChildProcess | null = null;
let url = "";
let codes: string[] = [];
let vaultId = "";
let vaultDir = "";

const freePort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address() as net.AddressInfo;
      s.close(() => resolve(port));
    });
  });

test.beforeAll(async () => {
  test.setTimeout(120_000);
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "anydag-e2e-sync-"));
  await run("node", [path.join(ROOT, "api", "build.mjs")], { cwd: ROOT });
  const port = await freePort();
  url = `http://127.0.0.1:${port}`;
  const env = {
    ...process.env,
    ANYDAG_API_DATA: path.join(tmp, "server"),
    ANYDAG_API_PORT: String(port),
    ANYDAG_API_HOST: "127.0.0.1",
    ANYDAG_API_PUBLIC_URL: url,
  };
  await run("node", [SYNC_BIN, "account", "add", "e2e"], { env });
  for (let i = 0; i < 2; i++) {
    const out = (await run("node", [SYNC_BIN, "pair", "e2e"], { env })).stdout;
    codes.push(/^code:\s+(\S+)/m.exec(out)![1]!);
  }
  server = spawn("node", [SYNC_BIN, "serve"], { env, stdio: "ignore" });
  const end = Date.now() + 30_000;
  for (;;) {
    try {
      if ((await fetch(`${url}/v1/health`)).ok) break;
    } catch {
      /* Not listening yet. */
    }
    if (Date.now() > end) throw new Error("the api server did not start");
    await new Promise((r) => setTimeout(r, 200));
  }
});

test.afterAll(async ({ request }) => {
  await request.post("/api/vaults/open", { data: { path: HOME } }).catch(() => undefined);
  if (vaultId) await request.post("/api/vaults/close", { data: { id: vaultId, forget: true } }).catch(() => undefined);
  if (server?.pid) server.kill();
  /* Only the folder this spec made — and only if it made one. */
  if (tmp && path.basename(tmp).startsWith("anydag-e2e-sync-")) fs.rmSync(tmp, { recursive: true, force: true });
});

/** The CLI as the second device: its own home, its own folder, the app in this process. */
const device = (...args: string[]) => {
  const dir = path.join(tmp, "second");
  return run("node", [path.join(ROOT, "cli", "anydag.mjs"), "--vault", path.join(dir, "vault"), ...args], {
    env: { ...process.env, ANYDAG_HOME: path.join(dir, "home") },
    cwd: ROOT,
  });
};

test("pair, upload and watch the status in the browser; a second device downloads, edits, and the open note follows", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const heard: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") heard.push(`${m.type()}: ${m.text()}`);
  });
  page.on("pageerror", (e) => heard.push(String(e)));

  // A vault of its own, holding one note.
  const parent = path.join(tmp, "browser");
  fs.mkdirSync(parent);
  const made = await page.request.post("/api/vaults/create", { data: { parent, name: "synced" } });
  expect(made.ok(), await made.text()).toBe(true);
  const v = ((await made.json()) as { vault: { id: string; path: string } }).vault;
  vaultId = v.id;
  vaultDir = v.path;
  await page.request.post("/api/vaults/open", { data: { path: HOME } });
  fs.writeFileSync(path.join(vaultDir, "Plan.md"), "---\ntitle: Plan\n---\n\nthe first line, written in the browser vault\n");

  await page.goto(`/?vault=${vaultId}&note=Plan`);
  await expect(page.locator(".bn-editor")).toContainText("the first line");

  // Settings → Sync: pair.
  await openSettings(page, "sync");
  await page.locator("[data-dag-sync-server-input]").fill(url);
  await page.locator("[data-dag-sync-code]").fill(codes[0]!);
  await page.locator("[data-dag-sync-device-input]").fill("browser");
  await page.locator("[data-dag-sync-pair]").click();

  // Upload: the passphrase twice, then the recovery code, written down and typed back.
  await page.locator('[data-dag-sync-choose="upload"]').click();
  await page.locator("[data-dag-sync-pass]").fill(PASS);
  await page.locator("[data-dag-sync-pass-again]").fill(PASS);
  await page.locator("[data-dag-sync-upload]").click();
  const recovery = ((await page.locator("[data-dag-sync-recovery]").textContent()) ?? "").trim();
  expect(recovery).toMatch(/^[0-9A-Z]{4}(-[0-9A-Z]{4}){5,}$/);
  await expect(page.locator("[data-dag-sync-recovery-done]")).toBeDisabled();
  await page.locator("[data-dag-sync-recovery-saved]").check();
  await page.locator("[data-dag-sync-recovery-typed]").fill(recovery);
  await page.locator("[data-dag-sync-recovery-done]").click();

  // The status: synced, nothing pending, and the sidebar's foot says so too.
  await expect(page.locator("[data-dag-sync-state]")).toHaveAttribute("data-dag-sync-state", "idle");
  await expect(page.locator("[data-dag-sync-pending]")).toHaveAttribute("data-dag-sync-pending", "0");
  await expect(page.locator("[data-dag-sync-server]").first()).toContainText(url);
  const status = (await (await page.request.get(`/api/sync?vault=${vaultId}`)).json()) as { remote: string; linked: boolean };
  expect(status.linked).toBe(true);
  /* Escape, on purpose: the recovery step's Close unmounts under the focus, and the dialog has to
     have taken it back or the modal never hears the key. */
  await page.keyboard.press("Escape");
  await expect(page.locator("[data-dag-settings]")).toBeHidden();
  await openSidebar(page);
  await expect(page.locator("[data-dag-sync-row]")).toHaveAttribute("data-dag-sync-row", "idle");

  // Second device: pair, download, and the note is on its disk.
  const pass = path.join(tmp, "pass");
  fs.writeFileSync(pass, `${PASS}\n`);
  fs.mkdirSync(path.join(tmp, "second", "vault"), { recursive: true });
  fs.mkdirSync(path.join(tmp, "second", "home"), { recursive: true });
  await device("sync", "pair", url, codes[1]!, "--device", "second");
  await device("sync", "link", "--download", status.remote, "--passphrase-file", pass);
  const there = path.join(tmp, "second", "vault", "Plan.md");
  expect(fs.readFileSync(there, "utf8")).toContain("the first line, written in the browser vault");

  // It edits the note and syncs.
  fs.writeFileSync(there, fs.readFileSync(there, "utf8") + "\na line from the second device\n");
  await device("sync", "now");

  // Back here, with the note open: Sync now, and the editor shows the line. Waited on in the page.
  await page.request.post(`/api/sync/now?vault=${vaultId}`);
  await expect(page.locator(".bn-editor")).toContainText("a line from the second device", { timeout: 20_000 });
  expect(fs.readFileSync(path.join(vaultDir, "Plan.md"), "utf8")).toContain("a line from the second device");

  // Devices: the second one is listed, and revoking it signs it out.
  await openSettings(page, "sync");
  const row = page.locator("[data-dag-sync-device]").filter({ hasText: "second" });
  await expect(row).toBeVisible();
  await expect(page.locator("[data-dag-sync-me]")).toBeVisible();
  await row.locator("[data-dag-sync-revoke]").click();
  await row.locator("[data-dag-sync-revoke-yes]").click();
  await expect(row).toContainText("revoked");
  await expect(row.locator("[data-dag-sync-revoke]")).toHaveCount(0);

  expect(heard).toEqual([]);
});
