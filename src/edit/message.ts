import { fragId, msgId, parseSequence, seqIdOf, seqIdOn, seqParts, type FragmentKind } from "@/dsl/sequence";
import { canWrap, insertStatement, messageStatement, wrapIn, type Slot } from "@/dsl/sequence-write";

import type { LaidBox, LaidOut } from "./build";
import type { PickedEdge } from "./pick";

/**
 * What the pointer means in a sequence diagram, with no pointer in it: which lifeline a drag ended
 * on, which statement a drop height goes after, and which messages a shift-click picked.
 *
 * The gesture that draws a message lives in `useEditor` like every other one; this is the part a
 * test can hand a layout and a height, for the reason `drag.ts` gives. The statements themselves
 * are spelled in `src/dsl/sequence-write.ts` — this file decides *where*, never *what*.
 */

/** One row of the drawing, as the layout published it: a line of the body, and its height. */
type Row = NonNullable<LaidOut["rows"]>[number];

/**
 * The participant whose lifeline is nearest a point across the diagram — every column is a target,
 * because a lifeline is a hairline and "the one I let go nearest" is the only reading of a drop
 * between two of them that a person would make.
 */
export function columnAt(nodes: Record<string, LaidBox>, x: number): string | null {
  let best: string | null = null;
  let far = Infinity;
  for (const [id, b] of Object.entries(nodes)) {
    const d = Math.abs(b.x + b.w / 2 - x);
    if (d < far) {
      far = d;
      best = id;
    }
  }
  return best;
}

/**
 * Which statement a drop height goes after: the last row drawn above it, or `null` for above all of
 * them. The drawing order *is* the file's order in this dialect — the layout walks the events once,
 * top to bottom — so the row the pointer let go under is the line to write after.
 */
export function slotAt(rows: readonly Row[], y: number): Slot {
  let at: Slot = null;
  for (const r of rows) if (r.y < y) at = { line: r.line, inside: r.inside };
  return at;
}

/**
 * A message from one participant to another, written into the slot the drop height chose, with the
 * pick id it will be drawn under — so the gesture can pick it and open its label for typing, as the
 * `+` does for a card.
 */
export function drawMessage(
  body: string,
  from: string,
  to: string,
  slot: Slot,
): { body: string; id: string; line: number } | null {
  const out = insertStatement(body, slot, messageStatement(from, to, "message"));
  const at = seqIdOn(out.body, out.line);
  return at && at.what === "edge" ? { body: out.body, id: at.id, line: out.line } : null;
}

/** The ids of every message a pick holds — one, or the run from it to where shift was clicked. */
export function runOf(pick: Pick<PickedEdge, "id" | "to">): string[] {
  const a = seqIdOf(pick.id);
  const b = pick.to ? seqIdOf(pick.to) : a;
  if (!a || a.what !== "msg" || !b || b.what !== "msg") return [pick.id];
  const lo = Math.min(a.n, b.n);
  const hi = Math.max(a.n, b.n);
  return Array.from({ length: hi - lo + 1 }, (_, i) => msgId(lo + i));
}

/** The first and last line of a picked run of messages, or `null` when the pick is not messages. */
function runLines(body: string, pick: Pick<PickedEdge, "id" | "to">): { first: number; last: number } | null {
  const ids = runOf(pick);
  const { messages } = seqParts(parseSequence(body).events);
  const lines = ids.map((id) => {
    const at = seqIdOf(id);
    return at?.what === "msg" ? messages[at.n]?.line : undefined;
  });
  if (lines.some((l) => l === undefined)) return null;
  const ns = lines as number[];
  return { first: Math.min(...ns), last: Math.max(...ns) };
}

/** Whether Wrap in can be offered for this pick: messages, all in one list. */
export function wrappable(body: string, pick: Pick<PickedEdge, "id" | "to">): boolean {
  const run = runLines(body, pick);
  return run !== null && canWrap(body, run.first, run.last);
}

/** The picked run wrapped in a fragment, and the new fragment's pick id. */
export function wrapRun(
  body: string,
  pick: Pick<PickedEdge, "id" | "to">,
  kind: FragmentKind,
): { body: string; id: string } | null {
  const run = runLines(body, pick);
  const out = run && wrapIn(body, run.first, run.last, kind);
  if (!out) return null;
  const n = seqParts(parseSequence(out.body).events).fragments.findIndex((f) => f.line === out.line);
  return n === -1 ? null : { body: out.body, id: fragId(n) };
}
