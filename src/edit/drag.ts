import { declaredAt } from "@/dsl/declared";
import { redate } from "@/dsl/graph/timeline";
import type { Graph } from "@/dsl/ir";
import { hasGraph, parseDiagram } from "@/dsl/parse";
import { moveStatement, moveTopic, replaceLine, setGeometry, statementSpan, topicSpan } from "@/dsl/restate";

import { frameShift, type LaidBox, type LaidOut } from "./build";

/**
 * What dragging a card inside a diagram means, as text over text.
 *
 * **A drag inside a diagram is a structural edit, not a position.** ELK's layered algorithm has no
 * fixed node — the `INTERACTIVE` strategies take a coordinate as a hint and hand back a card *near*
 * it — and four of the five house layouts have an axis that already *is* an ordinal: a commit's
 * column, a lane's band, a date. So there is nothing honest to write for "the card is here"; what
 * there is to write is what the drop *said*: this card belongs in that group, after that sibling,
 * in that band, on that date. Every one of those is a line of the fence moving, which is a thing
 * the file can say and a thing Claude reads back.
 *
 * The gesture lives in `useEditor` like every other one. What is here is the part with no pointer
 * in it, for the reason `connect.ts` gives: it can be tested without a browser and read without
 * one. Everything goes through `src/dsl/restate.ts`, so the author's spacing, quoting and comments
 * survive a drop by construction.
 */

/**
 * How this fence reads a drag on one of its cards.
 *
 * - `structure` — the eight brace dialects and `mindmap`: the drop names a container or a
 *   neighbour, and the statement moves.
 * - `fixed` — `sketch`, and any fence opened `layout=fixed`: the coordinate *is* the meaning, so
 *   the drop writes `x=`/`y=`.
 * - `date` — `timeline`: x is real time, so a sideways drag is a date and a vertical one is
 *   nothing (the packing owns y).
 * - `order` — `sequence` and `chart`: the drawing's one axis *is* the order of the statements, so a
 *   thing dragged across its neighbour reorders that list. A sequence's columns are its participant
 *   list; a chart's legend, its bars within a group and its wedges around the circle are all the
 *   declaration order of its `series`/`slice` lines, and nothing else about where a bar sits is a
 *   thing the file can say. A *message* cannot be dragged at all, and not by a rule written here:
 *   only a participant header carries `data-dag-node`, so a message can never be picked.
 * - `none` — `gitgraph`: a column is a commit and a lane is a branch, both ordinal and both the
 *   file's. There is no drop that means anything, so the drag is refused with a cursor rather than
 *   quietly writing something else.
 */
export type DragMode = "structure" | "fixed" | "date" | "order" | "none";

export function dragMode(type: string, layout?: string): DragMode {
  if (type === "sketch" || layout === "fixed") return "fixed";
  if (type === "gitgraph") return "none";
  if (type === "timeline") return "date";
  if (type === "sequence" || type === "chart") return "order";
  return "structure";
}

/** What a refused dialect has to say for itself, in the one line the panel shows. */
export const REFUSAL: Record<string, string> = {
  gitgraph: "Commits are ordered by the file, so a drag cannot move one.",
};

/**
 * Whether ELK is the thing placing this fence — the one place `col=` says anything.
 *
 * `flow` and `activity` are named rather than derived because `layoutGraph` names them: a `flow`
 * with no `lane` block still goes to `layoutLanes`, whose columns are a longest-path answer with no
 * partition to constrain. `mindmap` runs through ELK and is excluded for a different reason — its
 * lines are bare text with no `key=value` grammar to carry a `col=` at all.
 */
export const layered = (type: string, layout?: "fixed"): boolean =>
  dragMode(type, layout) === "structure" && type !== "mindmap" && type !== "flow" && type !== "activity";

/**
 * The innermost thing the pointer is over inside the diagram.
 *
 * One answer rather than three, because `closest()` already gives the innermost of the three
 * selectors in a single walk — and a lane holding a group holding a card would otherwise arrive
 * here as a set this module would have to re-rank without the DOM to rank it by.
 *
 * `frame` is the diagram's own padding, which is a real instruction — *out* of whatever holds this
 * card. `null` is the pointer having left the item altogether, which for a structural drop is not:
 * a card dropped on the paper two hundred pixels away is not asking for anything a fence can say.
 * A `fixed` or a `date` drop reads the *travel* and ignores this entirely.
 */
export type Over = { what: "node" | "group" | "lane" | "frame"; id: string } | null;

export interface Drop {
  type: string;
  body: string;
  dir?: "LR" | "TB";
  /** The fence's `layout=`, which is what makes a coordinate the author's. */
  layout?: "fixed";
  /** The card being dragged. */
  node: string;
  over: Over;
  /** `data-dag-layout`: every box in the diagram's own coordinates, plus a timeline's scale. */
  laid: LaidOut;
  /**
   * Where in the thing under the pointer the pointer is, on each axis: 0 its leading edge, 1 its
   * trailing one.
   *
   * A fraction rather than a point, and that is what keeps this module free of the page. The only
   * question a drop asks about position is "which half of that card", and the element's own client
   * rect answers it exactly — where converting the pointer into the diagram's coordinates would
   * mean unpicking a frame's padding, a header, a timeline strip's overhang and the canvas zoom,
   * and getting a different answer from the one the reader can see.
   */
  half: { x: number; y: number };
  /** How far the card travelled, in the diagram's own coordinates. */
  by: { x: number; y: number };
  /** `theme.metric.grid`, for the one mode that writes a coordinate. */
  grid: number;
}

/**
 * What a drop writes: the new body, and how far the drawing's top-left corner moved with it.
 *
 * `shift` is non-zero only for a fixed drop that moves the corner — the leftmost box dragged
 * right, anything dragged out past the top — because `layoutSketch` makes the frame hug the
 * drawing: the corner is always drawn at the frame's origin, so moving it moves everything else
 * the other way unless the fence moves by the same amount. The caller writes both in one op,
 * which is what keeps the rest of the drawing exactly where it was.
 */
export interface DropEdit {
  body: string;
  shift: { x: number; y: number };
}

/** The new body, or `null` when the drop means nothing and the file is left alone. */
export function dropBody(d: Drop): string | null {
  return dropEdit(d)?.body ?? null;
}

/** `dropBody` and the corner's travel — see `DropEdit`. */
export function dropEdit(d: Drop): DropEdit | null {
  const mode = dragMode(d.type, d.layout);
  if (mode === "none") return null;

  const graph = hasGraph(d.type) ? parseDiagram(d.type, d.body, d.dir, undefined, d.layout) : null;
  const line = declaredAt(d.type, d.body, d.node, d.dir);
  if (line === null) return null;

  /* The two modes where the *travel* is the whole instruction and what the pointer ended up over is
     nothing at all. They come first for a reason: a sketch's frame is sized to its content, so
     dragging a box clear of everything else means leaving the item, and refusing that would be
     refusing the commonest move on the one canvas whose whole premise is hand-placed geometry. */
  if (mode === "fixed") return graph ? fixedDrop(d, graph, line) : null;
  const still = (body: string | null): DropEdit | null => (body === null ? null : { body, shift: { x: 0, y: 0 } });
  if (mode === "date") return still(dateDrop(d, line));

  if (d.over === null) return null;
  if (mode === "order") return still(orderDrop(d, line));
  if (d.type === "mindmap") return still(topicDrop(d, line));
  return graph ? still(structuralDrop(d, graph, line)) : null;
}

/* ------------------------------------------------------------------------ where things live */

/** Every line that *declares* something, with the block that encloses it — `null` at the top. */
function containers(graph: Graph, body: string): Map<number, number | null> {
  /* A block is opened by a group or a lane, and which of the two is innermost is a fact about the
     text rather than about the IR: a node inside a lane inside a group carries both, in fields
     that do not say which brace came last. `statementSpan` reads the braces, so it can. */
  const blocks = [...graph.groups.map((g) => g.line), ...graph.lanes.map((l) => l.line)].sort((a, b) => a - b);
  const spans = new Map(blocks.map((b) => [b, statementSpan(body, b)]));
  const decls = [...graph.nodes.map((n) => n.line), ...blocks].sort((a, b) => a - b);

  const out = new Map<number, number | null>();
  for (const line of decls) {
    let best: number | null = null;
    for (const b of blocks) {
      if (b >= line) break;
      const s = spans.get(b)!;
      if (s.to >= line && (best === null || b > best)) best = b;
    }
    out.set(line, best);
  }
  return out;
}

/** The declarations directly inside a block, in file order. Edges are not declarations. */
function childrenOf(map: Map<number, number | null>, block: number | null): number[] {
  return [...map]
    .filter(([, c]) => c === block)
    .map(([line]) => line)
    .sort((a, b) => a - b);
}

/** Where a box sits, whether it is a card or a boundary. Lanes are not published and answer none. */
const boxOf = (laid: LaidOut, id: string): LaidBox | undefined => laid.nodes[id] ?? laid.groups[id];

/**
 * Which axis "before or after that card" is asking about, read off the drawing rather than `dir`.
 *
 * The diagram's direction is not the answer, twice over. `separate` gives a group its own, and
 * `dir=TB` on a `group` line is a working override this module cannot see — but worse, a reorder
 * in a layered layout is a reorder *within* a layer, which is the axis **across** the flow. A
 * `state` machine running RIGHT stacks two branches of one decision down the page, and a drop on
 * the lower one is asking about y while `dir` says x.
 *
 * So the axis comes from the target's **nearest neighbour**, which is exactly the pair a reader is
 * choosing between. Global spread was the first answer and is wrong for the same reason `dir` is:
 * a third card in the next layer along dominates it and swings the axis back to the flow.
 *
 * The set includes the card being dragged, deliberately. It is one of the boxes on the page and
 * usually the closest thing to where it was dropped; leaving it out was what made two branches off
 * one decision measure themselves against the decision instead of against each other.
 */
export function axisOf(target: LaidBox, others: LaidBox[], dir: "LR" | "TB" | undefined): "x" | "y" {
  const cx = (b: LaidBox) => b.x + b.w / 2;
  const cy = (b: LaidBox) => b.y + b.h / 2;
  let near: LaidBox | undefined;
  let best = Infinity;
  for (const o of others) {
    const dx = cx(o) - cx(target);
    const dy = cy(o) - cy(target);
    const d = Math.hypot(dx, dy);
    if (d > 0 && d < best) {
      best = d;
      near = o;
    }
  }
  if (!near) return dir === "TB" ? "y" : "x";
  return Math.abs(cx(near) - cx(target)) >= Math.abs(cy(near) - cy(target)) ? "x" : "y";
}

/**
 * Which layer a card came out in, counted off the drawing — what the panel offers as `col=`.
 *
 * ELK aligns a layer on one leading edge and everything is snapped to the grid, so the distinct
 * leading edges across the flow *are* the layers, and a card's rank among them is its column. Read
 * back rather than published, because ELK does not report a layer index and the number a person
 * would want to pin is the one they can see: "this card is third along".
 *
 * Advisory, like every `Q_` finding: it is offered as a value to write, never written by the drag.
 * A drag that pinned a column would make the layout stop responding to the file, which is the one
 * thing automatic layout is for.
 */
export function columnOf(laid: LaidOut, id: string, dir: "LR" | "TB" | undefined): number | null {
  const box = laid.nodes[id];
  if (!box) return null;
  const at = (b: LaidBox) => (dir === "TB" ? b.y : b.x);
  const layers = [...new Set(Object.values(laid.nodes).map(at))].sort((a, b) => a - b);
  const n = layers.indexOf(at(box));
  return n < 0 ? null : n;
}

/* ------------------------------------------------------------------------- the eight braces */

function structuralDrop(d: Drop, graph: Graph, line: number): string | null {
  const own = statementSpan(d.body, line);
  const inside = (n: number) => n >= own.from && n <= own.to;
  const map = containers(graph, d.body);
  const lineOf = (id: string): number | null => declaredAt(d.type, d.body, id, d.dir);

  /* A card: before or after it, in whatever container it is in. `moveStatement` re-indents to the
     target's own indent, so "next to that card" and "into that group" are the same edit — which is
     what makes a drop onto a card inside a group land inside the group. */
  if (d.over?.what === "node" && d.over.id !== d.node) {
    const target = lineOf(d.over.id);
    if (target === null || inside(target)) return null;
    const block = map.get(target) ?? null;
    const family = childrenOf(map, block);
    const boxes: LaidBox[] = [];
    for (const n of family) {
      const id = idAt(graph, n);
      const b = id === undefined ? undefined : boxOf(d.laid, id);
      if (b) boxes.push(b);
    }
    const box = boxOf(d.laid, d.over.id);
    const axis = box ? axisOf(box, boxes, d.dir) : d.dir === "TB" ? "y" : "x";
    if (d.half[axis] > 0.5) return moved(d.body, line, { afterLine: target });
    const prev = family.filter((n) => n < target && !inside(n)).pop();
    if (prev !== undefined) return moved(d.body, line, { afterLine: prev });
    return moved(d.body, line, block === null ? { toTop: true } : { intoBlockLine: block });
  }

  /* A band or a boundary, with no card under the pointer: into it, at its end. "At its end" and
     not at its start, because a container's model order is read down the page and a person who
     drops a card into a group is adding to it, not putting it in front. */
  const container = d.over && (d.over.what === "group" || d.over.what === "lane") ? d.over.id : null;
  if (container !== null) {
    const target = lineOf(container);
    if (target === null || inside(target)) return null;
    const last = childrenOf(map, target)
      .filter((n) => !inside(n))
      .pop();
    return moved(d.body, line, last === undefined ? { intoBlockLine: target } : { afterLine: last });
  }

  /* The frame's own padding: out of whatever held it, after the last thing declared at the top.
     Not `toTop` outright — that would put a card above the whole diagram, which is a different
     instruction from "take this out of that group". */
  const top = childrenOf(map, null)
    .filter((n) => !inside(n))
    .pop();
  return moved(d.body, line, top === undefined ? { toTop: true } : { afterLine: top });
}

/** Which thing a declaration line declares — the inverse of the maps above, for a box lookup. */
function idAt(graph: Graph, line: number): string | undefined {
  return (
    graph.nodes.find((n) => n.line === line)?.id ??
    graph.groups.find((g) => g.line === line)?.id ??
    graph.lanes.find((l) => l.line === line)?.id
  );
}

/** `moveStatement`, with "it did not move" reported as nothing rather than as an identical write. */
function moved(body: string, line: number, target: Parameters<typeof moveStatement>[2]): string | null {
  const next = moveStatement(body, line, target);
  return next === body ? null : next;
}

/* --------------------------------------------------------------------------------- mindmap */

/**
 * A topic dropped on another topic is re-parented under it, with everything beneath it.
 *
 * Dropped anywhere else it is refused, and that is the grammar rather than caution: depth 0 is the
 * root, a mindmap has one, and a drop on the frame would quietly make a second one.
 */
function topicDrop(d: Drop, line: number): string | null {
  if (d.over?.what !== "node" || d.over.id === d.node) return null;
  const target = declaredAt(d.type, d.body, d.over.id, d.dir);
  if (target === null) return null;
  const own = topicSpan(d.body, line);
  if (target >= own.from && target <= own.to) return null;
  const next = moveTopic(d.body, line, target);
  return next === d.body ? null : next;
}

/* ---------------------------------------------------------------------------------- fixed */

/**
 * A coordinate, relative to whatever contains it — which is how `layoutSketch` reads one.
 *
 * A container moves as one line: its children are written against *its* origin, so shifting the
 * group is the whole edit and nothing inside it is touched. That falls out of the format rather
 * than being arranged here, which is why there is no loop over children.
 */
function fixedDrop(d: Drop, graph: Graph, line: number): DropEdit | null {
  const self = boxOf(d.laid, d.node);
  if (!self) return null;
  const parentOf = (id: string): string | undefined =>
    graph.nodes.find((n) => n.id === id)?.group ?? graph.groups.find((g) => g.id === id)?.parent;
  const parent = parentOf(d.node);
  /* The layout's numbers are not the file's. A child is written against its container's origin,
     and a top-level box against the file's own, which the layout moved so the frame hugs the
     drawing — `LaidOut.origin` is how far. Writing the layout's number back as the file's is what
     made an 8px drag move a card 104px in any sketch with a negative coordinate in it. */
  const base = (parent ? d.laid.groups[parent] : undefined) ?? { x: 0, y: 0 };
  const file = parent ? { x: 0, y: 0 } : (d.laid.origin ?? { x: 0, y: 0 });
  const snap = (v: number) => Math.round(v / d.grid) * d.grid;
  const rx = snap(self.x + d.by.x - base.x);
  const ry = snap(self.y + d.by.y - base.y);
  const x = rx + file.x;
  const y = ry + file.y;
  const src = d.body.split("\n")[line - 1];
  if (src === undefined) return null;
  const next = replaceLine(d.body, line, setGeometry(src, { x, y }));
  if (next === d.body) return null;

  /* Where the drawing's top-left corner goes: every box as it was, the dragged one and everything
     inside it moved by the same snapped travel. A container that grows to hold a child only grows
     right and down, so the boxes alone answer this. */
  const moved = (id: string): boolean => {
    for (let at: string | undefined = id; at !== undefined; at = parentOf(at)) if (at === d.node) return true;
    return false;
  };
  const tx = base.x + rx - self.x;
  const ty = base.y + ry - self.y;
  const all = [...Object.entries(d.laid.nodes), ...Object.entries(d.laid.groups)];
  const corner = (dx: number, dy: number) => ({
    x: Math.min(...all.map(([id, b]) => b.x + (moved(id) ? dx : 0))),
    y: Math.min(...all.map(([id, b]) => b.y + (moved(id) ? dy : 0))),
  });
  return { body: next, shift: frameShift(corner(0, 0), corner(tx, ty)) };
}

/* -------------------------------------------------------------------------------- timeline */

/**
 * A sideways drag is a date; a vertical one is nothing.
 *
 * y on a timeline is a packing answer — the first row the card fits in — so there is no statement
 * that could say "put it lower", and the axis is inverted through the scale the layout published
 * rather than through a copy of its arithmetic. See `AxisScale`.
 */
function dateDrop(d: Drop, line: number): string | null {
  const scale = d.laid.scale;
  const self = d.laid.nodes[d.node];
  if (!scale || !self || scale.px <= 0) return null;
  const at = scale.min + ((self.x + d.by.x) / scale.px) * scale.span;
  const src = d.body.split("\n")[line - 1];
  if (src === undefined) return null;
  const DAY = 86_400_000;
  const written = redate(src, Math.round(at / DAY) * DAY);
  if (written === null) return null;
  const next = replaceLine(d.body, line, written);
  return next === d.body ? null : next;
}

/* --------------------------------------------------------------------- sequence, and chart */

/**
 * What a *declaration* looks like in the two dialects whose one axis is the order of their
 * statements.
 *
 * Neither has an IR to ask — a sequence's model is moments and a chart's is data — so "the
 * previous one" is a scan for the head word that makes one. It cannot be `target − 1`: in a
 * sequence that line is as likely to be a message, a blank or an `activate`, and in a chart it is
 * as likely to be the `x` line, a `unit` or the form.
 */
const DECLARES: Record<string, RegExp> = {
  sequence: /^\s*(?:participant|actor)\s/,
  chart: /^\s*(?:series|slice)\s/,
};

/** Anything at all: a line that is neither blank nor a comment. */
const CONTENT = /^\s*(?:%%|\/\/|$)/;

/**
 * A participant header, a series or a slice dragged across its neighbour: its line moves with it.
 *
 * **Across, always.** Both dialects read left to right — a sequence's columns are its participant
 * list, and a chart's bars, wedges and legend rows are all its declaration order — so the only
 * question a drop asks is which side of the target it landed on. The ghost only travels along x
 * for the same reason (`nodeDrag`'s `flat`), so the gesture and the reading agree by construction.
 *
 * Landing before the *first* declaration falls back to the last line that carries anything, rather
 * than to the top of the body. In a sequence that is usually nothing and `toTop` is right; in a
 * chart it is the `x` line or the form, and a `series` hoisted above `bar` would be a data line
 * standing in front of the statement that says what shape the chart is — legal, and not something
 * a person dragging a bar asked for.
 */
function orderDrop(d: Drop, line: number): string | null {
  if (d.over?.what !== "node" || d.over.id === d.node) return null;
  const target = declaredAt(d.type, d.body, d.over.id, d.dir);
  if (target === null) return null;
  if (d.half.x > 0.5) return moved(d.body, line, { afterLine: target });

  const lines = d.body.split("\n");
  const declares = DECLARES[d.type] ?? DECLARES.sequence!;
  const own = statementSpan(d.body, line);
  const mine = (n: number) => n >= own.from && n <= own.to;
  for (let n = target - 1; n >= 1; n--) {
    if (!mine(n) && declares.test(lines[n - 1] ?? "")) return moved(d.body, line, { afterLine: n });
  }
  for (let n = target - 1; n >= 1; n--) {
    if (!mine(n) && !CONTENT.test(lines[n - 1] ?? "")) return moved(d.body, line, { afterLine: n });
  }
  return moved(d.body, line, { toTop: true });
}
