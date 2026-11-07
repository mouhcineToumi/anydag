/**
 * Two writers on one note: a three-way merge by line.
 *
 * A note is saved with the sha1 of the text it was edited from, and a save against a text that has
 * moved is refused with the text that replaced it — the board's contract, unchanged. What a board
 * does next (take the server's text, re-apply one op) has no counterpart for prose, so this is what
 * a note does: merge its own change and the other writer's against the text both started from.
 * Because a note is saved through the span map, *ours* differs from the base only in the blocks the
 * person touched, and a line merge is then exactly as fine-grained as the edits were. Claude
 * rewriting one paragraph while a person types in another is the ordinary case, and it merges.
 *
 * `null` means both changed the same lines differently. The note keeps the person's text and asks.
 *
 * No browser, no React, no `@/` aliases.
 */
import { lcs } from "./markdown";

/** Past this, the quadratic LCS is not worth running; the note asks instead of merging. */
const MAX_LINES = 3000;

export function merge3(base: string, ours: string, theirs: string): string | null {
  if (ours === theirs) return ours;
  if (ours === base) return theirs;
  if (theirs === base) return ours;
  const a = base.split("\n");
  const o = ours.split("\n");
  const t = theirs.split("\n");
  if (Math.max(a.length, o.length, t.length) > MAX_LINES) return null;

  const mo = new Map(lcs(a, o));
  const mt = new Map(lcs(a, t));
  const out: string[] = [];

  /** One stretch where at least one side moved away from the base. */
  const chunk = (b: string[], x: string[], y: string[]): boolean => {
    const same = (p: string[], q: string[]) => p.length === q.length && p.every((l, i) => l === q[i]);
    if (same(x, b)) out.push(...y);
    else if (same(y, b)) out.push(...x);
    else if (same(x, y)) out.push(...x);
    else return false;
    return true;
  };

  let i = 0;
  let j = 0;
  let k = 0;
  for (;;) {
    /* The next base line both sides kept, which is where the two histories agree again. */
    let b = i;
    while (b < a.length && !(mo.has(b) && mt.has(b))) b++;
    if (b === a.length) {
      if (!chunk(a.slice(i), o.slice(j), t.slice(k))) return null;
      break;
    }
    const jb = mo.get(b) as number;
    const kb = mt.get(b) as number;
    if (!chunk(a.slice(i, b), o.slice(j, jb), t.slice(k, kb))) return null;
    out.push(a[b]);
    i = b + 1;
    j = jb + 1;
    k = kb + 1;
  }
  return out.join("\n");
}
