/**
 * The disk store of sealed bytes (`sync/server/blobs/disk.ts`, the `Blobs` port's one adapter): a
 * put is whole-or-not-at-all and idempotent; nothing a bad id names is written, so a path segment
 * never escapes the root; a write in flight lives in `.tmp` beside its blob and never in a
 * listing; and two uploads of one id racing each other still leave one complete blob.
 */
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { blobId } from "../protocol/crypto";
import { DiskBlobs } from "../server/blobs/disk";

const utf8 = (text: string): Uint8Array => new Uint8Array(Buffer.from(text, "utf8"));

/** A well-shaped id (`BLOB_ID`, 43 base64url characters), as the routes hand one over; `n` makes the suite's ids distinct. */
const id = (n: number): string => blobId(new Uint8Array(32).fill(n), utf8(`blob ${n}`));

const collect = async (listing: AsyncIterable<string>): Promise<string[]> => {
  const held: string[] = [];
  for await (const each of listing) held.push(each);
  return held;
};

const isOneOf = (held: Uint8Array, first: Uint8Array, second: Uint8Array): boolean =>
  Buffer.from(held).equals(Buffer.from(first)) || Buffer.from(held).equals(Buffer.from(second));

let root: string;
let blobs: DiskBlobs;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "anydag-blobs-"));
  blobs = new DiskBlobs(root);
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("blobs on disk", () => {
  const vault = "vaulta1234"; // ten lowercase characters, as a vault id is

  it("put, get, size, list, delete", async () => {
    const one = id(1);
    const bytes = utf8("sealed once, settled everywhere");
    await blobs.put(vault, one, bytes);
    expect(await blobs.get(vault, one)).toEqual(bytes);
    expect(await blobs.size(vault, one)).toBe(bytes.byteLength);
    expect(await collect(blobs.list(vault))).toEqual([one]);

    expect(await blobs.get(vault, id(2))).toBeNull();
    expect(await blobs.size(vault, id(2))).toBeNull();

    await blobs.delete(vault, [one, id(2)]); // an absent one is nothing
    expect(await blobs.get(vault, one)).toBeNull();
    expect(await collect(blobs.list(vault))).toEqual([]);
    expect(await collect(blobs.list("vaultz9999"))).toEqual([]); // a vault never written
    await blobs.delete(vault, [one]); // still nothing
  });

  it("a blob held is kept as it is", async () => {
    const one = id(1);
    const first = utf8("first");
    const second = utf8("second");
    await blobs.put(vault, one, first);
    await blobs.put(vault, one, second);
    expect(await blobs.get(vault, one)).toEqual(first);
  });

  it("two puts of one id racing still leave one complete blob and no temp", async () => {
    for (const round of [0, 1, 2]) {
      const one = id(11 + round);
      const big = round === 1; // one pair writes more than one chunk's worth, to vary the interleaving
      const first = utf8("1".repeat(big ? 200_000 : 3_000));
      const second = utf8("2".repeat(big ? 200_000 : 3_000));
      await Promise.all([blobs.put(vault, one, first), blobs.put(vault, one, second)]);
      const held = await blobs.get(vault, one);
      expect(held).not.toBeNull();
      if (!held) throw new Error("the blob did not land");
      expect(isOneOf(held, first, second)).toBe(true);
      /* Neither put's temp survived whichever rename won. */
      expect(readdirSync(path.join(root, vault, one.slice(0, 2)))).toEqual([one]);
      await blobs.delete(vault, [one]); // so the next round starts clean
    }
  });

  it("list yields ids, never a temp of a write in flight", async () => {
    const one = id(1);
    await blobs.put(vault, one, utf8("held"));
    const leaf = path.join(root, vault, one.slice(0, 2));
    writeFileSync(path.join(leaf, `${one}.4242.deadbeef.tmp`), utf8("a put in flight"));
    mkdirSync(path.join(root, vault, "zz"), { recursive: true });
    writeFileSync(path.join(root, vault, "zz", "zz-tmp-only.tmp"), utf8("a leaf never earned"));
    expect(await collect(blobs.list(vault))).toEqual([one]);
  });

  it("a bad vault or a bad id throws, and writes nothing", async () => {
    const one = id(1);
    for (const badVault of ["a/b", "../x", "VAULTA1234", "", "a".repeat(11)]) {
      await expect(blobs.put(badVault, one, utf8("payload"))).rejects.toThrow();
    }
    for (const badId of ["../x", "a/b", "short", "", `${"a".repeat(42)}?`]) {
      await expect(blobs.put(vault, badId, utf8("payload"))).rejects.toThrow();
    }
    /* Reads are guarded by the same hand. */
    await expect(collect(blobs.list("../x"))).rejects.toThrow();
    await expect(blobs.get(vault, "../x")).rejects.toThrow();
    await expect(blobs.size("a/b", one)).rejects.toThrow();
    await expect(blobs.delete(vault, ["../x"])).rejects.toThrow();
    /* Nothing was written anywhere: not in the root, and not outside it. */
    expect(readdirSync(root)).toEqual([]);
  });
});
