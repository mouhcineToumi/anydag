#!/usr/bin/env node
/**
 * Package the desktop app for the OS this runs on — what `npm run desktop:dist` and both workflows
 * call after `npm run desktop:build`. It owns the three decisions electron-builder cannot make from
 * its config alone:
 *
 * 1. **Whether to sign.** A certificate in the environment signs; none does not, and the build still
 *    installs. macOS reads `CSC_LINK` + `CSC_KEY_PASSWORD` (a Developer ID Application .p12, base64
 *    or a path), and notarises when `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` and `APPLE_TEAM_ID` are
 *    there too. Windows reads `WIN_CSC_LINK` + `WIN_CSC_KEY_PASSWORD`. Each OS is handed only its own
 *    — electron-builder on Windows falls back to `CSC_LINK`, which here is an Apple certificate.
 *    Unsigned, `CSC_IDENTITY_AUTO_DISCOVERY` is `false` so nothing goes looking in a keychain, and
 *    the macOS app is signed **ad hoc** (`-c.mac.identity=-`): an Apple Silicon Mac runs no code
 *    without a signature of some kind, and an ad-hoc one is what "right-click → Open" can then
 *    allow. An empty variable — a secret the repository does not have — counts as absent.
 * 2. **Whether the shell may update itself on macOS**: the shell is rebuilt with `ANYDAG_SIGNED`,
 *    because Squirrel.Mac refuses an update to an ad-hoc-signed app (`desktop/main.ts`).
 * 3. **The second macOS architecture's watcher.** `npm ci` installs the prebuilt
 *    `@parcel/watcher-darwin-<arch>` of the machine it runs on; the x64 app built on an arm64 runner
 *    needs the other one, fetched with `npm pack` and checked against the lockfile's integrity.
 *
 *   node desktop/package.mjs [any electron-builder arguments]
 */
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const env = { ...process.env };
for (const [k, v] of Object.entries(env)) if (v === "") delete env[k];

const MAC = ["CSC_LINK", "CSC_KEY_PASSWORD", "APPLE_ID", "APPLE_APP_SPECIFIC_PASSWORD", "APPLE_TEAM_ID"];
const WIN = ["WIN_CSC_LINK", "WIN_CSC_KEY_PASSWORD"];
for (const k of process.platform === "darwin" ? WIN : process.platform === "win32" ? MAC : [...MAC, ...WIN]) delete env[k];

const signing = process.platform === "darwin" ? Boolean(env.CSC_LINK) : process.platform === "win32" ? Boolean(env.WIN_CSC_LINK) : false;
env.CSC_IDENTITY_AUTO_DISCOVERY = signing ? "true" : "false";
env.ANYDAG_SIGNED = signing ? "1" : "0";
/* electron-builder skips signing on a pull request (`GITHUB_BASE_REF`), ad hoc included. A PR job
   is handed no certificate, so the only signing it can do is the ad-hoc one the release does too. */
if (!signing) env.CSC_FOR_PULL_REQUEST = "true";

const args = ["--config", "desktop/electron-builder.yml", "--publish", "never", ...process.argv.slice(2)];
if (process.platform === "darwin" && !signing) args.push("-c.mac.identity=-");

const notarising = process.platform === "darwin" && signing && Boolean(env.APPLE_ID);
console.log(
  `package: ${process.platform} — ${signing ? `signed${process.platform === "darwin" ? (notarising ? ", notarised" : ", NOT notarised (no APPLE_ID)") : ""}` : process.platform === "darwin" ? "signed ad hoc" : "unsigned"}`,
);

if (process.platform === "darwin") otherWatcher();

/* The shell again, so it knows whether it was signed. */
process.env.ANYDAG_SIGNED = env.ANYDAG_SIGNED;
const { build } = await import("./build.mjs");
await build();

const bin = path.join(root, "node_modules", ".bin", process.platform === "win32" ? "electron-builder.cmd" : "electron-builder");
const run = spawnSync(bin, args, { cwd: root, env, stdio: "inherit", shell: process.platform === "win32" });
process.exit(run.status ?? 1);

/** `@parcel/watcher-darwin-<the other arch>`, at the version and integrity the lockfile pins. */
function otherWatcher() {
  const other = process.arch === "arm64" ? "x64" : "arm64";
  const name = `@parcel/watcher-darwin-${other}`;
  const dest = path.join(root, "node_modules", ...name.split("/"));
  if (fs.existsSync(path.join(dest, "watcher.node"))) return;
  const lock = JSON.parse(fs.readFileSync(path.join(root, "package-lock.json"), "utf8"));
  const pinned = lock.packages?.[`node_modules/${name}`];
  if (!pinned?.version || !pinned?.integrity) throw new Error(`package-lock.json pins no ${name}`);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "anydag-watcher-"));
  try {
    const file = execFileSync("npm", ["pack", `${name}@${pinned.version}`, "--pack-destination", tmp, "--silent"], { cwd: tmp, encoding: "utf8" })
      .trim()
      .split("\n")
      .pop();
    const tgz = path.join(tmp, file);
    const [algo, want] = pinned.integrity.split("-", 2);
    const got = createHash(algo).update(fs.readFileSync(tgz)).digest("base64");
    if (got !== want) throw new Error(`${name}@${pinned.version}: integrity ${algo}-${got} is not the lockfile's ${pinned.integrity}`);
    fs.mkdirSync(dest, { recursive: true });
    execFileSync("tar", ["-xzf", tgz, "-C", dest, "--strip-components=1"]);
    console.log(`package: ${name}@${pinned.version} beside this machine's, for the ${other} app`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
