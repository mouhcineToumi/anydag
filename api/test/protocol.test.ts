/**
 * The pinned tests of the frozen protocol (`api/protocol/crypto.ts`, `api/protocol/meta.ts`).
 * Neither is edited here: these exist so a refactor cannot quietly move every key on the server or
 * every seal on its way up. Refusals branch on `Unsealed` (`crypto.ts`'s own class), discarding
 * anything that skips that error; the metadata's shape errors are its plain sentences.
 *
 * Three things wear literals on purpose:
 * - The two vectors a zero vault key makes (`keyOf(…, "Notes/a.md")`, `blobId(…, utf8("hello"))`):
 *   they pin the HKDF labels and the HMAC spellings, so touching them is a *deliberate* change —
 *   recompute the vectors and rewrite this test in the same commit as the change.
 * - One fixed recovery key, chosen because all 1736 of its single-character mutants are refused.
 *   The check is 20 bits wide, so about one key in 650 has a mutant it lets through; a random key
 *   would make "assert every mutant is refused" a race instead of a statement. A refactor that
 *   moves the check's own HMAC (over `anydag-sync/recovery`) fails this test, which is the point.
 */
import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  b64,
  blobId,
  deriveKek,
  fromRecoveryCode,
  keyForm,
  keyOf,
  keysOf,
  newParams,
  normalise,
  open,
  openBlob,
  randomKey,
  recoveryCode,
  seal,
  sealBlob,
  Unsealed,
  unwrapKey,
  wrapKey,
} from "../protocol/crypto";
import { openMeta, sealMeta, type Meta } from "../protocol/meta";
import { BLOB_ID, type KdfParams } from "../protocol/wire";

// -- helpers --------------------------------------------------------------------------------------

const utf8 = (text: string): Uint8Array => new Uint8Array(Buffer.from(text, "utf8"));
/** What a recovery code may be typed with.
 * (`O`, `I`, `L` and `U` are deliberately absent — they read as digits — and the test leans on it.) */
const B32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

const salt = (): string => b64(new Uint8Array(randomBytes(16)));
const scryptParams = (): KdfParams => ({ kdf: "scrypt", N: 1 << 14, r: 8, p: 1, salt: salt() });
const resalt = (params: KdfParams): KdfParams => ({ ...params, salt: salt() });
/** A group of four characters the read-back accepts, straight from the alphabet above it. */
const GROUP = new RegExp(`^[${B32}]{4}$`);

const flip = (bytes: Uint8Array, at: number): Uint8Array => {
  const copy = new Uint8Array(bytes);
  copy[at] ^= 0xff;
  return copy;
};

/** A key drawn once and for all: all 1736 of its single-character mutants are refused (verified). */
const FIXED = new Uint8Array(Buffer.from("1194179a1da023a629ac2fb235b83bbe41c447ca4dd053d659dc5fe265e86bee", "hex"));

// -- paths ----------------------------------------------------------------------------------------

describe("normalise", () => {
  it("folds what three file systems would disagree about, and refuses what names no place", () => {
    /* NFD becomes NFC, backslashes become slashes, and slash litter goes. */
    expect(normalise("e\u0301.md")).toBe("\u00e9.md");
    expect(normalise("Notes\\Scans\\a.md")).toBe("Notes/Scans/a.md");
    expect(normalise("/a.md")).toBe("a.md");
    expect(normalise("a.md/")).toBe("a.md");
    expect(normalise("a//b.md")).toBe("a/b.md");
    expect(() => normalise("")).toThrow();
    expect(() => normalise("/")).toThrow();
    expect(() => normalise(".")).toThrow();
    expect(() => normalise("..")).toThrow();
    expect(() => normalise("./a.md")).toThrow();
    expect(() => normalise("a/../b.md")).toThrow();
  });
});

// -- keys -----------------------------------------------------------------------------------------

describe("the keys a vault key makes", () => {
  const keys = keysOf(randomKey());

  it("is 32 bytes, or nothing at all", () => {
    expect(() => keysOf(new Uint8Array(31))).toThrow();
    expect(() => keysOf(new Uint8Array(33))).toThrow();
    expect(() => keysOf(new Uint8Array(0))).toThrow();
  });

  it("makes three subkeys of its own", () => {
    const forms = [b64(keys.path), b64(keys.blob), b64(keys.enc)];
    expect(new Set(forms).size).toBe(3);
    for (const form of forms) expect(form).toHaveLength(43);
  });

  it("folds case and accents into the form a key is named by", () => {
    expect(keyForm("Notes/Plan.md")).toBe("notes/plan.md");
    expect(keyForm("e\u0301.md")).toBe("\u00e9.md");
    expect(keyOf(keys.path, "Notes/Plan.md")).toBe(keyOf(keys.path, "notes/plan.md"));
    expect(keyOf(keys.path, "\u00e9.md")).toBe(keyOf(keys.path, "e\u0301.md"));
    expect(keyOf(keys.path, "\u00c9.md")).toBe(keyOf(keys.path, "\u00e9.md"));
  });

  it("a key is 43 base64url characters, and two paths name two keys", () => {
    const key = keyOf(keys.path, "a.md");
    expect(key).toHaveLength(43);
    expect(key).toMatch(BLOB_ID);
    expect(keyOf(keys.path, "a.md")).not.toBe(keyOf(keys.path, "b.md"));
    expect(keyOf(keys.path, "a.md")).toMatch(BLOB_ID);
  });

  it("from a zero vault key, the pinned vectors", () => {
    const zero = new Uint8Array(32);
    const pinned = keysOf(zero);
    expect(keyOf(pinned.path, "Notes/a.md")).toBe("DqCemES7K6DwqXrdhDVEvb232xNzUzSXAsN7ol9gpHM");
    expect(blobId(pinned.blob, utf8("hello"))).toBe("9YWaF9Xm5YRnh1G0B3zqHFhriogd6EEWDYI3bEhyGxM");
  });
});

// -- seals ----------------------------------------------------------------------------------------

describe("seal and open", () => {
  const keys = keysOf(randomKey());
  const kEnc = keys.enc;
  const plain = utf8("regions still settle at 14:00; the spike is not the story");
  const aim = "test:a";

  it("round trips", () => {
    expect(open(kEnc, seal(kEnc, plain, aim), aim)).toEqual(plain);
  });

  it("two seals of one plaintext differ, both open", () => {
    const first = seal(kEnc, plain, aim);
    const second = seal(kEnc, plain, aim);
    expect(Buffer.compare(Buffer.from(first), Buffer.from(second))).not.toBe(0);
    expect(open(kEnc, second, aim)).toEqual(plain);
  });

  it("throws Unsealed, and nothing else, wherever a seal is not true", () => {
    const sealed = seal(kEnc, plain, aim);
    const other = keysOf(randomKey()).enc;
    expect(() => open(kEnc, flip(sealed, 1 + 12), aim)).toThrow(Unsealed); // the first ciphertext byte
    expect(() => open(kEnc, flip(sealed, sealed.byteLength - 1), aim)).toThrow(Unsealed); // a tag byte
    expect(() => open(other, sealed, aim)).toThrow(Unsealed); // another key, the same aim
    expect(() => open(kEnc, sealed, "test:b")).toThrow(Unsealed); // the right key, another aim
    expect(() => open(kEnc, sealed.subarray(0, 12), aim)).toThrow(Unsealed); // shorter than a seal can stand
    expect(() => open(kEnc, sealed.subarray(0, sealed.byteLength - 4), aim)).toThrow(Unsealed); // the tag misplaced
    expect(() => open(kEnc, new Uint8Array(0), aim)).toThrow(Unsealed); // not there at all
    const versioned = new Uint8Array(sealed); // a version this code does not read
    versioned[0] = 0x02;
    expect(() => open(kEnc, versioned, aim)).toThrow(Unsealed);
  });
});

describe("a blob is bound to its id", () => {
  it("opens under its own id and under no other", () => {
    const keys = keysOf(randomKey());
    const bytes = utf8("a settled statement, value 1200");
    const id = blobId(keys.blob, bytes);
    const other = blobId(keys.blob, utf8("another settled statement"));
    expect(openBlob(keys.enc, id, sealBlob(keys.enc, id, bytes))).toEqual(bytes);
    /* The id is associated data: the server cannot serve one id's bytes under another. */
    expect(() => openBlob(keys.enc, other, sealBlob(keys.enc, id, bytes))).toThrow(Unsealed);
  });
});

describe("the metadata beside a key", () => {
  const keys = keysOf(randomKey());
  const key = keyOf(keys.path, "Notes/érrands.md");
  const meta: Meta = {
    path: "Notes/érrands.md",
    kind: "file",
    created: "2026-11-06T09:00:00.000Z",
    mtime: 1762419600000,
    size: 408,
  };
  /* Sealed the way a bad writer would, honestly, and with the wrong-key refusals out of the way: */
  const hand = (what: unknown): string => b64(seal(keys.enc, utf8(JSON.stringify(what)), `meta:${key}`));

  it("round trips", () => {
    expect(openMeta(keys.enc, key, sealMeta(keys.enc, key, meta))).toEqual(meta);
  });

  it("refuses a seal opened under another key of the same vault", () => {
    const sealed = sealMeta(keys.enc, key, meta);
    expect(() => openMeta(keys.enc, keyOf(keys.path, "Announcements.md"), sealed)).toThrow(Unsealed);
  });

  it("refuses what is not a Meta in JSON", () => {
    expect(() => openMeta(keys.enc, key, hand({ nope: 1 }))).toThrow();
    expect(() => openMeta(keys.enc, key, hand({ path: "a.md" }))).toThrow();
    expect(() => openMeta(keys.enc, key, hand({ path: "a.md", kind: "salad" }))).toThrow();
    expect(() => openMeta(keys.enc, key, b64(seal(keys.enc, utf8("not json"), `meta:${key}`)))).toThrow();
  });

  it("reads a spare seal with the shape's defaults", () => {
    expect(openMeta(keys.enc, key, hand({ path: "a.md", kind: "file" }))).toEqual({
      path: "a.md",
      kind: "file",
      created: null,
      mtime: 0,
      size: 0,
    });
  });
});

// -- the passphrase's key -------------------------------------------------------------------------

describe("the passphrase's key", () => {
  it("is deterministic for its parameters, and bound to the salt", () => {
    const params: KdfParams = newParams();
    expect(deriveKek("correct horse", params)).toEqual(deriveKek("correct horse", params));
    expect(deriveKek("correct horse", params)).not.toEqual(deriveKek("correct horse", resalt(params)));
  });

  it("wraps the vault key, and refuses another passphrase", () => {
    const params: KdfParams = newParams();
    const kek = deriveKek("correct horse", params);
    const vk = randomKey();
    expect(unwrapKey(kek, wrapKey(kek, vk))).toEqual(vk);
    expect(() => unwrapKey(deriveKek("wrong house", params), wrapKey(kek, vk))).toThrow(Unsealed);
  });

  it("works over scrypt, built by hand with a small N for speed", () => {
    const params: KdfParams = scryptParams();
    const kek = deriveKek("correct horse", params);
    const vk = randomKey();
    expect(deriveKek("correct horse", params)).toEqual(kek);
    expect(unwrapKey(kek, wrapKey(kek, vk))).toEqual(vk);
    expect(() => unwrapKey(deriveKek("wrong horse", params), wrapKey(kek, vk))).toThrow(Unsealed);
  });
});

// -- the recovery code ----------------------------------------------------------------------------

describe("the recovery code", () => {
  it("is 14 groups of 4, and round trips", () => {
    const key = randomKey();
    const code = recoveryCode(key);
    expect(recoveryCode(key)).toBe(code); // deterministic, so a drawn key is drawn the same twice
    const groups = code.split("-");
    expect(groups).toHaveLength(14);
    expect(code).toHaveLength(69);
    for (const group of groups) {
      expect(group).toHaveLength(4);
      expect(group).toMatch(GROUP);
    }
    expect(fromRecoveryCode(code)).toEqual(key);
  });

  it("a short or a younger code reads as null", () => {
    const code = recoveryCode(randomKey());
    /* The 52 key characters with the check taken off decode cleanly and then fail the check. */
    expect(fromRecoveryCode(code.replace(/-/g, "").slice(0, 52))).toBeNull();
    expect(fromRecoveryCode(code.replace(/-/g, "").slice(0, 55))).toBeNull(); // never a full code
  });

  it("reads a person's alphabet: lowercase, spaces, O for 0, I and L for 1", () => {
    const code = recoveryCode(FIXED);
    /* The fixed key's code holds both digits, so neither reading below is a no-op. */
    expect(code.includes("0")).toBe(true);
    expect(code.includes("1")).toBe(true);
    expect(fromRecoveryCode(code.toLowerCase())).toEqual(FIXED);
    expect(fromRecoveryCode(code.replace(/-/g, " "))).toEqual(FIXED);
    expect(fromRecoveryCode(code.replace(/0/g, "O"))).toEqual(FIXED);
    expect(fromRecoveryCode(code.replace(/1/g, "L"))).toEqual(FIXED);
    expect(fromRecoveryCode(code.replace(/1/g, "I"))).toEqual(FIXED);
    expect(fromRecoveryCode(code.toLowerCase().replace(/-/g, " ").replace(/0/g, "O").replace(/1/g, "l"))).toEqual(FIXED);
  });

  it("a single mistyped character is refused — every one, on a key drawn once", () => {
    const chars = recoveryCode(FIXED).replace(/-/g, "").split("");
    let tried = 0;
    for (let at = 0; at < chars.length; at++) {
      for (const letter of B32) {
        if (letter === chars[at]) continue;
        const variant = [...chars];
        variant[at] = letter;
        expect(fromRecoveryCode(variant.join(""))).toBeNull();
        tried++;
      }
    }
    expect(tried).toBe(56 * (B32.length - 1));
  });
});
