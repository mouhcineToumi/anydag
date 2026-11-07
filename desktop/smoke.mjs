#!/usr/bin/env node
/**
 * The desktop app's smoke check, on whichever OS runs it.
 *
 * It makes a vault in a temp folder holding one board, starts the app on it with
 * `ANYDAG_DESKTOP_SMOKE=1` and a temp home — so it writes nothing outside them: no shim, no
 * protocol registration, no update check — and passes when the app says it loaded the board and the
 * page published `data-dag-ready`. Which app: the packaged one under `release/` when there is one
 * (`--packaged`, the default when it exists), else Electron on `desktop/dist/main.cjs`.
 *
 *   node desktop/smoke.mjs [--dev | --packaged] [--app <path to the executable>]
 *
 * Exit 0 on `ready=1`, 1 otherwise, with everything the app said printed.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const flag = (name) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? args[at + 1] : undefined;
};

/** The unpacked app electron-builder leaves beside the installer, per OS. */
function packaged() {
  const release = path.join(root, "release");
  const found = [];
  if (process.platform === "linux") found.push(path.join(release, "linux-unpacked", "anydag"));
  if (process.platform === "win32") found.push(path.join(release, "win-unpacked", "AnyDag.exe"));
  if (process.platform === "darwin") {
    /* electron-builder names the x64 build `mac` and the others by their arch; this machine's own
       arch first, so the default run is a native one (`--app` names the other). */
    const dirs = process.arch === "arm64" ? ["mac-arm64", "mac-universal", "mac", "mac-x64"] : ["mac", "mac-x64", "mac-universal", "mac-arm64"];
    for (const dir of dirs) found.push(path.join(release, dir, "AnyDag.app", "Contents", "MacOS", "AnyDag"));
  }
  return found.find((f) => fs.existsSync(f));
}

function electron() {
  const bin = path.join(root, "node_modules", "electron", "dist");
  if (process.platform === "win32") return path.join(bin, "electron.exe");
  if (process.platform === "darwin") return path.join(bin, "Electron.app", "Contents", "MacOS", "Electron");
  return path.join(bin, "electron");
}

const app = flag("app") ?? (args.includes("--dev") ? undefined : packaged());
const [command, lead] = app ? [app, []] : [electron(), [path.join(root, "desktop", "dist", "main.cjs")]];

const vault = fs.mkdtempSync(path.join(os.tmpdir(), "anydag-smoke-vault-"));
const home = fs.mkdtempSync(path.join(os.tmpdir(), "anydag-smoke-home-"));
fs.writeFileSync(path.join(vault, "Smoke.board.md"), "---\ntitle: Smoke\n---\n\n```md\nIt opens.\n```\n");

/* Linux CI has no GPU and an unprivileged sandbox the runner may refuse; neither is what is tested.
   On macOS `safeStorage` is the login keychain, which the smoke has no business writing — and an
   item one build made is a modal "allow access?" to the next build signed differently (the x64 app
   after the arm64 one, each signed ad hoc), which blocks the main thread with nobody to answer it.
   Chromium's mock keychain keeps it in the process. */
const extra = process.platform === "linux" ? ["--no-sandbox", "--disable-gpu"] : process.platform === "darwin" ? ["--use-mock-keychain"] : [];
console.log(`smoke: ${command} ${[...lead, vault].join(" ")}`);
const child = spawn(command, [...lead, vault, ...extra], {
  env: { ...process.env, ANYDAG_DESKTOP_SMOKE: "1", ANYDAG_HOME: home, ELECTRON_ENABLE_LOGGING: "1" },
  stdio: ["ignore", "pipe", "pipe"],
});
let said = "";
const hear = (chunk) => {
  said += chunk;
  process.stdout.write(chunk);
};
child.stdout.on("data", hear);
child.stderr.on("data", hear);
/* The app waits up to 90 s for the page once it is up; a cold x64 build under Rosetta takes about a
   minute to get that far. */
const timer = setTimeout(() => {
  console.error("smoke: no answer in 240 s");
  child.kill();
  /* A main thread that is stuck never runs its SIGTERM handler. */
  setTimeout(() => child.kill("SIGKILL"), 10_000).unref();
}, 240_000);
child.on("exit", (code) => {
  clearTimeout(timer);
  const ok = /smoke: loaded \S+\?board=Smoke ready=1/.test(said);
  for (const dir of [vault, home]) fs.rmSync(dir, { recursive: true, force: true });
  console.log(ok ? "smoke: green" : `smoke: red (exit ${code})`);
  process.exit(ok ? 0 : 1);
});
