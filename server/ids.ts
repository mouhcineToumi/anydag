/**
 * A document's permanent id, in its frontmatter (decision 5).
 *
 * Ten characters of lower-case Crockford base32 — fifty bits, no `i`, `l`, `o` or `u`, so one read
 * aloud or copied by hand cannot be mistaken for another; the hosted app's ids, so every `dag:` link
 * already written keeps working. What the page accepts is `[0-9a-z]{10}`, and that is what is read
 * back: an `id:` in some other shape — a Zettelkasten plugin's `202301011200` — is somebody else's
 * key, and is neither adopted nor overwritten.
 */

import { createHash, randomInt } from "node:crypto";

import { withKeys } from "../src/note/task";

export const ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";
const ID = /^[0-9a-z]{10}$/;

export const validId = (value: unknown): value is string => typeof value === "string" && ID.test(value);

/** A fresh id nobody in this vault has. A collision in fifty bits is a formality, checked anyway. */
export function mint(taken: (id: string) => boolean = () => false): string {
  for (;;) {
    let out = "";
    for (let i = 0; i < 10; i++) out += ALPHABET[randomInt(32)];
    if (!taken(out)) return out;
  }
}

/**
 * The id a duplicate's loser is given, the same on every device: sha256 of the id and the loser's
 * lower-cased path onto the alphabet, hashed again with a counter while it is taken. Two devices
 * fixing one duplicate must write byte-identical files, or sync would trade the fix back and forth.
 */
export function derivedId(id: string, rel: string, taken: (x: string) => boolean = () => false): string {
  for (let n = 0; ; n++) {
    const digest = createHash("sha256")
      .update(`${id}\0${rel.toLowerCase()}${n ? `\0${n}` : ""}`)
      .digest();
    let out = "";
    for (let i = 0; i < 10; i++) out += ALPHABET[digest[i]! & 31];
    if (!taken(out)) return out;
  }
}

const FRONT = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;
const ID_LINE = /^id[ \t]*:[ \t]*(["']?)([^\r\n"']*)\1[ \t]*$/m;

/**
 * The frontmatter's `id:`, when it is one of ours; `null` when there is none, and `false` when the
 * key is there and holds something else — a key this app must not write over.
 */
export function frontId(text: string): string | null | false {
  const m = FRONT.exec(text);
  if (!m) return null;
  const line = ID_LINE.exec(m[1]!);
  if (!line) return null;
  const value = line[2]!.trim();
  return validId(value) ? value : false;
}

/** `text` with `id:` set — one line of the frontmatter, every other byte kept (`withKeys`' rule). */
export const withId = (text: string, id: string | null): string => withKeys(text, { id }, ["id"]);

/** An instant as a `created` is kept: UTC, to the second. */
export function instant(at: Date | number = new Date()): string {
  return new Date(at).toISOString().replace(/\.\d{3}Z$/, "Z");
}

const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
export const validInstant = (value: unknown): value is string => typeof value === "string" && INSTANT.test(value);
