/**
 * What a search's two lists say about one file.
 *
 * The names above and the matches in the text below are one answer to one question, and a file
 * that matched both ways used to appear twice — once as a row, once as a block. It is one file, so
 * it is one row: **the name is its best match**, and the row says that the words are in its text as
 * well. Its block matches go with the row; the words are where opening it takes you rather than a
 * second entry.
 *
 * Pure, so `test/search-results.test.ts` holds the rule rather than a browser.
 */
import { keyOf } from "../ui/tree";
import type { Found } from "./wire";

/** A document as both lists name it: the key the tree gives its row, rather than a second spelling. */
export const docKey = (doc: Pick<Found, "kind" | "name">): string => keyOf(doc);

export interface Split {
  /** The hits to draw under "In the text": every file without a row of its own. */
  hits: Found[];
  /** The keys of the files drawn by name that also matched in their text. */
  inText: Set<string>;
}

export function byDocument(hits: readonly Found[], named: ReadonlySet<string>): Split {
  const inText = new Set<string>();
  const rest: Found[] = [];
  for (const h of hits) {
    const key = docKey(h);
    if (named.has(key)) inText.add(key);
    else rest.push(h);
  }
  return { hits: rest, inText };
}
