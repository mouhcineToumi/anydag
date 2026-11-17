import { lcs } from "../note/lcs";
import { locateItems } from "./locate";
import type { PatchOp } from "./patch";
import { isItemType } from "./types";

/**
 * Carrying a patch across a 409: the ops were written against one text, and the server holds
 * another.
 *
 * Most ops survive being sent again unchanged. An `attrs` op names the keys it sets, so the other
 * writer's keys stay; a remove, an insert and a move say what they do, not what the result is. A
 * **body** is different: it is the whole span between the fences, rendered from the text the edit
 * started from. Re-sent as it is, it overwrites everything the other writer did inside that item —
 * an agent's new `queue jobs` line in the fence a person was retitling a card in, gone without a
 * word (#393). So each body is merged three ways — the item's body in the text the edit started
 * from, the body the edit wrote, the item's body in the text the 409 returned — and the merge is
 * what is sent. A body nobody else touched merges to the edit's own; one only the other writer
 * touched merges to theirs.
 *
 * When the two changed the same lines differently there is no merge, and the answer is the ids
 * that would not merge. The caller sends nothing then and says so: the other writer's text is
 * already the file, and overwriting it is the one thing this exists to stop.
 *
 * No browser, no React, no `@/` aliases: the server bundles `src/board/`.
 */

export type Rebased = { ok: true; ops: PatchOp[] } | { ok: false; ids: string[] };

/** Past this the quadratic LCS is not worth running, and the edit is refused rather than merged. */
const MAX_LINES = 3000;

/** The ops that carry a body: every `SetOp` with one, a type change included. */
const bodyOf = (op: PatchOp): { id: string; body: string } | null =>
  "body" in op && typeof op.body === "string" ? { id: op.id, body: op.body } : null;

/** `ops`, written against `from`, made into what to send against `onto`. */
export function rebaseOps(ops: PatchOp[], from: string, onto: string): Rebased {
  if (from === onto || !ops.some(bodyOf)) return { ok: true, ops };
  const bodies = (text: string) => new Map(locateItems(text, isItemType).items.map((it) => [it.id, it.body]));
  const was = bodies(from);
  const now = bodies(onto);
  const refused: string[] = [];
  const out = ops.map((op): PatchOp => {
    const set = bodyOf(op);
    if (!set) return op;
    const base = was.get(set.id);
    /* An item the edit's own text did not have is one this patch made, or one it never looked at:
       there is nothing to merge against. An item the other writer removed is a change to the same
       place too — writing it back would bring back what they deleted. */
    if (base === undefined) return op;
    const theirs = now.get(set.id);
    const merged = theirs === undefined ? null : mergeBody(base, set.body, theirs);
    if (merged === null) {
      refused.push(set.id);
      return op;
    }
    return merged === set.body ? op : { ...op, body: merged };
  });
  return refused.length ? { ok: false, ids: refused } : { ok: true, ops: out };
}

/** One side's change to the base: base lines `[start, end)` replaced by `lines`. */
interface Edit {
  start: number;
  end: number;
  lines: string[];
}

/**
 * A deletion is a deletion of each line, one edit a line: removing a card takes its blank line and its
 * edges with it, and a line the other writer put between two of those is not in the way of any of
 * them. A replaced range stays whole — an insertion inside one has no place to go.
 */
function editsOf(base: string[], side: string[]): Edit[] {
  const out: Edit[] = [];
  let i = 0;
  let j = 0;
  for (const [b, s] of [...lcs(base, side), [base.length, side.length] as const]) {
    if (s > j) out.push({ start: i, end: b, lines: side.slice(j, s) });
    else for (let k = i; k < b; k++) out.push({ start: k, end: k + 1, lines: [] });
    i = b + 1;
    j = s + 1;
  }
  return out;
}

const same = (x: Edit, y: Edit): boolean =>
  x.start === y.start && x.end === y.end && x.lines.length === y.lines.length && x.lines.every((l, i) => l === y.lines[i]);

/**
 * Three-way merge of a fence body, by line, at the grain of the edits themselves.
 *
 * `merge3` (`src/note/merge.ts`) is a note's merge, and it asks when two changes merely *touch*:
 * a line retyped next to a line inserted is one stretch both sides changed. A diagram's body is a
 * list of statements, and the race this exists for is exactly that shape — a card retitled or
 * deleted while an agent appends the next card under it. So each side is reduced to the edits it
 * made to the base, and the two lists merge unless an edit of one side overlaps an edit of the
 * other: two replaced ranges that share a line, an insertion strictly inside the other's replaced
 * range, or two different insertions at the same place. Two sides making the same edit is one edit,
 * so a line both deleted is deleted once.
 *
 * `null` is a real conflict.
 */
export function mergeBody(base: string, ours: string, theirs: string): string | null {
  if (ours === theirs || theirs === base) return ours;
  if (ours === base) return theirs;
  const a = base.split("\n");
  const o = ours.split("\n");
  const t = theirs.split("\n");
  if (Math.max(a.length, o.length, t.length) > MAX_LINES) return null;

  const mine = editsOf(a, o);
  const other = editsOf(a, t).filter((e) => !mine.some((m) => same(m, e)));
  for (const m of mine)
    for (const e of other) {
      const inserts = m.start === m.end && e.start === e.end;
      if (inserts ? m.start === e.start : m.start < e.end && e.start < m.end) return null;
    }

  /* By where they start; at one place, an insertion before the range that starts there. */
  const all = [...mine, ...other].sort((x, y) => x.start - y.start || x.end - x.start - (y.end - y.start));
  const out: string[] = [];
  let at = 0;
  for (const e of all) {
    out.push(...a.slice(at, e.start), ...e.lines);
    at = e.end;
  }
  out.push(...a.slice(at));
  return out.join("\n");
}
