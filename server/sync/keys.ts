/**
 * The secrets the sync client keeps at rest.
 *
 * - **The home secret**: 32 random bytes per app install. The desktop keeps it in `safeStorage` and
 *   hands it to the server child as `ANYDAG_HOME_SECRET`; under `anydag serve` and the CLI it is
 *   `<home>/home.secret`, mode 0600, made on first use — never once the app keeps one.
 * - **The vault key**, sealed under the home secret in `~/.anydag/sync/<vault>/key`.
 *
 * Load-bearing: the vault key is never a plaintext file, and a link needs no restart — the server
 * can seal it the moment the passphrase opened it, because the secret it seals under is already in
 * the process.
 */

import fs from "node:fs";
import path from "node:path";

import { b64, open, randomKey, seal, unb64 } from "../../sync/protocol/crypto";

const AAD = "vault-key-at-rest";

function secretFrom(text: string, where: string): Uint8Array {
  const bytes = unb64(text.trim());
  if (bytes.byteLength !== 32) throw new Error(`${where} is not 32 bytes of base64url`);
  return bytes;
}

/** The desktop app keeps this install's home secret, and this process was not handed it. */
export class SecretElsewhere extends Error {
  constructor() {
    super(
      "The AnyDag app keeps this machine's sync secret in the system keychain, and this process was not given it. Link and sync this vault from the app, or with the app open — `anydag` then goes through it.",
    );
    this.name = "SecretElsewhere";
  }
}

/** Whether the desktop app has taken this home's secret into `safeStorage` (`desktop/main.ts`). */
function keptByDesktop(homeDir: string): boolean {
  try {
    const all = JSON.parse(fs.readFileSync(path.join(homeDir, "keys.json"), "utf8")) as { keys?: Record<string, unknown> };
    return all.keys?.ANYDAG_HOME_SECRET !== undefined;
  } catch {
    return false;
  }
}

/**
 * This install's home secret: `ANYDAG_HOME_SECRET`, else `<homeDir>/home.secret`, made when absent —
 * **unless the desktop app keeps it**. Once the app has run, the secret is an entry in `keys.json`
 * that only Electron's `safeStorage` can open, and a `home.secret` made beside it would be a second
 * secret: every vault key sealed under one would not open under the other, and which process sealed
 * it would decide whether a vault syncs. So the CLI or `anydag serve` with the app closed refuses
 * (`SecretElsewhere`) rather than make one. A `home.secret` already there is read: either the app
 * adopted it, or it is the one the CLI sealed under before the app ever ran.
 */
export function homeSecret(homeDir: string, env: NodeJS.ProcessEnv = process.env): Uint8Array {
  const given = env.ANYDAG_HOME_SECRET;
  if (given) return secretFrom(given, "ANYDAG_HOME_SECRET");
  const file = path.join(homeDir, "home.secret");
  try {
    return secretFrom(fs.readFileSync(file, "utf8"), file);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  if (keptByDesktop(homeDir)) throw new SecretElsewhere();
  fs.mkdirSync(homeDir, { recursive: true });
  const secret = randomKey();
  try {
    fs.writeFileSync(file, b64(secret) + "\n", { mode: 0o600, flag: "wx" });
    return secret;
  } catch (e) {
    // Another process made it first: theirs is the one.
    if ((e as NodeJS.ErrnoException).code === "EEXIST") return secretFrom(fs.readFileSync(file, "utf8"), file);
    throw e;
  }
}

/** Seal `vk` under the home secret into `<dir>/key`. */
export function saveVaultKey(dir: string, secret: Uint8Array, vk: Uint8Array): void {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "key");
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, b64(seal(secret, vk, AAD)) + "\n", { mode: 0o600 });
  fs.renameSync(tmp, file);
}

/** The vault key in `<dir>/key`, or `null` when none was saved. Throws when the secret does not open it. */
export function loadVaultKey(dir: string, secret: Uint8Array): Uint8Array | null {
  let text: string;
  try {
    text = fs.readFileSync(path.join(dir, "key"), "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
  return open(secret, unb64(text.trim()), AAD, "the vault key at rest");
}
