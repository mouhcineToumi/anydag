import type { AttrValue } from "@/board/attrs";
import type { PatchOp } from "@/board/patch";
import { referencedInto } from "@/board/survive";
import { hashOf } from "@/board/parseBoard";
import type { Board, BoardItem } from "@/board/types";

import { requestDiagram, type Draft, type DraftDiagnostic } from "./generate";

/**
 * The rewrite half of a prompt card: asking a model to change what is already on the board, and
 * what landing its answer *means* as an edit.
 *
 * The gesture is in `useEditor` (`ctl.rewrite` / `ctl.applyRewrite`) and the preview is someone
 * else's; this file is the pipeline minus the pointer, the way `generate.ts` is for a fresh draw.
 * The one shape that separates them is the landing: a prompt card is consumed by remove-and-insert,
 * while a rewrite is **one `SetOp` on the item that is already there** — `SetOp`'s own doc comment
 * in `src/board/patch.ts` states the argument:
 *
 * > Remove-and-insert would do it at the cost of a new id, which loses the selection, every link
 * > that named it, and the item's place in the file.
 *
 * And `id` is the whole of link safety: `resolveLinks` pushes a link only when both ends resolve,
 * so a rewrite that lost its id would make every curve naming the item vanish from the drawing
 * rather than dangle — silent, and invisible until somebody reads the board.
 */

/**
 * Ask for a rewrite. The server runs the same loop as a draw, refusing a draft that only echoes the
 * source back — `requestDiagram` forwards the whole request, `source` included, which is why the
 * type was widened rather than a second fetch written beside it.
 */
export const requestRewrite = requestDiagram;

/**
 * The fence attributes a model is allowed to state about a rewritten item, overlaid onto the
 * item's own. Placement — `x`, `y`, `page`, `group` — and the `id` are the item's; the model saw
 * only the body, so it has no business with them and its answer is dropped where it tries.
 */
const MODEL_ATTRS = ["title", "subtitle", "dir", "aspect", "frame"] as const;

/** The two types whose box is the author's, so a model may size one (`resizeOf` in `board/types`). */
const SIZED_TYPES: ReadonlySet<string> = new Set(["chart", "sketch"]);

/**
 * What changes on the fence line when a rewrite changes the item's type, beyond the
 * type itself: the two attributes that meant something only to the old one. `layout=fixed` says
 * the old body's coordinates are the drawing, and a new body in a new grammar carries none — kept,
 * it would grid every card in reading order. `w`/`h` size a chart or a sketch, and on any other
 * type they widen an empty frame around a diagram laid out at its natural size (the same
 * bigger-empty-box defect).
 * `null` is `SetOp`'s "take it off". Nothing when the type stays.
 */
function retyped(item: BoardItem, type: string): Record<string, AttrValue | null> {
  if (type === item.type) return {};
  const out: Record<string, AttrValue | null> = {};
  if (item.attrs.map.layout !== undefined) out.layout = null;
  if (!SIZED_TYPES.has(type)) {
    if (item.attrs.map.w !== undefined) out.w = null;
    if (item.attrs.map.h !== undefined) out.h = null;
  }
  return out;
}

/**
 * Land a rewrite draft on the item: **one `SetOp`, never the insert-and-remove pair**
 * `replacement()` uses — see the header. One commit, one undo entry, and the item keeps the id
 * that holds its selection, its links and its place in the file.
 *
 * The model's allowed attrs (`MODEL_ATTRS`, plus `w`/`h` when the draft's box is the author's) are
 * merged over what the item already carries: a key the model wrote wins, a key it never saw stays.
 * **`type` is written when the draft's differs** — the person asked for another kind of diagram,
 * which a rewrite used to refuse outright by pinning the type — and `SetOp.type` is what
 * keeps the id through it, as it does for a Mermaid conversion. The attributes only the old type
 * meant go with it (`retyped`).
 */
export function rewriteOps(item: BoardItem, draft: Draft): PatchOp[] {
  const allow = new Set<string>(MODEL_ATTRS);
  if (SIZED_TYPES.has(draft.type)) {
    allow.add("w");
    allow.add("h");
  }
  const attrs: Record<string, AttrValue | null> = retyped(item, draft.type);
  for (const [key, value] of Object.entries(draft.attrs)) {
    if (value !== undefined && allow.has(key)) attrs[key] = value;
  }
  const type = draft.type !== item.type ? { type: draft.type } : {};
  /* `attrs` left off entirely when the model said nothing about the fence: an empty patch would
     still trip `applyPatch`'s anonymous-id pinning, a file change the rewrite did not ask for. */
  return [Object.keys(attrs).length ? { id: item.id, ...type, attrs, body: draft.body } : { id: item.id, ...type, body: draft.body }];
}

/**
 * The item as the proposal would draw it — the file untouched, the board untouched. A shallow copy
 * with the draft's body and, when the draft changed it, its type, minus what `retyped` would take
 * off the fence: the preview has to be the drawing Accept will produce, or a retype previews as a
 * `flow` squeezed into a chart's `w=`. `hash` is rebuilt with `parseBoard`'s recipe, or the layout
 * cache hands back the old drawing.
 */
export function proposedItem(item: BoardItem, draft: Draft): BoardItem {
  const off = retyped(item, draft.type);
  const layout = "layout" in off ? undefined : item.layout;
  return {
    ...item,
    type: draft.type,
    body: draft.body,
    layout,
    w: "w" in off ? undefined : item.w,
    h: "h" in off ? undefined : item.h,
    hash: hashOf(`${draft.type}\0${draft.body}\0${item.dir ?? ""}\0${item.aspect ?? ""}\0${layout ?? ""}`),
  };
}

/**
 * The text appended to the person's instruction, naming the ids the rest of the board links *into*
 * the selection — the rule: the model sees the selection plus what references
 * it, never the whole board. One line, factual. When nothing references the selection it
 * contributes nothing at all, not an empty heading — most rewrites have no audience beyond the
 * item itself.
 */
export function rewriteContext(board: Board, ids: ReadonlySet<string>): string {
  const names: string[] = [];
  for (const { node } of referencedInto(board, ids)) {
    if (!names.includes(node)) names.push(node);
  }
  if (names.length === 0) return "";
  return `Keep the ids other items link into unchanged: ${names.join(", ")}.`;
}

/**
 * What `ctl.rewrite` hands back, and what the preview is built from.
 *
 * `lost` and `unparsed` are the survival check (`lost()` in `board/survive.ts`) run the moment the
 * draft lands, so a draft that drops an id the rest of the board points at is warned about before
 * it is accepted rather than silently taken: `unparsed` says the draft does not parse and survival
 * could not be judged at all.
 */
export interface RewriteOutcome {
  ok: boolean;
  /** Who refused, when it was us rather than the server: `error` carries the server's word. */
  reason?: "multi" | "not-diagram" | "missing";
  error?: string;
  draft?: Draft;
  /** Ids referenced from elsewhere that the draft no longer declares. */
  lost: string[];
  /** The draft does not parse, so survival was never judged. */
  unparsed: boolean;
  diagnostics: DraftDiagnostic[];
  attempts: number;
}
