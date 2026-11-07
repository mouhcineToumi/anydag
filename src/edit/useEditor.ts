import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";

import type { AttrValue } from "@/board/attrs";
import { freshId, itemsToText, textToItems } from "@/board/clipboard";
import { importKind, openId, sealId } from "@/board/envelope";
import { rebind } from "@/dsl/rebind";
import type { Placement } from "@/board/flow";
import { appendPart, fileCard, isFragment, NOTE_CARD, noteCard, render, type Component } from "@/board/library";
import { uploadFile } from "@/files/upload";
import { saveWithFiles } from "@/files/exportBundle";
import { csvTab } from "@/table/csv";
import { tableFromCsv } from "@/table/write";
import { componentFrontmatter } from "@/board/library/saved";
import { reorderPages } from "@/board/pages";
import type { MetaOp, NewItem, PatchOp, SetOp } from "@/board/patch";
import { TEMPLATES } from "@/board/templates";
import { tidy as tidyBoxes, type TidyBox } from "@/board/tidy";
import {
  isDiagramType,
  isLinkType,
  resizeOfItem,
  type Board,
  type BoardItem,
  type BoardPage,
  type DiagramType,
  type ItemType,
} from "@/board/types";
import type { BoardHandle, FileKind } from "@/board/useBoard";
import { DRAG_SLOP, type Point, type Rect } from "@/canvas/geometry";
import type { Tool, ViewportHandle } from "@/canvas/Viewport";

import { boardToSvg, itemToSvg } from "@/export/svg";
import { svgToPng } from "@/export/png";
import { fileStem, saveFile } from "@/export/save";
import { bindingFor, CHORD_MS, LEADER_CODE, WHICHKEY_MS, type Command } from "@/edit/bindings";

import { renameItemId } from "@/board/rename";
import { parseChart } from "@/dsl/chart";
import { declaredAt, declaredOn } from "@/dsl/declared";
import { hasGraph, parseDiagram } from "@/dsl/parse";
import { removeEdge, removeNode, replaceLine, setEdgeLabel, setLinkVia, setTitle, stripCoords } from "@/dsl/restate";

import { History } from "./history";
import {
  appendLink,
  connectSvg,
  connectable,
  handleAt,
  linkStatement,
  removeLinkLine,
  targetAt,
  type Side as ConnectSide,
  type Target,
} from "./connect";
import {
  appendEdge,
  clearSpot,
  boxesOf,
  cornerOf,
  frameShift,
  detach as detachBody,
  fileAt,
  fixedGraph,
  freshNodeId,
  grow,
  growable,
  loneShape,
  pinUnplaced,
  resizeShape,
  scaleFixed,
  soleCard,
  type LaidOut,
} from "./build";
import { columnOf, dragMode, dropEdit, type Over } from "./drag";
import { duplicateStatement, edgeAt, edgeLabelOf, type PickedEdge, type PickedNode } from "./pick";
import { guidesToSvg, snapBox, union, type Box } from "./snap";
import { framesOf, groupOf, memberOf, memberOps, minimum, paintOf, place as placeMember, type Member } from "./resize";
import { inkStatement } from "./ink";
import { placedWidth, storedWidth } from "./image";
import { replacement, requestDiagram, type Draft, type Generated } from "./generate";
import { type RewriteOutcome, requestRewrite, rewriteContext, rewriteOps } from "./rewrite";
import { toggleAssistant } from "@/assistant/panelState";
import { lost } from "@/board/survive";
import { refuseLocked } from "@/settings/lock";
import { INSPECTOR_MODE, readPref, writePref } from "@/settings/prefs";
import { readSettings } from "@/settings/store";
import { track } from "@/telemetry/client";

/**
 * Everything a person can do to the items on a board, in one place.
 *
 * The board file is the document and every one of these is a write to it: a drag is an `x=`/`y=`,
 * a delete is a block gone, a paste is a block appended, typing in the editor is a body replaced.
 * `useBoard` does the writing and refuses a stale one; `History` remembers what to put back. This
 * hook is the part in between — what is selected, which gesture is in progress, and how a key or a
 * pointer turns into ops.
 *
 * Two rules keep it fast on a board of forty items:
 *
 * - **Gestures paint; only their end reaches React.** A drag writes `transform` on every selected
 *   item and commits once on release, the same split `Viewport` uses for pan and zoom. A marquee
 *   is a painted rectangle. The only state here that changes mid-gesture is nothing.
 * - **`ctl` is one object with a stable identity.** `Item` is memoised and gets it as a prop; the
 *   methods read the latest board, places and selection through refs, so no item re-renders
 *   because a callback was recreated.
 *
 * Pinning is the one place an edit is larger than it looks. `flow.ts` places unpinned items in
 * rows below the lowest pinned one, so pinning the first item on an all-unpinned board — by moving
 * it, or by pasting something next to it — would shift every other item. Every op that pins
 * therefore pins the whole visible set at the positions it already occupies, once.
 */

/** A form control owns its own keys; so does anything a person is typing into. */
export const typing = (t: EventTarget | null): boolean =>
  t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(t.tagName));

/** The leader's commands that only go somewhere or show something — what a chord may still do while
    the app is locked. The pen, a note, a prompt card, the library, links and tidy all make
    or move something, and are refused. */
const READS: ReadonlySet<Command> = new Set(["select", "hand", "boards", "help"]);

/** ELK snaps to the theme's grid; a hand-placed item should land on the same one. */
const snap = (v: number, grid: number) => Math.round(v / grid) * grid;
/** How wide a placed card is when nothing says (`noteCard`'s width), for spacing a row of them. */
const PLACED_W = 360;

/**
 * Move a set of items so their top-left corner lands at `at`, keeping the arrangement between them.
 *
 * A paste and a stamped component are the same problem: several items with positions of their own,
 * which have to arrive together somewhere else without losing their shape. Items carrying no
 * position stack below, a grid step apart, because there is nothing else to say about where they go.
 */
function anchorAt(items: NewItem[], at: Point, grid: number): NewItem[] {
  let minX = Infinity;
  let minY = Infinity;
  for (const it of items) {
    if (typeof it.attrs.x === "number" && typeof it.attrs.y === "number") {
      minX = Math.min(minX, it.attrs.x);
      minY = Math.min(minY, it.attrs.y);
    }
  }
  let stackY = 0;
  for (const it of items) {
    if (typeof it.attrs.x === "number" && typeof it.attrs.y === "number") {
      it.attrs.x = it.attrs.x - minX + at.x;
      it.attrs.y = it.attrs.y - minY + at.y;
    } else {
      it.attrs.x = at.x;
      it.attrs.y = at.y + stackY;
      stackY += grid * 10;
    }
  }
  return items;
}

/** How close, on the glass, a guide has to be to take: divided by the zoom to become board units. */
const SNAP_PX = 8;

/**
 * How long a run of arrow presses may go unwritten.
 *
 * The keyup is what normally writes a nudge, so this is only ever reached by a run that loses its
 * keyup — a window blurred with the key held. Long enough that an ordinary OS repeat (about 33ms)
 * never trips it, short enough that nothing stays unwritten for a noticeable time.
 */
const NUDGE_SETTLE = 400;

/**
 * Smart guides during a drag.
 *
 * The box the pointer proposes is offered to `snapBox` against every box on the page that is not
 * moving; an axis with a guide near takes it, an axis without falls back to the grid — guides
 * outrank the grid, as they do in draw.io, because a centre between two cards is rarely on it.
 * Alt held turns the guides off. The lines are painted into the layer's `<svg>`; nothing here is
 * React.
 */
function guided(
  proposed: Box,
  others: Box[],
  zoom: number,
  grid: number,
  overlay: SVGElement | null,
  off: boolean,
): { x: number; y: number } {
  const s = off ? null : snapBox(proposed, others, SNAP_PX / zoom);
  if (overlay) overlay.innerHTML = s ? guidesToSvg(s.guides, (grid / 2) / zoom) : "";
  return {
    x: s?.x ?? snap(proposed.x, grid),
    y: s?.y ?? snap(proposed.y, grid),
  };
}

/**
 * Tell the link layer where the moving items are now.
 *
 * An event rather than a prop, for the same reason `data-pan` is an attribute: `useEditor` does not
 * render `BoardEdges` and threading a callback down through `App` for a gesture would put a new
 * identity on every render of a memoised tree. `dag:tidy` already works this way.
 */
const previewLinks = (moves: readonly (readonly [string, { x: number; y: number }])[] | null) =>
  document.dispatchEvent(
    new CustomEvent("dag:links-preview", { detail: { moves: moves === null ? null : new Map(moves) } }),
  );

const clearGuides = (overlay: SVGElement | null) => {
  if (overlay) overlay.innerHTML = "";
};

/** Whatever a `Placement` says, with what a gesture said more recently on top. */
type Override = Partial<Pick<Placement, "x" | "y" | "w" | "h">>;

/** Which handle a resize started on: a compass point, `n` for the top edge, `se` for a corner. */
export type Dir = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

/** Which half of the editor panel is showing: the controls, or the text behind them. */
type InspectorMode = "props" | "source";

/**
 * What a double-click landed on inside a diagram, and therefore what the inline input renames.
 *
 * Four things carry a name a person would want to retype in place, and they are not one thing:
 * a card's title, a container's label, a band's owner, and the words on an edge. The writer differs
 * (`setTitle` against `setEdgeLabel`) and so does where the input goes, so the kind travels with
 * the id rather than being worked out twice.
 */
export interface Renaming {
  item: string;
  id: string;
  what: "node" | "group" | "lane" | "edge";
  /** Which arrow along a chain, for an edge. Every edge of `a --> b --> c` is on one line. */
  seg: number;
  /** What is in the box when it opens — read once, from the file, at the moment of the gesture. */
  text: string;
}

/**
 * What the pointer found under a double-click: the innermost nameable thing, or nothing.
 *
 * `data-dag-title-of` is the fifth selector and the only one that is a *label* rather than the thing
 * it names. A chart draws every label after every mark, because SVG has no z-index and a wedge's
 * own share has to sit over the wedge beside it — so a legend row and a wedge's label are outside
 * the `<g>` that carries the id, and nesting cannot answer for them.
 */
function nameableUnder(el: Element | null): { id: string; what: Renaming["what"] } | null {
  const hit = el?.closest<HTMLElement>(
    "[data-dag-node],[data-dag-group],[data-dag-lane],[data-dag-edge],[data-dag-title-of]",
  );
  if (!hit) return null;
  const d = hit.dataset;
  if (d.dagTitleOf) return { id: d.dagTitleOf, what: "node" };
  if (d.dagNode) return { id: d.dagNode, what: "node" };
  if (d.dagGroup) return { id: d.dagGroup, what: "group" };
  if (d.dagLane) return { id: d.dagLane, what: "lane" };
  if (d.dagEdge) return { id: d.dagEdge, what: "edge" };
  return null;
}

/* Which half of the panel is showing. A preference, so it lives with the other four in
   `settings/prefs.ts` — and since accounts, follows the person rather than the machine. */

function storedMode(): InspectorMode {
  return readPref(INSPECTOR_MODE) === "source" ? "source" : "props";
}

/** The methods `Item` calls. One object, never recreated. */
export interface EditorCtl {
  /**
   * A press on an item. Returns false when the press is a pan and should bubble to the viewport.
   *
   * `node` is the card under the pointer, when the press landed on one — read out of the DOM by
   * `Item`, never here: the same argument `connect` makes, and the reason `press` stays ignorant
   * of what a diagram looks like.
   */
  press(id: string, e: ReactPointerEvent, el: HTMLDivElement, node?: string): boolean;
  /** Pick one of this item's own edges, by the id the parser gave it. */
  pickEdge(item: string, id: string | null): void;
  /** A press on the resize handle. */
  resize(id: string, e: ReactPointerEvent, el: HTMLDivElement, dir: Dir): void;
  /**
   * A press on one of the eight handles on a group's dashed box: every member resized
   * together, about the far side, in one write. `box` is the dashed box the handle sits on.
   */
  resizeGroup(name: string, e: ReactPointerEvent, box: HTMLElement, dir: Dir): void;
  /**
   * A press on a connect handle: pull a link out of this item's side, out of a picked card's, or
   * out of a selected group's.
   *
   * `from` says which, when it is not the item. A card carries its id and its box in *board*
   * coordinates, because the line is painted into the layer and the layer's origin is the board's.
   * A group carries only a box, and `id` is then the group's **name** rather than an item id —
   * which is exactly what `LinkEnd` means by a group end, so nothing downstream needs a case for
   * it. Absent, the source is the whole item and the box is its placement. The gesture is
   * identical in all three, which is the point of one method rather than three.
   */
  connect(
    id: string,
    e: ReactPointerEvent,
    el: HTMLElement,
    side: ConnectSide,
    from?: { node: string; box: Box } | { group: true; box: Box },
  ): void;
  /** A press on a `+` handle: grow a second card out of the picked one, on that side. */
  grow(id: string, e: ReactPointerEvent, el: HTMLElement, side: ConnectSide): void;
  /**
   * A press on the bend handle at a picked link's middle: pull the line through a point.
   *
   * Board links only. The point is a board coordinate, written `via="320,180"` on the statement,
   * and it is the author's rather than the router's — so an edge that carries one takes neither
   * the bow, nor the dogleg, nor the side arc, all of which exist to guess at what somebody has
   * now said outright.
   */
  bendLink(id: string, e: ReactPointerEvent<SVGCircleElement>): void;
  /** The same handle, double-clicked: the bend comes off and the router has the line back. */
  straightenLink(id: string): void;
  /** A double-click on something nameable inside a diagram: open the inline input over it. */
  rename(id: string, el: Element | null): boolean;
  /**
   * Open the editor on this item, and — when the gesture landed on a card inside a diagram — put
   * the caret on the line that declares it.
   */
  open(id: string, node?: string): void;
  remove(ids?: string[]): void;
  duplicate(ids?: string[]): void;
  /** Bring to front / send to back (`]` / `[`, and the chip): one `MoveOp` per item, one commit. */
  bringToFront(ids?: string[]): void;
  sendToBack(ids?: string[]): void;
  /**
   * A prompt card's own edits: its text under the key the panel types under, so a burst of typing on
   * the card is one thing to undo, and the type it asks for.
   */
  write(id: string, next: { body?: string; as?: DiagramType | null }): Promise<void>;
  /**
   * Ask the dev server for the diagram a prompt card describes. A clean answer is put where the card
   * is before this resolves, and the card is gone; anything else comes back for the card to show.
   * The model is whichever the settings card names, read at the moment of the press.
   */
  generate(id: string, req: { prompt: string; as?: DiagramType }, signal?: AbortSignal): Promise<Generated>;
  /** Put a draft where the card is whatever is wrong with it — the card's "Insert anyway". */
  accept(id: string, draft: Draft): Promise<boolean>;
  /**
   * Ask the model to rewrite the selected items, and bring the answer back **without committing
   * anything** — an answer lands only when somebody accepts it. The model is whichever the settings
   * card names, read at the moment of the press, exactly as `generate` reads it.
   */
  rewrite(ids: string[], prompt: string, signal?: AbortSignal): Promise<RewriteOutcome>;
  /**
   * Land an accepted rewrite: one `SetOp` on the item as the board holds it *now* — the answer took
   * seconds, and in that time the item may have been moved or deleted; a deleted item is somebody
   * changing their mind, and the draft is dropped rather than put somewhere no longer is. One
   * commit, one undo entry.
   */
  applyRewrite(id: string, draft: Draft): Promise<boolean>;
}

/**
 * A request to put the panel's caret somewhere: on the line declaring a card (`node`), or on a line
 * of the body (`line`, 1-based, relative to the body as `declaredAt` counts). `n` makes it a request
 * rather than a fact — asking for the same place twice has to move the caret back.
 */
interface Reveal {
  id: string;
  node?: string;
  line?: number;
  n: number;
}

export interface Editor {
  enabled: boolean;
  /** Whether a leader chord has been open long enough to be worth naming — the which-key overlay. */
  chord: boolean;
  selected: ReadonlySet<string>;
  /** The item open in the editor panel, if any. */
  editing: string | null;
  /** A pending "show me this node's line", or this line, for the open item — see `open`/`openAt`. */
  reveal: Reveal | null;
  tool: Tool;
  setTool(tool: Tool): void;
  ctl: EditorCtl;
  /** Placements with the in-flight gesture's result on top. */
  places: Map<string, Placement>;
  canUndo: boolean;
  canRedo: boolean;
  undo(): void;
  redo(): void;
  /** Add a fresh item of a type, at a board point or the middle of the view. */
  add(type: ItemType, at?: Point): void;
  /**
   * Open the page's `edges` fence — the links between items — in the editor panel, making one if
   * the page has none. It is the only item with no place on the paper, so there is nothing to
   * click and this is the only way to reach it.
   */
  links(): void;
  /**
   * Open the panel on an item's source with the caret on one line of its body — the problems
   * dock's "show me", where the thing to look at is a line rather than a card.
   */
  openAt(id: string, line: number): void;
  /** The link picked on the canvas, if any. Delete removes it; a click anywhere else clears it. */
  pickedLink: string | null;
  pickLink(id: string | null): void;
  /**
   * The card, group or lane picked *inside* a diagram, and the edge segment beside it.
   *
   * Kept out of `selected` for the reason `pickedLink` is: neither can be marquee'd, grouped,
   * copied or moved as an item, and widening the selection to hold two kinds of thing would put a
   * `typeof` in every place that reads it. At most one of the three is ever set.
   */
  pickedNode: PickedNode | null;
  pickedEdge: PickedEdge | null;
  pickNode(item: string, node: string | null): void;
  pickEdge(item: string, id: string | null): void;
  /**
   * What Delete and ctrl+D do, as a button: the pick first, then the selection.
   *
   * The selection toolbar's two buttons name those keys in their tooltips, and a button that names a
   * key has to do what the key does. They used to take the whole selection whatever was picked —
   * so with one card picked out of a diagram, the key deleted the card and the button beside it
   * deleted the diagram.
   */
  removeSelection(): void;
  duplicateSelection(): void;
  /**
   * Which layer the layout put a card in, counted off the drawing — the number `col=` would pin.
   *
   * A DOM read per call, like `laidOutIn` itself: the layout's answer exists only on the page. The
   * panel offers it and never writes it, which is the whole distinction between an automatic layout
   * a person is nudging and one they have detached.
   */
  columnOf(item: string, node: string): number | null;
  /**
   * The caret as a feeder: whatever `line` declares becomes the pick.
   *
   * `body` is the panel's draft when there is one, because what a person is looking at may not
   * have been written to the file yet — this is the one caller that knows more than the board.
   */
  pickFromLine(item: string, line: number, body?: string): void;
  /** Which half of the editor panel is showing. Remembered across sessions, not in the URL. */
  mode: InspectorMode;
  setMode(mode: InspectorMode): void;
  /**
   * The inline rename standing over a card, a container, a band or an edge label.
   *
   * Its own state rather than part of the pick, because the two answer different questions: a pick
   * is what the panel and the keys act on and it survives everything short of Escape, while this is
   * a modal little box that exists for one gesture. `commitRename` writes through the same
   * `body:<id>` key the panel types under, so a rename and the keystrokes around it are one undo.
   */
  renaming: Renaming | null;
  commitRename(text: string): void;
  cancelRename(): void;
  /**
   * Rename an item everywhere on the board — its own fence line and every `edges` reference.
   *
   * Not a patch op: `renameItemId` rewrites spans all over the file, so it goes through `put`, the
   * route undo already uses, under the same `base` rule. Resolves to a message when it could not
   * be done — a name somebody else has, a file that moved underneath — and to `null` when it was.
   */
  renameItem(id: string, to: string): Promise<string | null>;
  /**
   * The two declared conversions between an automatic layout and the author's own coordinates.
   *
   * `detach` writes `layout=fixed` **and** every card's `x=`/`y=` as the layout last placed it, in
   * one commit: the attribute alone would hand the fence to `layoutSketch`, which finds nothing
   * placed and grids the cards in reading order. `relayout` is the inverse — every `x=`/`y=` gone
   * and `layout=` with them — and for a `sketch`, which is fixed by nature, it re-grids instead.
   */
  detach(id: string): void;
  relayout(id: string): void;
  /** Put a library component on the board, at a board point or the middle of the view. */
  place(component: Component, at?: Point): void;
  /**
   * Put several down side by side from a board point, in one write and one undo entry, selected —
   * the cards a selection dragged out of the sidebar lands as.
   */
  placeAll(components: Component[], at?: Point): void;
  /** Append a library part to a diagram of its type. False when the item cannot take it. */
  dropPart(component: Component, id: string): boolean;
  /** Board coordinates of a client point — where a drop lands. */
  toBoard(clientX: number, clientY: number): Point;
  /**
   * Save the selection — or, with nothing selected, the whole page — as a reusable component.
   *
   * It lands in `boards/components/` as a board of its own, so it is openable, editable and in
   * git, and it shows up in the library panel of every open board. Resolves to the name it was
   * given, or `null` when there was nothing to save.
   */
  saveAsComponent(name?: string): Promise<string | null>;
  /**
   * The pages of this board: made, renamed, removed, and what sits on which.
   *
   * A page was declared in frontmatter and nowhere else, so the tabs could show them and nothing
   * could make one. The whole set travels on every write because `parseBoard` derives the list
   * from what the items use when the frontmatter declares none — writing only the new page would
   * silently drop the ones it had inferred.
   */
  pages: {
    add(): void;
    rename(id: string, name: string): void;
    remove(id: string): void;
    /** Move items — the selection by default — onto a page. */
    moveTo(id: string, ids?: string[]): void;
    /**
     * Move a page in front of another, or to the end (`before === null`).
     *
     * Only the order of the frontmatter changes — no item is touched, because an item names its
     * page by id and the ids are not renumbered. A move that changes nothing writes nothing.
     */
    reorder(id: string, before: string | null): void;
  };
  /** Put the selected items in one group (ctrl+G), or take them out of theirs (ctrl+shift+G). */
  group(): void;
  ungroup(): void;
  /**
   * Tidy up (T): re-place the board — or, with two or more selected, the selection — so rows,
   * columns and grids are exact and every gap is the board's. Resolves to how many items moved;
   * a board that is already tidy is left alone, and nothing is written. `dry` only counts.
   */
  tidy(ids?: string[], dry?: boolean): Promise<number>;
  /**
   * Save the board — or, with `ids`, those items — as one SVG, a PNG at 2×, or the board file
   * itself. Resolves once the browser has been handed the file; rejects with a reason a person
   * can read.
   */
  exportAs(kind: "svg" | "png" | "md", ids?: string[]): Promise<void>;
  /**
   * Files a person dropped or picked: images become assets, text becomes items at `at`, and a
   * whole board file becomes a new board, which is then opened.
   */
  importFiles(files: File[], at?: Point): Promise<void>;
  select(ids: string[]): void;
  selectAll(): void;
  clear(): void;
  close(): void;
  /** The editor panel's writes: coalesced in the history under the item's key. */
  setBody(id: string, body: string): void;
  /**
   * Change several things about an item at once — its type, its body, its fence attributes.
   *
   * One op, so one history entry: converting a Mermaid paste changes all three and a person
   * pressing ctrl+Z means "put the Mermaid back", not "put the Mermaid back three times".
   */
  replace(id: string, next: { type?: ItemType; body?: string; attrs?: Record<string, AttrValue | null> }): void;
  setAttrs(id: string, attrs: Record<string, AttrValue | null>): void;
  onMarquee(rect: Rect, additive: boolean): void;
  onPaperClick(): void;
  onPaperDoubleClick(at: Point): void;
  /**
   * A stroke was drawn with the pen: one commit, one new one-node `sketch` item, one undo entry.
   *
   * The points arrive raw, in board coordinates, from `Viewport`; `src/edit/ink.ts` turns them
   * into the statement.
   */
  onInk(points: Point[]): void;
}

interface Options {
  board: Board | null;
  page: string;
  /** What the flow decided, before any gesture. */
  laidOut: Map<string, Placement>;
  handle: BoardHandle;
  viewport: RefObject<ViewportHandle>;
  grid: number;
  /** False under `?snapshot=1`, where the page is being photographed rather than used. */
  enabled: boolean;
  /**
   * The app is locked: read only. Unlike `enabled` it keeps the keys and the selection —
   * search, help, Settings, Escape, select, copy and a pan all still work — and refuses, saying so,
   * everything that would write: a gesture is never armed, a key that edits is answered with the
   * notice, and `commit`, `put` and every `/__board/create` underneath refuse as a floor.
   */
  locked?: boolean;
  /** The `L` key: show or hide the library panel. */
  onLibrary?(): void;
  /** Open it, rather than toggle it — how a saved component shows itself. */
  onLibraryOpen?(): void;
  /** The `?` key: show or hide the shortcut sheet. */
  onHelp?(): void;
  /** `space O`: the board browser — which board is open is `App`'s, not the editor's. */
  onBoards?(): void;
  /* Settings — the app's own behaviour, opened with ctrl+, and closed by the same Escape chain. */
  onSettings?(): void;
  /** Open another file — the board, note or quiz an import just made. Absent `kind` is a board. */
  onOpenBoard?(name: string, kind?: FileKind): void;
  /** Show a page — the one an add just made, or the survivor after a delete. */
  onOpenPage?(id: string): void;
}

export function useEditor({
  board,
  page,
  laidOut,
  handle,
  viewport,
  grid,
  enabled,
  locked = false,
  onLibrary,
  onLibraryOpen,
  onHelp,
  onBoards,
  onSettings,
  onOpenBoard,
  onOpenPage,
}: Options): Editor {
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const [editing, setEditing] = useState<string | null>(null);
  /*
   * A request to put the caret on one node's line, once.
   *
   * `n` is what makes it a request rather than a fact: double-clicking the same card twice must
   * move the caret back, and a value equal to the last one would be indistinguishable from no
   * request at all. The panel acts on it and nothing else reads it.
   */
  const [reveal, setReveal] = useState<Reveal | null>(null);
  /* The link picked on the canvas. Not part of `selected`: a link is not an item — it cannot be
     moved, resized, grouped or copied — and widening the selection to hold two kinds of thing
     would put a `typeof` in every place that reads it. */
  const [pickedLink, setPickedLink] = useState<string | null>(null);
  const pickedLinkRef = useRef<string | null>(null);
  pickedLinkRef.current = pickedLink;
  const pickLink = useCallback((id: string | null) => {
    setPickedLink(id);
    if (id !== null) setSelected(new Set());
  }, []);
  /* The thing picked inside a diagram, on the same argument one line up. A node pick remembers the
     id and derives the line; an edge has no author id, so it remembers the line and the segment.
     See `src/edit/pick.ts`. */
  const [pickedNode, setPickedNode] = useState<PickedNode | null>(null);
  const pickedNodeRef = useRef<PickedNode | null>(null);
  pickedNodeRef.current = pickedNode;
  const [pickedEdge, setPickedEdge] = useState<PickedEdge | null>(null);
  const pickedEdgeRef = useRef<PickedEdge | null>(null);
  pickedEdgeRef.current = pickedEdge;
  const [renaming, setRenaming] = useState<Renaming | null>(null);
  const [mode, setModeState] = useState<InspectorMode>(storedMode);
  const [tool, setTool] = useState<Tool>("select");

  /*
   * The leader chord has two answers, and they are deliberately not the same one.
   *
   * `chordRef` is whether a chord is *live* — set the instant Space goes down, because the letter
   * after it may arrive in the same tens of milliseconds and a person who knows the chord must
   * never be made to wait for it. It is a ref because the key handler lives in an effect with a
   * dependency list, and a chord opened by one press has to be visible to the next press without
   * re-running that effect.
   *
   * `chord` is whether the which-key overlay is *shown*, which happens `WHICHKEY_MS` later and only
   * if the chord is still open. That is the whole bargain: somebody who knows it never sees it, and
   * somebody who does not gets the set without having to know the sheet exists. It is React state
   * because it is drawn — once per gesture rather than once per frame, so it is no business of the
   * paint/render split.
   */
  const [chord, setChord] = useState(false);
  const chordRef = useRef(false);
  /* The keys read this rather than the state: the key handler's effect has no reason to re-register
     because the tool changed, and a stale `tool` there would drop the pen one Escape late. */
  const toolRef = useRef<Tool>(tool);
  toolRef.current = tool;
  const [overrides, setOverrides] = useState<Map<string, Override>>(new Map());
  const [tick, setTick] = useState(0);

  const history = useRef(new History()).current;

  /* Everything a gesture or a key reads, as of *now* rather than as of the render that created
     the handler. `ctl` never changes identity, so it cannot close over state. */
  const boardRef = useRef(board);
  boardRef.current = board;
  const pageRef = useRef(page);
  pageRef.current = page;
  const laidOutRef = useRef(laidOut);
  laidOutRef.current = laidOut;
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const editingRef = useRef(editing);
  editingRef.current = editing;
  const handleRef = useRef(handle);
  handleRef.current = handle;
  const gridRef = useRef(grid);
  gridRef.current = grid;
  /* Read by every write at the moment it would happen, so a lock switched mid-gesture still holds. */
  const lockedRef = useRef(locked);
  lockedRef.current = locked;

  const places = useMemo(() => {
    if (overrides.size === 0) return laidOut;
    const out = new Map(laidOut);
    for (const [id, o] of overrides) {
      const was = out.get(id);
      if (was) out.set(id, { ...was, ...o, pinned: true });
    }
    return out;
  }, [laidOut, overrides]);
  const placesRef = useRef(places);
  placesRef.current = places;

  /* Drop an override the moment the file says the same thing, so a later rewrite by Claude is never
     fighting a stale local value. */
  useEffect(() => {
    setOverrides((prev) => {
      if (prev.size === 0) return prev;
      const next = new Map(prev);
      for (const [id, o] of prev) {
        const p = laidOut.get(id);
        if (!p) continue;
        const same = (a: number | undefined, b: number) => a === undefined || Math.abs(a - b) < 0.5;
        if (same(o.x, p.x) && same(o.y, p.y) && same(o.w, p.w) && same(o.h, p.h)) next.delete(id);
      }
      return next.size === prev.size ? prev : next;
    });
  }, [laidOut]);

  /* A selection can only name items that exist. Claude deleting one, or the board changing under
     the page, must not leave a ghost in the set. */
  useEffect(() => {
    if (!board) return;
    const ids = new Set(board.items.filter((it) => it.page === page && !it.hidden).map((it) => it.id));
    setSelected((prev) => {
      const next = new Set([...prev].filter((id) => ids.has(id)));
      return next.size === prev.size ? prev : next;
    });
    setEditing((prev) => (prev && !ids.has(prev) ? null : prev));
  }, [board, page]);

  const visible = useCallback((): BoardItem[] => {
    const b = boardRef.current;
    return b ? b.items.filter((it) => it.page === pageRef.current && !it.hidden) : [];
  }, []);

  /**
   * The ids, plus every other member of any group one of them is in.
   *
   * A group is a `group=` attribute shared by its members, and this is the whole of its meaning:
   * whatever selects one member selects them all, and everything else — moving, deleting,
   * copying — already acts on the selection.
   */
  const withGroups = useCallback(
    (ids: Iterable<string>): Set<string> => {
      const out = new Set(ids);
      const items = visible();
      const groups = new Set<string>();
      for (const it of items) if (out.has(it.id) && it.group) groups.add(it.group);
      if (groups.size) for (const it of items) if (it.group && groups.has(it.group)) out.add(it.id);
      return out;
    },
    [visible],
  );

  /* ---- picking, inside a diagram ---- */

  /*
   * Painted, then rendered — the split `Viewport` uses for pan and zoom, for the same reason.
   *
   * A pick has to ring the card in the frame the pointer went down in, and the card belongs to a
   * memoised `Item` that this state deliberately does not reach: giving `Item` a per-node prop
   * would re-render every diagram on the board whenever anybody clicked a card in one of them. So
   * the gesture writes `data-dag-picked` straight onto the element and React state follows for the
   * panel's benefit.
   *
   * It survives a re-render by construction, which is the non-obvious part: `NodeView` does not
   * render this attribute at all, and `Edges` renders it as `undefined` when nothing was passed —
   * and React writes nothing to the DOM when a prop is `undefined` on both sides of a diff. The
   * effect below re-applies it regardless, which is what makes a pick nobody painted work: the
   * caret feeder, and the copy ctrl+D has not laid out yet.
   */
  const painted = useRef<Element | null>(null);
  const paint = useCallback((el: Element | null) => {
    if (painted.current === el) return;
    painted.current?.removeAttribute("data-dag-picked");
    painted.current = el;
    el?.setAttribute("data-dag-picked", "");
  }, []);

  /*
   * After **every** render, deliberately, rather than when the pick changes.
   *
   * The element a pick names may not exist yet when the pick is made. ctrl+D on a card writes the
   * body, and the copy reaches the DOM only once the new source has been parsed and ELK has
   * answered — several renders later, with nothing about the pick changing in between. A dependency
   * list would have to name a signal from inside a memoised, asynchronously laid out subtree, and
   * there is none; one `querySelector` per render of the board is cheaper than inventing one, and
   * gestures paint rather than render, so this does not run sixty times a second.
   */
  useEffect(() => {
    const p = pickedNode ?? pickedEdge;
    if (!p) return paint(null);
    const item = `[data-dag-item="${CSS.escape(p.item)}"]`;
    const find = (sel: string) => document.querySelector(`${item} ${sel}`);
    const q = CSS.escape(pickedNode ? pickedNode.node : pickedEdge!.id);
    paint(
      pickedNode
        ? (find(`[data-dag-node="${q}"]`) ?? find(`[data-dag-group="${q}"]`) ?? find(`[data-dag-lane="${q}"]`))
        : find(`[data-dag-edge="${q}"]`),
    );
  });

  /* A pick lives inside one item and only while that item is what is being worked on. Every way of
     losing it — a press on the paper, another item selected, a marquee, a page, a board — is a
     change to `selected`, so one rule covers all of them. */
  useEffect(() => {
    setPickedNode((p) => (p && !selected.has(p.item) ? null : p));
    setPickedEdge((p) => (p && !selected.has(p.item) ? null : p));
  }, [selected]);

  const clearPick = useCallback(() => {
    setPickedNode(null);
    setPickedEdge(null);
  }, []);

  const pickNode = useCallback((item: string, node: string | null) => {
    setPickedEdge(null);
    setPickedLink(null);
    if (node === null) return setPickedNode(null);
    /* The same card again is the same pick: a caret moving within one statement's line must not
       re-render the panel, and `select` fires on every arrow press. */
    setPickedNode((prev) => (prev && prev.item === item && prev.node === node ? prev : { item, node }));
    setSelected((prev) => (prev.size === 1 && prev.has(item) ? prev : new Set([item])));
  }, []);

  const pickEdge = useCallback((item: string, id: string | null, body?: string) => {
    setPickedNode(null);
    setPickedLink(null);
    if (id === null) return setPickedEdge(null);
    const it = boardRef.current?.items.find((x) => x.id === item);
    const at = it && edgeAt(it.type, body ?? it.body, it.dir, id);
    if (!it || !at) return setPickedEdge(null);
    setPickedEdge((prev) => (prev && prev.item === item && prev.id === id ? prev : { item, id, ...at }));
    /* The hit stroke stops the press reaching `Item`, so nothing else would select the diagram —
       and an unselected item's pick is cleared by the rule above the moment it is set. */
    setSelected((prev) => (prev.size === 1 && prev.has(item) ? prev : new Set([item])));
  }, []);

  const pickFromLine = useCallback(
    (item: string, line: number, body?: string) => {
      const it = boardRef.current?.items.find((x) => x.id === item);
      if (!it) return;
      const at = declaredOn(it.type, body ?? it.body, line, it.dir);
      if (!at) return clearPick();
      if (at.what === "edge") pickEdge(item, at.id, body);
      else pickNode(item, at.id);
    },
    [clearPick, pickEdge, pickNode],
  );

  const setMode = useCallback((next: InspectorMode) => {
    setModeState(next);
    writePref(INSPECTOR_MODE, next);
  }, []);

  /* ---- writing ---- */

  const commit = useCallback(
    async (ops: PatchOp[], key?: string): Promise<boolean> => {
      /* The lock's floor: whatever got this far without being refused stops here. */
      if (lockedRef.current) return refuseLocked();
      const w = await handleRef.current.patch(ops);
      if (!w) {
        setOverrides(new Map());
        return false;
      }
      history.push(w.before, w.after, key);
      setTick((t) => t + 1);
      return true;
    },
    [history],
  );

  /**
   * What Delete and ctrl+D do to a pick.
   *
   * Each is one line of `src/dsl/restate.ts` over the item's body, written through the same key
   * the panel types under (`body:<id>`), so a delete and the keystrokes around it are one thing to
   * undo and there is no second write path to keep in step. A writer that hands the body straight
   * back — the id was not declared here, the line is not an edge — writes nothing at all rather
   * than making an empty history entry.
   */
  const bodyOf = useCallback((id: string): BoardItem | undefined => boardRef.current?.items.find((x) => x.id === id), []);

  const writeBody = useCallback(
    (it: BoardItem, next: string) => {
      if (next !== it.body) void commit([{ id: it.id, body: next }], `body:${it.id}`);
    },
    [commit],
  );

  const removePickedNode = useCallback(() => {
    const p = pickedNodeRef.current;
    const it = p && bodyOf(p.item);
    if (!p || !it) return;
    setPickedNode(null);
    writeBody(it, removeNode(it.body, p.node, { type: it.type, dir: it.dir }));
  }, [bodyOf, writeBody]);

  const removePickedEdge = useCallback(() => {
    const p = pickedEdgeRef.current;
    const it = p && bodyOf(p.item);
    if (!p || !it) return;
    setPickedEdge(null);
    /* The id is what the pick actually holds, so it is asked first; the line it was picked at is
       the fallback for the case `declaredAt` cannot answer — a node happening to be called `e3`. */
    writeBody(it, removeEdge(it.body, declaredAt(it.type, it.body, p.id, it.dir) ?? p.line));
  }, [bodyOf, writeBody]);

  /* ---- renaming in place ---- */

  /**
   * Open the inline input on whatever a double-click landed on.
   *
   * The text it starts with is read from the *file* rather than from the DOM, and that is not
   * fussiness: a card draws `node.title`, which `finalize()` may have filled in, and a group draws
   * a label beside a dot and a sublabel. Reading the element's text would put all of that in the
   * box and then write it back as the title.
   */
  const startRename = useCallback(
    (item: string, at: { id: string; what: Renaming["what"] }): boolean => {
      const it = bodyOf(item);
      if (!it || !isDiagramType(it.type)) return false;
      if (at.what === "edge") {
        const where = edgeAt(it.type, it.body, it.dir, at.id);
        if (!where) return false;
        setPickedNode(null);
        setPickedEdge({ item, id: at.id, ...where });
        setRenaming({
          item,
          id: at.id,
          what: "edge",
          seg: where.seg,
          text: edgeLabelOf(it.body.split("\n")[where.line - 1] ?? "", where.seg),
        });
        return true;
      }
      const line = declaredAt(it.type, it.body, at.id, it.dir);
      if (line === null) return false;
      /* A stroke has no title: `ink` takes none, the renderer draws nothing for one, and a rename
         box over a stroke would be a control that changes nothing. Refused here, where the rename
         is decided — the double-click falls through to opening the item instead. */
      const first = it.body.split("\n")[line - 1]?.trimStart().split(/\s+/)[0];
      if (first === "ink") return false;
      pickNode(item, at.id);
      /* The title as the author wrote it: the first string on the statement, or nothing when the
         declaration carries none — a `state done` whose name is doing the work. A mindmap line is
         its own title, which is why `setTitle` takes the type and why this reads the whole line. */
      const graph = hasGraph(it.type) ? parseDiagram(it.type, it.body, it.dir) : null;
      /* A chart's series and slices carry one too, and they are not in any graph. Without this the
         box would open empty on a picked series — and an empty box writes nothing, so the rename
         would silently do nothing at all. */
      const chart = it.type === "chart" ? parseChart(it.body) : null;
      const found =
        graph?.nodes.find((n) => n.id === at.id)?.title ??
        graph?.groups.find((g) => g.id === at.id)?.label ??
        graph?.lanes.find((l) => l.id === at.id)?.label ??
        [...(chart?.series ?? []), ...(chart?.slices ?? [])].find((x) => x.id === at.id)?.title ??
        "";
      setRenaming({ item, id: at.id, what: at.what, seg: 0, text: found });
      return true;
    },
    [bodyOf, pickNode],
  );

  const cancelRename = useCallback(() => setRenaming(null), []);

  const commitRename = useCallback(
    (text: string) => {
      const r = renaming;
      setRenaming(null);
      const it = r && bodyOf(r.item);
      if (!r || !it) return;
      const trimmed = text.trim();
      const line = declaredAt(it.type, it.body, r.id, it.dir);
      if (line === null) return;
      const src = it.body.split("\n")[line - 1] ?? "";
      /* An empty box on a *label* means "take the label off", which the grammar can say. An empty
         box on a card does not: a nameless card would draw as nothing, and a mindmap topic *is*
         its line, so clearing it would leave a blank line where a statement was. Emptying a title
         is what the panel's Title field is for, where it is a deliberate act rather than a slip.
         A figure is the exception on the card side: its title is a caption under a
         picture, the picture is still there with none, and its text is optional. */
      const caption = r.what === "node" && src.trimStart().split(/\s+/)[0] === "figure";
      if (trimmed === "" && r.what !== "edge" && !caption) return;
      const next =
        r.what === "edge" ? setEdgeLabel(src, trimmed || null, r.seg) : setTitle(src, trimmed || null, it.type);
      writeBody(it, replaceLine(it.body, line, next));
    },
    [bodyOf, renaming, writeBody],
  );

  /* A rename belongs to one thing inside one item; anything that lets go of the pick lets go of it
     too, which is the same one rule that already covers the paper, a marquee, a page and a board. */
  useEffect(() => {
    setRenaming((r) => (r && !selected.has(r.item) ? null : r));
  }, [selected]);

  const duplicatePickedNode = useCallback(() => {
    const p = pickedNodeRef.current;
    const it = p && bodyOf(p.item);
    if (!p || !it) return;
    const made = duplicateStatement(it.type, it.body, p.node, it.dir);
    if (!made) return;
    setPickedNode({ item: it.id, node: made.id });
    writeBody(it, made.body);
  }, [bodyOf, writeBody]);

  /** Ops that pin every unpinned visible item where it already is — see the note at the top. */
  const pins = useCallback(
    (except: Iterable<string>): SetOp[] => {
      const skip = new Set(except);
      const out: SetOp[] = [];
      for (const it of visible()) {
        if (skip.has(it.id) || it.x !== undefined || it.y !== undefined) continue;
        const p = laidOutRef.current.get(it.id);
        if (p) out.push({ id: it.id, attrs: { x: Math.round(p.x), y: Math.round(p.y) } });
      }
      return out;
    },
    [visible],
  );

  /**
   * A body write that moved a fixed drawing's top-left corner, and the fence moved with it.
   *
   * `layoutSketch` draws the corner at the frame's origin whatever the file says it is, so a write
   * that moves it — the leftmost box dragged right, a `+` grown out past the top, Detach dropping
   * ELK's padding — would slide everything else the other way unless the item moves by the same
   * amount. Both go in one op, so it is one undo entry and never a state in which the drawing
   * stands somewhere nobody put it.
   */
  const writeShifted = useCallback(
    (
      it: BoardItem,
      next: string,
      shift: { x: number; y: number },
      attrs: Record<string, AttrValue | null> = {},
      /* The panel's typing key, which is what every body writer here uses; a declared conversion
         passes none, so it is an undo entry of its own. */
      key: string | null = `body:${it.id}`,
    ) => {
      const at = placesRef.current.get(it.id);
      const moved = at && (shift.x !== 0 || shift.y !== 0);
      if (!moved && Object.keys(attrs).length === 0) return writeBody(it, next);
      const out = { ...attrs };
      if (moved) {
        out.x = Math.round(at.x + shift.x);
        out.y = Math.round(at.y + shift.y);
      }
      const ops: PatchOp[] = [{ id: it.id, body: next, attrs: out }];
      if (moved) ops.push(...pins([it.id]));
      void commit(ops, key ?? undefined);
    },
    [commit, pins, writeBody],
  );

  /**
   * What a move looks like before it is written.
   *
   * `places` is the layout merged with `overrides`, so this is what the canvas draws — and every
   * reader of a position, this file's own included, sees it immediately. Split out from `move`
   * because the nudge paints on every key repeat and writes once; see `flushNudge`.
   */
  const paintMove = useCallback((moves: Map<string, Point>) => {
    setOverrides((prev) => {
      const next = new Map(prev);
      for (const [id, at] of moves) next.set(id, { ...next.get(id), x: at.x, y: at.y });
      return next;
    });
  }, []);

  /** The same move as bytes. `pins` is here rather than in `paintMove` because it is a write. */
  const writeMove = useCallback(
    (moves: Map<string, Point>, key?: string): Promise<boolean> => {
      const ops: PatchOp[] = [];
      for (const [id, at] of moves) ops.push({ id, attrs: { x: at.x, y: at.y } });
      ops.push(...pins(moves.keys()));
      return commit(ops, key);
    },
    [commit, pins],
  );

  const move = useCallback(
    (moves: Map<string, Point>, key?: string): Promise<boolean> => {
      paintMove(moves);
      return writeMove(moves, key);
    },
    [paintMove, writeMove],
  );

  /*
   * A held arrow key is one write, not thirty.
   *
   * `nudge` used to call `move`, so every key repeat — about thirty a second, once the OS starts
   * repeating — was its own `POST /patch`. Against a file that is invisible: `writeAtomic` on a few
   * hundred bytes, and nobody ever noticed. Against a document store it is roughly thirty times the
   * sustained write rate for one document, which is a board that goes slow and then stops
   * answering.
   *
   * So the run paints on every repeat and writes when the key comes up — which is exactly what a
   * drag already does, and it is why `onKeyUp` was already the place the undo run is sealed. The
   * pending targets accumulate here rather than being recomputed from `places`: two repeats inside
   * one frame would otherwise both read the same un-rendered position and the second would write
   * the first one's answer.
   */
  const nudging = useRef<Map<string, Point> | null>(null);
  const settle = useRef<number | null>(null);

  const flushNudge = useCallback(
    (seal: boolean): void => {
      if (settle.current !== null) {
        clearTimeout(settle.current);
        settle.current = null;
      }
      const moves = nudging.current;
      nudging.current = null;
      if (!moves?.size) {
        if (seal) history.seal();
        return;
      }
      /* Sealed after the write, never before: `history.push` happens once `patch` resolves, and a
         seal that landed first would end the run the push is meant to join. */
      void writeMove(moves, "nudge").then(() => seal && history.seal());
    },
    [history, writeMove],
  );

  /**
   * Tidy up.
   *
   * The boxes are the page's — `places` carries the measured size of every item, which is why this
   * runs here rather than on the server: a diagram's height is known only once ELK has answered.
   * `tidy()` reads the arrangement off them and says where each should go; what it says is
   * written as one move, so one ctrl+Z takes the whole thing back. Items it leaves where they
   * are cost nothing, and a board that is already tidy costs no write at all.
   *
   * Two or more selected means the selection, which is the draw.io and Figma convention; anything
   * less means the page. The result is published as `data-dag-tidy` on the root, which is how
   * `scripts/tidy.mjs` — the skill's end-of-draw check — learns that it finished and what it did.
   * `dry` is that script's `--check`: the same answer, and no write.
   */
  const tidyUp = useCallback(
    async (ids?: string[], dry = false): Promise<number> => {
      const b = boardRef.current;
      if (!b) return 0;
      const sel = ids ? new Set(ids) : selectedRef.current.size > 1 ? selectedRef.current : null;
      const boxes: TidyBox[] = [];
      for (const it of visible()) {
        if (sel && !sel.has(it.id)) continue;
        const p = placesRef.current.get(it.id);
        if (p) boxes.push({ id: it.id, x: p.x, y: p.y, w: p.w, h: p.h, group: it.group });
      }
      const moves = new Map<string, Point>();
      for (const [id, at] of tidyBoxes(boxes, { gap: b.flow.gap, grid: gridRef.current })) {
        const p = placesRef.current.get(id)!;
        if (Math.abs(p.x - at.x) >= 0.5 || Math.abs(p.y - at.y) >= 0.5) moves.set(id, at);
      }
      const done = moves.size > 0 && !dry ? await move(moves, "tidy") : true;
      const moved = done ? moves.size : 0;
      if (!dry) track("feature.use", { what: "tidy" });
      document.documentElement.dataset.dagTidy = JSON.stringify({ moved, of: boxes.length, ids: [...moves.keys()], dry });
      return moved;
    },
    [move, visible],
  );

  /* `dag:tidy` on the document tidies the whole page, whatever is selected and whether or not the
     editor is on — it is how a script drives the page under `?snapshot=1`, where nothing else is.
     `detail.dry` asks what would move without moving it. */
  useEffect(() => {
    const onTidy = (e: Event) =>
      void tidyUp(
        visible().map((it) => it.id),
        (e as CustomEvent<{ dry?: boolean } | null>).detail?.dry === true,
      );
    document.addEventListener("dag:tidy", onTidy);
    return () => document.removeEventListener("dag:tidy", onTidy);
  }, [tidyUp, visible]);

  /** Insert items and select them. Positions are the caller's; ids are made unique here. */
  const insert = useCallback(
    /*
     * `select` is the pen's, and nothing else passes it. Every other way an item arrives — a paste,
     * a duplicate, a drop from the library — is a thing a person wants to act on next, so selecting
     * it is the right answer. A stroke is not: the pen stays armed and the next press draws again,
     * so selecting what was just drawn puts eight resize handles, four connect handles and the
     * selection bar over the drawing, none of which can even be clicked while the pen makes items
     * `pointer-events: none`. It also cost the Escape chain its meaning — the selection is inner, so
     * every Escape cleared that instead of putting the pen down.
     */
    async (items: NewItem[], key?: string, select = true) => {
      const b = boardRef.current;
      if (!b || items.length === 0) return;
      const taken = new Set(b.items.map((it) => it.id));
      /* A pasted or duplicated group is a new group: the copies stay together, and apart from
         the originals. One fresh name per group in the batch. */
      const groupsTaken = new Set(b.items.map((it) => it.group ?? ""));
      const groups = new Map<string, string>();
      const ops: PatchOp[] = [];
      const ids: string[] = [];
      for (const it of items) {
        const wanted = typeof it.attrs.id === "string" ? it.attrs.id : "";
        const id = wanted && !taken.has(wanted) ? wanted : freshId(it.type, taken);
        taken.add(id);
        ids.push(id);
        const attrs: Record<string, AttrValue> = { ...it.attrs, id };
        if (typeof attrs.group === "string") {
          let g = groups.get(attrs.group);
          if (!g) {
            g = freshId("group", groupsTaken);
            groupsTaken.add(g);
            groups.set(attrs.group, g);
          }
          attrs.group = g;
        }
        if (pageRef.current !== "page-1") attrs.page = pageRef.current;
        else delete attrs.page;
        ops.push({ insert: { type: it.type, attrs, body: it.body } });
      }
      ops.push(...pins([]));
      /* Nothing was written, so there is nothing to select and nothing to open: returning the ids
         anyway had `place()` opening an editor on an item that does not exist. */
      if (!(await commit(ops, key))) return;
      if (select) setSelected(new Set(ids));
      return ids;
    },
    [commit, pins],
  );

  /* ---- selection ---- */

  const select = useCallback((ids: string[]) => setSelected(new Set(ids)), []);
  const clear = useCallback(() => setSelected((prev) => (prev.size ? new Set() : prev)), []);
  const selectAll = useCallback(() => setSelected(new Set(visible().map((it) => it.id))), [visible]);
  const close = useCallback(() => {
    setEditing(null);
    history.seal();
    viewport.current?.focus();
  }, [history, viewport]);

  const remove = useCallback(
    (ids?: string[]) => {
      const targets = ids ?? [...selectedRef.current];
      if (targets.length === 0) return;
      const gone = new Set(targets);
      setSelected((prev) => new Set([...prev].filter((id) => !gone.has(id))));
      if (editingRef.current && gone.has(editingRef.current)) setEditing(null);
      void commit(targets.map((id) => ({ id, remove: true as const })));
    },
    [commit],
  );

  const duplicate = useCallback(
    (ids?: string[]) => {
      const b = boardRef.current;
      if (!b) return;
      const targets = new Set(ids ?? [...selectedRef.current]);
      const step = gridRef.current * 3;
      const items: NewItem[] = [];
      for (const it of b.items) {
        if (!targets.has(it.id)) continue;
        const p = placesRef.current.get(it.id);
        const attrs: Record<string, AttrValue> = { ...it.attrs.map };
        delete attrs.id;
        if (it.note) attrs.note = true;
        if (p) {
          attrs.x = Math.round(p.x) + step;
          attrs.y = Math.round(p.y) + step;
        }
        items.push({ type: it.type, attrs, body: it.body });
      }
      void insert(items);
    },
    [insert],
  );

  const removeSelection = useCallback(() => {
    if (pickedNodeRef.current) return removePickedNode();
    if (pickedEdgeRef.current) return removePickedEdge();
    remove();
  }, [remove, removePickedEdge, removePickedNode]);

  const duplicateSelection = useCallback(() => {
    if (pickedNodeRef.current) return duplicatePickedNode();
    duplicate();
  }, [duplicate, duplicatePickedNode]);

  /**
   * Bring the selection to the front of its page's stack, or send it to the back (`]` / `[`).
   *
   * Stacking is fence order, so this is one `MoveOp` per item — but all of them in one `commit`,
   * which is what makes it one undo. Walking `b.items` rather than the selection's own `Set` order
   * is what `duplicate` already does for the same reason: several items keep the relative order
   * they were written in, not whatever order a click happened to add them to the selection.
   *
   * `front` processes forward (first-written first) so each becomes the new last in turn, landing
   * contiguous at the end in its original order; `back` processes in reverse so each becomes the
   * new first in turn, landing contiguous at the start in the same order.
   */
  const restack = useCallback(
    (move: "front" | "back", ids?: string[]) => {
      const b = boardRef.current;
      if (!b) return;
      const targets = new Set(ids ?? [...selectedRef.current]);
      if (targets.size === 0) return;
      const ordered = b.items.filter((it) => targets.has(it.id));
      if (move === "back") ordered.reverse();
      void commit(ordered.map((it) => ({ id: it.id, move })));
    },
    [commit],
  );
  const bringToFront = useCallback((ids?: string[]) => restack("front", ids), [restack]);
  const sendToBack = useCallback((ids?: string[]) => restack("back", ids), [restack]);

  /** ⌘⇧H / ctrl+shift+H: hide the selection, or show it again — off the canvas, still in the file. */
  const toggleHidden = useCallback(() => {
    const b = boardRef.current;
    const sel = selectedRef.current;
    if (!b || sel.size === 0) return;
    const items = b.items.filter((it) => sel.has(it.id));
    const hide = items.some((it) => !it.hidden);
    void commit(items.map((it) => ({ id: it.id, attrs: { hidden: hide ? true : null } })));
  }, [commit]);

  /**
   * Open the panel on an item, and — when the gesture landed on a card — on that card.
   *
   * A double-click used to mean "show me this line of the source", and it meant it literally: the
   * panel opened on the text with the declaring line selected. It now opens on the *controls* for
   * the thing that was clicked, and the caret placement is what `reveal` still carries, for the
   * moment somebody switches to the source with a pick standing.
   *
   * A double-click on a bare card is an inline rename on the card itself, in place.
   */
  const open = useCallback(
    (id: string, node?: string) => {
      setSelected(new Set([id]));
      setEditing(id);
      if (!node) return;
      pickNode(id, node);
      setMode("props");
      setReveal((prev) => ({ id, node, n: (prev?.n ?? 0) + 1 }));
    },
    [pickNode, setMode],
  );

  /*
   * The other way into the panel: a line rather than a card. A diagnostic names a line, and on a
   * broken body there may be no card to pick at all — the whole point is that the text does not
   * parse. The source is what shows, because a line is a fact about the text.
   */
  const openAt = useCallback(
    (id: string, line: number) => {
      setSelected(new Set([id]));
      setEditing(id);
      setMode("source");
      setReveal((prev) => ({ id, line, n: (prev?.n ?? 0) + 1 }));
    },
    [setMode],
  );

  const add = useCallback(
    (type: ItemType, at?: Point) => {
      const g = gridRef.current;
      const p = at ?? viewport.current?.center() ?? { x: 0, y: 0 };
      const body = TEMPLATES[type] ?? "";
      const attrs: Record<string, AttrValue> = { x: snap(p.x, g), y: snap(p.y, g) };
      if (type === "note") attrs.note = true;
      const kind: ItemType = type === "note" ? "md" : type;
      if (type === "prompt") attrs.w = 420;
      void insert([{ type: kind, attrs, body }]).then((ids) => {
        /* This panel opening is the one a drop is allowed: `add` is only ever called
           with "md" and "prompt" — `N`, a double-click on the paper, and `P` — and the md case is
           exactly the exception in the rule `place()` states, an item whose body is prose the
           canvas has no way to edit. A prompt card takes its text on the card itself, and opening
           the panel would take the focus straight back off it. */
        if (ids?.[0] && kind !== "prompt") setEditing(ids[0]);
      });
    },
    [insert, viewport],
  );

  const links = useCallback(() => {
    const b = boardRef.current;
    if (!b) return;
    const had = b.items.find((it) => isLinkType(it.type) && it.page === pageRef.current);
    if (had) return open(had.id);
    /* No `x`/`y`: it draws nothing, and a position on an item nobody can see is a lie the tidy
       would then have to keep. */
    void insert([{ type: "edges", attrs: {}, body: TEMPLATES.edges }]).then((ids) => {
      if (ids?.[0]) open(ids[0]);
    });
  }, [insert, open]);

  /**
   * Write one link into the page's `edges` fence, making the fence if there is none.
   *
   * One statement per link, always appended, which is what makes the delete below exact: a line the
   * pointer drew holds exactly the link it drew.
   *
   * **Two cards in one diagram are not a link at all**, and this is where that is decided. An
   * `edges` fence exists because no parser owns both `actor` and `service`; inside one fence the
   * dialect owns both ends, so `a --> b` belongs in the body where every other edge of that diagram
   * is written — it inherits the hue, the markers and the routing the dialect gives its own edges,
   * and it survives being copied, kept as a component or dropped onto another board of that type.
   * Writing it into `edges` instead would draw a board-level line over the top of the diagram it
   * was drawn inside, which is a different picture.
   */
  const addLink = useCallback(
    (from: Target, to: Target) => {
      const b = boardRef.current;
      if (!b) return;
      if (from.item === to.item && from.node && to.node) {
        const it = b.items.find((x) => x.id === from.item);
        if (it && isDiagramType(it.type)) return writeBody(it, appendEdge(it.body, `${from.node} --> ${to.node}`));
        return;
      }
      const statement = linkStatement(from, to);
      const fence = b.items.find((it) => isLinkType(it.type) && it.page === pageRef.current);
      if (fence) void commit([{ id: fence.id, body: appendLink(fence.body, statement) }]);
      else void insert([{ type: "edges", attrs: {}, body: statement }]);
    },
    [commit, insert, writeBody],
  );

  /** Take one link out of the fence it came from. Its statement is a line, and the line goes. */
  const removeLink = useCallback(
    (id: string) => {
      const b = boardRef.current;
      if (!b) return;
      const link = b.links.find((l) => l.id === id);
      const fence = link && b.items.find((it) => it.id === link.fence);
      if (!link || !fence) return;
      setPickedLink(null);
      void commit([{ id: fence.id, body: removeLinkLine(fence.body, link.line - fence.line) }]);
    },
    [commit],
  );

  /* ---- growing, detaching, renaming an item ---- */

  /**
   * What the layout last said about one diagram, as it published it.
   *
   * `data-dag-layout` on the `.dag-diagram` element, the same channel `data-dag-quality` uses and for
   * the same reason: the answer exists only on the page, because ELK runs in a worker reached
   * through a specifier only Vite resolves. `null` covers everything from "not laid out yet" to
   * "not a graph", and every caller has a sensible thing to do with that.
   */
  const laidOutIn = useCallback((id: string): LaidOut | null => {
    const el = document.querySelector<HTMLElement>(`[data-dag-item="${CSS.escape(id)}"] .dag-diagram`);
    if (!el?.dataset.dagLayout) return null;
    try {
      return JSON.parse(el.dataset.dagLayout) as LaidOut;
    } catch {
      return null;
    }
  }, []);

  /** The layer a card came out in, for the panel's `col=` offer. See `columnOf` in `drag.ts`. */
  const columnAt = useCallback(
    (item: string, node: string): number | null => {
      const laid = laidOutIn(item);
      const it = bodyOf(item);
      return laid && it ? columnOf(laid, node, it.dir) : null;
    },
    [bodyOf, laidOutIn],
  );

  /**
   * Dragging a picked card: a **structural** edit, painted while the pointer is down.
   *
   * Every other drag on this board writes a coordinate. This one cannot, and the reason is worth
   * having in one place: ELK's layered algorithm has no fixed node — its `INTERACTIVE` strategies
   * take a coordinate as a *hint* and hand back a card near it — and four of the five house layouts
   * have an axis that already is an ordinal. So the drop is read as what it said about the
   * structure — into that group, after that card, into that band, on that date — and `src/edit/
   * drag.ts` turns that into one line of the fence moving. What comes back after the relayout is
   * not to the pixel where the pointer let go, which is the same honesty `resizeOf`'s `aspect`
   * already states.
   *
   * Four things about the gesture itself:
   *
   * - **The card is the ghost.** No clone: a `.dag-node` is `position: absolute` with `left`/`top`
   *   from the layout, so a `transform` moves what is drawn and leaves `getBoundingClientRect()`'s
   *   *size* exactly as laid out — which is what the DEV size assertion measures. A clone would
   *   have duplicated the per-instance gradient ids `replaceIDs()` exists to keep unique.
   * - **Painted, never rendered.** The styles are inline and go on release, like `data-zoom` and
   *   like every other gesture here; nothing reaches React until the drop.
   * - **The drop target comes out of the DOM.** `elementFromPoint` and one `closest()` with all
   *   three selectors give the innermost of a card, a boundary and a band in a single walk. The
   *   dragged card is `pointer-events: none` for the duration so it cannot answer for itself, and
   *   `data-dag-node-drag` turns the link layer's hit strokes off for the reason a connect does.
   * - **`data-dag-group` is on the item too**, for the board-level group, so a `closest()` that
   *   escapes the diagram would report the item as a boundary to drop into. The hit is required to
   *   be inside the item and not to *be* it.
   */
  const nodeDrag = useCallback(
    (id: string, node: string, e: ReactPointerEvent, el: HTMLElement): boolean => {
      const it = bodyOf(id);
      if (!it || !isDiagramType(it.type)) return false;
      /* One card is the item: there is no structure for a drop to name, so the press moves the
         item — see `soleCard`. */
      if (soleCard(it)) return false;
      const card = el.querySelector<HTMLElement>(`[data-dag-node="${CSS.escape(node)}"]`);
      if (!card) return false;

      /* The handles over this card are `App`'s, drawn in the layer from a box the layout
         published, so they stand still while the card under them is painted somewhere else — the
         board-level half of the same defect, and carried the same way. See the item drag. */
      const tools = el
        .closest<HTMLElement>(".dag-layer")
        ?.querySelector<HTMLElement>(`[data-dag-node-tools="${CSS.escape(node)}"]`);

      const mode = dragMode(it.type, it.layout);
      const zoom = Number(el.closest<HTMLElement>(".dag-viewport")?.dataset.zoom ?? 1) || 1;
      const sx = e.clientX;
      const sy = e.clientY;

      let moved = false;
      let over: Over = null;
      let half = { x: 0.5, y: 0.5 };
      let by = { x: 0, y: 0 };
      let marked: HTMLElement | null = null;
      const mark = (next: HTMLElement | null) => {
        if (marked === next) return;
        if (marked) delete marked.dataset.dagDrop;
        marked = next;
        if (marked) marked.dataset.dagDrop = "";
      };

      const onMove = (ev: PointerEvent) => {
        if (!moved) {
          if (Math.abs(ev.clientX - sx) + Math.abs(ev.clientY - sy) < DRAG_SLOP) return;
          moved = true;
          document.documentElement.dataset.dagNodeDrag = mode === "none" ? "refused" : "on";
          card.style.pointerEvents = "none";
          card.style.opacity = "0.5";
          card.style.zIndex = "3";
        }
        /* A timeline's y is a packing answer and a sequence's is a clock, so on those the card only
           travels along the one axis whose drop means something. */
        const flat = mode === "date" || mode === "order";
        by = { x: (ev.clientX - sx) / zoom, y: flat ? 0 : (ev.clientY - sy) / zoom };
        card.style.transform = `translate(${by.x}px, ${by.y}px)`;
        if (tools) tools.style.translate = `${by.x}px ${by.y}px`;
        if (mode === "none") return;

        const under = document.elementFromPoint(ev.clientX, ev.clientY);
        const item = under?.closest<HTMLElement>("[data-dag-item]");
        const own = item?.dataset.dagItem === id ? item : null;
        let hit = own ? (under?.closest<HTMLElement>("[data-dag-node],[data-dag-group],[data-dag-lane]") ?? null) : null;
        if (hit === own || (hit && !own?.contains(hit))) hit = null;
        over = !own
          ? null
          : hit?.dataset.dagNode !== undefined
            ? { what: "node", id: hit.dataset.dagNode }
            : hit?.dataset.dagLane !== undefined
              ? { what: "lane", id: hit.dataset.dagLane }
              : hit?.dataset.dagGroup !== undefined
                ? { what: "group", id: hit.dataset.dagGroup }
                : { what: "frame", id };
        const r = (hit ?? own)?.getBoundingClientRect();
        if (r && r.width > 0 && r.height > 0) {
          half = { x: (ev.clientX - r.left) / r.width, y: (ev.clientY - r.top) / r.height };
        }
        mark(hit ?? own);
      };

      let cancelled = false;
      const onUp = () => {
        removeEventListener("pointermove", onMove);
        removeEventListener("pointerup", onUp);
        removeEventListener("pointercancel", onUp);
        removeEventListener("keydown", onKey, true);
        mark(null);
        delete document.documentElement.dataset.dagNodeDrag;
        card.style.transform = "";
        card.style.pointerEvents = "";
        card.style.opacity = "";
        card.style.zIndex = "";
        if (tools) tools.style.translate = "";
        if (!moved || cancelled) return;
        /* Eat the click that ends the drag, so releasing over a card does not re-pick it. */
        addEventListener("click", (c) => c.stopPropagation(), { capture: true, once: true });
        /* Read the item again: the board is one round trip stale after a write, and a drag can
           follow one closely enough to matter. */
        const cur = bodyOf(id);
        if (!cur) return;
        const next = dropEdit({
          type: cur.type,
          body: cur.body,
          dir: cur.dir,
          layout: cur.layout,
          node,
          over,
          laid: laidOutIn(id) ?? { nodes: {}, groups: {} },
          half,
          by,
          grid: gridRef.current,
        });
        if (next !== null) writeShifted(cur, next.body, next.shift);
      };

      /* Escape abandons it, captured — the board's own key handler would take the key first and
         read it as "let go of the pick", which is the one thing that must not happen mid-gesture. */
      const onKey = (ev: KeyboardEvent) => {
        if (ev.key !== "Escape") return;
        ev.preventDefault();
        ev.stopPropagation();
        cancelled = true;
        onUp();
      };

      addEventListener("pointermove", onMove);
      addEventListener("pointerup", onUp);
      addEventListener("pointercancel", onUp);
      addEventListener("keydown", onKey, true);
      return true;
    },
    [bodyOf, laidOutIn, writeShifted],
  );

  /**
   * A second card beside the picked one, with an edge to it, and the rename already open on it.
   *
   * draw.io's hover arrow, and the single biggest way of *building* a diagram without typing. The
   * whole thing is one commit, so one ctrl+Z takes back the card and its edge together — two
   * commits would make "undo" mean "leave a card nothing points at".
   */
  const growFrom = useCallback(
    (side: ConnectSide, dragged: boolean) => {
      const p = pickedNodeRef.current;
      const it = p && bodyOf(p.item);
      if (!p || !it || !isDiagramType(it.type)) return;
      /* The handles are not drawn where a dialect has no edge to write (`growable`), so this is the
         belt to that brace: a `+` on a chart would append `web --> mob`, which is `E_UNKNOWN_KIND`
         in a chart body — a gesture that breaks the thing it was pressed on. */
      if (!growable(it.type)) return;

      /* A fixed fence places by coordinate, so the new box goes one gap off the picked one on the
         side that was pulled — past any card already there — and an edge is a separate claim only
         a drag makes. Everywhere else the edge *is* the placement: ELK has no reason to put an
         unconnected card anywhere near the one it grew from. */
      const fixed = it.type === "sketch" || it.layout === "fixed";
      let at: { x: number; y: number } | undefined;
      let body = it.body;
      let shift = { x: 0, y: 0 };
      if (fixed) {
        const laid = laidOutIn(p.item);
        const spot = laid ? clearSpot(laid, p.node, side, gridRef.current * 4) : null;
        const graph = laid && spot ? parseDiagram(it.type, it.body, it.dir, it.aspect, it.layout) : null;
        if (laid && spot && graph) {
          /* The new line goes in the picked one's block, so its coordinate is written the way that
             block's are — and in the file's numbers, not the layout's. */
          at = fileAt(laid, spot, graph.nodes.find((n) => n.id === p.node)?.group);
          /* A card with no coordinate is placed *below* everything that has one, so the new card's
             `x=`/`y=` would move it; pinning what is unplaced keeps the drawing the drawing. */
          body = pinUnplaced(graph, laid, it.body);
          const was = cornerOf(laid);
          shift = frameShift(was, { x: Math.min(was.x, spot.x), y: Math.min(was.y, spot.y) });
        }
      }

      const made = grow(it.type, body, it.dir, p.node, { side, edge: !fixed || dragged, at });
      if (!made) return;
      setPickedNode({ item: it.id, node: made.id });
      setRenaming({ item: it.id, id: made.id, what: "node", seg: 0, text: "" });
      writeShifted(it, made.body, shift);
    },
    [bodyOf, laidOutIn, writeShifted],
  );

  /**
   * Detach: the diagram keeps exactly the drawing it has, and the coordinates become the author's.
   *
   * Both halves in one op. `layout=fixed` on its own would be a *different diagram* — see `detach`
   * in `src/edit/build.ts` — and two commits would put a re-gridded version of the board into the
   * undo stack as a state somebody could land on.
   */
  const detachItem = useCallback(
    (id: string) => {
      const it = bodyOf(id);
      if (!it || !isDiagramType(it.type)) return;
      const laid = laidOutIn(id);
      const graph = parseDiagram(it.type, it.body, it.dir, it.aspect, it.layout);
      if (!laid || !graph) return;
      /* ELK's drawing starts wherever its padding put it and a fixed one starts at the frame's
         origin, so the fence moves by that corner and the cards stay exactly where they were. */
      writeShifted(it, detachBody(graph, laid, it.body), cornerOf(laid), { layout: "fixed" }, null);
    },
    [bodyOf, laidOutIn, writeShifted],
  );

  const relayoutItem = useCallback(
    (id: string) => {
      const it = bodyOf(id);
      if (!it) return;
      void commit([{ id, body: stripCoords(it.body), attrs: { layout: null } }]);
    },
    [bodyOf, commit],
  );

  /**
   * Rename an item everywhere on the board.
   *
   * Through `put` rather than through a patch op, because `renameItemId` rewrites spans in every
   * `edges` fence on every page and `applyPatch` addresses one item at a time. Same `base` rule,
   * same history entry: this is the undo path used forwards.
   */
  const renameItem = useCallback(
    async (id: string, to: string): Promise<string | null> => {
      const want = to.trim();
      if (want === id) return null;
      if (want === "") return "an item needs a name";
      if (lockedRef.current) return refuseLocked(), "read only: unlock to rename it";
      const cur = handleRef.current.current();
      if (!cur) return "the board has not loaded yet";
      const done = renameItemId(cur.text, id, want);
      if (!done.ok) return done.error;
      const w = await handleRef.current.put(done.text);
      if (!w) return "the file changed underneath. Try again";
      history.push(w.before, w.after);
      setTick((t) => t + 1);
      setSelected(new Set([want]));
      setEditing((prev) => (prev === id ? want : prev));
      return null;
    },
    [history],
  );

  const place = useCallback(
    (component: Component, at?: Point) => {
      const g = gridRef.current;
      const p = at ?? viewport.current?.center() ?? { x: 0, y: 0 };
      const to = { x: snap(p.x, g), y: snap(p.y, g) };

      /* A saved stack is several items, and they go down together keeping their arrangement —
         the same problem a paste solves, and the same answer. A stamp never inherits an id: the
         one it was saved with belongs to the board it came from. */
      if (component.saved && component.layer === 4) {
        const items = anchorAt(textToItems(component.saved.text), to, g);
        for (const it of items) delete it.attrs.id;
        void insert(items);
        return;
      }

      const attrs: Record<string, AttrValue> = { ...component.attrs, ...to };
      /* A fragment on the paper starts a diagram of its type with just that in it. */
      const body = render(component);
      void insert([{ type: component.type, attrs, body }]).then((ids) => {
        /* **The panel opens on a new item only when the item's body is prose the canvas has no
           way to edit** — an `md`, whose body *is* its content and for which the panel is the
           only text-entry route. Everything else dropped here is reachable on the canvas:
           double-click renames it and a pick gives it the controls, and a panel opening over all
           of that was the complaint this closes. A prompt card is typed into where it
           lands; see `add`, which is the other place this rule is already honoured.

           A card that places a note, a task or a board (`noteCard`) is `md` and still not prose: its
           body is one `![…](dag:…)` line, the canvas draws a card naming the document,
           and the panel would open on that line of syntax over the card somebody just dropped
. */
        if (ids?.[0] && component.type === "md" && !component.id.startsWith(NOTE_CARD)) setEditing(ids[0]);
      });
    },
    [insert, viewport],
  );

  /*
   * A row, left to right from the point, each one gap past the last: a card's height is the page's to
   * measure once it is drawn, and a row cannot overlap itself whatever the heights come out as. Its
   * width is the component's own `w=`, or the placed card's for a picture that would not measure.
   * Selected, so `T` makes it whatever shape is wanted next.
   */
  const placeAll = useCallback(
    (components: Component[], at?: Point) => {
      if (components.length === 0) return;
      const g = gridRef.current;
      const gap = boardRef.current?.flow.gap ?? g * 3;
      const p = at ?? viewport.current?.center() ?? { x: 0, y: 0 };
      let x = snap(p.x, g);
      const y = snap(p.y, g);
      const items: NewItem[] = components.map((c) => {
        const attrs: Record<string, AttrValue> = { ...c.attrs, x, y };
        x = snap(x + (typeof c.attrs?.w === "number" ? c.attrs.w : PLACED_W) + gap, g);
        return { type: c.type, attrs, body: render(c) };
      });
      void insert(items);
    },
    [insert, viewport],
  );

  const dropPart = useCallback(
    (component: Component, id: string): boolean => {
      const it = boardRef.current?.items.find((x) => x.id === id);
      if (!it || !isFragment(component) || !isDiagramType(it.type) || it.type !== component.type) return false;
      /*
       * The two kinds of component differ in exactly one place, and this is it. An authored
       * blueprint fills its holes with ids allocated clear of what is here; a saved one arrives
       * with the real ids a person wrote, so it keeps the ones that are free and renames the ones
       * that are not.
       */
      const next = component.saved
        ? `${it.body.replace(/\s+$/, "")}\n\n${rebind(it.type, component.source ?? "", it.body)}`
        : appendPart(component, it.body);
      void commit([{ id, body: next }]).then((ok) => {
        if (ok) {
          setSelected(new Set([id]));
          setEditing(id);
        }
      });
      return true;
    },
    [commit],
  );

  const toBoard = useCallback(
    (clientX: number, clientY: number): Point => viewport.current?.toBoard(clientX, clientY) ?? { x: 0, y: 0 },
    [viewport],
  );

  const onLibraryRef = useRef(onLibrary);
  onLibraryRef.current = onLibrary;
  const onLibraryOpenRef = useRef(onLibraryOpen);
  onLibraryOpenRef.current = onLibraryOpen;

  /* ---- gestures ---- */

  /* ---- prompt cards ---- */

  const writePrompt = useCallback<EditorCtl["write"]>(
    async (id, next) => {
      const writes: Promise<boolean>[] = [];
      if (next.body !== undefined) writes.push(commit([{ id, body: next.body }], `body:${id}`));
      if (next.as !== undefined) writes.push(commit([{ id, attrs: { as: next.as } }], `attrs:${id}:as`));
      await Promise.all(writes);
    },
    [commit],
  );

  /*
   * Swap the card for the draft, against the board as it is *now* — the answer took seconds, and in
   * that time the card may have been moved, retyped into, or deleted. Deleted is a person changing
   * their mind, and the answer is dropped rather than put somewhere the card no longer is.
   */
  const acceptDraft = useCallback<EditorCtl["accept"]>(
    async (id, draft) => {
      const b = boardRef.current;
      const card = b?.items.find((it) => it.id === id && it.type === "prompt");
      if (!b || !card) return false;
      const made = freshId(draft.type, new Set(b.items.map((it) => it.id)));
      if (!(await commit(replacement(card, draft, made)))) return false;
      setSelected(new Set([made]));
      return true;
    },
    [commit],
  );

  const generateFor = useCallback<EditorCtl["generate"]>(
    /* The text comes from the card rather than the board: what a person just typed may be a quarter
       of a second ahead of the file, and ctrl+Enter is pressed the moment they stop. */
    async (id, req, signal) => {
      track("feature.use", { what: "generate" });
      const { llm } = readSettings();
      const result = await requestDiagram(
        { prompt: req.prompt, as: req.as, provider: llm.provider, model: llm.model, reasoning: llm.reasoning },
        signal,
      );
      /* A clean answer that could not be put down — the write refused twice — is not a success: the
         card would sit on "Drawing…" with nothing coming. It goes back as a failure with its draft,
         so Insert anyway is one click away. */
      if (result.ok && result.draft && !(await acceptDraft(id, result.draft)))
        return { ...result, ok: false, error: "the board changed underneath and the diagram was not put down. Try again" };
      return result;
    },
    [acceptDraft],
  );

  /* ---- rewrite ---- */

  /*
   * Ask for a rewrite of the selection, and stop at the draft.
   *
   * A sibling of `generateFor`, not a parameterisation: `generateFor` **auto-accepts** on success —
   * the card is consumed the moment its answer is clean — and that is exactly the wrong reflex
   * here, where nothing touches the file before the answer is accepted. So
   * this returns the draft and the survival check beside it, and `applyRewrite` is the thing that
   * writes.
   */
  const rewrite = useCallback<EditorCtl["rewrite"]>(
    async (ids, prompt, signal) => {
      const b = boardRef.current;
      const empty: RewriteOutcome = { ok: false, lost: [], unparsed: false, diagnostics: [], attempts: 0 };
      if (!b || ids.length === 0) return { ...empty, reason: "missing" };
      /* One item is the case there is a gesture for; a multi-item rewrite is a real design — what
         does one answer mean across three bodies? — and is refused rather than half-done: the
         whole first item rewritten and the rest silently ignored would be worse than an honest no. */
      if (ids.length > 1) return { ...empty, reason: "multi" };
      const item = b.items.find((it) => it.id === ids[0]);
      if (!item) return { ...empty, reason: "missing" };
      if (!isDiagramType(item.type)) return { ...empty, reason: "not-diagram" };

      /* The selection's own DSL, and the ids the rest of the board links into it: the
         model sees the selection plus what references it, never the whole board. The instruction is
         appended to, so a line naming what must survive rides with whatever the person typed. */
      const context = rewriteContext(b, new Set(ids));
      const { llm } = readSettings();
      const result = await requestRewrite(
        {
          prompt: context ? `${prompt}\n\n${context}` : prompt,
          /* `from`, never `as`: the type is what the item is now, and the person may be asking for
             another one — pinned, "show this as a flowchart" was refused on every attempt. */
          from: item.type,
          source: item.body,
          provider: llm.provider,
          model: llm.model,
          reasoning: llm.reasoning,
        },
        signal,
      );
      if (!result.ok || !result.draft) return { ...empty, error: result.error, diagnostics: result.diagnostics, attempts: result.attempts };

      /* What the draft would break elsewhere on the board, judged now — `applyRewrite` runs the
         same check again against the board as it then is, but the person deciding whether to accept
         wants the answer before that, not after. */
      const survival = lost(b, item, result.draft.body, result.draft.type);
      return {
        ok: true,
        draft: result.draft,
        lost: survival.parsed ? survival.lost : [],
        unparsed: !survival.parsed,
        diagnostics: result.diagnostics,
        attempts: result.attempts,
      };
    },
    [],
  );

  /*
   * Land an accepted rewrite, against the board as it is *now* — the answer took seconds, and in
   * that time the item may have been moved, retyped into, or deleted. Deleted is a person changing
   * their mind, and the draft is dropped rather than put somewhere the item no longer is. The same
   * argument `acceptDraft` makes one method up.
   */
  const applyRewrite = useCallback<EditorCtl["applyRewrite"]>(
    async (id, draft) => {
      const b = boardRef.current;
      const item = b?.items.find((it) => it.id === id);
      if (!b || !item) return false;
      return commit(rewriteOps(item, draft));
    },
    [commit],
  );

  const ctl = useMemo<EditorCtl>(() => {
    const press: EditorCtl["press"] = (id, e, el, node) => {
      if (e.button !== 0) return false;
      /*
       * A finger on an item that is not selected is a pan. On a phone a board is mostly
       * items, and a drag that moved whatever it began on would leave nowhere to scroll from; a
       * tap selects it instead, on the release, and a finger on a selected item moves it the way
       * the pointer does. Resizing and connecting stay the pointer's: their handles are not drawn
       * for a finger (`chrome.css`).
       */
      if (e.pointerType === "touch" && (lockedRef.current || !selectedRef.current.has(id))) {
        const sx = e.clientX;
        const sy = e.clientY;
        const finger = e.pointerId;
        const lift = (ev: PointerEvent) => {
          if (ev.pointerId !== finger) return;
          removeEventListener("pointerup", lift);
          removeEventListener("pointercancel", lift);
          if (ev.type !== "pointerup" || Math.abs(ev.clientX - sx) + Math.abs(ev.clientY - sy) >= DRAG_SLOP) return;
          setPickedLink(null);
          clearPick();
          const family = withGroups([id]);
          setSelected(family);
          selectedRef.current = family;
        };
        addEventListener("pointerup", lift);
        addEventListener("pointercancel", lift);
        return false;
      }
      /*
       * The hand tool is a held pan modifier that does not need holding, and it has to be read
       * *here* rather than only in `Viewport` — which is where it was, and why the tool did
       * nothing over an item. Returning false is what makes the press bubble: `Item` skips its
       * `stopPropagation`, the viewport receives the press it would otherwise never see, and its
       * own `tool === "hand"` branch classifies it as a pan. Left in the viewport alone, a press
       * on an item selected it and dragged it while the cursor said `grab` — the one reading of
       * "hand mode" nobody wants. The pen makes the same argument in CSS (`chrome.css`), because
       * a stroke must also miss the handles and the link hit-strokes; a pan has no such reach,
       * so the one line here is the whole of it.
       */
      if (toolRef.current === "hand") return false;
      /* Space or ctrl/cmd held means the gesture is a pan, not a move — read off the press as well
         as off `data-pan`, because a modifier held before the window took focus produced no
         keydown for the viewport to have seen. */
      const view = el.closest<HTMLElement>(".dag-viewport");
      if (view?.dataset.pan !== undefined || e.ctrlKey || e.metaKey) return false;
      setPickedLink(null);

      const was = selectedRef.current;

      /*
       * The second click picks the card out of the diagram.
       *
       * The same rule a group already follows (`onUp` below): the first click takes the container,
       * and once the container is the whole selection the next click reaches inside it. So nothing
       * about clicking a diagram changes, and a card becomes reachable without a modifier nobody
       * would guess.
       *
       * It returns before any drag is armed, which is the point: this press is a *selection*, and
       * a press that both picks a thing and starts moving something else is how a click turns into
       * an accidental edit.
       *
       * A press on a card that is *already* picked drags the **card**, not the item — see
       * `nodeDrag`. **Alt is the escape hatch**: with it held the press falls through and moves the
       * whole diagram as it always did, which is the only way to move a board whose every diagram
       * has a card picked in it without letting go of the pick first.
       */
      if (node && !e.shiftKey && was.size === 1 && was.has(id)) {
        const cur = pickedNodeRef.current;
        if (!cur || cur.item !== id || cur.node !== node) {
          paint((e.target as Element | null)?.closest("[data-dag-node]") ?? null);
          pickNode(id, node);
          return true;
        }
        if (!e.altKey && !lockedRef.current && nodeDrag(id, node, e, el)) return true;
      } else if (!node) {
        /* The frame, the padding, the header — the diagram itself rather than anything in it. */
        clearPick();
      }

      const family = withGroups([id]);
      let next: Set<string>;
      if (e.shiftKey) {
        /* Shift toggles the whole family: in if any member is out, out otherwise. */
        next = new Set(was);
        const allIn = [...family].every((f) => next.has(f));
        for (const f of family) if (allIn) next.delete(f); else next.add(f);
        setSelected(next);
        selectedRef.current = next;
        if (!next.has(id)) return true;
      } else if (!was.has(id)) {
        next = family;
        setSelected(next);
        selectedRef.current = next;
      } else {
        next = new Set(was);
      }

      /* Locked: the press was a selection, and that is all it may be. */
      if (lockedRef.current) return true;

      const zoom = Number(view?.dataset.zoom ?? 1) || 1;
      const g = gridRef.current;
      const layer = el.closest<HTMLElement>(".dag-layer");
      const overlay = layer?.querySelector<SVGElement>(".dag-guides") ?? null;
      /* Every selected item moves together; their elements are looked up once, on the press. */
      const parts: { id: string; el: HTMLElement; from: Point }[] = [];
      const boxes: Box[] = [];
      for (const sid of next) {
        const node = sid === id ? el : layer?.querySelector<HTMLElement>(`[data-dag-item="${CSS.escape(sid)}"]`);
        const from = placesRef.current.get(sid);
        if (node && from) {
          parts.push({ id: sid, el: node, from: { x: from.x, y: from.y } });
          boxes.push({ x: from.x, y: from.y, w: from.w, h: from.h });
        }
      }
      /*
       * What the *layer* draws over a moving item has to move with it, and there was a time none
       * of it did.
       *
       * `Item` carries its own outline, its chip and its eight resize handles, so an item's own
       * furniture follows the painted transform for nothing. A group's dashed box and the four
       * connect handles on it do not: they are `App`'s, rendered from `places`, which is React
       * state and therefore stands still for the whole of a gesture that paints. So a dragged
       * group left the thing you link *from* behind at the position it started in, with the
       * drawing forty pixels away — reported as "dragging an element doesn't drag along its
       * linking ports". The handles on a picked card (`.dag-nodetools`) are in the layer for the
       * same reason and had the same defect, reachable by alt-dragging the item under a pick.
       *
       * **`style.translate`, not `style.transform`**, and that is what keeps this to a delta. Each
       * of these elements is already positioned by a `transform` that is `App`'s arithmetic — a
       * union's origin less the padding it draws around it, or a card's box inside its diagram —
       * and the drag has no business knowing either number. The individual transform properties
       * are applied *before* `transform` and compose with it, so a delta written here moves the
       * element and leaves whoever owns its position alone.
       *
       * `withGroups` guarantees that touching one member of a group selects all of them, so a
       * group whose box is drawn is a group moving entirely, by exactly the delta its members
       * move by. A card's handles ride on their item for the same reason.
       */
      const carried: HTMLElement[] = [];
      const carry = (sel: string) => {
        const found = layer?.querySelector<HTMLElement>(sel);
        if (found) carried.push(found);
      };
      const moving = new Set<string>();
      for (const it of visible()) if (next.has(it.id) && it.group) moving.add(it.group);
      for (const name of moving) carry(`[data-dag-groupbox="${CSS.escape(name)}"]`);
      const pick = pickedNodeRef.current;
      if (pick && next.has(pick.item)) carry(`[data-dag-node-tools="${CSS.escape(pick.node)}"]`);

      /* The selection moves as one box, snapped as one box: a row of three stays a row, and it
         aligns to the rest of the board by its own outer edges and centre. */
      const group = union(boxes);
      const others: Box[] = [];
      for (const [oid, p] of placesRef.current) {
        if (!next.has(oid)) others.push({ x: p.x, y: p.y, w: p.w, h: p.h });
      }

      const sx = e.clientX;
      const sy = e.clientY;
      let moved = false;
      let at = { dx: 0, dy: 0 };

      const onMove = (ev: PointerEvent) => {
        const dx = (ev.clientX - sx) / zoom;
        const dy = (ev.clientY - sy) / zoom;
        if (!moved) {
          if (Math.abs(ev.clientX - sx) + Math.abs(ev.clientY - sy) < DRAG_SLOP) return;
          moved = true;
          for (const p of parts) p.el.classList.add("dag-item--dragging");
          document.documentElement.dataset.dagDragging = "";
        }
        const to = guided({ ...group, x: group.x + dx, y: group.y + dy }, others, zoom, g, overlay, ev.altKey);
        at = { dx: to.x - group.x, dy: to.y - group.y };
        for (const p of parts) p.el.style.transform = `translate(${p.from.x + at.dx}px, ${p.from.y + at.dy}px)`;
        for (const c of carried) c.style.translate = `${at.dx}px ${at.dy}px`;
        previewLinks(parts.map((p) => [p.id, { x: p.from.x + at.dx, y: p.from.y + at.dy }] as const));
      };

      /* A second finger makes the gesture a pinch (`Viewport`): the item goes back where it was and
         nothing is written. */
      let pinched = false;
      const onPinch = () => {
        pinched = true;
        for (const p of parts) p.el.style.transform = `translate(${p.from.x}px, ${p.from.y}px)`;
        onUp();
      };
      document.addEventListener("dag:pinch", onPinch);

      const onUp = () => {
        removeEventListener("pointermove", onMove);
        removeEventListener("pointerup", onUp);
        removeEventListener("pointercancel", onUp);
        document.removeEventListener("dag:pinch", onPinch);
        clearGuides(overlay);
        previewLinks(null);
        delete document.documentElement.dataset.dagDragging;
        for (const p of parts) p.el.classList.remove("dag-item--dragging");
        /* Cleared here rather than left for React, which never writes this property and so would
           never overwrite it. `move` paints the new places in the same task, so the box is
           re-rendered where it now belongs before the browser gets a frame — the same handover an
           item's own `transform` makes one line up. */
        for (const c of carried) c.style.translate = "";
        if (pinched) return;
        if (!moved) {
          /* A plain click on one of several selected items picks that one out. */
          if (!e.shiftKey && was.has(id) && was.size > 1) setSelected(new Set([id]));
          return;
        }
        /* Eat the click that ends a drag, so releasing over a link does not follow it. */
        addEventListener("click", (c) => c.stopPropagation(), { capture: true, once: true });
        const moves = new Map<string, Point>();
        for (const p of parts) moves.set(p.id, { x: p.from.x + at.dx, y: p.from.y + at.dy });
        void move(moves);
      };

      /*
       * Window listeners, no capture. Both alternatives were tried and are wrong: without capture,
       * an element-level listener stops firing the instant the pointer leaves a 30px-tall note, so
       * the drag dies before it starts; with capture, the pointerup retargets to the item and the
       * `click` that ends the gesture goes to it instead of to whatever was under the pointer, so
       * a link inside a note stops working.
       */
      addEventListener("pointermove", onMove);
      addEventListener("pointerup", onUp);
      addEventListener("pointercancel", onUp);
      return true;
    };

    /*
     * Resize from any side or corner.
     *
     * An edge that moves snaps to the edges of the items around it — offered to `snapBox` as a
     * zero-sized box on that edge, taking an alignment on that axis and never a spacing, because a
     * width has no gap to keep. The left and top edges move the origin as well as the size, so the
     * opposite edge stays where it was, which is what a person pulling on one side expects.
     *
     * The height is painted on the wrapper for the duration and written as `h=` on release; the
     * item's body then draws that as a minimum height, so the box a person drew is the box the
     * flow lays out, whatever the content needed.
     *
     * **A diagram is the other case, and it writes `aspect=` instead** (`resizeOfItem`). Its box is
     * the layout's answer, not the author's, so `w=` only ever widened the frame around content that
     * stayed exactly where it was — a bigger empty rectangle. `aspect` is the shape ELK folds the
     * diagram towards, so pulling an edge wide really does turn three rows into two. The width is
     * painted during the gesture the same way; what comes back after the relayout is the layout's
     * width for that shape, which will not be to the pixel where the pointer let go. That is the
     * honest answer rather than the flattering one.
     *
     * **And hand-placed content is the third**, which is the same defect one layout over: a
     * `sketch` of two or more shapes, or any fence opened `layout=fixed`, is drawn by a passthrough
     * that never reads the fence's box, so `w=`/`h=` there moved the frame and left the drawing
     * parked in the corner of it. Those handles scale the drawing — `scaleFixed` — and the fence's
     * box is cleared on whichever axis scaled so the frame hugs what it now holds.
     */
    const resize: EditorCtl["resize"] = (id, e, el, dir) => {
      if (e.button !== 0) return;
      const view = el.closest<HTMLElement>(".dag-viewport");
      const zoom = Number(view?.dataset.zoom ?? 1) || 1;
      const g = gridRef.current;
      const from = placesRef.current.get(id);
      if (!from) return;
      const item = boardRef.current?.items.find((x) => x.id === id);
      const mode = item ? resizeOfItem(item) : "box";
      if (mode === "none") return;
      /* One sketch shape standing alone: its handles resize the shape, not a frame around it. */
      const lone = item ? loneShape(item) : null;
      /* Behind it, hand-placed content — a sketch with two or more shapes, or any fence opened
         `layout=fixed`: its handles scale the drawing, which the plain `box` write cannot mean.
         Read once per gesture, like `lone`; the layout is asked on release, below. */
      const fixed = item && mode === "box" ? fixedGraph(item) : null;
      const minW = g * 20;
      const minH = g * 4;
      const sx = e.clientX;
      const sy = e.clientY;
      const overlay = el.closest<HTMLElement>(".dag-layer")?.querySelector<SVGElement>(".dag-guides") ?? null;
      const others: Box[] = [];
      for (const [oid, p] of placesRef.current) if (oid !== id) others.push({ x: p.x, y: p.y, w: p.w, h: p.h });
      const t = SNAP_PX / zoom;

      let box: Box = { x: from.x, y: from.y, w: from.w, h: from.h };

      /* One edge on one axis: where it lands, and the guide that says why. */
      const edge = (axis: "x" | "y", at: number, off: boolean): { at: number; svg: string } => {
        const probe: Box = axis === "x" ? { x: at, y: box.y, w: 0, h: box.h } : { x: box.x, y: at, w: box.w, h: 0 };
        const sn = off ? null : snapBox(probe, others, t);
        const hit = axis === "x" ? sn?.x : sn?.y;
        if (hit === null || hit === undefined) return { at: snap(at, g), svg: "" };
        return { at: hit, svg: guidesToSvg(sn!.guides.filter((q) => q.axis === axis && q.kind === "align"), 0) };
      };

      const onMove = (ev: PointerEvent) => {
        const dx = (ev.clientX - sx) / zoom;
        const dy = (ev.clientY - sy) / zoom;
        let svg = "";
        let { x, y, w, h } = from;
        if (dir.includes("e")) {
          const r = edge("x", from.x + from.w + dx, ev.altKey);
          w = Math.max(minW, r.at - from.x);
          svg += r.svg;
        }
        if (dir.includes("w")) {
          const r = edge("x", from.x + dx, ev.altKey);
          x = Math.min(r.at, from.x + from.w - minW);
          w = from.x + from.w - x;
          svg += r.svg;
        }
        if (dir.includes("s")) {
          const r = edge("y", from.y + from.h + dy, ev.altKey);
          h = Math.max(minH, r.at - from.y);
          svg += r.svg;
        }
        if (dir.includes("n")) {
          const r = edge("y", from.y + dy, ev.altKey);
          y = Math.min(r.at, from.y + from.h - minH);
          h = from.y + from.h - y;
          svg += r.svg;
        }
        box = { x, y, w, h };
        if (overlay) overlay.innerHTML = svg;
        el.style.transform = `translate(${x}px, ${y}px)`;
        el.style.width = `${w}px`;
        el.style.height = `${h}px`;
      };
      const onUp = () => {
        removeEventListener("pointermove", onMove);
        removeEventListener("pointerup", onUp);
        removeEventListener("pointercancel", onUp);
        clearGuides(overlay);
        el.style.height = "";
        const attrs: Record<string, AttrValue | null> = {};
        const o: Override = {};
        if (box.x !== from.x) o.x = attrs.x = Math.round(box.x);
        if (box.y !== from.y) o.y = attrs.y = Math.round(box.y);

        if (mode === "aspect") {
          /* The shape, not the box. `w` goes with it: a frame width left over from before is what
             would keep the diagram in its old rectangle however ELK folds the content. */
          if (box.w !== from.w) {
            attrs.aspect = Math.round((box.w / Math.max(1, box.h)) * 100) / 100;
            attrs.w = null;
            el.style.width = "";
          }
        } else if (lone && laidOutIn(id)?.nodes[lone.id]) {
          /* A lone shape: the handles mean the shape. Its own `w=`/`h=` change by exactly what
             the item's box did — the frame is the shape plus a bare padding, and it hugs whatever
             the shape becomes — and any `w=`/`h=` left on the fence goes, or it would hold the
             frame at the old size around a shape that has moved on. One op, one undo entry. */
          const now = laidOutIn(id)!.nodes[lone.id]!;
          const g = gridRef.current;
          const w = Math.max(g * 4, snap(now.w + (box.w - from.w), g));
          const h = Math.max(g * 4, snap(now.h + (box.h - from.h), g));
          el.style.width = "";
          if (w === now.w && h === now.h && attrs.x === undefined && attrs.y === undefined) return;
          const at: Record<string, AttrValue | null> = { ...attrs, w: null, h: null };
          if (at.x !== undefined || at.y !== undefined) {
            if (at.x === undefined) at.x = Math.round(from.x);
            if (at.y === undefined) at.y = Math.round(from.y);
          }
          setOverrides((prev) => new Map(prev).set(id, { ...prev.get(id), ...o }));
          const ops: PatchOp[] = [{ id, attrs: at, body: resizeShape(item!.body, lone, w, h) }];
          if (at.x !== undefined) ops.push(...pins([id]));
          void commit(ops);
          return;
        } else if (fixed) {
          /* Hand-placed content: the handles scale the drawing, not a frame around it. */
          const laid = laidOutIn(id);
          /* The factors come off the content extent, not off the frame: the frame is the extent
             plus a constant padding, so scaling the extent by the frame's own ratio would leave
             the frame short of where the pointer let go by twice the padding. Same idiom the
             lone branch uses — the box's delta is added to what the layout last said — because
             it is the same fact being read twice. And the extent is the boxes' own, from their
             corner: a line or a label reaching past them adds a margin that does not
             scale, and counted in, it left the frame short of the pointer by the factor's share. */
          const content = laid ? boxesOf(laid) : null;
          const extentW = content?.w ?? 0;
          const extentH = content?.h ?? 0;
          if (!laid || !content || extentW <= 0 || extentH <= 0) {
            /* An empty fence has no extent to scale, and the frame the pointer moved is still
               real: the plain box write is the whole gesture, and the shared commit below the
               chain is where it lands. */
            if (box.w !== from.w) o.w = attrs.w = Math.round(box.w);
            if (box.h !== from.h) o.h = attrs.h = Math.round(box.h);
          } else {
            const sx = (extentW + (box.w - from.w)) / extentW;
            const sy = (extentH + (box.h - from.h)) / extentH;
            /* The frame hugs the scaled content, so `w=`/`h=` go on the scaled axes — a fence
               width left over from before would hold the frame at the old size around a drawing
               that has moved on, which is exactly why the lone branch clears them. The untouched
               axis's attribute stays alone: a side pull does not pin the other one. */
            el.style.width = "";
            if (sx === 1 && sy === 1 && attrs.x === undefined && attrs.y === undefined) return;
            const at: Record<string, AttrValue | null> = {
              ...attrs,
              ...(sx !== 1 ? { w: null } : {}),
              ...(sy !== 1 ? { h: null } : {}),
            };
            if (at.x !== undefined || at.y !== undefined) {
              if (at.x === undefined) at.x = Math.round(from.x);
              if (at.y === undefined) at.y = Math.round(from.y);
            }
            setOverrides((prev) => new Map(prev).set(id, { ...prev.get(id), ...o }));
            const ops: PatchOp[] = [
              { id, attrs: at, body: scaleFixed(fixed, laid, item!.body, sx, sy, gridRef.current) },
            ];
            if (at.x !== undefined) ops.push(...pins([id]));
            void commit(ops);
            return;
          }
        } else {
          if (box.w !== from.w) o.w = attrs.w = Math.round(box.w);
          if (box.h !== from.h) o.h = attrs.h = Math.round(box.h);
        }
        if (Object.keys(attrs).length === 0) return;
        /* A height is only meaningful with a position to hang it on: an unpinned item that is
           resized is pinned where it flows, so the box stays the box. */
        if (attrs.h !== undefined || attrs.x !== undefined || attrs.y !== undefined) {
          if (attrs.x === undefined) attrs.x = Math.round(from.x);
          if (attrs.y === undefined) attrs.y = Math.round(from.y);
        }
        setOverrides((prev) => new Map(prev).set(id, { ...prev.get(id), ...o }));
        const ops: PatchOp[] = [{ id, attrs }];
        if (attrs.x !== undefined) ops.push(...pins([id]));
        void commit(ops);
      };
      addEventListener("pointermove", onMove);
      addEventListener("pointerup", onUp);
      addEventListener("pointercancel", onUp);
    };

    /*
     * Resize a group as one. The same gesture as `resize` — an edge pulled, snapped to
     * the neighbours' edges or else the grid, the far side held still — on the box around every
     * member, and what each member does to follow is `src/edit/resize.ts`: its box scales, its
     * drawing scales, or it slides.
     *
     * Painted for the duration and written once on release, as every gesture here is: each member's
     * own element and the dashed box, restored to what React last wrote before the write lands so
     * React's next render is the one that says where things are. One commit for all of it, so one
     * ctrl+Z puts the whole group back.
     */
    const resizeGroup: EditorCtl["resizeGroup"] = (name, e, box, dir) => {
      if (e.button !== 0) return;
      const layer = box.closest<HTMLElement>(".dag-layer");
      const zoom = Number(box.closest<HTMLElement>(".dag-viewport")?.dataset.zoom ?? 1) || 1;
      const g = gridRef.current;
      const items = visible().filter((it) => it.group === name);
      const members: Member[] = [];
      for (const it of items) {
        const from = placesRef.current.get(it.id);
        if (from) members.push(memberOf(it, { x: from.x, y: from.y, w: from.w, h: from.h }, laidOutIn(it.id)));
      }
      if (members.length === 0) return;
      const g0 = groupOf(members);
      const least = minimum(members, g0, g);
      const overlay = layer?.querySelector<SVGElement>(".dag-guides") ?? null;
      const inGroup = new Set(members.map((m) => m.id));
      const others: Box[] = [];
      for (const [oid, p] of placesRef.current) if (!inGroup.has(oid)) others.push({ x: p.x, y: p.y, w: p.w, h: p.h });
      const t = SNAP_PX / zoom;
      const sx = e.clientX;
      const sy = e.clientY;

      /* Every element the drag paints, with what React had written on it, to put back on release. */
      const els = new Map<string, HTMLElement>();
      for (const m of members) {
        const el = layer?.querySelector<HTMLElement>(`[data-dag-item="${CSS.escape(m.id)}"]`);
        if (el) els.set(m.id, el);
      }
      const keys = ["transform", "width", "height", "transformOrigin"] as const;
      const saved = new Map<HTMLElement, Record<(typeof keys)[number], string>>();
      for (const el of [box, ...els.values()]) saved.set(el, { transform: el.style.transform, width: el.style.width, height: el.style.height, transformOrigin: el.style.transformOrigin });
      const restore = () => {
        for (const [el, was] of saved) for (const k of keys) el.style[k] = was[k];
      };

      let g1: Box = g0;

      /* One edge on one axis, snapped as `resize` snaps one. */
      const edge = (axis: "x" | "y", at: number, off: boolean): { at: number; svg: string } => {
        const probe: Box = axis === "x" ? { x: at, y: g1.y, w: 0, h: g1.h } : { x: g1.x, y: at, w: g1.w, h: 0 };
        const sn = off ? null : snapBox(probe, others, t);
        const hit = axis === "x" ? sn?.x : sn?.y;
        if (hit === null || hit === undefined) return { at: snap(at, g), svg: "" };
        return { at: hit, svg: guidesToSvg(sn!.guides.filter((q) => q.axis === axis && q.kind === "align"), 0) };
      };

      const onMove = (ev: PointerEvent) => {
        const dx = (ev.clientX - sx) / zoom;
        const dy = (ev.clientY - sy) / zoom;
        let svg = "";
        let { x, y, w, h } = g0;
        if (dir.includes("e")) {
          const r = edge("x", g0.x + g0.w + dx, ev.altKey);
          w = Math.max(least.w, r.at - g0.x);
          svg += r.svg;
        }
        if (dir.includes("w")) {
          const r = edge("x", g0.x + dx, ev.altKey);
          x = Math.min(r.at, g0.x + g0.w - least.w);
          w = g0.x + g0.w - x;
          svg += r.svg;
        }
        if (dir.includes("s")) {
          const r = edge("y", g0.y + g0.h + dy, ev.altKey);
          h = Math.max(least.h, r.at - g0.y);
          svg += r.svg;
        }
        if (dir.includes("n")) {
          const r = edge("y", g0.y + dy, ev.altKey);
          y = Math.min(r.at, g0.y + g0.h - least.h);
          h = g0.y + g0.h - y;
          svg += r.svg;
        }
        g1 = { x, y, w, h };
        if (overlay) overlay.innerHTML = svg;
        /* The dashed box goes around the members' frames, as `App` draws it from the places once
           the write lands, with its padding; its handles are its children and come along. */
        const f = framesOf(members, g0, g1);
        box.style.transform = `translate(${f.x - 8}px, ${f.y - 8}px)`;
        box.style.width = `${f.w + 16}px`;
        box.style.height = `${f.h + 16}px`;
        for (const m of members) {
          const el = els.get(m.id);
          if (!el) continue;
          const p = paintOf(m, g0, g1);
          const scale = p.sx !== undefined ? ` scale(${p.sx}, ${p.sy})` : "";
          el.style.transformOrigin = scale ? "0 0" : saved.get(el)!.transformOrigin;
          el.style.transform = `translate(${p.x}px, ${p.y}px)${scale}`;
          if (p.w !== undefined) el.style.width = `${p.w}px`;
          if (p.h !== undefined) el.style.height = `${p.h}px`;
        }
        previewLinks(members.map((m) => [m.id, placeMember(m, g0, g1)] as const));
      };
      const onUp = () => {
        removeEventListener("pointermove", onMove);
        removeEventListener("pointerup", onUp);
        removeEventListener("pointercancel", onUp);
        clearGuides(overlay);
        previewLinks(null);
        restore();
        if (g1.x === g0.x && g1.y === g0.y && g1.w === g0.w && g1.h === g0.h) return;
        const ops: PatchOp[] = [];
        const o = new Map<string, Override>();
        for (const m of members) {
          const it = items.find((x) => x.id === m.id)!;
          const op = memberOps(it, m, g0, g1, laidOutIn(m.id), g);
          if (!op) continue;
          ops.push(op);
          /* What the page shows until the file comes back: the new place, and the new box where
             the box is the member's own — never a drawing's, which is the layout's answer and is
             snapped to the grid on the way back, so a predicted one might never be agreed with and
             an override is only let go once the file says the same thing. `resize`'s rule. */
          const attrs = "attrs" in op ? (op.attrs ?? {}) : {};
          o.set(m.id, {
            ...(typeof attrs.x === "number" ? { x: attrs.x, y: attrs.y as number } : {}),
            ...(m.follows === "box" && typeof attrs.w === "number" ? { w: attrs.w } : {}),
            ...(m.follows === "box" && typeof attrs.h === "number" ? { h: attrs.h } : {}),
          });
        }
        if (ops.length === 0) return;
        setOverrides((prev) => {
          const next = new Map(prev);
          for (const [id, v] of o) next.set(id, { ...prev.get(id), ...v });
          return next;
        });
        /* Placing anything pins the page's unplaced items where they flow, as a move does. */
        if (ops.some((op) => "attrs" in op && op.attrs && "x" in op.attrs)) ops.push(...pins([...inGroup]));
        void commit(ops);
      };
      addEventListener("pointermove", onMove);
      addEventListener("pointerup", onUp);
      addEventListener("pointercancel", onUp);
    };

    /**
     * Pulling a link out of an item's side.
     *
     * The same shape as every other gesture here: paint while the pointer is down, write once on
     * release. What is different is that the drop target is read out of the DOM rather than out of
     * geometry — `elementFromPoint` and two `closest()` calls say which card inside which diagram
     * is under the pointer, and the page is the only thing that knows that for certain.
     *
     * The line is painted into `.dag-guides`, the layer the smart guides use: it already shares the
     * board's transform, already overflows, and already takes no pointer. `data-dag-connecting` on
     * the root is what stops the link layer's own hit strokes from answering `elementFromPoint`
     * instead of the item under them.
     */
    const connect: EditorCtl["connect"] = (id, e, el, side, start) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      e.preventDefault();

      /* A group has no entry in `places` — it is not an item — so its box has to be handed in. */
      const place = start?.box ?? placesRef.current.get(id);
      if (!place) return;
      const layer = el.closest<HTMLElement>(".dag-layer");
      const overlay = layer?.querySelector<SVGElement>(".dag-guides") ?? null;
      const from = handleAt(place, side);
      /* The source is the *card* when the handles belong to one, which is what makes a drop on
         another card in the same diagram an edge in that diagram's body rather than a refusal:
         `connectable` allows two different cards under one item, and it always could. */
      const source: Target = !start ? { item: id } : "node" in start ? { item: id, node: start.node } : { item: id, group: true };
      const dotR = gridRef.current / 2;

      let over: Target | null = null;
      let marked: HTMLElement | null = null;
      const mark = (next: HTMLElement | null) => {
        if (marked === next) return;
        if (marked) delete marked.dataset.dagDrop;
        marked = next;
        if (marked) marked.dataset.dagDrop = "";
      };

      document.documentElement.dataset.dagConnecting = "";

      const onMove = (ev: PointerEvent) => {
        const at = toBoard(ev.clientX, ev.clientY);
        const under = document.elementFromPoint(ev.clientX, ev.clientY);
        const hit = targetAt(under);
        over = hit && connectable(source, hit) ? hit : null;
        mark(
          over
            ? (under?.closest<HTMLElement>("[data-dag-node]") ?? under?.closest<HTMLElement>("[data-dag-item]") ?? null)
            : null,
        );
        if (overlay) overlay.innerHTML = connectSvg(from, at, side, over !== null, dotR);
      };

      const onUp = () => {
        removeEventListener("pointermove", onMove);
        removeEventListener("pointerup", onUp);
        removeEventListener("pointercancel", onUp);
        removeEventListener("keydown", onKey, true);
        delete document.documentElement.dataset.dagConnecting;
        mark(null);
        if (overlay) overlay.innerHTML = "";
        /* Eat the click that ends the gesture, or the release over an item selects it. */
        addEventListener("click", (c) => c.stopPropagation(), { capture: true, once: true });
        if (over) addLink(source, over);
      };

      /* Escape abandons it. Captured, because the board's own key handler would take the key first
         and read it as "clear the selection". */
      const onKey = (ev: KeyboardEvent) => {
        if (ev.key !== "Escape") return;
        ev.preventDefault();
        ev.stopPropagation();
        over = null;
        onUp();
      };

      addEventListener("pointermove", onMove);
      addEventListener("pointerup", onUp);
      addEventListener("pointercancel", onUp);
      addEventListener("keydown", onKey, true);
    };

    /**
     * Where a link's statement is: the `edges` fence it was read from, and the line inside it.
     *
     * The board is one round trip stale after a write, so this is read at the moment of the
     * gesture rather than carried from the press — the same reason `nodeDrag` re-reads its item
     * before it writes.
     */
    const linkAt = (id: string): { fence: BoardItem; line: number; src: string } | null => {
      const b = boardRef.current;
      const link = b?.links.find((l) => l.id === id);
      const fence = link && b!.items.find((it) => it.id === link.fence);
      if (!link || !fence) return null;
      const line = link.line - fence.line;
      const src = fence.body.split("\n")[line - 1];
      return src === undefined ? null : { fence, line, src };
    };

    /* `BoardEdges` is the only listener, and its `BendPreview` is the shape. Built inline, the way
       `previewLinks` above builds `LinkPreview`'s: this layer does not import from `src/render/`. */
    const previewBend = (detail: { id: string; at: Point | null } | null) =>
      document.dispatchEvent(new CustomEvent("dag:link-bend", { detail }));

    /**
     * Pull the picked line through a point.
     *
     * Everything a drag on this board writes is a coordinate, and for once that is the easy half:
     * a link lives on the paper, where `x=` and `y=` are what every item already says, so the bend
     * is written in board coordinates like anything else. What takes the thinking is that the
     * curve has to be under the pointer *before* the file says so, and the link layer is the one
     * tree allowed to re-render during a gesture — so the point goes out on `dag:link-bend` every
     * frame and `BoardEdges` simply routes again. Nothing else on the page hears it.
     *
     * Snapped to the grid, like every other coordinate a drag writes, and written once on release.
     * A press that never moved leaves the line alone: the handle is also the thing you double-click
     * to straighten, and a click that quietly rewrote the statement to the value it already held
     * would put an undo entry in the way of the gesture that follows it.
     */
    const bendLink: EditorCtl["bendLink"] = (id, e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const sx = e.clientX;
      const sy = e.clientY;
      let moved = false;
      let at: Point | null = null;

      const onMove = (ev: PointerEvent) => {
        if (!moved) {
          if (Math.abs(ev.clientX - sx) + Math.abs(ev.clientY - sy) < DRAG_SLOP) return;
          moved = true;
          document.documentElement.dataset.dagBending = "";
        }
        const p = toBoard(ev.clientX, ev.clientY);
        const g = gridRef.current;
        at = { x: snap(p.x, g), y: snap(p.y, g) };
        previewBend({ id, at });
      };

      const onUp = () => {
        removeEventListener("pointermove", onMove);
        removeEventListener("pointerup", onUp);
        removeEventListener("pointercancel", onUp);
        delete document.documentElement.dataset.dagBending;
        previewBend(null);
        if (!moved || !at) return;
        /* Eat the click that ends the drag, or the release counts as a second press on the handle
           and the double-click that straightens is one press closer than it should be. */
        addEventListener("click", (c) => c.stopPropagation(), { capture: true, once: true });
        const spot = linkAt(id);
        if (spot) void commit([{ id: spot.fence.id, body: replaceLine(spot.fence.body, spot.line, setLinkVia(spot.src, at)) }]);
      };

      addEventListener("pointermove", onMove);
      addEventListener("pointerup", onUp);
      addEventListener("pointercancel", onUp);
    };

    const straightenLink: EditorCtl["straightenLink"] = (id) => {
      const spot = linkAt(id);
      if (spot) void commit([{ id: spot.fence.id, body: replaceLine(spot.fence.body, spot.line, setLinkVia(spot.src, null)) }]);
    };

    /**
     * The `+` on a picked card: a second card on that side, and the edge to it.
     *
     * A press rather than a click, and a release rather than a `click` event, so that the gesture
     * can tell a tap from a pull — which is the whole difference in a fixed fence, where the
     * coordinate is the placement and the arrow is a separate claim. Everywhere else both do the
     * same thing, and being lenient about a few pixels of travel is what makes a `+` feel like a
     * button rather than a trap.
     */
    const growHandle: EditorCtl["grow"] = (id, e, el, side) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      e.preventDefault();
      const sx = e.clientX;
      const sy = e.clientY;
      let moved = false;
      const onMove = (ev: PointerEvent) => {
        if (Math.abs(ev.clientX - sx) + Math.abs(ev.clientY - sy) >= DRAG_SLOP) moved = true;
      };
      const onUp = () => {
        removeEventListener("pointermove", onMove);
        removeEventListener("pointerup", onUp);
        removeEventListener("pointercancel", onUp);
        /* Eat the click that ends the gesture, or the release selects whatever is under it. */
        addEventListener("click", (c) => c.stopPropagation(), { capture: true, once: true });
        growFrom(side, moved);
      };
      void id;
      void el;
      addEventListener("pointermove", onMove);
      addEventListener("pointerup", onUp);
      addEventListener("pointercancel", onUp);
    };

    const rename: EditorCtl["rename"] = (id, el) => {
      const at = nameableUnder(el);
      return at ? startRename(id, at) : false;
    };

    /* Every method that writes, or opens something that does, asks the lock first. The
       handles that call most of these are not drawn while locked; this is what holds when one is
       reached anyway — a key, a menu, a test. A refused rename says it was handled, so a
       double-click does not go on to open the panel and be refused twice. */
    const held =
      <A extends unknown[], R>(f: (...a: A) => R, refused: R) =>
      (...a: A): R =>
        lockedRef.current ? (refuseLocked(), refused) : f(...a);
    return {
      press,
      resize: held(resize, undefined),
      resizeGroup: held(resizeGroup, undefined),
      connect: held(connect, undefined),
      bendLink: held(bendLink, undefined),
      straightenLink: held(straightenLink, undefined),
      grow: held(growHandle, undefined),
      rename: held(rename, true),
      open: held(open, undefined),
      remove: held(remove, undefined),
      duplicate: held(duplicate, undefined),
      bringToFront: held(bringToFront, undefined),
      sendToBack: held(sendToBack, undefined),
      pickEdge,
      write: held(writePrompt, Promise.resolve()),
      generate: generateFor,
      accept: held(acceptDraft, Promise.resolve(false)),
      rewrite,
      applyRewrite: held(applyRewrite, Promise.resolve(false)),
    };
  }, [move, commit, open, remove, duplicate, bringToFront, sendToBack, withGroups, pins, addLink, toBoard, paint, pickNode, pickEdge, clearPick, growFrom, startRename, nodeDrag, writePrompt, generateFor, acceptDraft, rewrite, applyRewrite]);

  const onMarquee = useCallback((rect: Rect, additive: boolean) => {
    const hit: string[] = [];
    for (const [id, p] of placesRef.current) {
      if (p.x < rect.x + rect.w && p.x + p.w > rect.x && p.y < rect.y + rect.h && p.y + p.h > rect.y) hit.push(id);
    }
    /* Only what is on this page: `places` is already per page, by way of `placeItems`. Touching
       one member of a group takes the group. */
    const all = withGroups(hit);
    setSelected((prev) => (additive ? new Set([...prev, ...all]) : all));
    setPickedLink(null);
    clearPick();
  }, [withGroups, clearPick]);

  const onPaperClick = useCallback(() => {
    clear();
    setEditing(null);
    setPickedLink(null);
    clearPick();
  }, [clear, clearPick]);

  const onPaperDoubleClick = useCallback((at: Point) => add("md", at), [add]);

  /**
   * The pen: a stroke becomes an item.
   *
   * One commit — `insert` builds the insert op and any first-pin ops into one patch — so one
   * ctrl+Z takes the stroke back whole. The panel does not open: a drop
   * opens it only when the item's body is prose the canvas cannot edit, and a stroke is a drawing
   * every gesture of which already lives on the canvas. The pen stays armed, so the next press
   * draws the next stroke — and for the same reason the stroke is **not selected**, which is the
   * one place this differs from every other `insert`: see the note on its `select` argument.
   *
   * The id is fresh by the machinery that already exists: `freshNodeId`, the same scheme the `+`
   * uses, over the new (empty) body. An item's body is its own id space — the library's golden
   * file shows a Circle dropped twice each landing `circle1` — so a fresh one-node item needs a
   * name nothing in *its* body says, and that is what the helper answers.
   */
  const onInk = useCallback(
    (raw: Point[]) => {
      const g = gridRef.current;
      const zoom = viewport.current?.zoom() ?? 1;
      const statement = inkStatement(raw, zoom, g, freshNodeId("", "ink"));
      if (!statement) return;
      void insert([{ type: "sketch", attrs: statement.attrs, body: statement.body }], undefined, false);
    },
    [insert, viewport],
  );

  /*
   * Save what is selected as a component.
   *
   * The bytes are the items' own source — `itemsToText` is the same flavour a copy puts on the
   * clipboard — under a frontmatter block saying what the thing is. It goes through `/create`,
   * which keeps the name unique, so saving twice gives two components rather than silently
   * replacing one. The library opens afterwards, because a save with no visible result is a save a
   * person cannot trust.
   */
  const saveAsComponent = useCallback(
    async (name?: string): Promise<string | null> => {
      const b = boardRef.current;
      if (!b) return null;
      if (lockedRef.current) return refuseLocked(), null;
      const sel = selectedRef.current;
      const chosen = sel.size ? b.items.filter((it) => sel.has(it.id)) : visible();
      if (chosen.length === 0) return null;

      const one = chosen.length === 1 ? chosen[0]! : null;
      const title = name?.trim() || one?.title?.trim() || (one ? `A ${one.type}` : `${chosen.length} items`);
      const description = one
        ? `${one.type}, saved from \`${b.name}\``
        : `${chosen.length} items, saved from \`${b.name}\``;
      const icon = one && isDiagramType(one.type) ? "Boxes" : "Layers";
      const text = `${componentFrontmatter(title, description, icon)}\n${itemsToText(chosen)}\n`;

      const stem = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "component";
      const r = await fetch("/__board/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: `components/${stem}`, text }),
      });
      if (!r.ok) return null;
      const made = (await r.json()) as { name?: string };
      onLibraryOpenRef.current?.();
      return made.name ?? null;
    },
    [visible],
  );

  /**
   * Pages.
   *
   * `page-1` is the default an item with no `page=` falls on, so moving something there takes the
   * attribute off rather than writing it: a one-page board should not end up with `page=page-1` on
   * every fence line it has.
   */
  const pages = useMemo(() => {
    const list = (): BoardPage[] => boardRef.current?.pages ?? [];
    const write = (next: BoardPage[], more: PatchOp[] = []) => {
      const meta: MetaOp = { meta: { pages: next.map((p) => ({ id: p.id, name: p.name })) } };
      return commit([meta, ...more]);
    };
    const pageAttr = (id: string) => (id === "page-1" ? null : id);

    return {
      add() {
        const had = list();
        const taken = new Set(had.map((p) => p.id));
        let n = had.length + 1;
        while (taken.has(`page-${n}`)) n++;
        const id = `page-${n}`;
        void write([...had, { id, name: `Page ${had.length + 1}` }]).then((ok) => {
          if (ok) onOpenPageRef.current?.(id);
        });
      },
      rename(id: string, name: string) {
        const next = list().map((p) => (p.id === id ? { ...p, name } : p));
        void write(next);
      },
      remove(id: string) {
        const had = list();
        if (had.length < 2) return;
        const next = had.filter((p) => p.id !== id);
        const to = next[0]!.id;
        /* Whatever was on it comes with it rather than vanishing: an item on a page nobody
           declares is moved to the first one by `parseBoard` anyway, and doing it here means the
           file says so and the undo can take it back. */
        const moves: PatchOp[] = (boardRef.current?.items ?? [])
          .filter((it) => it.page === id)
          .map((it) => ({ id: it.id, attrs: { page: pageAttr(to) } }));
        void write(next, moves).then((ok) => {
          if (ok && pageRef.current === id) onOpenPageRef.current?.(to);
        });
      },
      moveTo(id: string, ids?: string[]) {
        const which = ids ?? [...selectedRef.current];
        if (which.length === 0) return;
        void commit(which.map((it) => ({ id: it, attrs: { page: pageAttr(id) } })));
      },
      reorder(id: string, before: string | null) {
        const had = list();
        const next = reorderPages(had, id, before);
        /* Identity, not equality: `reorderPages` hands back the same array when the drop asked
           for the order the board already has, and writing it would be an undo entry that undoes
           nothing — plus a round trip through the patcher for a file that would come back byte
           for byte the same. */
        if (next === had) return;
        void write(next);
      },
    };
  }, [commit]);

  const replace = useCallback<Editor["replace"]>(
    (id, next) => {
      void commit([{ id, ...next }]);
    },
    [commit],
  );

  const group = useCallback(() => {
    const b = boardRef.current;
    const sel = selectedRef.current;
    if (!b || sel.size < 2) return;
    /* One group out of whatever was selected, groups included: the members merge. */
    const taken = new Set(b.items.map((it) => it.group ?? ""));
    const name = freshId("group", taken);
    void commit([...sel].map((id) => ({ id, attrs: { group: name } })));
  }, [commit]);

  const ungroup = useCallback(() => {
    const b = boardRef.current;
    const sel = selectedRef.current;
    if (!b) return;
    const ops: PatchOp[] = b.items.filter((it) => sel.has(it.id) && it.group).map((it) => ({ id: it.id, attrs: { group: null } }));
    if (ops.length) void commit(ops);
  }, [commit]);

  const onHelpRef = useRef(onHelp);
  onHelpRef.current = onHelp;
  const onBoardsRef = useRef(onBoards);
  onBoardsRef.current = onBoards;
  const onSettingsRef = useRef(onSettings);
  onSettingsRef.current = onSettings;
  const onOpenBoardRef = useRef(onOpenBoard);
  onOpenBoardRef.current = onOpenBoard;
  const onOpenPageRef = useRef(onOpenPage);
  onOpenPageRef.current = onOpenPage;

  /* ---- export ---- */

  /**
   * The items to export, as boxes at zoom 1 with their elements. The height is measured, not the
   * flow's guess: `place.h` is what the flow was told, the element is what is on screen.
   */
  const partsFor = useCallback((ids?: string[]) => {
    const layer = document.querySelector<HTMLElement>(".dag-layer");
    const zoom = Number(document.querySelector<HTMLElement>(".dag-viewport")?.dataset.zoom ?? 1) || 1;
    const want = ids ? new Set(ids) : null;
    const out: { el: HTMLElement; x: number; y: number; width: number; height: number; id: string }[] = [];
    for (const it of visible()) {
      if (want && !want.has(it.id)) continue;
      const el = layer?.querySelector<HTMLElement>(`[data-dag-item="${CSS.escape(it.id)}"]`);
      const p = placesRef.current.get(it.id);
      if (!el || !p) continue;
      const inner = el.querySelector<HTMLElement>(".dag-item__body");
      const height = (inner?.getBoundingClientRect().height ?? p.h * zoom) / zoom;
      out.push({ el, x: p.x, y: p.y, width: p.w, height, id: it.id });
    }
    return out;
  }, [visible]);

  /**
   * The link layer as a part, at its board position.
   *
   * It paints `transform: translate(x, y)` rather than carrying its position in React, the same
   * channel every gesture uses, so its offset is read back off the element. Absent when the board
   * has no links, which is most boards.
   */
  const linkLayer = useCallback((): { el: HTMLElement; x: number; y: number; width: number; height: number } | undefined => {
    const el = document.querySelector<HTMLElement>(".dag-board-edges");
    if (!el) return undefined;
    const m = /translate\(\s*(-?[\d.]+)px[,\s]+(-?[\d.]+)px/.exec(el.style.transform);
    return {
      el,
      x: m ? Number(m[1]) : 0,
      y: m ? Number(m[2]) : 0,
      width: el.offsetWidth,
      height: el.offsetHeight,
    };
  }, []);

  /**
   * What an export of the board, or of some items on it, is — the SVG, or the PNG rasterised from
   * it — without saving it anywhere. `exportAs` saves it as a download; `dag:export` below hands it
   * to whoever asked, which is how `anydag board export` gets exactly the file the menu would have.
   */
  const renderExport = useCallback(
    async (kind: "svg" | "png", ids?: string[]): Promise<string | Blob> => {
      const b = boardRef.current;
      if (!b) throw new Error("no board is open");
      const parts = partsFor(ids);
      if (parts.length === 0) throw new Error("nothing to export");
      const title = b.title ?? b.name;
      /* Read here, at the moment of the gesture, rather than held in state: a preference must not
         be able to re-render a memoised `Item`. */
      const opts = readSettings().export;
      /* One item is exported edge to edge, as the chip always did; a board gets a margin of paper. */
      const svg =
        parts.length === 1 && ids
          ? await itemToSvg(parts[0]!.el, { width: Math.ceil(parts[0]!.width), height: Math.ceil(parts[0]!.height), title })
          : await boardToSvg(parts, {
              title,
              margin: gridRef.current * opts.margin,
              overlay: linkLayer(),
              paper: opts.paper,
            });
      if (kind === "svg") return svg;
      const size = /width="(\d+)" height="(\d+)"/.exec(svg);
      return svgToPng(svg, Number(size?.[1] ?? 0), Number(size?.[2] ?? 0), opts.scale);
    },
    [partsFor, linkLayer],
  );

  const exportAs = useCallback(
    async (kind: "svg" | "png" | "md", ids?: string[]) => {
      const b = boardRef.current;
      if (!b) throw new Error("no board is open");
      const stem = ids?.length === 1 ? `${fileStem(b.name)}-${fileStem(ids[0]!)}` : fileStem(b.name);
      if (kind === "md") {
        /* The id is the store's, not the file's, so the copy in transit carries it as an envelope
           and an import of it keeps every reference to this board working. */
        const text = handleRef.current.current()?.text ?? "";
        const id = handleRef.current.docId;
        /* With the pictures and the attachments it names beside it, in a zip, when it names any
 — the text alone otherwise, as it always was. */
        await saveWithFiles(b.name, `${fileStem(b.name)}.board.md`, id ? sealId(text, id) : text);
        return;
      }
      const out = await renderExport(kind, ids);
      if (kind === "svg") saveFile(`${stem}.svg`, out, "image/svg+xml");
      else saveFile(`${stem}.png`, out);
    },
    [renderExport],
  );

  /* `dag:export` on the document renders what the Export menu would save and hands it back through
     `detail.reply` — the SVG's text, or the PNG as a data URL — rather than downloading it. It is
     `dag:tidy`'s shape and for `dag:tidy`'s reason: a script drives the page under `?snapshot=1`,
     where there is no menu, and `anydag board export` is that script. A callback rather than a
     data attribute, because an SVG with its fonts embedded is megabytes. */
  useEffect(() => {
    const onExport = (e: Event) => {
      const d = (e as CustomEvent<{ kind?: string; ids?: string[]; reply?: (v: string) => void; fail?: (why: string) => void } | null>).detail;
      if (!d?.reply || (d.kind !== "svg" && d.kind !== "png")) return;
      const { reply, fail } = d;
      renderExport(d.kind, d.ids).then(
        (out) => {
          if (typeof out === "string") return reply(out);
          const r = new FileReader();
          r.onload = () => reply(String(r.result));
          r.onerror = () => fail?.("could not read the PNG back");
          r.readAsDataURL(out);
        },
        (why: unknown) => fail?.(why instanceof Error ? why.message : String(why)),
      );
    };
    document.addEventListener("dag:export", onExport);
    return () => document.removeEventListener("dag:export", onExport);
  }, [renderExport]);

  /* ---- import ---- */

  const readText = (file: File) =>
    new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(new Error(`could not read ${file.name}`));
      r.readAsText(file);
    });
  const readDataUrl = (file: Blob) =>
    new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(new Error(`could not read ${(file as File).name || "the image"}`));
      r.readAsDataURL(file);
    });

  /* The one path a pasted or dropped image takes, whichever gesture brought it.
     Both callers used to post a literal `w: 520`, which is why a 1002-pixel screenshot arrived
     soft: it was drawn at half size and then again at the board's zoom. The width is now the
     placement rule's answer, and the bytes are still the clipboard's own unless somebody has asked
     for a cap. Everything here is best-effort — an image that will not decode is posted exactly as
     it arrived, at the fallback width, because refusing a paste outright is the worse failure. */
  const stageImage = async (file: Blob, grid: number): Promise<{ dataUrl: string; w: number }> => {
    const rule = readSettings().paste;
    /* A vector has no pixels to lose and an animation has frames a canvas would drop, so neither is
       ever resampled — a cap is about the size of a screenshot on disk, not about turning an SVG
       into a bitmap or a GIF into its first frame. */
    const raster = file.type !== "image/svg+xml" && file.type !== "image/gif";
    let blob = file;
    let stored = 0;

    try {
      const probe = await createImageBitmap(file);
      stored = probe.width;
      const cap = raster ? storedWidth({ w: probe.width, h: probe.height }, rule) : null;
      probe.close();
      if (cap !== null) {
        const small = await createImageBitmap(file, { resizeWidth: cap, resizeQuality: "high" });
        const canvas = document.createElement("canvas");
        canvas.width = small.width;
        canvas.height = small.height;
        canvas.getContext("2d")?.drawImage(small, 0, 0);
        small.close();
        /* PNG, always. What lands here is a screenshot with text in it, and lossy encoding is
           exactly the defect resampling here would keep. */
        const out = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"));
        if (out) {
          blob = out;
          stored = canvas.width;
        }
      }
    } catch {
      /* An undecodable blob, or a browser without `createImageBitmap` options. The bytes are still
         perfectly good and `placedWidth` falls back to the fixed width when it has no size. */
    }

    return { dataUrl: await readDataUrl(blob), w: placedWidth(stored, devicePixelRatio, rule, grid) };
  };

  /*
   * A file from the computer kept as an attachment — in the board's own folder, so a board
   * and what it shows move together — and the item that shows it: a picture's `image` fence, drawn
   * from the file by id at the width the placement rule gives it, or the placed card anything else
   * is. **A drop, Import and a pasted file are uploads**;
   * only a pasted *image* stays the board's own picture (`onPaste`). Refusals are said on the board
   * (`dag:upload-problem`), since a drop has nowhere else to answer.
   */
  const attachFile = async (file: File, at: Point): Promise<NewItem | null> => {
    const b = boardRef.current;
    if (!b) return null;
    const folder = b.name.includes("/") ? b.name.slice(0, b.name.lastIndexOf("/")) : "";
    const got = await uploadFile(file, folder);
    if ("error" in got) {
      document.dispatchEvent(new CustomEvent("dag:upload-problem", { detail: got.error }));
      return null;
    }
    let w: number | undefined;
    if (file.type.startsWith("image/")) {
      try {
        const probe = await createImageBitmap(file);
        w = placedWidth(probe.width, devicePixelRatio, readSettings().paste, gridRef.current);
        probe.close();
      } catch {
        /* A picture the browser cannot decode lands at the card's width; it is still the file. */
      }
    }
    const card = fileCard({ id: got.id, name: got.name, title: got.title }, w);
    return { type: card.type, attrs: { ...card.attrs, x: at.x, y: at.y }, body: render(card) };
  };

  const importFiles = useCallback(
    async (files: File[], at?: Point) => {
      const b = boardRef.current;
      if (!b || files.length === 0) return;
      if (lockedRef.current) return void refuseLocked();
      const g = gridRef.current;
      const origin = at ?? viewport.current?.center() ?? { x: 0, y: 0 };
      let x = snap(origin.x, g);
      let y = snap(origin.y, g);
      const step = g * 10;
      const items: NewItem[] = [];

      for (const file of files) {
        const name = file.name.toLowerCase();
        /* A CSV is a table: a new table of it, and its card
           placed where it was dropped — the card a sidebar row dropped here would place. Asked before
           the attachment branch below, which would otherwise upload it as a file. */
        if (/\.(csv|tsv)$/.test(name) || file.type === "text/csv" || file.type === "text/tab-separated-values") {
          const title = file.name.replace(/\.(csv|tsv)$/i, "") || "Imported";
          const table = tableFromCsv(title, csvTab(await readText(file)));
          if (!table) continue;
          const r = await fetch("/__board/create", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: title, text: table, kind: "table" }),
          });
          if (!r.ok) continue;
          const made = (await r.json()) as { name?: string; id?: string };
          if (!made.name || !made.id) continue;
          const card = noteCard({ id: made.id, name: made.name, title, kind: "table" });
          items.push({ type: card.type, attrs: { ...card.attrs, x, y }, body: render(card) });
          y += step * 4;
          continue;
        }
        /* Text becomes items, and a whole board, note, quiz or table a file of its own, as ever. Everything
           else — a picture, a PDF, a sheet — is an attachment, placed where it was let go. */
        const prose = /\.(md|txt|markdown)$/.test(name) || (file.type === "text/plain" && !/\.[a-z0-9]+$/.test(name));
        if (!prose) {
          const it = await attachFile(file, { x, y });
          if (it) {
            items.push(it);
            y += it.type === "image" ? step * 4 : step;
          }
          continue;
        }
        const text = await readText(file);
        /* A whole file becomes a file of its own, **of the kind its name says**. A note or
           a quiz is Markdown with frontmatter too, and until the quiz this read any frontmatter as a
           board — so an exported `.note.md` dropped back in came out a board called `x-note`. A
           plain `.md` with frontmatter is still a board, as it always was. */
        const kind = importKind(name, text);
        if (kind) {
          /* An exported file says who it is in its frontmatter; the store adopts that id when it is
             free and the envelope never reaches the stored text. */
          const opened = openId(text);
          const r = await fetch("/__board/create", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: file.name.replace(/\.(?:board|note|quiz|table)\.md$|\.md$/i, ""),
              text: opened.text,
              id: opened.id,
              ...(kind === "board" ? {} : { kind }),
            }),
          });
          if (r.ok) {
            const made = (await r.json()) as { name?: string };
            if (made.name) onOpenBoardRef.current?.(made.name, kind);
          }
          continue;
        }
        for (const it of textToItems(text)) {
          if (typeof it.attrs.x !== "number" || typeof it.attrs.y !== "number") {
            it.attrs.x = x;
            it.attrs.y = y;
            y += step;
          }
          items.push(it);
        }
      }
      if (items.length) await insert(items);
    },
    [insert, viewport],
  );

  /* ---- history ---- */

  const undo = useCallback(() => {
    if (lockedRef.current) return void refuseLocked();
    const cur = handleRef.current.current();
    if (!cur) return;
    const text = history.undo(cur.base);
    setTick((t) => t + 1);
    if (text === null) return;
    void handleRef.current.put(text).then((w) => {
      if (!w) history.clear();
      setTick((t) => t + 1);
    });
  }, [history]);

  const redo = useCallback(() => {
    if (lockedRef.current) return void refuseLocked();
    const cur = handleRef.current.current();
    if (!cur) return;
    const text = history.redo(cur.base);
    setTick((t) => t + 1);
    if (text === null) return;
    void handleRef.current.put(text).then((w) => {
      if (!w) history.clear();
      setTick((t) => t + 1);
    });
  }, [history]);

  /* A new board is a new document; what was undoable on the last one is not on this one. */
  useEffect(() => {
    history.clear();
    setSelected(new Set());
    setEditing(null);
    clearPick();
    setTick((t) => t + 1);
  }, [board?.name, history, clearPick]);

  /* ---- the editor panel's writes ---- */

  const setBody = useCallback(
    (id: string, body: string) => void commit([{ id, body }], `body:${id}`),
    [commit],
  );
  const setAttrs = useCallback(
    (id: string, attrs: Record<string, AttrValue | null>) =>
      void commit([{ id, attrs }], `attrs:${id}:${Object.keys(attrs).join(",")}`),
    [commit],
  );

  /* ---- keys and the clipboard ---- */

  /* Where the pointer last was, so a paste lands under it rather than in a corner. */
  const pointer = useRef<{ x: number; y: number; over: boolean }>({ x: 0, y: 0, over: false });

  useEffect(() => {
    if (!enabled) return;

    const onPointer = (e: PointerEvent) => {
      pointer.current = {
        x: e.clientX,
        y: e.clientY,
        over: e.target instanceof Element && e.target.closest(".dag-viewport") !== null,
      };
    };

    /*
     * The chord's own state, local to the effect that owns the listeners.
     *
     * `showAt` is the timer that puts the overlay up; `shutAt` is the one that gives up on a chord
     * nobody completed. A chord is live from the moment Space goes down until something closes it,
     * which is a binding, Escape, any other key, a pointer going down (that press was a pan), the
     * window losing focus, or `CHORD_MS` passing.
     */
    let showAt = 0;
    let shutAt = 0;
    const shutChord = () => {
      clearTimeout(showAt);
      clearTimeout(shutAt);
      if (!chordRef.current) return;
      chordRef.current = false;
      setChord(false);
    };
    const openChord = () => {
      chordRef.current = true;
      clearTimeout(showAt);
      clearTimeout(shutAt);
      showAt = window.setTimeout(() => setChord(true), WHICHKEY_MS);
    };

    /** One place saying which callback a binding names, so the table itself holds no closures. */
    const run = (command: Command) => {
      const at = () =>
        pointer.current.over ? viewport.current?.toBoard(pointer.current.x, pointer.current.y) : undefined;
      switch (command) {
        case "select":
          return setTool("select");
        case "hand":
          return setTool("hand");
        case "pen":
          return setTool("pen");
        case "note":
          return add("md", at());
        case "prompt":
          return add("prompt", at());
        case "library":
          return onLibraryRef.current?.();
        case "links":
          return links();
        case "tidy":
          return void tidyUp();
        case "boards":
          return onBoardsRef.current?.();
        case "assistant":
          return toggleAssistant();
        case "help":
          return onHelpRef.current?.();
      }
    };

    /* On Linux a middle click is also a paste — of the X11 primary selection — and a middle drag
       is how the board is panned over an item. Chromium fires `paste` for it, so a pan would drop
       whatever text was last selected anywhere onto the board as a note. A paste on the heels of a
       middle press is that, not a person pressing ctrl+V. */
    let middleAt = -Infinity;
    const onPress = (e: PointerEvent) => {
      if (e.button === 1) middleAt = performance.now();
      /* Space held plus a button down is the pan, which is the one gesture the leader shares a key
         with. Any other press is a person reaching for the board rather than finishing a chord, and
         both want the same answer. */
      shutChord();
    };

    const nudge = (dx: number, dy: number) => {
      const pending = nudging.current ?? new Map<string, Point>();
      const moves = new Map<string, Point>();
      for (const id of selectedRef.current) {
        /* The pending target first: a repeat that arrives before React has rendered the last one
           would otherwise read a stale `places` and ask for a step that has already been taken. */
        const from = pending.get(id) ?? placesRef.current.get(id);
        if (from) moves.set(id, { x: from.x + dx, y: from.y + dy });
      }
      if (!moves.size) return;
      paintMove(moves);
      for (const [id, at] of moves) pending.set(id, at);
      nudging.current = pending;
      /* The keyup is what normally writes this. The timer is for the run that never gets one — a
         window blurred with the key still down, or focus taken by something else mid-repeat. */
      if (settle.current !== null) clearTimeout(settle.current);
      settle.current = window.setTimeout(() => flushNudge(false), NUDGE_SETTLE);
    };

    /*
     * On the window, in the capture phase, so an arrow with a selection nudges the items and never
     * reaches the viewport's pan; everything not handled here is left alone.
     *
     * Space is the one key both this and the viewport answer to — the leader here, the pan modifier
     * there — and it is the one key this handler deliberately does not swallow. See the chord
     * branch below.
     */
    const onKey = (e: KeyboardEvent) => {
      /* The Settings modal owns every key aimed at it. This handler runs first, in the
         capture phase, and a click on a blank part of the modal leaves the focus on the modal
         itself rather than on a control — so without this an arrow or a Delete pressed there moved
         or deleted what is selected on the board behind it. Its Escape and `ctrl+,` are its own.
         The logs question (`telemetry/Prompt.tsx`) is the same kind of card, and the same rule. */
      if (e.target instanceof Element && e.target.closest("[data-dag-settings],[data-dag-telemetry-ask]")) return;
      if (typing(e.target)) {
        /* Focus reached a control while a chord was open. The chord was never meant for it, and
           leaving it open would make the next letter typed in there mean two things at once —
           which is the defect this whole mechanism exists to close. */
        shutChord();
        return;
      }
      const mod = e.ctrlKey || e.metaKey;
      const sel = selectedRef.current;
      /* A pick is a thing inside a diagram, and every key below that has a meaning for one takes
         it before the item-level meaning: the card is the more specific thing under the pointer,
         the way a group member is once it has been picked out. */
      const pn = pickedNodeRef.current;
      const pe = pickedEdgeRef.current;
      const g = gridRef.current;
      const step = e.shiftKey ? g * 10 : g;
      const take = () => {
        e.preventDefault();
        e.stopPropagation();
      };

      /*
       * The leader, ahead of everything — including Escape, because a chord that is open is the
       * innermost thing being held, and the innermost thing held is the first thing let go.
       *
       * Space is both the leader and the viewport's pan modifier, and the two do not collide
       * because a pan involves the pointer: `onPress` takes the chord back the moment a button
       * goes down. So space-drag pans, space-then-letter runs a command, and space-held-plus-letter
       * runs the same command without waiting for the release — which is the shape a hand already
       * knows from every modifier it has ever used.
       *
       * A key that is not a binding closes the chord and does nothing else. That is deliberate:
       * the alternative is falling through to the bare meaning, which would put back exactly the
       * flat namespace this replaced, one press deeper.
       */
      if (chordRef.current) {
        /*
         * The leader's own auto-repeat is not a second press, and the difference is the whole of
         * whether holding it works. A held key starts repeating after about half a second — which
         * is *after* the overlay has appeared — so treating a repeat as a press would put the set
         * on screen and then take it away again while the key was still down, with the letter that
         * followed doing nothing. `e.repeat` is what tells the two apart; a genuine second press is
         * somebody taking the chord back, which is the one case this branch is for.
         */
        if (e.code === LEADER_CODE) {
          e.preventDefault();
          if (!e.repeat) shutChord();
          return;
        }
        shutChord();
        if (!mod) {
          take();
          if (e.key === "Escape") return;
          const b = bindingFor(e.key);
          /* Locked, a chord may go somewhere or show something, and may not make anything. */
          if (b && lockedRef.current && !READS.has(b.command)) return void refuseLocked();
          if (b) run(b.command);
          return;
        }
      }
      if (e.code === LEADER_CODE && !mod && !e.altKey && !e.shiftKey && !e.repeat) {
        /* `preventDefault` only, never `take()`. The viewport listens for this same press in the
           bubble phase to arm its pan, and stopping propagation here would be a chord that quietly
           took hold-to-pan away — with nothing anywhere saying so. */
        e.preventDefault();
        openChord();
        shutAt = window.setTimeout(shutChord, CHORD_MS);
        return;
      }

      /*
       * Locked: every key below that edits is refused, with the notice, before it means
       * anything. What stays is what reads — select all, Settings, Escape — and the arrows, which
       * pan the board rather than nudging what is selected: a locked board is a board to look at.
       */
      if (lockedRef.current) {
        const k = e.key.toLowerCase();
        const edits = mod
          ? k === "z" || k === "y" || k === "d" || k === "g" || (e.shiftKey && (k === "k" || k === "h"))
          : e.key === "Delete" || e.key === "Backspace" || e.key === "Enter" || e.key === "]" || e.key === "[";
        if (edits) {
          if (!mod && !sel.size && !pn && !pe && !pickedLinkRef.current) return;
          take();
          return void refuseLocked();
        }
        if (!mod && e.key.startsWith("Arrow")) return;
      }

      if (mod && e.key.toLowerCase() === "z") {
        take();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (mod && e.key.toLowerCase() === "y") return take(), redo();
      if (mod && e.key.toLowerCase() === "a") return take(), selectAll();
      if (mod && e.key.toLowerCase() === "d") return take(), pn ? duplicatePickedNode() : duplicate();
      if (mod && e.key.toLowerCase() === "g") {
        take();
        if (e.shiftKey) ungroup();
        else group();
        return;
      }
      /* ctrl+shift+K: keep this as a component. Not ctrl+S — the browser owns that, and a page
         save dialog over the board is the one thing worse than no shortcut. */
      if (mod && e.shiftKey && e.key.toLowerCase() === "k") return take(), void saveAsComponent();
      /* ⌘⇧H / ctrl+shift+H: hidden, off the canvas but still in the file. */
      if (mod && e.shiftKey && e.key.toLowerCase() === "h") return take(), toggleHidden();
      /* ctrl+, — what every editor binds for its preferences, and a key nothing here wanted. */
      if (mod && e.key === ",") return take(), onSettingsRef.current?.();
      if (mod) return;

      switch (e.key) {
        case "Escape":
          /* A card over the board first: it sits over everything, and its Escape must not also
             clear what is selected underneath. One handler, in one order, rather than three racing
             on the window. */
          if (document.querySelector("[data-dag-settings]")) return take(), onSettingsRef.current?.();
          if (document.querySelector("[data-dag-shortcuts]")) return take(), onHelpRef.current?.();
          /* The pick before the panel and before the selection: it is the innermost thing that is
             held, so it is the first thing let go. A second Escape does what one always did. */
          if (pn || pe) return take(), clearPick();
          if (editingRef.current) return take(), close();
          if (sel.size) return take(), clear();
          if (pickedLinkRef.current) return take(), setPickedLink(null);
          /* The pen last, because it is the outermost thing held — the tool everything else sits
             on, the way the hand tool would be if it could be held. Everything above it let go
             first; the next Escape puts the pen down. */
          if (toolRef.current === "pen") return take(), setTool("select");
          return;
        case "Delete":
        case "Backspace":
          if (pn) return take(), removePickedNode();
          if (pe) return take(), removePickedEdge();
          if (sel.size) return take(), remove();
          if (pickedLinkRef.current) return take(), removeLink(pickedLinkRef.current);
          return;
        case "Enter":
          if (pn || pe) {
            take();
            setMode("props");
            return open((pn ?? pe)!.item);
          }
          /* A board link's statement lives in an `edges` fence, and the fence is an item — so its
             controls are reached by opening that item, which is the only thing on a board with no
             place on the paper to click. Enter rather than the pick itself: a panel that flew open
             every time somebody clicked a line would be in the way of deleting one. */
          if (pickedLinkRef.current) {
            const link = boardRef.current?.links.find((l) => l.id === pickedLinkRef.current);
            if (link) {
              take();
              setMode("props");
              return open(link.fence);
            }
          }
          if (sel.size === 1) return take(), open([...sel][0]!);
          return;
        case "ArrowLeft":
          if (sel.size) return take(), nudge(-step, 0);
          return;
        case "ArrowRight":
          if (sel.size) return take(), nudge(step, 0);
          return;
        case "ArrowUp":
          if (sel.size) return take(), nudge(0, -step);
          return;
        case "ArrowDown":
          if (sel.size) return take(), nudge(0, step);
          return;
        case "]":
          if (sel.size) return take(), bringToFront();
          return;
        case "[":
          if (sel.size) return take(), sendToBack();
          return;
      }
    };
    /* A run of arrow presses is one write and one undo; releasing the key ends both. */
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key.startsWith("Arrow")) flushNudge(true);
    };

    const selection = (): BoardItem[] => {
      const sel = selectedRef.current;
      return visible().filter((it) => sel.has(it.id));
    };

    const onCopy = (e: ClipboardEvent) => {
      if (typing(e.target)) return;
      const items = selection();
      if (items.length === 0) return;
      e.preventDefault();
      e.clipboardData?.setData("text/plain", itemsToText(items));
    };
    const onCut = (e: ClipboardEvent) => {
      if (typing(e.target)) return;
      const items = selection();
      if (items.length === 0) return;
      e.preventDefault();
      if (lockedRef.current) return void refuseLocked();
      e.clipboardData?.setData("text/plain", itemsToText(items));
      remove(items.map((it) => it.id));
    };

    /*
     * Paste: an image becomes a file next to the board plus a fence in it, so the next agent to
     * read the board sees the picture rather than a blob that lived only in this tab. Text that
     * carries fences becomes those items; any other text becomes a note. Everything lands under
     * the pointer, or in the middle of the view when the pointer is elsewhere.
     */
    const onPaste = (e: ClipboardEvent) => {
      if (typing(e.target)) return;
      if (performance.now() - middleAt < 500) {
        e.preventDefault();
        return;
      }
      const b = boardRef.current;
      if (!b) return;
      if (lockedRef.current) {
        e.preventDefault();
        return void refuseLocked();
      }
      const g = gridRef.current;
      const target = pointer.current.over
        ? viewport.current?.toBoard(pointer.current.x, pointer.current.y)
        : viewport.current?.center();
      const at = { x: snap(target?.x ?? 0, g), y: snap(target?.y ?? 0, g) };

      /* A pasted file that is not a picture — a PDF copied in a file manager — is an attachment, as
         the same file dropped would be. A picture stays the board's own, below. */
      const other = Array.from(e.clipboardData?.items ?? [])
        .find((i) => i.kind === "file" && !i.type.startsWith("image/"))
        ?.getAsFile();
      if (other) {
        e.preventDefault();
        void attachFile(other, at).then((it) => it && insert([it]));
        return;
      }
      const file = Array.from(e.clipboardData?.items ?? [])
        .find((i) => i.kind === "file" && i.type.startsWith("image/"))
        ?.getAsFile();
      if (file) {
        e.preventDefault();
        void (async () => {
          const staged = await stageImage(file, g);
          await fetch(`/__board/asset?name=${encodeURIComponent(b.name)}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ dataUrl: staged.dataUrl, x: at.x, y: at.y, w: staged.w, page: pageRef.current }),
          });
        })();
        return;
      }

      const text = e.clipboardData?.getData("text/plain") ?? "";
      const items = textToItems(text);
      if (items.length === 0) return;
      e.preventDefault();

      void insert(anchorAt(items, at, g));
    };

    /* Files from the desktop. `dragover` must be cancelled or the browser opens the file itself;
       it is cancelled only over the board, so a drop on the board list still does nothing. */
    const overBoard = (e: DragEvent) => e.target instanceof Element && e.target.closest(".dag-viewport") !== null;
    const onDragOver = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes("Files") || !overBoard(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    };
    const onDrop = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes("Files") || !overBoard(e)) return;
      /* Cancelled locked as well — the browser would otherwise open the file in place of the app. */
      e.preventDefault();
      if (lockedRef.current) return void refuseLocked();
      void importFiles(Array.from(e.dataTransfer.files), viewport.current?.toBoard(e.clientX, e.clientY));
    };

    addEventListener("pointermove", onPointer);
    addEventListener("pointerdown", onPress, true);
    addEventListener("blur", shutChord);
    addEventListener("dragover", onDragOver);
    addEventListener("drop", onDrop);
    addEventListener("keydown", onKey, true);
    addEventListener("keyup", onKeyUp);
    document.addEventListener("copy", onCopy);
    document.addEventListener("cut", onCut);
    document.addEventListener("paste", onPaste);
    return () => {
      removeEventListener("pointermove", onPointer);
      removeEventListener("pointerdown", onPress, true);
      removeEventListener("blur", shutChord);
      shutChord();
      /* A nudge still in hand is written rather than dropped: the effect re-runs whenever any of
         its many dependencies changes, which is not a reason to lose somebody's last arrow press. */
      flushNudge(true);
      removeEventListener("dragover", onDragOver);
      removeEventListener("drop", onDrop);
      removeEventListener("keydown", onKey, true);
      removeEventListener("keyup", onKeyUp);
      document.removeEventListener("copy", onCopy);
      document.removeEventListener("cut", onCut);
      document.removeEventListener("paste", onPaste);
    };
  }, [enabled, add, bringToFront, clear, clearPick, close, duplicate, duplicatePickedNode, flushNudge, group, history, importFiles, insert, links, move, open, paintMove, redo, remove, removeLink, removePickedEdge, removePickedNode, saveAsComponent, selectAll, sendToBack, setMode, tidyUp, toggleHidden, undo, ungroup, viewport, visible]);

  /* `tick` is what makes `canUndo` a fresh read after a write; the stack itself is not state. */
  void tick;

  return {
    enabled,
    chord,
    selected,
    editing,
    reveal,
    tool,
    setTool,
    ctl,
    places,
    canUndo: history.canUndo,
    canRedo: history.canRedo,
    undo,
    redo,
    add,
    links,
    openAt,
    pickedLink,
    pickLink,
    pickedNode,
    pickedEdge,
    pickNode,
    pickEdge,
    removeSelection,
    duplicateSelection,
    columnOf: columnAt,
    pickFromLine,
    mode,
    setMode,
    renaming,
    commitRename,
    cancelRename,
    renameItem,
    detach: detachItem,
    relayout: relayoutItem,
    place,
    placeAll,
    dropPart,
    pages,
    toBoard,
    group,
    ungroup,
    tidy: tidyUp,
    exportAs,
    importFiles,
    select,
    selectAll,
    clear,
    close,
    setBody,
    setAttrs,
    replace,
    onMarquee,
    onPaperClick,
    onPaperDoubleClick,
    onInk,
    saveAsComponent,
  };
}
