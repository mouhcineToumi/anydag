import { framed, resizeOf, type BoardItem, type ItemType } from "@/board/types";
import { declaredAt } from "@/dsl/declared";
import { parseItem } from "@/dsl/diagnose";
import type { Graph, Node } from "@/dsl/ir";
import { containersOf, hasGraph, kindsOf } from "@/dsl/parse";
import { replaceLine, setGeometry, statementSpan, type Geometry } from "@/dsl/restate";
import { tokenize } from "@/dsl/tokenizer";

import type { Side } from "./connect";

/**
 * Building a diagram with the pointer: what a `+` appends, and what Detach rewrites.
 *
 * Both are text over text with no browser in them, which is what makes them testable and what
 * keeps `useEditor` a place where gestures are turned into ops rather than a place where the
 * grammar lives. Everything here goes through `src/dsl/restate.ts` for the same reason every other
 * writer does: one span in, one span out, and the author's spacing, quoting and comments come
 * through untouched.
 *
 * The two are opposite in shape and that is worth saying once. `grow()` is a **statement writer**
 * — two lines added to a body that is otherwise byte-identical. `detach()` is a **declared
 * whole-body conversion**, the family `fromMermaid` started: it touches every declaration in the
 * fence, so it is offered as a button that says what it will do rather than happening as a side
 * effect of a drag.
 */

/** A card, its edge, and the id the new card was given. */
export interface Grown {
  body: string;
  id: string;
}

/**
 * A name nothing in this body already uses, based on `stem`.
 *
 * Every *word* is avoided rather than every declared id — broader than it needs to be and cheaper
 * than being exactly right, which is the argument `duplicateStatement` already makes: `service2`
 * is a fine name for a new service unless the word `service2` appears anywhere at all, in which
 * case it is a confusing one.
 */
export function freshNodeId(body: string, stem: string): string {
  const taken = new Set<string>();
  for (const t of tokenize(body, [])) if (t.kind === "word") taken.add(t.value);
  const base = stem.replace(/\d+$/, "") || "node";
  for (let n = 2; ; n++) {
    const id = `${base}${n}`;
    if (!taken.has(id)) return id;
  }
}

/** The kind word a declaration opens with — the author's, not the renderer's `NodeKind`. */
function kindWordOf(line: string): string | null {
  const tokens = tokenize(line, []).filter((t) => t.kind !== "sep" && t.kind !== "eof");
  if (tokens.length < 2 || tokens[0]!.kind !== "word" || tokens[1]!.kind !== "word") return null;
  if (tokens.some((t) => t.kind === "arrow")) return null;
  return tokens[0]!.value;
}

const indentOf = (line: string): string => /^[ \t]*/.exec(line)![0]!;

/** The two words for a pseudostate, in the dialects that have them — `state` and `activity`. */
export type Pseudo = "start" | "end";

/** Whether this dialect can declare a start or an end state of its own. */
export const hasPseudo = (type: string): boolean => kindsOf(type).includes("start") && kindsOf(type).includes("end");

const isPseudo = (word: string): word is Pseudo => word === "start" || word === "end";

export interface GrowOpts {
  /** Which handle was pulled: it decides which way the edge points, and where a fixed card lands. */
  side: Side;
  /**
   * Whether to write the edge as well.
   *
   * True everywhere the layout is ELK's, because a card with nothing pointing at it is a card ELK
   * has no reason to put anywhere near the one it grew from — the edge *is* the placement. In a
   * fixed fence the coordinate is the placement, so the edge is a separate claim and only a drag
   * asks for one.
   */
  edge: boolean;
  /** Where the new card goes, in a fence whose coordinates are the author's. */
  at?: { x: number; y: number };
  /**
   * Grow a start or an end state instead of a copy of the picked card.
   *
   * It also decides which way the edge points, whatever `side` says: a start state is where the
   * flow comes from and an end state is where it goes, and an arrow the wrong way round would be a
   * diagram that begins at its ending.
   */
  pseudo?: Pseudo;
}

/**
 * A second card beside the picked one, and the edge between them.
 *
 * The new statement is inserted **after the picked statement, in the same block**, so a card grown
 * from something inside a group is inside that group: the brace is the containment and staying in
 * it is what "beside this" means. The edge goes at the end of the body at no indent, where every
 * hand-written board puts its edges and where a cross-boundary one has to be anyway.
 *
 * The kind is read off the picked line rather than out of the IR, because the IR holds the
 * *renderer's* kind and several words can map to one of those — `store` and `db` are both a
 * cylinder, and growing a `db` should write `db`.
 *
 * `null` when the id is not declared here, or the line it is declared on is not a declaration —
 * a mindmap topic and a sequence participant have no kind word to copy, and inventing one would
 * write a statement in a grammar that does not have it.
 */
export function grow(type: string, body: string, dir: "LR" | "TB" | undefined, from: string, opts: GrowOpts): Grown | null {
  if (opts.pseudo && !hasPseudo(type)) return null;
  const line = declaredAt(type, body, from, dir);
  if (line === null) return null;

  const lines = body.split("\n");
  const stmt = lines[line - 1];
  if (stmt === undefined) return null;
  const kind = kindWordOf(stmt);
  if (!kind) return null;

  /* Growing from a start or an end state grows a real card: a second dot beside the first is never
     what the `+` on one was pressed for. `kindsOf` lists the real kinds first, so the first one that
     is not a pseudostate is the dialect's own word for a card. */
  const word = opts.pseudo ?? (isPseudo(kind) ? (kindsOf(type).find((k) => !isPseudo(k)) ?? kind) : kind);
  const id = freshNodeId(body, word);
  /* A pseudostate draws no text, so it is declared with none — `start start2`, the way `fork f2` is. */
  let text = `${indentOf(stmt)}${word} ${id}${isPseudo(word) ? "" : ` ${JSON.stringify(`New ${word}`)}`}`;
  if (opts.at) text = setGeometry(text, opts.at);

  const span = statementSpan(body, line);
  const out = [...lines.slice(0, span.to), text, ...lines.slice(span.to)];

  if (!opts.edge) return { body: out.join("\n"), id };

  /* East and south grow *forward*, so the picked card is the source; west and north grow back
     towards it. A reader follows an arrow the way they read the page, and a `+` on the left hand
     side that drew a line pointing right would be an arrow through the card it came from. A start
     state is the exception on both counts: it always points at the card, and an end state is always
     pointed at. */
  const back = opts.pseudo ? opts.pseudo === "start" : opts.side === "w" || opts.side === "n";
  const statement = back ? `${id} --> ${from}` : `${from} --> ${id}`;
  return { body: appendEdge(out.join("\n"), statement), id };
}

/**
 * One edge statement appended to a diagram's body.
 *
 * At the end, because that is where every board here writes its edges and where a cross-boundary
 * one has to be anyway — a statement inside a `{ }` block belongs to that block. The blank line is
 * the one judgement call: an edge joining a run of edges belongs in the run, and one landing after
 * a declaration gets a line of air, which is how a person writing the same board would do it.
 */
export function appendEdge(body: string, statement: string): string {
  const lines = body.replace(/\s+$/, "").split("\n");
  const last = lines[lines.length - 1] ?? "";
  const runOn = tokenize(last, []).some((t) => t.kind === "arrow");
  if (last.trim() === "") return `${statement}`;
  return [...lines, ...(runOn ? [] : [""]), statement].join("\n");
}

/** What a wrap needs to know: which word opens the container, and which line is wrapped. */
export interface WrapPlan {
  word: "group" | "lane";
  /** 1-based, in the body: the declaration of the picked card, group or lane. */
  line: number;
  /** The picked thing's own container, so a fixed fence can write the new box against it. */
  parent: string | undefined;
}

/**
 * Whether the picked card, group or lane can be wrapped in a new container, and in which.
 *
 * **The word is the dialect's, never a choice.** `flow` and `activity` draw swimlanes with a layout
 * of their own, so what wraps there is a `lane`; every other dialect with containers has `group`.
 * `usecase` and `c4` also have `system`, and a wrap writes `group` there too — the Shape control on
 * the new container is how it becomes one, which keeps a wrap one gesture and one word.
 *
 * Refused where the result would be a statement the grammar reads differently from what was asked:
 *
 * - **A lane inside a lane**, or a lane round a group, or a group in a diagram that has lanes. A file
 *   uses groups or lanes, not both (`docs/dsl/common.md`), and a band nested in a band is not
 *   something the lane layout draws.
 * - **A line that is not the picked thing's own.** The parser says a card inside a one-line lane
 *   (`lane r "R" { step a "A" }`) is declared on the lane's line, and wrapping *that* line would wrap
 *   the lane while the panel says it wrapped the card. A legacy `[*]` is declared on an edge for
 *   the same reason — it has no statement of its own to put inside anything.
 * - **A body that does not parse clean**, the bar every writer here holds.
 */
export function wrapPlan(item: Pick<BoardItem, "type" | "body" | "dir" | "aspect" | "layout">, id: string): WrapPlan | null {
  const containers = containersOf(item.type);
  if (containers.length === 0 || kindsOf(item.type).length === 0) return null;
  const g = parseItem(item);
  if (!g || g.kind !== "graph" || g.diagnostics.some((d) => d.severity === "error")) return null;

  const node = g.nodes.find((n) => n.id === id);
  const group = node ? undefined : g.groups.find((x) => x.id === id);
  const lane = node || group ? undefined : g.lanes.find((x) => x.id === id);
  const subject = node ?? group ?? lane;
  if (!subject) return null;

  const word = containers.includes("lane") ? "lane" : "group";
  if (word === "lane" && (lane || node?.lane || g.groups.length > 0)) return null;
  if (word === "group" && g.lanes.length > 0) return null;

  const line = declaredAt(item.type, item.body, id, item.dir);
  if (line === null || line !== subject.line) return null;
  const head = tokenize(item.body.split("\n")[line - 1] ?? "", []).filter((t) => t.kind !== "sep" && t.kind !== "eof");
  if (head[0]?.kind !== "word" || head[1]?.kind !== "word" || head[1].value !== id) return null;
  if (head.some((t) => t.kind === "arrow")) return null;

  return { word, line, parent: node ? node.group : group?.parent };
}

/**
 * The new container's box, for a fence whose coordinates are the author's — a `sketch`, or any
 * `layout=fixed` fence.
 *
 * There a container carries its own `x= y= w= h=` and its children are written against its origin,
 * so a wrap that wrote only the word would put the card in a container with no box. This one
 * is `pad` clear of the picked box on every side, and the wrapped statement moves to `(pad, pad)`
 * inside it: the card stays exactly where it was drawn, and the container appears round it.
 *
 * `corner` is where the new box's top-left is in the layout's numbers, for {@link frameShift} —
 * a fixed layout draws the frame's corner at the origin, so a container reaching past the old
 * corner would slide the drawing the other way unless the item moves by the same amount.
 *
 * `null` when the layout has not published a box for the thing, which is "not laid out yet" and
 * the one case where there is nothing honest to write.
 */
export function wrapGeometry(
  laid: LaidOut,
  id: string,
  parent: string | undefined,
  pad: number,
): { box: Geometry; at: { x: number; y: number }; corner: { x: number; y: number } } | null {
  const b = laid.nodes[id] ?? laid.groups[id];
  if (!b) return null;
  const corner = { x: b.x - pad, y: b.y - pad };
  const at = fileAt(laid, corner, parent);
  return { box: { ...at, w: b.w + pad * 2, h: b.h + pad * 2 }, at: { x: pad, y: pad }, corner };
}

/** One box as the layout placed it, in the diagram's own coordinates. */
export interface LaidBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** What a diagram publishes about where its layout put things — see `data-dag-layout`. */
export interface LaidOut {
  nodes: Record<string, LaidBox>;
  groups: Record<string, LaidBox>;
  /** A timeline's date scale, and nothing else's: see `AxisScale`. */
  scale?: { min: number; span: number; px: number };
  /**
   * A fixed layout's translation: where the file puts the drawing's top-left, which the layout
   * drew at `0,0`. A top-level box here is `box.x + origin.x` in the file; a child is relative to
   * its container and needs nothing. Absent everywhere ELK or a house layout placed things.
   */
  origin?: { x: number; y: number };
  /**
   * How big the layout drew the whole drawing — the frame's inside. In a fixed layout that is the
   * boxes *and* whatever line or label reaches past them, so the boxes need not start at
   * `0,0` or end at the far edge; a writer that wants the padding round the boxes reads it here.
   * Absent from a page older than this field, where the boxes were the whole of it.
   */
  size?: { w: number; h: number };
}

/**
 * Every declaration in this body carrying the coordinate the layout gave it.
 *
 * This is the whole of Detach. `layout=fixed` alone would hand the fence to `layoutSketch`, which
 * finds nothing placed and lays the cards out in a reading-order grid — a *different diagram*, and
 * the opposite of what somebody who wants to nudge one card asked for. Writing the coordinates
 * first means the drawing does not move at the moment it stops being automatic, and the two land
 * in one commit so one ctrl+Z takes the whole conversion back.
 *
 * **Coordinates are relative to the container**, because that is how `layoutSketch` reads them: a
 * group carries its own box and its children are written against its origin, so moving a group is
 * editing one line. ELK's answer is absolute within the diagram, so each box is offset by its
 * parent's — a node by its group's, a group by its parent group's.
 *
 * A group gets `w=`/`h=` as well as a position. Without them the container would shrink to hug its
 * contents the moment it was detached, which for a boundary drawn deliberately roomy is the frame
 * quietly changing size behind the conversion.
 */
export function detach(graph: Graph, laid: LaidOut, body: string): string {
  const origin = (parent: string | undefined): LaidBox | undefined => (parent ? laid.groups[parent] : undefined);
  const at = (box: LaidBox, parent: string | undefined) => {
    const o = origin(parent);
    return { x: box.x - (o?.x ?? 0), y: box.y - (o?.y ?? 0) };
  };

  const lines = body.split("\n");
  const write = (line: number, geom: Parameters<typeof setGeometry>[1]) => {
    const cur = lines[line - 1];
    if (cur !== undefined) lines[line - 1] = setGeometry(cur, geom);
  };

  /* Groups first, so a nested one is written against a parent whose own box is already known —
     which it is either way, since every offset is read from `laid` rather than from the text. */
  for (const g of graph.groups) {
    const box = laid.groups[g.id];
    if (box) write(g.line, { ...at(box, g.parent), w: box.w, h: box.h });
  }
  for (const n of graph.nodes) {
    const box = laid.nodes[n.id];
    if (box) write(n.line, at(box, n.group));
  }
  return lines.join("\n");
}

/**
 * Whether this type's coordinates *can* become the author's — derived, never listed.
 *
 * Two facts already written down, and their intersection is the answer. `kindsOf` is non-empty
 * only for a dialect `parseWith` reads, and `modifiers()` — which is what promotes `x=`/`y=` onto
 * a node — runs only there: a mindmap, a timeline, a gitgraph and a sequence have parsers of their
 * own, so a coordinate written on one of those would be text nothing reads. `resizeOf` is
 * `"aspect"` for exactly the ELK diagrams, which is the other half: the five own-layout dialects
 * have an axis no rectangle describes, which is the same reason they get no resize handle.
 *
 * `sketch` falls out of both — it is fixed by nature, so there is nothing to detach it from.
 */
export const detachable = (type: ItemType): boolean =>
  type !== "sketch" && resizeOf(type) === "aspect" && kindsOf(type).length > 0;

/**
 * Whether a card in this dialect can grow a neighbour — the `+` handles, and the round ones beside
 * them.
 *
 * Both write the same pair of things: a declaration, and **an edge to it**. An edge between two
 * declared things is what a `Graph` is, so `hasGraph` is the whole predicate rather than a list.
 * The two dialects it excludes each fail on the second half. A chart has no edge grammar at all —
 * `web --> mob` in a chart body is `E_UNKNOWN_KIND`, so a `+` there would write a statement that
 * breaks the chart it was pressed on. A sequence has arrows, but an arrow there is a *message* — a
 * moment, not a relationship — so growing a participant "with the edge already attached" would put
 * a message between two people on the strength of a click on a plus, which is a different claim
 * from the one every other dialect's `+` makes.
 *
 * The item's own connect handles are untouched: a board-level link into a series or a participant
 * is an `edges` fence one layer up, and that grammar owns both ends.
 */
export const growable = (type: string): boolean => hasGraph(type);

/**
 * A `sketch` item that is one shape and nothing else — what the library drops for "a circle".
 *
 * On the page it *is* the shape: bare, so no header, and a frame that hugs the one thing in it by
 * `frame.barePad`. So the item's handles have to mean the shape. Writing `w=`/`h=` on the fence —
 * what they do for every other `box` item — widened the frame and left the circle exactly the size
 * it was, which is the bigger-empty-box defect the diagrams got a fix for, one dialect over.
 *
 * `null` for anything else: a sketch holding two shapes is a drawing, and resizing the drawing's
 * frame is what its handles already mean. A body that does not parse is not resized through either.
 */
export function loneShape(item: Pick<BoardItem, "type" | "body" | "frame" | "title" | "subtitle">): Node | null {
  if (item.type !== "sketch" || framed(item)) return null;
  const g = parseItem(item);
  if (!g || g.kind !== "graph" || g.diagnostics.some((d) => d.severity === "error")) return null;
  if (g.nodes.length !== 1 || g.groups.length !== 0) return null;
  return g.nodes[0]!;
}

/** The shape's own `w=`/`h=`, on its own line, and nothing else in the body touched. */
export function resizeShape(body: string, node: Node, w: number, h: number): string {
  const line = body.split("\n")[node.line - 1];
  if (line === undefined) return body;
  return replaceLine(body, node.line, setGeometry(line, { w, h }));
}

/**
 * The one node of a diagram item that is exactly one node and nothing else.
 *
 * Where `loneShape` asks "may the item's handles mean the shape?", this asks "may the item view
 * show *that node's* styling and write its line" — the reason the panel would have looked
 * useless over a shape dropped from the library. The item's frame has no fill, no kind and no
 * icon; the node inside it has all three. So unlike `loneShape` this is not restricted to
 * `sketch` and is not refused when the item is framed: a framed one-node `arch` is still one
 * node, and its hue is still the only hue on the item.
 *
 * The dialect gate is `kindsOf`, not `hasGraph` alone. A `chart` and a `sequence` fall out of
 * either — their models are not `Graph`s — but a lone `mindmap` topic, a `timeline` entry or a
 * `gitgraph` commit parses into a one-node `Graph` whose line is bare text: a modifier written
 * onto it would become part of the label. `kindsOf` is non-empty exactly for the nine dialects
 * whose statements go through `modifiers()`, which is the same test `detachable` makes one
 * function down; it is the set whose lines these controls can honestly write.
 */
export function loneNode(item: Pick<BoardItem, "type" | "body" | "dir" | "aspect" | "layout">): Node | null {
  if (kindsOf(item.type).length === 0) return null;
  const g = parseItem(item);
  if (!g || g.kind !== "graph" || g.diagnostics.some((d) => d.severity === "error")) return null;
  if (g.nodes.length !== 1 || g.groups.length !== 0) return null;
  return g.nodes[0]!;
}

/**
 * Whether this diagram is one card and nothing else, whatever its dialect.
 *
 * A drag on a picked card is a structural edit — into that group, past that sibling, onto that
 * date — and with one card there is nothing for a drop to name. It used to go ahead anyway: in a
 * `sketch` it wrote the card's own `x=`/`y=` and the frame grew around the gap, and in
 * every other dialect it painted a ghost and then refused the drop. On the page a one-card item
 * *is* its card, so the press moves the item instead — the same answer `loneShape` gives for the
 * resize handles, asked about every dialect rather than only the one with shapes in it.
 */
export function soleCard(item: Pick<BoardItem, "type" | "body" | "dir" | "aspect" | "layout">): boolean {
  const m = parseItem(item);
  if (!m) return false;
  if (m.kind === "sequence") return m.participants.length === 1;
  if (m.kind === "chart") return m.series.length + m.slices.length === 1;
  return m.nodes.length === 1 && m.groups.length === 0 && m.lanes.length === 0;
}

/**
 * The top-left corner of a laid-out drawing — the smallest `x` and `y` of any box in it.
 *
 * In a fixed layout this is `0,0` unless a line or a label reaches past the boxes on that side
 *, when the boxes start that far in; a writer that moves it has to move the fence by what
 * {@link frameShift} says, or the whole drawing slides the other way under the pointer. ELK's corner
 * is wherever its padding put it, which is what Detach has to take back out.
 */
export function cornerOf(laid: LaidOut): { x: number; y: number } {
  const boxes = [...Object.values(laid.nodes), ...Object.values(laid.groups)];
  if (boxes.length === 0) return { x: 0, y: 0 };
  return { x: Math.min(...boxes.map((b) => b.x)), y: Math.min(...boxes.map((b) => b.y)) };
}

/**
 * The box around every box in a laid-out drawing, in the layout's numbers, or `null` when it has
 * none. What a writer that scales the drawing scales: in a fixed layout the frame is this plus the
 * margin a line or a label reaching past it took, and that margin does not scale.
 */
export function boxesOf(laid: LaidOut): { x: number; y: number; w: number; h: number } | null {
  const boxes = [...Object.values(laid.nodes), ...Object.values(laid.groups)];
  if (boxes.length === 0) return null;
  const { x, y } = cornerOf(laid);
  const right = Math.max(...boxes.map((b) => b.x + b.w));
  const bottom = Math.max(...boxes.map((b) => b.y + b.h));
  return { x, y, w: right - x, h: bottom - y };
}

/**
 * How far a fixed fence moves when a writer takes its drawing's top-left box from `was` to `now`,
 * both in the layout's numbers, so that whatever it did not move stays where it is on the board.
 *
 * The layout draws the frame's corner at `0,0`. That corner is the boxes' own — or, when a line or a
 * label reaches past them, the line's, and the boxes start `was` in from it. In the first
 * case the corner follows the boxes and the fence moves with it; in the second it stays with the
 * line until a box goes past it, and the fence moves only by how far one does. Taking the corner as
 * the boxes' alone moved everything a writer did not touch by the line's margin. Where the line
 * will be after the next routing is not known here — a drag that changes how high a bow goes moves
 * the drawing by the difference — so it is taken to stay.
 */
export function frameShift(was: { x: number; y: number }, now: { x: number; y: number }): { x: number; y: number } {
  const axis = (b: number, n: number) => (b > 0 ? Math.min(n, 0) : n - b);
  return { x: axis(was.x, now.x), y: axis(was.y, now.y) };
}

/**
 * Where the `+` puts a new card in a fixed fence: one gap off the picked one on the side that was
 * pulled, and past anything already there.
 *
 * The coordinate is the placement here, so a spot one gap to the east is simply written — and when
 * a card already stood there, the new one was drawn on top of it and hid it. The answer keeps the
 * direction the person pulled, which is the one thing the gesture said: a card in the way pushes
 * the spot to one gap past its far edge, and that repeats until nothing is in the way. The new
 * card's size is taken to be the picked one's, since it is the same kind and has not been laid
 * out yet. A container holding the picked card is not in the way — the new card goes into it —
 * and every other box is, a group included. All of it is in the layout's numbers.
 */
export function clearSpot(laid: LaidOut, node: string, side: Side, gap: number): LaidBox | null {
  const from = laid.nodes[node];
  if (!from) return null;
  const inside = (o: LaidBox, b: LaidBox) => o.x <= b.x && o.y <= b.y && o.x + o.w >= b.x + b.w && o.y + o.h >= b.y + b.h;
  const blocks = [
    ...Object.entries(laid.nodes)
      .filter(([id]) => id !== node)
      .map(([, b]) => b),
    ...Object.values(laid.groups).filter((g) => !inside(g, from)),
  ];
  const hit = (s: LaidBox) => blocks.find((b) => s.x < b.x + b.w && b.x < s.x + s.w && s.y < b.y + b.h && b.y < s.y + s.h);
  const spot: LaidBox = {
    x: from.x + (side === "e" ? from.w + gap : side === "w" ? -(from.w + gap) : 0),
    y: from.y + (side === "s" ? from.h + gap : side === "n" ? -(from.h + gap) : 0),
    w: from.w,
    h: from.h,
  };
  /* Every step clears one box for good, so the loop ends by the count of them. */
  for (let i = 0; i <= blocks.length; i++) {
    const b = hit(spot);
    if (!b) break;
    if (side === "e") spot.x = b.x + b.w + gap;
    else if (side === "w") spot.x = b.x - gap - spot.w;
    else if (side === "s") spot.y = b.y + b.h + gap;
    else spot.y = b.y - gap - spot.h;
  }
  return spot;
}

/**
 * The file's coordinate for a box the layout placed, relative to whatever contains it.
 *
 * A child is written against its container's origin and a top-level box against the file's own,
 * which a fixed layout moved to `0,0` (`LaidOut.origin`). Detach has no origin to add — ELK's
 * numbers are the ones being adopted — so it passes a layout without one.
 */
export function fileAt(laid: LaidOut, box: { x: number; y: number }, parent: string | undefined): { x: number; y: number } {
  const o = parent ? laid.groups[parent] : undefined;
  if (o) return { x: box.x - o.x, y: box.y - o.y };
  return { x: box.x + (laid.origin?.x ?? 0), y: box.y + (laid.origin?.y ?? 0) };
}

/**
 * Every declaration in a fixed fence that has no coordinate, given the one it is drawn at.
 *
 * `layoutSketch` places a card with no `x=`/`y=` in a reading-order grid *below* everything that
 * has one, so the moment one card gains a coordinate the others can move — a lone shape grown
 * east with `+` jumped below its own new neighbour. Pinning what is unplaced first, in the same
 * op, is what keeps the drawing the drawing. Only the lines missing a coordinate are touched.
 */
export function pinUnplaced(graph: Graph, laid: LaidOut, body: string): string {
  const lines = body.split("\n");
  const write = (line: number, geom: { x: number; y: number }) => {
    const cur = lines[line - 1];
    if (cur !== undefined) lines[line - 1] = setGeometry(cur, geom);
  };
  for (const g of graph.groups) {
    const box = laid.groups[g.id];
    if (box && (g.x === undefined || g.y === undefined)) write(g.line, fileAt(laid, box, g.parent));
  }
  for (const n of graph.nodes) {
    const box = laid.nodes[n.id];
    if (box && (n.x === undefined || n.y === undefined)) write(n.line, fileAt(laid, box, n.group));
  }
  return lines.join("\n");
}

/**
 * The parsed body of an item whose coordinates are the author's, or `null`.
 *
 * Hand-placed content is a `sketch`, fixed by nature, or any fence opened `layout=fixed`. What
 * makes it a category here is what the item's resize handles mean: the frame is the drawing's
 * extent plus padding, so `w=`/`h=` on the fence move the frame and leave the drawing exactly
 * where it was — the bigger-empty-box defect the ELK diagrams know, back again one
 * layout over. Scaling the drawing is the answer there, and `scaleFixed` below is what a handle
 * commits; `md` and `chart` are `box` too but are not hand-placed, and a frame around them is
 * real.
 *
 * `null` for anything else, and for a body that does not parse clean. A writer here must never
 * produce a body that does not parse — the same bar `loneShape` holds — so one with errors in it
 * is left to the person who has to fix it.
 */
export function fixedGraph(item: Pick<BoardItem, "type" | "body" | "layout">): Graph | null {
  if (item.type !== "sketch" && item.layout !== "fixed") return null;
  const g = parseItem(item);
  if (!g || g.kind !== "graph" || g.diagnostics.some((d) => d.severity === "error")) return null;
  return g;
}

/**
 * Every declaration in this body, scaled about the drawing's origin.
 *
 * What a resize handle means on hand-placed content, as draw.io and Excalidraw draw it for a
 * multi-shape selection: a corner pull scales both axes, a side pull one, and the drawing comes
 * out the same picture at the new size. `layoutSketch` is a passthrough that honours each node's
 * own coordinates and never reads the fence's box, so `w=`/`h=` on the fence alone are the frame
 * moving and nothing else — the same claim `detach()` makes about `layout=fixed` on its way in,
 * now read in the other direction: the coordinates in the file are the drawing, so a frame the
 * author pulled wider has to mean the coordinates went with it.
 *
 * Two consequences are accepted rather than fixed, because both are the gesture doing what it
 * says:
 *
 * - **The text inside a shape does not scale.** `layout/size.ts` has no font-scale concept and a
 *   weight or a size is a theme token, so a shape pulled to twice the width holds its label at
 *   the size it had.
 * - **A per-axis pull makes a square shape non-square.** `size.ts` keeps a circle, a triangle, a
 *   star, a pentagon or an octagon square only while exactly one of `w=`/`h=` is written; writing
 *   both — which is what scaling one axis means — is the pull deciding they are different now.
 *
 * **The factors are clamped, never the individual child.** Flooring one box at a minimum while
 * its neighbours keep shrinking is a drawing quietly changing shape — spacing that was even stops
 * being even — so the floor applies to the whole drawing: the scale is never so small that the
 * smallest box in it goes under one grid step.
 *
 * **Coordinates are relative to the container**, because that is how `layoutSketch` reads them,
 * and scaling the whole plane about the origin scales a relative coordinate by the same factor —
 * so the offset from the parent group's origin is simply multiplied, exactly as `detach()`'s
 * `at()` produces the numbers being scaled here.
 *
 * **A dimension is written only on the axis that scaled.** `sx === 1` means neither `x` nor `w`
 * goes on any line: a side pull must not pin the other axis, because a node with no `w=` today
 * takes its width from its text and writing one would freeze it for good.
 */
export function scaleFixed(graph: Graph, laid: LaidOut, body: string, sx: number, sy: number, grid: number): string {
  const boxes = [...Object.values(laid.nodes), ...Object.values(laid.groups)];
  /* Nothing drawn, nothing to scale — and the caller falls back to the plain box write before it
     gets here, so this is only the empty-collection guard rather than the gesture's answer. */
  if (boxes.length === 0) return body;
  /* A laid box is never smaller than a grid step in practice; the `> 0` guard is what keeps a
     pathological one from sending the factor to infinity and writing a body that does not parse. */
  const minW = Math.min(...boxes.map((b) => b.w));
  const minH = Math.min(...boxes.map((b) => b.h));
  if (minW > 0) sx = Math.max(sx, grid / minW);
  if (minH > 0) sy = Math.max(sy, grid / minH);

  const lines = body.split("\n");
  const write = (line: number, geom: Parameters<typeof setGeometry>[1]) => {
    const cur = lines[line - 1];
    if (cur !== undefined) lines[line - 1] = setGeometry(cur, geom);
  };

  /* Geometry for one box, on the axes that moved. A child's coordinate is relative to its
     container's origin — the same reading `layoutSketch` gives the file on the way back in — so
     scaling about the diagram's origin scales `(box - origin)` by the factor and nothing needs
     re-deriving. A group scales its own box as well as its origin: its children are written
     against the origin it will have when the file is read again, which is this same arithmetic. */
  const geom = (box: LaidBox, parent: string | undefined): Parameters<typeof setGeometry>[1] => {
    const o = parent ? laid.groups[parent] : undefined;
    return {
      ...(sx !== 1 ? { x: (box.x - (o?.x ?? 0)) * sx, w: box.w * sx } : {}),
      ...(sy !== 1 ? { y: (box.y - (o?.y ?? 0)) * sy, h: box.h * sy } : {}),
    };
  };

  for (const g of graph.groups) {
    const box = laid.groups[g.id];
    if (box) write(g.line, geom(box, g.parent));
  }
  /* The size is the whole point here, unlike in `detach()`, which writes no `w`/`h` on a node
     because there the size is its text: a scaled drawing is one where every box is the author's
     on both axes. */
  for (const n of graph.nodes) {
    const box = laid.nodes[n.id];
    if (box) write(n.line, geom(box, n.group));
  }
  return lines.join("\n");
}
