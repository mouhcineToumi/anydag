/**
 * The sync protocol's cryptography. `node:crypto` and nothing else, so
 * the server, the app's server child under Electron's Node and the CLI all run the same code.
 *
 * - `VK`, the vault key: 32 random bytes per remote vault. Never sent in the clear: wrapped under a
 *   key derived from the passphrase (`deriveKek`) and under the recovery key.
 * - `keysOf(VK)`: three subkeys by HKDF-SHA256 — `path` names a path (`keyOf`), `blob` names bytes
 *   (`blobId`), `enc` seals content and metadata.
 * - A seal is AES-256-GCM: `[0x01][nonce 12][ciphertext][tag 16]`, with associated data binding it
 *   to what it is (a key, a blob id, a label) so the server cannot swap one ciphertext for another.
 *
 * Every binary string on the wire is base64url without padding.
 */

import * as nodeCrypto from "node:crypto";
import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

import type { KdfParams } from "./wire";

/** Node 24's Argon2, which the installed `@types/node` does not describe yet. */
type Argon2 = (
  algorithm: "argon2id",
  p: { message: Uint8Array; nonce: Uint8Array; parallelism: number; tagLength: number; memory: number; passes: number },
) => Buffer;
const argon2Sync = (nodeCrypto as unknown as { argon2Sync?: Argon2 }).argon2Sync;

const VERSION = 0x01;
const NONCE = 12;
const TAG = 16;

export class Unsealed extends Error {
  constructor(what: string) {
    super(`could not open ${what}: wrong key, or it was changed`);
  }
}

export const b64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString("base64url");
export const unb64 = (text: string): Uint8Array => new Uint8Array(Buffer.from(text, "base64url"));

/** 32 random bytes: a vault key, a recovery key, a device token's source. */
export const randomKey = (): Uint8Array => new Uint8Array(randomBytes(32));

// -- paths ----------------------------------------------------------------------------------------

/**
 * A vault-relative path as the protocol names it: `/`-separated, NFC, no leading or trailing slash,
 * no empty, `.` or `..` segment. Throws on a path that would not name one place in a vault.
 */
export function normalise(rel: string): string {
  const parts = rel
    .normalize("NFC")
    .replace(/\\/g, "/")
    .split("/")
    .filter((p) => p !== "");
  if (!parts.length || parts.some((p) => p === "." || p === "..")) throw new Error(`not a vault path: ${JSON.stringify(rel)}`);
  return parts.join("/");
}

/** The form a key is computed from: two names one file system calls the same are one key. */
export const keyForm = (rel: string): string => normalise(rel).toLowerCase();

// -- keys -----------------------------------------------------------------------------------------

export interface VaultKeys {
  path: Uint8Array;
  blob: Uint8Array;
  enc: Uint8Array;
}

const sub = (vk: Uint8Array, label: string): Uint8Array =>
  new Uint8Array(hkdfSync("sha256", vk, new Uint8Array(0), `anydag-sync/v1/${label}`, 32));

export function keysOf(vk: Uint8Array): VaultKeys {
  if (vk.byteLength !== 32) throw new Error("a vault key is 32 bytes");
  return { path: sub(vk, "path"), blob: sub(vk, "blob"), enc: sub(vk, "enc") };
}

const hmac = (key: Uint8Array, data: Uint8Array | string): string => b64(createHmac("sha256", key).update(data).digest());

/** The opaque key a path is stored under. */
export const keyOf = (kPath: Uint8Array, rel: string): string => hmac(kPath, keyForm(rel));

/** The opaque id of a plaintext: one per content per vault, meaningless across vaults. */
export const blobId = (kBlob: Uint8Array, bytes: Uint8Array): string => hmac(kBlob, bytes);

// -- sealing --------------------------------------------------------------------------------------

export function seal(kEnc: Uint8Array, plain: Uint8Array, aad: string): Uint8Array {
  const nonce = randomBytes(NONCE);
  const c = createCipheriv("aes-256-gcm", kEnc, nonce);
  c.setAAD(Buffer.from(aad, "utf8"));
  const body = Buffer.concat([c.update(plain), c.final()]);
  return new Uint8Array(Buffer.concat([Buffer.from([VERSION]), nonce, body, c.getAuthTag()]));
}

export function open(kEnc: Uint8Array, sealed: Uint8Array, aad: string, what = "a sealed value"): Uint8Array {
  if (sealed.byteLength < 1 + NONCE + TAG || sealed[0] !== VERSION) throw new Unsealed(what);
  const nonce = sealed.subarray(1, 1 + NONCE);
  const tag = sealed.subarray(sealed.byteLength - TAG);
  const body = sealed.subarray(1 + NONCE, sealed.byteLength - TAG);
  try {
    const d = createDecipheriv("aes-256-gcm", kEnc, nonce);
    d.setAAD(Buffer.from(aad, "utf8"));
    d.setAuthTag(tag);
    return new Uint8Array(Buffer.concat([d.update(body), d.final()]));
  } catch {
    throw new Unsealed(what);
  }
}

/** A file's bytes, bound to their blob id. */
export const sealBlob = (kEnc: Uint8Array, id: string, plain: Uint8Array): Uint8Array => seal(kEnc, plain, `blob:${id}`);
export const openBlob = (kEnc: Uint8Array, id: string, sealed: Uint8Array): Uint8Array =>
  open(kEnc, sealed, `blob:${id}`, `blob ${id}`);

/** A short text (a vault's name), bound to a label. */
export const sealText = (kEnc: Uint8Array, label: string, text: string): string =>
  b64(seal(kEnc, Buffer.from(text, "utf8"), `text:${label}`));

// -- the vault key, wrapped -----------------------------------------------------------------------

/** What a new vault's passphrase is stretched with. Argon2id where Node has it, scrypt where not. */
export function newParams(): KdfParams {
  const salt = b64(randomBytes(16));
  return typeof argon2Sync === "function"
    ? { kdf: "argon2id", m: 65536, t: 3, p: 1, salt }
    : { kdf: "scrypt", N: 1 << 17, r: 8, p: 1, salt };
}

/** The key a passphrase unlocks the vault key with. ~200 ms by design. */
export function deriveKek(passphrase: string, params: KdfParams): Uint8Array {
  const message = Buffer.from(passphrase.normalize("NFC"), "utf8");
  const salt = Buffer.from(params.salt, "base64url");
  if (params.kdf === "argon2id") {
    if (typeof argon2Sync !== "function") throw new Error("this Node has no Argon2: the vault was made where one exists");
    return new Uint8Array(
      argon2Sync("argon2id", { message, nonce: salt, parallelism: params.p, tagLength: 32, memory: params.m, passes: params.t }),
    );
  }
  return new Uint8Array(
    scryptSync(message, salt, 32, { N: params.N, r: params.r, p: params.p, maxmem: 256 * params.N * params.r }),
  );
}

export const wrapKey = (kek: Uint8Array, vk: Uint8Array): string => b64(seal(kek, vk, "vault-key"));
export const unwrapKey = (kek: Uint8Array, wrapped: string): Uint8Array =>
  open(kek, unb64(wrapped), "vault-key", "the vault key");

// -- the recovery key ------------------------------------------------------------------------------

/*
 * 32 bytes as 52 Crockford base32 characters plus a 4-character check, in 14 groups of four:
 * `7Q2M-9XK4-…`. Read back case-insensitively, `O` as `0`, `I`/`L` as `1`, dashes and spaces ignored.
 * (Not words: a word list is 2,048 strings to vendor, for no gain a check digit lacks.)
 */
const B32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function toB32(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
    value &= (1 << bits) - 1;
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

function fromB32(text: string, bytes: number): Uint8Array | null {
  const out = new Uint8Array(bytes);
  let bits = 0;
  let value = 0;
  let at = 0;
  for (const ch of text) {
    const v = B32.indexOf(ch);
    if (v < 0) return null;
    value = (value << 5) | v;
    bits += 5;
    if (bits >= 8) {
      if (at < bytes) out[at++] = (value >>> (bits - 8)) & 255;
      bits -= 8;
    }
    value &= (1 << bits) - 1;
  }
  /* The padding bits of the last character must be zero, or two codes would open one key. */
  return at === bytes && value === 0 ? out : null;
}

const check = (key: Uint8Array): string =>
  toB32(createHmac("sha256", "anydag-sync/recovery").update(key).digest().subarray(0, 3)).slice(0, 4);

export function recoveryCode(key: Uint8Array): string {
  if (key.byteLength !== 32) throw new Error("a recovery key is 32 bytes");
  return (toB32(key) + check(key)).match(/.{1,4}/g)!.join("-");
}

/** The key a recovery code holds, or `null` when it was mistyped. */
export function fromRecoveryCode(code: string): Uint8Array | null {
  const clean = code.toUpperCase().replace(/[\s-]/g, "").replace(/O/g, "0").replace(/[IL]/g, "1").replace(/U/g, "V");
  if (clean.length !== 56) return null;
  const key = fromB32(clean.slice(0, 52), 32);
  if (!key) return null;
  const want = Buffer.from(check(key));
  const got = Buffer.from(clean.slice(52));
  return want.length === got.length && timingSafeEqual(want, got) ? key : null;
}
