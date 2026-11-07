import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

import { removeRefs } from "../dsl/restate";
import { serializeAttrs, str, type Attrs, type AttrValue } from "./attrs";
import { rewriteFenceAttrs } from "./fences";
import { locateItems, renderFence, type Located } from "./locate";
import { isItemType, isLinkType } from "./types";

/**
 * Changing a board file on someone's behalf, without touching anything they did not mean to change.
 *
 * **Browser-free**: the Vite plugin imports this, so the server rewrites exactly the bytes the
 * client is showing. Same reason `fences.ts` and `locate.ts` are shared.
 *
 * A board file is the durable document — a person opens it, Claude writes it, git tracks it. So an
 * edit made on the canvas has to come back as the smallest possible change to that document: one
 * fence line for a move, one body for a retype, one block gone for a delete, one block appended for
 * a paste. Anything larger and a drag would show up in a diff as a rewrite of the whole board.
 *
 * Four kinds of op, all addressed by the id `parseBoard` shows — which for an anonymous item is the
 * auto id, and `locateItems` is what makes those two agree.
 */

/** Set attributes on an item's fence line (`null` removes one), replace its body, or both. */
export interface SetOp {
  id: string;
  /**
   * Change what kind of item this is — the fence's info word.
   *
   * Only one thing needs it, and it could not be done any other way: converting a Mermaid paste
   * moves the content into the dialect it was written for, and a `graph LR` pasted into an `arch`
   * fence is a `flow`. Remove-and-insert would do it at the cost of a new id, which loses the
   * selection, every link that named it, and the item's place in the file.
   */
  type?: string;
  /**
   * Unpinning is a real operation, not a curiosity: an item with no `x`/`y` is one the auto-flow
   * owns, and going back to that is how you undo a drag.
   */
  attrs?: Record<string, AttrValue | null>;
  /** The DSL, markdown or caption between the fences. */
  body?: string;
}

/**
 * Delete an item: its fence lines, its body, and the blank line that separated it — and every link
 * that named it, or a card inside it, out of every `edges` fence (see `dropLinks`).
 */
interface RemoveOp {
  id: string;
  remove: true;
}

/** A new item. Its id is the client's to choose, because the client holds the selection. */
export interface NewItem {
  type: string;
  attrs: Record<string, AttrValue>;
  body: string;
}

/** Append an item at the end of the file, or directly after another item. */
export interface InsertOp {
  insert: NewItem;
  after?: string;
}

/**
 * Set keys in the document's frontmatter; `null` removes one.
 *
 * The pages a board has are declared there and nowhere else, so adding, renaming or removing one
 * could not be expressed as an op at all — a page was something only a text editor could make. It
 * rides here rather than in a route of its own so that it goes through the same `base` check, the
 * same history entry and the same undo as every other edit; a page added and a card moved onto it
 * are one action, and one ctrl+Z should take back both.
 *
 * Keys the board does not know are preserved: this merges into what is there rather than replacing
 * it, and the YAML is written back whole.
 */
export interface MetaOp {
  meta: Record<string, unknown>;
}

/**
 * Where a move sends an item: to the front or back of its page's stacking order, or beside a
 * named item.
 *
 * Stacking *is* fence order — the item written last in the file draws last, and so on top. "Front"
 * and "back" only make sense among items sharing a page, because nothing on a different page is
 * ever drawn in the same stack; `before`/`after` name an item directly and carry no such
 * restriction, the same way `InsertOp.after` does not.
 */
type MoveTarget = "front" | "back" | { before: string } | { after: string };

/** Cut an item's whole block out and paste it back in, front, back, or beside a named item. */
interface MoveOp {
  id: string;
  move: MoveTarget;
}

export type PatchOp = SetOp | RemoveOp | InsertOp | MetaOp | MoveOp;

export type PatchResult = { ok: true; text: string } | { ok: false; error: string };

const isInsert = (op: PatchOp): op is InsertOp => "insert" in op;
const isRemove = (op: PatchOp): op is RemoveOp => "remove" in op && op.remove === true;
const isMeta = (op: PatchOp): op is MetaOp => "meta" in op;
const isMove = (op: PatchOp): op is MoveOp => "move" in op;

/** Between two blocks: exactly one blank line, which is how every board here is written. */
function join(left: string, right: string): string {
  const a = left.replace(/\n+$/, "");
  const b = right.replace(/^\n+/, "");
  if (!a) return b;
  if (!b) return `${a}\n`;
  return `${a}\n\n${b}`;
}

/* Exported for `rename.ts`, which pins an id onto a fence exactly as a `SetOp` does when a drag
   pins an unnamed item — one implementation of "add or replace the id", not two. */
export function attrsOf(item: Located): Attrs {
  /* A copy, so an op that fails part-way has not mutated the located list. */
  return { map: { ...item.attrs.map }, order: [...item.attrs.order] };
}

function setAttrs(attrs: Attrs, patch: Record<string, AttrValue | null>): void {
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) {
      delete attrs.map[key];
      attrs.order = attrs.order.filter((k) => k !== key);
      continue;
    }
    if (!(key in attrs.map)) attrs.order.push(key);
    attrs.map[key] = value;
  }
}

/** The id first, as `parseAttrs` orders it when written as `#id`. */
export function withId(attrs: Record<string, AttrValue>, id: string): Attrs {
  const rest = Object.entries(attrs).filter(([k]) => k !== "id");
  return { map: Object.fromEntries([["id", id], ...rest]), order: ["id", ...rest.map(([k]) => k)] };
}

/**
 * Apply every op, or none.
 *
 * Ops are applied last-block-first. Each rewrite changes the length of the text it touches, which
 * moves every offset after it; going backwards means the offsets computed by the single
 * `locateItems` at the top stay valid for every op that has not run yet.
 */
/**
 * Merge keys into the document's frontmatter, writing the block back whole.
 *
 * `bodyStart` is the length of the block `locateItems` matched, so the slice before it is exactly
 * the frontmatter — including the one newline the regex takes after the closing `---`. A file with
 * no frontmatter grows one, separated from the body by a blank line the way every board here is
 * written.
 */
function withMeta(text: string, bodyStart: number, yaml: string | null, patch: Record<string, unknown>): string {
  let meta: Record<string, unknown> = {};
  if (yaml !== null) {
    try {
      meta = (parseYaml(yaml) as Record<string, unknown> | null) ?? {};
    } catch {
      /* Unparseable frontmatter is already an `EB_FRONTMATTER` error on the board. Replacing it
         here would throw away whatever the author was in the middle of writing. */
      return text;
    }
  }
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) delete meta[k];
    else meta[k] = v;
  }
  const body = text.slice(bodyStart);
  if (Object.keys(meta).length === 0) return yaml === null ? text : body.replace(/^\n+/, "");
  const block = `---\n${stringifyYaml(meta)}---\n`;
  return yaml === null ? `${block}\n${body}` : block + body;
}

export function applyPatch(text: string, ops: PatchOp[]): PatchResult {
  const located = locateItems(text, isItemType);
  const byId = new Map<string, Located>();
  for (const it of located.items) byId.set(it.id, it);

  /* Two inserts naming one id would both land, and the board would then number the second — an
     item the caller cannot address by the name it gave it. */
  const inserting = new Set<string>();
  for (const op of ops) {
    if (isMeta(op)) continue;
    if (isInsert(op)) {
      const id = op.insert.attrs.id;
      if (typeof id !== "string" || !id) return { ok: false, error: "an inserted item needs an id" };
      if (byId.has(id)) return { ok: false, error: `an item \`${id}\` already exists` };
      if (inserting.has(id)) return { ok: false, error: `two inserts name the id \`${id}\`` };
      inserting.add(id);
      if (!isItemType(op.insert.type)) return { ok: false, error: `unknown item type \`${op.insert.type}\`` };
      if (op.after !== undefined && !byId.has(op.after)) return { ok: false, error: `no item \`${op.after}\`` };
      continue;
    }
    if (!byId.has(op.id)) return { ok: false, error: `no item \`${op.id}\`` };
    if (isMove(op) && typeof op.move !== "string") {
      const target = "before" in op.move ? op.move.before : op.move.after;
      if (!byId.has(target)) return { ok: false, error: `no item \`${target}\`` };
    }
    if (!isRemove(op) && !isMove(op) && op.type !== undefined && !isItemType(op.type))
      return { ok: false, error: `unknown item type \`${op.type}\`` };
  }

  /*
   * An append has no offset, so it cannot join the descending sort — it has to run after it.
   *
   * Scoring one `Infinity` looked like it said the same thing, and did until two arrived together:
   * `Infinity - Infinity` is `NaN`, the comparator fell through to its tie-break, and the appends
   * ran backwards. A three-item paste landed in the file as C, B, A — invisible on the canvas,
   * because a paste writes `x`/`y` on every item, and wrong in the document, the diff, and the
   * order the auto-flow would have used.
   */
  const isAppend = (op: PatchOp): boolean => isInsert(op) && op.after === undefined;
  const at = (op: PatchOp): number => (isInsert(op) ? byId.get(op.after!)!.end : byId.get((op as SetOp).id)!.start);
  /* `MoveOp` joins neither bucket: it touches two places, not one, so it cannot carry a single
     offset into this sort the way every other op here can — see `applyMove`. It runs in its own
     pass below, after everything with a single offset and before the frontmatter. */
  const ordered = [
    ...ops
      .filter((op) => !isAppend(op) && !isMeta(op) && !isMove(op))
      .map((op, i) => ({ op, i }))
      .sort((a, b) => at(b.op) - at(a.op) || b.i - a.i)
      .map(({ op }) => op),
    ...ops.filter(isAppend),
  ];

  let out = text;
  for (const op of ordered) {
    if (isInsert(op)) {
      const { type, attrs, body } = op.insert;
      const block = renderFence(type, serializeAttrs(withId(attrs, attrs.id as string)), body);
      if (op.after === undefined) {
        out = `${join(out, block)}\n`;
      } else {
        const end = byId.get(op.after)!.end;
        out = join(join(out.slice(0, end), block), out.slice(end));
      }
      continue;
    }

    /* Never true — `ordered` excludes both by construction — but TS cannot see that through a
       plain `.filter()`, so this is what narrows `MetaOp` and `MoveOp` back out of the union for
       everything below, the same way the removed `isMeta` branch used to. */
    if (isMeta(op) || isMove(op)) continue;

    const item = byId.get(op.id)!;

    if (isRemove(op)) {
      out = join(out.slice(0, item.start), out.slice(item.end));
      continue;
    }

    const attrs = attrsOf(item);
    if (op.attrs) setAttrs(attrs, op.attrs);
    /* An item nobody named keeps the id it was parsed with, written down now: `locateItems` skips
       a written id when numbering, so the next anonymous item of the type still counts from where
       it did, and the client's selection still points at something. */
    if (op.attrs && !("id" in attrs.map)) {
      attrs.map.id = item.id;
      attrs.order.unshift("id");
    }
    const body = op.body ?? item.body;

    if (item.prose) {
      /* Loose prose has no fence line to carry an attribute, so setting one wraps it. */
      if (!op.attrs) {
        out = out.slice(0, item.start) + body.trim() + out.slice(item.end);
        continue;
      }
      out = out.slice(0, item.start) + renderFence("md", serializeAttrs(attrs), body) + out.slice(item.end);
      continue;
    }

    const fence = item.fence!;
    const attrText = serializeAttrs(attrs);

    /* A retype is a rewrite of the whole block: the info word is on the opening fence line, which
       `rewriteFenceAttrs` deliberately does not touch — it rewrites only what is inside the braces. */
    if (op.type !== undefined && op.type !== item.type) {
      out = out.slice(0, fence.openStart) + renderFence(op.type, attrText, op.body ?? item.body) + out.slice(fence.blockEnd);
      continue;
    }

    if (op.body !== undefined && op.body !== item.body) {
      /* A body that closes its own fence — a markdown item quoting a code sample — needs longer
         backticks than the fence has, and that is a rewrite of the block rather than of the body. */
      const ticks = /^[ \t]*(`+)/.exec(out.slice(fence.openStart, fence.openEnd))?.[1]?.length ?? 3;
      const needs = Math.max(3, ...[...op.body.matchAll(/^[ \t]*(`{3,})[ \t]*$/gm)].map((m) => m[1]!.length + 1));
      if (needs > ticks) {
        out = out.slice(0, fence.openStart) + renderFence(item.type, attrText, op.body) + out.slice(fence.blockEnd);
        continue;
      }
      const bodyStart = fence.openEnd + 1;
      if (!fence.closed) {
        /* An unclosed fence runs to the end of the file, so the body is everything after the open
           line — and when the open line is the last line, there is not even a newline yet. */
        out = bodyStart > out.length ? `${out}\n${op.body}` : out.slice(0, bodyStart) + op.body;
      } else {
        const closeStart = out.lastIndexOf("\n", fence.blockEnd - 1) + 1;
        /* Zero body lines and one empty body line both read back as `""`; only the offsets tell
           them apart, and the rewrite has to put back whichever shape it found. */
        const lines = closeStart > bodyStart;
        if (op.body === "") out = out.slice(0, bodyStart) + out.slice(closeStart);
        else if (lines) out = out.slice(0, bodyStart) + op.body + out.slice(closeStart - 1);
        else out = `${out.slice(0, bodyStart)}${op.body}\n${out.slice(bodyStart)}`;
      }
    }

    if (op.attrs) {
      const next = rewriteFenceAttrs(out, fence, attrText);
      if (next === null) return { ok: false, error: `item \`${op.id}\` is not on a fence line any more` };
      out = next;
    }
  }

  /* Moves, each against the board as the previous one left it — see `applyMove`. Frontmatter is
     last of all: it sits before every item, so writing it earlier would move every offset the
     moves above still had to read. */
  for (const op of ops) if (isMove(op)) out = applyMove(out, op);
  for (const op of ops) if (isMeta(op)) out = withMeta(out, located.bodyStart, located.frontmatter, op.meta);

  const gone = new Set(ops.filter(isRemove).map((op) => op.id));
  return { ok: true, text: gone.size ? dropLinks(out, gone) : out };
}

/**
 * `text` with every link naming a removed item taken out of every `edges` fence, on every page.
 *
 * **A delete takes its links with it**. A link whose end is not on the board is
 * `EB_LINK_UNKNOWN_ITEM`, an error: a card copied, linked to, then deleted left a board reporting
 * a problem about something nobody could see any more, on a fence the person never touched. So it is
 * the same promise `removeNode` makes one level down — a delete never leaves a board that does not
 * parse — kept here rather than in the page's gesture, so a delete from the CLI or over MCP keeps it
 * too. The statement goes by `removeNode`'s rules: a bus loses a source, a chain is split and never
 * collapsed into a link nobody drew.
 *
 * Only what *this* patch removed. A link that already named nothing is somebody's typing, and a write
 * that tidied it would be a change the caller did not ask for. An empty fence stays, as it does when
 * its last link is deleted by hand.
 *
 * `arch1.db` is a card inside item `arch1` unless an item is called `arch1.db` — `parseBoard`'s
 * resolver, which tries the whole string first; `renameItemId` reads a reference the same way.
 */
function dropLinks(text: string, gone: ReadonlySet<string>): string {
  const located = locateItems(text, isItemType);
  const live = new Set(located.items.map((it) => it.id));
  const named = (word: string): boolean => {
    if (gone.has(word)) return true;
    if (live.has(word)) return false;
    const dot = word.lastIndexOf(".");
    return dot > 0 && gone.has(word.slice(0, dot));
  };
  const ops: SetOp[] = [];
  for (const it of located.items) {
    if (!isLinkType(it.type)) continue;
    const body = removeRefs(it.body, named);
    if (body !== it.body) ops.push({ id: it.id, body });
  }
  if (ops.length === 0) return text;
  /* The bodies go back through the one writer that knows how a fence's body is spliced; with no
     `remove` among these ops, this does not come back here. */
  const done = applyPatch(text, ops);
  return done.ok ? done.text : text;
}

/**
 * Where a move's cut item is going: the target item, and which side of it.
 *
 * `"front"`/`"back"` resolve against `candidates` — every OTHER item already on the mover's page,
 * in file order — so the caller decides what "other items" means once and this stays pure. `null`
 * means there is nothing to reorder against: a solo item on its page, or a named target that is
 * not (any more) on the board.
 */
function moveTarget(
  move: MoveTarget,
  page: string,
  candidates: Located[],
): { item: Located; side: "before" | "after" } | null {
  if (typeof move === "string") {
    const onPage = candidates.filter((it) => (str(it.attrs, "page") ?? "page-1") === page);
    if (onPage.length === 0) return null;
    return move === "front"
      ? { item: onPage[onPage.length - 1]!, side: "after" }
      : { item: onPage[0]!, side: "before" };
  }
  if ("before" in move) {
    const item = candidates.find((it) => it.id === move.before);
    return item ? { item, side: "before" } : null;
  }
  const item = candidates.find((it) => it.id === move.after);
  return item ? { item, side: "after" } : null;
}

/**
 * Cut one item's whole block out and paste it back in — front, back, or beside a named item.
 *
 * Every other writer in this file earns its "descending offset" sort because it touches exactly one
 * place; a move touches two, on either side of each other, so no single offset can stand for it in
 * that sort without risking a still-to-run op shifting the *other* end first. Re-parsing instead:
 * one `locateItems` finds the block to cut and where it can go, a second finds the target's
 * boundary in the text the cut left behind. Ids are stable across both by construction — that is
 * the whole of what `locateItems` promises — so this is the plain answer rather than the clever
 * one, and it is cheap enough that a board file never notices.
 */
function applyMove(text: string, op: MoveOp): string {
  const before = locateItems(text, isItemType);
  const mover = before.items.find((it) => it.id === op.id);
  if (!mover) return text;

  const cut = join(text.slice(0, mover.start), text.slice(mover.end));
  const after = locateItems(cut, isItemType);
  const target = moveTarget(op.move, str(mover.attrs, "page") ?? "page-1", after.items);
  if (!target) return text;

  /* An anonymous item keeps the id it was parsed with, written down now — the same rule `SetOp`
     follows when a drag pins an unnamed item. Reordering the file changes which anonymous item is
     encountered first; without this the mover and whoever now stands where it used to could
     silently trade identities the next time the board is parsed. */
  let block = text.slice(mover.start, mover.end);
  if (mover.prose) block = renderFence("md", serializeAttrs(withId({}, mover.id)), mover.body);
  else if (!("id" in mover.attrs.map)) {
    const attrs = attrsOf(mover);
    attrs.map.id = mover.id;
    attrs.order.unshift("id");
    block = renderFence(mover.type, serializeAttrs(attrs), mover.body);
  }

  const at = target.side === "after" ? target.item.end : target.item.start;
  return join(join(cut.slice(0, at), block), cut.slice(at));
}
