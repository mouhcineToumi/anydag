import theme from "../themes/paper/theme.json";

import { isLinkType, isDiagramType, type BoardItem, type BoardLink, type BoardPage } from "../src/board/types";
import { nodeIdsOf } from "../src/board/parseBoard";
import type { InsertOp, NewItem, PatchOp } from "../src/board/patch";
import { reorderPages } from "../src/board/pages";
import { HUE_ORDER } from "../src/dsl/ir";
import { isArrow, replaceLine, setEdgeArrow, setEdgeFlag, setEdgeHue, setEdgeLabel, setLinkVia } from "../src/dsl/restate";
import { nearest, suggestHue } from "../src/dsl/suggest";
import { appendLink, removeLinkLine } from "../src/edit/connect";
import { appendEdge } from "../src/edit/build";
import { segOf } from "../src/edit/pick";

import { UsageError } from "./args";
import { freshId, idsOf, pageAttr, type Loaded } from "./board";

/**
 * The canvas's gestures as text arithmetic — each one the op list the page would commit, worked out
 * from the board the command read. No request is made in here, which is what makes every one of
 * them a unit test rather than a round trip (`test/cli-ops.test.ts`).
 *
 * Where the page has a pure helper, this calls it; where the page's logic is private to
 * `useEditor` — `insert`, the page list, `freshId` — it is restated here and says so, because that
 * hook is React and cannot be imported into a terminal.
 */

/** The theme's grid. Every theme has the same metric block, which is what makes a layout cache survive a theme switch. */
export const GRID: number = theme.metric.grid;

/* ---- items ------------------------------------------------------------------------------------ */

/**
 * New items as the page inserts them (`useEditor.insert`): an id of their own when theirs is taken,
 * the batch's groups renamed so a copy is a new group, and the page they go on.
 */
export function insertOps(l: Loaded, items: NewItem[], page: string | undefined): { ops: InsertOp[]; ids: string[] } {
  const taken = idsOf(l);
  const groups = new Map<string, string>();
  const at = pageAttr(l, page);
  const ids: string[] = [];
  const ops: InsertOp[] = items.map((it) => {
    const attrs = { ...it.attrs };
    const own = typeof attrs.id === "string" ? attrs.id : undefined;
    const id = own && !taken.has(own) ? own : freshId(it.type, taken);
    taken.add(id);
    ids.push(id);
    attrs.id = id;
    if (typeof attrs.group === "string") {
      if (!groups.has(attrs.group)) groups.set(attrs.group, freshId("group", taken));
      attrs.group = groups.get(attrs.group)!;
    }
    delete attrs.page;
    if (at) attrs.page = at;
    return { insert: { type: it.type, attrs, body: it.body } };
  });
  return { ops, ids };
}

/**
 * Move a set of items so their top-left lands at `at`, keeping the arrangement between them — the
 * page's `anchorAt`, for a stamped component and a pasted stack. Items with no position stack below
 * it, ten grid steps apart.
 */
export function anchorAt(items: NewItem[], at: { x: number; y: number }): NewItem[] {
  const placed = items.filter((it) => typeof it.attrs.x === "number" && typeof it.attrs.y === "number");
  const minX = Math.min(...placed.map((it) => it.attrs.x as number));
  const minY = Math.min(...placed.map((it) => it.attrs.y as number));
  let stack = 0;
  return items.map((it) => {
    const attrs = { ...it.attrs };
    if (typeof attrs.x === "number" && typeof attrs.y === "number") {
      attrs.x = attrs.x - minX + at.x;
      attrs.y = attrs.y - minY + at.y;
    } else {
      attrs.x = at.x;
      attrs.y = at.y + stack;
      stack += GRID * 10;
    }
    return { ...it, attrs };
  });
}

/** A hue the theme owns, or a usage error naming the nearest one — the `W_UNKNOWN_HUE` rule, said before writing. */
export function hueOf(raw: string): string {
  if ((HUE_ORDER as readonly string[]).includes(raw)) return raw;
  const close = suggestHue(raw, HUE_ORDER);
  throw new UsageError(`no hue \`${raw}\`${close ? ` — did you mean \`${close}\`?` : ""} (the ten are ${HUE_ORDER.join(", ")})`);
}

/**
 * `key=value` pairs as a `SetOp`'s attributes, the page's `setAttrs`: `null` takes one off, a hue
 * is checked, a page is named by id or name and `page-1` is written as nothing, and the id is not
 * an attribute here — `item rename` carries every reference with it.
 */
export function attrsOf(l: Loaded, pairs: Record<string, string | number | true | null>): Record<string, string | number | true | null> {
  const out: Record<string, string | number | true | null> = {};
  for (const [k, v] of Object.entries(pairs)) {
    if (k === "id") throw new UsageError("an item's id is renamed with `anydag item rename`, which carries every link to it");
    if (k === "page") {
      out.page = v === null || v === true ? null : pageAttr(l, String(v)) ?? null;
      continue;
    }
    if (k === "hue" && typeof v === "string") {
      out.hue = hueOf(v);
      continue;
    }
    out[k] = v;
  }
  return out;
}

/** An item's group widened to every member, the way a click on one member selects them all. */
export function withGroups(l: Loaded, ids: readonly string[]): string[] {
  const groups = new Set(l.board.items.filter((i) => ids.includes(i.id) && i.group).map((i) => i.group!));
  const out = new Set(ids);
  for (const it of l.board.items) if (it.group && groups.has(it.group)) out.add(it.id);
  return l.board.items.filter((i) => out.has(i.id)).map((i) => i.id);
}

/** Front and back as the page restacks them: one move per item, in file order — reversed for the back. */
export function restackOps(l: Loaded, ids: readonly string[], to: "front" | "back"): PatchOp[] {
  const ordered = l.board.items.filter((i) => ids.includes(i.id)).map((i) => i.id);
  return (to === "back" ? ordered.reverse() : ordered).map((id) => ({ id, move: to }));
}

/* ---- pages ------------------------------------------------------------------------------------ */

export function pageOf(l: Loaded, ref: string): BoardPage {
  const p = l.board.pages.find((x) => x.id === ref || x.name === ref);
  if (!p) throw new UsageError(`no page \`${ref}\` on ${l.name} — it has ${l.board.pages.map((x) => `\`${x.id}\` (${x.name})`).join(", ")}`);
  return p;
}

/** The whole list, always — the page writes it whole, because a board that declared none had them inferred. */
const pagesMeta = (pages: readonly BoardPage[]): PatchOp => ({ meta: { pages: pages.map((p) => ({ id: p.id, name: p.name })) } });

export function addPageOps(l: Loaded, name?: string): { ops: PatchOp[]; id: string } {
  const had = l.board.pages;
  const taken = new Set(had.map((p) => p.id));
  let n = had.length + 1;
  while (taken.has(`page-${n}`)) n++;
  const id = `page-${n}`;
  return { ops: [pagesMeta([...had, { id, name: name || `Page ${had.length + 1}` }])], id };
}

export function renamePageOps(l: Loaded, ref: string, name: string): PatchOp[] {
  const p = pageOf(l, ref);
  return [pagesMeta(l.board.pages.map((x) => (x.id === p.id ? { ...x, name } : x)))];
}

/** A page taken away, and what was on it moved to the first one left — the page's `pages.remove`. */
export function removePageOps(l: Loaded, ref: string): PatchOp[] {
  const p = pageOf(l, ref);
  if (l.board.pages.length < 2) throw new UsageError(`${l.name} has one page, and a board cannot have none`);
  const next = l.board.pages.filter((x) => x.id !== p.id);
  const to = next[0]!.id === "page-1" ? null : next[0]!.id;
  const moves: PatchOp[] = l.board.items.filter((it) => it.page === p.id).map((it) => ({ id: it.id, attrs: { page: to } }));
  return [pagesMeta(next), ...moves];
}

/** `before` null is the end. The same array back from `reorderPages` means nothing moved, and nothing is written. */
export function movePageOps(l: Loaded, ref: string, before: string | null): PatchOp[] {
  const p = pageOf(l, ref);
  const target = before === null ? null : pageOf(l, before).id;
  const next = reorderPages(l.board.pages, p.id, target);
  return next === l.board.pages ? [] : [pagesMeta(next)];
}

/* ---- links ------------------------------------------------------------------------------------ */

/**
 * One end of a link, checked against the board the way `resolveLinks` reads it: the whole string as
 * an item id first, then a board-level group, then `item.node` split on the last dot.
 */
function endOf(l: Loaded, raw: string): { item: string; node?: string } {
  const items = new Map(l.board.items.map((i) => [i.id, i]));
  if (items.has(raw)) return { item: raw };
  if (l.board.items.some((i) => i.group === raw)) return { item: raw };
  const dot = raw.lastIndexOf(".");
  if (dot > 0) {
    const it = items.get(raw.slice(0, dot));
    const node = raw.slice(dot + 1);
    if (it) {
      const nodes = nodeIdsOf(it);
      if (nodes && !nodes.has(node)) {
        const close = nearest(node, nodes);
        throw new UsageError(`\`${it.id}\` has no card \`${node}\`${close ? ` — did you mean \`${it.id}.${close}\`?` : ""}`);
      }
      return { item: it.id, node };
    }
  }
  const close = nearest(raw, items.keys());
  throw new UsageError(`nothing on ${l.name} is called \`${raw}\`${close ? ` — did you mean \`${close}\`?` : ""}`);
}

export interface LinkStyle {
  label?: string;
  arrow?: string;
  hue?: string;
  quiet?: boolean;
}

/** The statement a link is written as: `a --> b "label" hue=teal quiet`. */
function linkLine(from: string, to: string, s: LinkStyle): string {
  const arrow = s.arrow ?? "-->";
  if (!isArrow(arrow)) throw new UsageError(`\`${arrow}\` is not an arrow`);
  return [from, arrow, to, s.label ? JSON.stringify(s.label) : "", s.hue ? `hue=${hueOf(s.hue)}` : "", s.quiet ? "quiet" : ""]
    .filter(Boolean)
    .join(" ");
}

/**
 * A link drawn between two ends, as the page's `addLink` writes it.
 *
 * Two cards of one diagram are an edge **of that diagram**, not a link — it goes into the body where
 * every other edge of it is written, which is what the pointer does and what `CLAUDE.md` argues. A
 * link goes into the first `edges` fence on the page, or a new one when the page has none.
 */
export function addLinkOps(
  l: Loaded,
  fromRaw: string,
  toRaw: string,
  style: LinkStyle,
  page: string,
): { ops: PatchOp[]; into: "diagram" | "edges"; fence: string } {
  const from = endOf(l, fromRaw);
  const to = endOf(l, toRaw);
  if (from.item === to.item && from.node === to.node) throw new UsageError("a link joins two different things");
  if (from.item === to.item && from.node && to.node) {
    const it = l.board.items.find((i) => i.id === from.item)!;
    if (isDiagramType(it.type)) {
      return { ops: [{ id: it.id, body: appendEdge(it.body, linkLine(from.node, to.node, style)) }], into: "diagram", fence: it.id };
    }
  }
  const statement = linkLine(fromRaw, toRaw, style);
  const fence = l.board.items.find((it) => isLinkType(it.type) && it.page === page);
  if (fence) return { ops: [{ id: fence.id, body: appendLink(fence.body, statement) }], into: "edges", fence: fence.id };
  const made = insertOps(l, [{ type: "edges", attrs: {}, body: statement }], page === l.board.pages[0]?.id ? undefined : page);
  return { ops: made.ops, into: "edges", fence: made.ids[0]! };
}

const endsText = (e: BoardLink["from"]) => (e.node === undefined ? e.item : `${e.item}.${e.node}`);

/** A link by its two ends as written, or by its id — the one a board's `link ls` prints. */
export function linkOf(l: Loaded, a: string, b?: string): { link: BoardLink; fence: BoardItem; line: number; seg: number } {
  const hits = b === undefined ? l.board.links.filter((x) => x.id === a) : l.board.links.filter((x) => endsText(x.from) === a && endsText(x.to) === b);
  if (hits.length === 0) throw new UsageError(`no link ${b === undefined ? `\`${a}\`` : `${a} → ${b}`} on ${l.name} (\`anydag link ls ${l.name}\` lists them)`);
  if (hits.length > 1) throw new UsageError(`${hits.length} links run ${a} → ${b}; name one by its id followed by \`-\`: ${hits.map((h) => `\`${h.id} -\``).join(" or ")}`);
  const link = hits[0]!;
  const fence = l.board.items.find((i) => i.id === link.fence)!;
  const line = link.line - fence.line;
  const onLine = l.board.links.filter((x) => x.fence === link.fence && x.line === link.line);
  const seg = segOf(fence.body.split("\n")[line - 1] ?? "", onLine.indexOf(link));
  return { link, fence, line, seg };
}

export interface LinkChange extends LinkStyle {
  via?: { x: number; y: number } | null;
  /** `label` set to `null` takes it off. */
  clearLabel?: boolean;
  clearHue?: boolean;
}

/** The label, arrow, hue, `quiet` and bend of one link, each on the segment of the line it is. */
export function setLinkOps(found: ReturnType<typeof linkOf>, c: LinkChange): PatchOp[] {
  const lines = found.fence.body.split("\n");
  let text = lines[found.line - 1] ?? "";
  if (c.label !== undefined || c.clearLabel) text = setEdgeLabel(text, c.clearLabel ? null : c.label ?? null, found.seg);
  if (c.arrow !== undefined) {
    if (!isArrow(c.arrow)) throw new UsageError(`\`${c.arrow}\` is not an arrow`);
    text = setEdgeArrow(text, c.arrow, found.seg);
  }
  if (c.hue !== undefined || c.clearHue) text = setEdgeHue(text, c.clearHue ? null : hueOf(c.hue!));
  if (c.quiet !== undefined) text = setEdgeFlag(text, "quiet", c.quiet);
  if (c.via !== undefined) text = setLinkVia(text, c.via);
  return [{ id: found.fence.id, body: replaceLine(found.fence.body, found.line, text) }];
}

export function removeLinkOps(found: ReturnType<typeof linkOf>): PatchOp[] {
  return [{ id: found.fence.id, body: removeLinkLine(found.fence.body, found.line) }];
}
