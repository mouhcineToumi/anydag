import nodeCrypto from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  blobId,
  deriveKek,
  fromRecoveryCode,
  keyOf,
  keysOf,
  newParams,
  openBlob,
  randomKey,
  recoveryCode,
  sealBlob,
  unwrapKey,
  wrapKey,
} from "../protocol/crypto";
import { openMeta, sealMeta } from "../protocol/meta";
import type { KdfParams } from "../protocol/wire";

/** Node has Argon2 from 24.7; `newParams` falls back to scrypt where it does not. */
const ARGON2 = typeof (nodeCrypto as unknown as { argon2Sync?: unknown }).argon2Sync === "function";

describe("the protocol's crypto, end to end", () => {
  it("wraps, derives, seals and opens", () => {
    const vk = randomKey();
    const params = newParams();
    expect(params.kdf).toBe(ARGON2 ? "argon2id" : "scrypt");
    const kek = deriveKek("correct horse", params);
    expect(unwrapKey(kek, wrapKey(kek, vk))).toEqual(vk);
    expect(() => unwrapKey(deriveKek("wrong", params), wrapKey(kek, vk))).toThrow();
    const k = keysOf(vk);
    expect(keyOf(k.path, "Notes/Plan.md")).toBe(keyOf(k.path, "notes/plan.md"));
    const bytes = new TextEncoder().encode("hello");
    const id = blobId(k.blob, bytes);
    expect(openBlob(k.enc, id, sealBlob(k.enc, id, bytes))).toEqual(bytes);
    const key = keyOf(k.path, "a.md");
    expect(
      openMeta(k.enc, key, sealMeta(k.enc, key, { path: "a.md", kind: "file", created: null, mtime: 1, size: 5 })).path,
    ).toBe("a.md");
    const code = recoveryCode(vk);
    expect(fromRecoveryCode(code.toLowerCase())).toEqual(vk);
    expect(fromRecoveryCode(code.replace(/^./, (c) => (c === "0" ? "1" : "0")))).toBeNull();
  });

  it("stretches a passphrase with scrypt, the fallback, on any Node", () => {
    const params: KdfParams = { kdf: "scrypt", N: 1 << 14, r: 8, p: 1, salt: "c2FsdHNhbHRzYWx0c2FsdA" };
    const vk = randomKey();
    const kek = deriveKek("correct horse", params);
    expect(deriveKek("correct horse", params)).toEqual(kek);
    expect(unwrapKey(kek, wrapKey(kek, vk))).toEqual(vk);
    expect(() => unwrapKey(deriveKek("wrong", params), wrapKey(kek, vk))).toThrow();
  });
});
