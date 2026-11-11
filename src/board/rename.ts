import { edgeSpan } from "../dsl/restate";
import type { Token } from "../dsl/tokenizer";
import { serializeAttrs } from "./attrs";
import { locateItems, renderFence } from "./locate";
import { attrsOf, withId, type PatchResult } from "./patch";
import { isItemType, isLinkType } from "./types";

/**
 * Renaming an item: its own `#id`, and every place an `edges` fence names it.
 *
 * Not `restate.ts`'s `renameId`, which renames a DSL id *inside one diagram's body* through
 * `rebind.ts` — a statement-level rename, the same family as `setTitle` or `moveStatement`. This is
 * a level up: an item id is what the *board* addresses a card by from outside the fence that
 * declares it, and `edges` is the one grammar built to reach in — `a --> b` and `a.node --> b` both
 * name items, not nodes inside a dialect's own graph. Nothing before this milestone could change an
 * item's id without hand-editing every `edges` line that mentioned it.
 *
 * **Browser-free, and no `@/` aliases** — `src/board/` is imported by the Vite plugin.
 */

/** A word token's char span. No quote adjustment: a board reference is never a string. */
const wordSpan = (t: Token): [number, number] => [t.col - 1, t.col - 1 + t.value.length];

/**
 * One line of an `edges` body with every reference to `from` renamed to `to`.
 *
 * A reference is a whole ref-list token out of `edgeSpan` — the same grammar `restate.ts` already
 * reads one edge statement with, so a `hue=teal` or a quoted label is never mistaken for one. Two
 * shapes, given the same priority `parseBoard`'s own resolver gives them: the *whole* token first —
 * `arch1.db` is item `arch1.db` if the board has one by that literal name — and only then the
 * last-dot split, `arch1` inside `arch1.db`. `ids` is every item id on the board, which is what
 * lets this line tell the two apart the way `parseLinks` alone never can.
 */
function renameRefs(line: string, from: string, to: string, ids: ReadonlySet<string>): string {
  const e = edgeSpan(line);
  if (!e) return line;

  const cuts: { at: [number, number]; text: string }[] = [];
  for (const ref of e.refs) {
    for (const t of ref.tokens) {
      if (t.value === from) {
        cuts.push({ at: wordSpan(t), text: to });
        continue;
      }
      const dot = t.value.lastIndexOf(".");
      if (dot <= 0 || dot >= t.value.length - 1) continue;
      if (ids.has(t.value)) continue; /* the whole token is somebody else's literal id */
      if (t.value.slice(0, dot) !== from) continue;
      const [start] = wordSpan(t);
      cuts.push({ at: [start, start + dot], text: to });
    }
  }
  if (cuts.length === 0) return line;

  let out = line;
  for (const c of [...cuts].sort((a, b) => b.at[0] - a.at[0])) out = out.slice(0, c.at[0]) + c.text + out.slice(c.at[1]);
  return out;
}

/** Each line's 0-based char offset within a fence's body: `\n`-joined, no trailing newline. */
function lineOffsets(body: string): number[] {
  const out: number[] = [0];
  for (const line of body.split("\n").slice(0, -1)) out.push(out[out.length - 1]! + line.length + 1);
  return out;
}

/**
 * Rename an item everywhere on the board: its own declaration, and every `edges` reference to it,
 * on every page. Refused when `to` is already somebody else's id — the two would collide the
 * moment `locateItems` ran next — or when `from` names nothing.
 *
 * One `locateItems`, one list of `{from, to, text}` spans against the text it read, applied last
 * first — the same shape `removeNode` in `restate.ts` uses for the same reason: every edit here
 * changes the length of what it touches, and going backwards keeps the rest of the list's offsets
 * valid for whichever edit has not run yet.
 */
export function renameItemId(text: string, from: string, to: string): PatchResult {
  if (from === to) return { ok: true, text };
  const located = locateItems(text, isItemType);
  const mover = located.items.find((it) => it.id === from);
  if (!mover) return { ok: false, error: `no item \`${from}\`` };
  if (located.items.some((it) => it.id === to)) return { ok: false, error: `an item \`${to}\` already exists` };

  const ids = new Set(located.items.map((it) => it.id));
  const edits: { from: number; to: number; text: string }[] = [];

  /* The mover's own declaration. Prose has no fence to carry an id, so renaming it pins one — the
     same rule `SetOp` follows in `patch.ts` when a drag pins an unnamed item. */
  if (mover.prose) {
    edits.push({ from: mover.start, to: mover.end, text: renderFence("md", serializeAttrs(withId({}, to)), mover.body) });
  } else {
    const attrs = attrsOf(mover);
    attrs.map.id = to;
    if (!("id" in mover.attrs.map)) attrs.order.unshift("id");
    const attrText = serializeAttrs(attrs);
    const fence = mover.fence!;
    const line = text.slice(fence.openStart, fence.openEnd);
    /* The same rebuild `rewriteFenceAttrs` does, inlined: that function hands back the whole file
       rewritten rather than a span, which is fine as the only edit in a patch and not composable
       with the `edges` edits below, which have to be batched against the same original offsets. */
    const head = /^[ \t]*`+/.exec(line)![0];
    edits.push({ from: fence.openStart, to: fence.openEnd, text: `${head}${fence.type}${attrText ? ` {${attrText}}` : ""}` });
  }

  /* Every `edges` fence that names it, whichever page it is on — a rename does not ask whether the
     reference still resolves, the same way `removeNode` does not ask whether a delete leaves one
     dangling; `parseBoard` reports that on its own the next time the file is read. */
  for (const fence of located.items) {
    if (!isLinkType(fence.type)) continue;
    const bodyStart = fence.fence!.openEnd + 1;
    const lines = fence.body.split("\n");
    const offsets = lineOffsets(fence.body);
    lines.forEach((line, i) => {
      const rewritten = renameRefs(line, from, to, ids);
      if (rewritten === line) return;
      const at = bodyStart + offsets[i]!;
      edits.push({ from: at, to: at + line.length, text: rewritten });
    });
  }

  let out = text;
  for (const e of edits.sort((a, b) => b.from - a.from)) out = out.slice(0, e.from) + e.text + out.slice(e.to);
  return { ok: true, text: out };
}

/**
 * One line of an `edges` body with every reference to the node `from` of item `item` renamed `to`:
 * `sales.web` becomes `sales.online`, and nothing else on the line moves.
 *
 * **Exact, whole-token only.** A reference is a ref-list token out of `edgeSpan`, as in
 * `renameRefs`, and it changes only when it reads `<item>.<from>` letter for letter. `sales`
 * alone names the item, `sales.web2` another node, `shop.web` another item's node. A token that is
 * a whole literal item id on this board (`ids`) is that item and not a node of anything, the
 * priority `resolveLinks` gives it.
 */
function renameNodeRefs(line: string, item: string, from: string, to: string, ids: ReadonlySet<string>): string {
  const e = edgeSpan(line);
  if (!e) return line;
  const want = `${item}.${from}`;
  const cuts: [number, number][] = [];
  for (const ref of e.refs) {
    for (const t of ref.tokens) {
      if (t.value !== want || ids.has(t.value)) continue;
      const [start] = wordSpan(t);
      cuts.push([start + item.length + 1, start + want.length]);
    }
  }
  let out = line;
  for (const c of cuts.sort((a, b) => b[0] - a[0])) out = out.slice(0, c[0]) + to + out.slice(c[1]);
  return out;
}

/**
 * Follow a rename of a node *inside* an item: every `edges` line that names `<item>.<from>` is
 * rewritten to `<item>.<to>`, on every page, and no other byte of the board changes.
 *
 * The other half of `renameItemId`, one level down. It does **not** touch the item's own fence —
 * how a node is renamed there is the dialect's business (`renameChartId` for a chart's series and
 * slices), and this takes the text *after* that, so a caller composes the two into one string and
 * writes it once: one version, one undo. Browser-free, no `@/` aliases.
 *
 * Refused (`ok: false`) only when `item` names nothing; a board with no link to follow comes back
 * unchanged, `ok: true`.
 */
export function renameNodeLinks(text: string, item: string, from: string, to: string): PatchResult {
  if (from === to) return { ok: true, text };
  const located = locateItems(text, isItemType);
  if (!located.items.some((it) => it.id === item)) return { ok: false, error: `no item \`${item}\`` };
  const ids = new Set(located.items.map((it) => it.id));
  const edits: { from: number; to: number; text: string }[] = [];
  for (const fence of located.items) {
    if (!isLinkType(fence.type)) continue;
    const bodyStart = fence.fence!.openEnd + 1;
    const lines = fence.body.split("\n");
    const offsets = lineOffsets(fence.body);
    lines.forEach((line, i) => {
      const rewritten = renameNodeRefs(line, item, from, to, ids);
      if (rewritten === line) return;
      const at = bodyStart + offsets[i]!;
      edits.push({ from: at, to: at + line.length, text: rewritten });
    });
  }
  let out = text;
  for (const e of edits.sort((a, b) => b.from - a.from)) out = out.slice(0, e.from) + e.text + out.slice(e.to);
  return { ok: true, text: out };
}
