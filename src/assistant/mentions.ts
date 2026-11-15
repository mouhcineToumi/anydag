/**
 * The Assistant's `@` list (#324): which document the caret is asking about, and which documents
 * answer. The ranking is `rank` from `src/refs/rank.ts` — the same one the note editor's reference
 * picker uses — so a query finds a document the same way in both places.
 */
import { collation } from "@/locale";
import { rank } from "@/refs/rank";
import { titleOf, type IndexDoc } from "@/refs/useIndex";

import type { ChipDoc } from "./DocChip";

/** A document a message mentions: the chip's drawing plus the id its `dag:` reference is made of. */
export interface MentionDoc extends ChipDoc {
  id: string;
}

/** The `@` before the caret and what has been typed since, or `null` when there is none. */
export interface ActiveMention {
  /** The index of the `@` in the message. */
  start: number;
  /** What follows the `@`, up to the caret. */
  query: string;
}

/** How many rows the list shows. A list is read, not scrolled, and the same ceiling as the picker. */
const LIMIT = 20;

/**
 * The `@` the caret sits after, when it starts a word: the beginning of the message, or after
 * whitespace or punctuation. An `@` inside a word — an email address — is not one, so typing
 * `me@example.com` does not open the list.
 */
export function mentionAt(text: string, caret: number): ActiveMention | null {
  if (caret < 0 || caret > text.length) return null;
  const before = text.slice(0, caret);
  const at = before.lastIndexOf("@");
  if (at < 0) return null;
  const previous = at > 0 ? before[at - 1]! : "";
  if (previous && /[\p{L}\p{N}_]/u.test(previous)) return null;
  const query = before.slice(at + 1);
  if (/[\r\n]/.test(query)) return null;
  return { start: at, query };
}

/**
 * The documents the list offers for `query`, best first. `taken` leaves out what the message
 * already names — one document is one chip. Ties are broken by title and then by name, so a list
 * does not rearrange itself between two queries that rank the same.
 */
export function mentionOptions(docs: readonly IndexDoc[], query: string, taken: ReadonlySet<string> = new Set()): MentionDoc[] {
  return docs
    .filter((d) => !taken.has(d.id))
    .map((d) => ({ d, r: rank(d, query) }))
    .filter((x): x is { d: IndexDoc; r: number } => x.r !== null)
    .sort((a, b) => a.r - b.r || collation().compare(titleOf(a.d), titleOf(b.d)) || collation().compare(a.d.name, b.d.name))
    .slice(0, LIMIT)
    .map(({ d }) => ({ id: d.id, kind: d.kind, name: d.name, title: titleOf(d) }));
}
