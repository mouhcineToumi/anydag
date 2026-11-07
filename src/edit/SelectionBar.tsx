import {
  BringToFront,
  Check,
  ChevronDown,
  Copy,
  CopyPlus,
  Download,
  Group,
  Image,
  LayoutGrid,
  LoaderCircle,
  MoreHorizontal,
  PackagePlus,
  PanelRightOpen,
  RotateCcw,
  SendToBack,
  Sparkles,
  Trash2,
  Ungroup,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { isDiagramType, type BoardItem } from "@/board/types";
import { svgToPng } from "@/export/png";
import { fileStem, saveFile } from "@/export/save";
import { readSettings } from "@/settings/store";
import { useSettings } from "@/settings/useSettings";

import { chordFor } from "./bindings";
import type { Draft, DraftDiagnostic } from "./generate";
import type { Editor } from "./useEditor";

/** Lucide at one size and weight, stated once, as the dock does. */
const ICON = { size: 16, strokeWidth: 1.75, strokeLinecap: "round", strokeLinejoin: "round" } as const;
const SMALL = { size: 14, strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" } as const;

/**
 * The rewrite's whole state, held by `App`: the preview is a substitution in the items the canvas
 * draws, so it lives where the items are computed, and it outlives the selection that asked for
 * it — clicking away must not silently throw away an answer the model spent seconds on. This
 * component only renders it and hands the decisions back.
 *
 * `id` is the item the run is about. The toolbar anchors to it rather than to whatever is selected
 * now, because while a run stands the toolbar *is* that run, and it belongs beside the drawing it
 * would change.
 */
export type RewriteRun =
  | { phase: "idle" }
  | { phase: "running"; id?: string }
  | { phase: "refused"; id?: string; message: string; detail?: DraftDiagnostic[] }
  /** `failed` is an Accept that was refused: the proposal stands, with the reason beside it. */
  | { phase: "preview"; id: string; draft: Draft; lost: string[]; unparsed: boolean; failed?: string };

interface Props {
  editor: Editor;
  items: BoardItem[];
  /** The board's name, which every per-item export file is named after. */
  boardName: string;
  run: RewriteRun;
  /** The app is locked: the bar is the one item's Export and nothing that changes it. */
  locked?: boolean;
  /** Open the dialog a change is described in — `App` holds it, and the text typed into it. */
  onAsk(): void;
  /** Write the standing proposal into the board — one `SetOp`, one undo entry. */
  onAccept(): void;
  /** Throw the proposal away, and cancel a request still in flight. Nothing has been written. */
  onDiscard(): void;
}

/**
 * Everything that can be done to a selection, in one row of icons over it.
 *
 * **One toolbar, not two.** A single selected item used to wear a chip on its top edge — Edit,
 * duplicate, front, back, three exports, delete — and a bar under it carried the set actions, a
 * second duplicate and delete, and a text field for a model. Two answers to "what can I do with
 * this", in two places, one of which lived inside the zoomed layer and grew and shrank with the
 * board. This is the union, in screen space, and it shows **only what applies**: Group waits for
 * two, Ungroup for something grouped, Tidy for two (with one selected it tidied the whole board,
 * which is the dock's job), and Edit, the exports and the model only ever mean one item.
 *
 * **Icons, and every name in the tooltip with its key.** The labels and the `<kbd>` hints made the
 * bar 944px wide and wrap on any laptop; the tooltip is where every name the dock does
 * not print lives, and the keys come from the same places the dock's do — `chordFor()` for anything under
 * the leader, so `Tidy` stops saying `T`.
 *
 * **The model is one icon.** It opens a dialog to type into (`RewriteDialog`, held by `App`), and
 * only on a single diagram — the field used to show over notes, images and pairs, and refuse only
 * once somebody had typed. While a request is out, or its answer is waiting to be accepted, the
 * toolbar *is* that run: a spinner and a stop, or Accept and Discard, anchored to the drawing it
 * would change, which the preview is drawn in.
 *
 * **Where it sits: above the selection, clear of every handle on it.** It floated 12px under the
 * item, which is exactly where the south connect handle sits — 30 board pixels out, so under the
 * bar at almost any zoom — and when it flipped above, it covered the north one. So the
 * box it keeps out of is not the selection but the selection *and everything drawn around it*:
 * the resize squares, the connect dots, a group's dashed box, a picked card's `+` and dots. Each is
 * measured off the DOM, so no offset here has to know what the handles' CSS says. Above that box
 * first, below it when there is no room above, and pinned to the top of the canvas when the
 * selection fills it.
 *
 * **Painted, never rendered.** The position is a measurement of the DOM, and `Item` is memoised, so
 * a prop would re-render every diagram whenever anybody clicked a card. `place()` writes
 * `--selbar-x` and `--selbar-y` onto the toolbar's own element; window-local values, named
 * without the `--dag-` prefix for `--canvas-x`'s reason. It runs after every render, and at most
 * once a frame on `dag:view` (every pan and zoom), `dag:links-preview` (every frame of a drag) and a
 * ResizeObserver — listened to once, for the toolbar's life. It used to run inside each of
 * those events, reading twenty boxes straight after `Viewport.paint` wrote a transform, which is a
 * style and layout pass forced once per wheel event; and the listeners and the observer were taken
 * down and put back after every render.
 */
export function SelectionBar({ editor, items, boardName, run, locked = false, onAsk, onAccept, onDiscard }: Props) {
  const bar = useRef<HTMLDivElement>(null);
  /* One menu at a time: Export, or the ⋯ that holds what is used least. */
  const [menu, setMenu] = useState<null | "export" | "more">(null);
  const exporting = menu === "export";
  const scale = useSettings().export.scale;

  const one = items.length === 1 ? items[0]! : null;
  const many = items.length > 1;
  const grouped = items.some((it) => it.group);
  const busy = run.phase !== "idle";
  const anchor = busy && "id" in run && run.id ? [run.id] : items.map((it) => it.id);
  /* Delete and Duplicate do what their keys do, and the keys act on a pick before the selection. */
  const inside = editor.pickedNode ? "card" : editor.pickedEdge ? "line" : null;

  /* What `place` measures around, as of the last render — read through a ref so the listeners below
     are set up once rather than after every render. */
  const around = useRef({ anchor, busy });
  around.current = { anchor, busy };
  const placeRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    const place = () => {
      const { anchor, busy } = around.current;
      const el = bar.current;
      const parent = el?.offsetParent;
      if (!el || !parent) return;
      /* The selection, for centring — and the selection with every handle drawn around it, for
         keeping out of. A handle is absolutely positioned outside its owner's box, so neither
         the item's rectangle nor its `scrollWidth` includes it: each one is asked for its own. */
      const sel = empty();
      const keep = empty();
      for (const id of anchor) {
        const item = document.querySelector<HTMLElement>(`[data-dag-item="${CSS.escape(id)}"]`);
        if (!item) continue;
        grow(sel, item.getBoundingClientRect());
        grow(keep, item.getBoundingClientRect());
        for (const h of item.querySelectorAll(".dag-handle, .dag-connect-handle")) grow(keep, h.getBoundingClientRect());
      }
      if (!busy) {
        for (const h of document.querySelectorAll(".dag-groupbox, .dag-groupbox > *, .dag-nodetools > *")) {
          grow(keep, h.getBoundingClientRect());
        }
      }
      if (!Number.isFinite(sel.l)) {
        el.style.removeProperty("--selbar-x");
        el.style.removeProperty("--selbar-y");
        return;
      }
      const body = parent.getBoundingClientRect();
      const canvas = document.querySelector(".dag-viewport")?.getBoundingClientRect();
      if (!canvas) return;
      const own = el.getBoundingClientRect();
      const cx = canvas.left - body.left;
      const cy = canvas.top - body.top;
      /* Centred on the selection, clamped so the whole toolbar stays on the canvas. */
      const half = own.width / 2;
      const x = Math.min(Math.max((sel.l + sel.r) / 2 - body.left, cx + GAP + half), cx + canvas.width - GAP - half);
      /* The floor is the dock's top rather than the canvas's: the dock is pinned to the bottom of
         the same box, so a toolbar that merely fits on the canvas can still land on the tools. */
      const dock = document.querySelector(".dag-dock")?.getBoundingClientRect();
      const floor = Math.min(cy + canvas.height, dock ? dock.top - body.top : Infinity) - GAP;
      const h = own.height;
      let y = keep.t - body.top - GAP - h;
      if (y < cy + GAP) {
        y = keep.b - body.top + GAP;
        if (y + h > floor) y = cy + GAP;
      }
      el.style.setProperty("--selbar-x", `${x}px`);
      el.style.setProperty("--selbar-y", `${y}px`);
    };
    placeRef.current = place;
    let frame = 0;
    const soon = () => {
      if (!frame)
        frame = requestAnimationFrame(() => {
          frame = 0;
          place();
        });
    };
    document.addEventListener("dag:view", soon);
    /* Every item drag announces its moving boxes on this on every frame, for the link layer; the
       toolbar follows a drag on the same signal rather than on a new one. */
    document.addEventListener("dag:links-preview", soon);
    const canvas = document.querySelector(".dag-viewport");
    const ro = new ResizeObserver(soon);
    if (canvas) ro.observe(canvas);
    if (bar.current) ro.observe(bar.current);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("dag:view", soon);
      document.removeEventListener("dag:links-preview", soon);
      ro.disconnect();
    };
  }, []);
  /* After every render, as before: what is selected, or the toolbar's own width, may have changed. */
  useEffect(() => placeRef.current());

  /* The export menu shuts on a press anywhere else, and on Escape — taken here and stopped, for the
     reason the dock's `⋯` gives: `typing()` leaves a focused BUTTON to itself, so nothing else would
     hear the key. A menu that outlived Escape would be the one thing on the board it did not close. */
  useEffect(() => {
    if (!menu) return;
    const down = (e: PointerEvent) => {
      if (!bar.current?.contains(e.target as Node)) setMenu(null);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      setMenu(null);
    };
    document.addEventListener("pointerdown", down);
    document.addEventListener("keydown", key, true);
    return () => {
      document.removeEventListener("pointerdown", down);
      document.removeEventListener("keydown", key, true);
    };
  }, [menu]);
  /* A different selection is a different question. */
  useEffect(() => setMenu(null), [one?.id]);

  /* One item's export, through the handle every item registers for a headless export — the one
     that sizes the file from the placement at 1:1 rather than from the zoomed DOM. */
  const svgOf = async (id: string): Promise<string | null> => {
    const w = window as unknown as { __anydagSvg?: Record<string, () => Promise<string | null>> };
    return (await w.__anydagSvg?.[id]?.()) ?? null;
  };
  const stem = (id: string) => `${fileStem(boardName)}-${fileStem(id)}`;
  const exportAs = async (kind: "svg" | "png" | "copy") => {
    setMenu(null);
    if (!one) return;
    const svg = await svgOf(one.id);
    if (!svg) return;
    if (kind === "svg") return saveFile(`${stem(one.id)}.svg`, svg, "image/svg+xml");
    /* Written as text, not as an `image/svg+xml` clipboard item: Chrome will not accept that type,
       and every editor worth pasting into reads SVG source from the text flavour. */
    if (kind === "copy") return void (await navigator.clipboard?.writeText(svg));
    const size = /width="(\d+)" height="(\d+)"/.exec(svg);
    saveFile(`${stem(one.id)}.png`, await svgToPng(svg, Number(size?.[1] ?? 0), Number(size?.[2] ?? 0), readSettings().export.scale));
  };

  return (
    <div
      ref={bar}
      className="dag-selbar"
      data-dag-selbar=""
      data-dag-selbar-run={busy ? run.phase : undefined}
      role="toolbar"
      aria-label={busy ? "Proposed change" : "Selection"}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      {busy ? (
        <Run run={run} onAccept={onAccept} onDiscard={onDiscard} onAsk={onAsk} />
      ) : (
        <div className="dag-selbar__row">
          {many ? (
            <span className="dag-selbar__count" title={`${items.length} items selected`}>
              {items.length}
            </span>
          ) : null}

          {one && !locked ? (
            <>
              <Tool hook="edit" label="Edit: properties and source" keys="Enter" word="Edit" onClick={() => editor.ctl.open(one.id)}>
                <PanelRightOpen {...ICON} aria-hidden="true" />
              </Tool>
              {isDiagramType(one.type) ? (
                <button
                  type="button"
                  className="dag-icon dag-icon--accent"
                  data-dag-rewrite-open=""
                  aria-label="Change with AI"
                  title="Change with AI: describe the change, and a model rewrites this diagram for you to accept"
                  onClick={onAsk}
                >
                  <Sparkles {...ICON} aria-hidden="true" />
                </button>
              ) : null}
              <span className="dag-dock__rule" />
            </>
          ) : null}

          {locked ? null : (
            <>
              {many ? (
                <Tool hook="group" label="Group: select and move these as one" keys="Ctrl+G" onClick={editor.group}>
                  <Group {...ICON} aria-hidden="true" />
                </Tool>
              ) : null}
              {grouped ? (
                <Tool hook="ungroup" attr="data-dag-ungroup" label="Ungroup" keys="Ctrl+Shift+G" onClick={editor.ungroup}>
                  <Ungroup {...ICON} aria-hidden="true" />
                </Tool>
              ) : null}
              {many ? (
                <Tool
                  hook="tidy"
                  attr="data-dag-tidy"
                  label="Tidy up the selection: rows, columns and grids with even gaps"
                  keys={chordFor("tidy")}
                  onClick={() => void editor.tidy()}
                >
                  <LayoutGrid {...ICON} aria-hidden="true" />
                </Tool>
              ) : null}
              {many || grouped ? <span className="dag-dock__rule" /> : null}

              <Tool
                hook="duplicate"
                label={inside === "card" ? "Duplicate the picked card" : "Duplicate"}
                keys="Ctrl+D"
                onClick={editor.duplicateSelection}
              >
                <CopyPlus {...ICON} aria-hidden="true" />
              </Tool>
            </>
          )}
          {one ? (
            <div className="dag-selbar__export">
              <button
                type="button"
                className={exporting ? "dag-icon dag-icon--on dag-selbar__more" : "dag-icon dag-selbar__more"}
                data-dag-selbar-export=""
                aria-haspopup="menu"
                aria-expanded={exporting}
                aria-label="Export this item"
                title="Export this item: SVG, PNG, or its SVG source"
                onClick={() => setMenu((m) => (m === "export" ? null : "export"))}
              >
                <Download {...ICON} aria-hidden="true" />
                <ChevronDown {...SMALL} aria-hidden="true" />
              </button>
              {exporting ? (
                <div className="dag-more__menu dag-selbar__menu" role="menu">
                  <button type="button" role="menuitem" className="dag-more__item" data-dag-svg="" onClick={() => void exportAs("svg")}>
                    <Download {...SMALL} aria-hidden="true" />
                    <span>Download as SVG</span>
                  </button>
                  <button type="button" role="menuitem" className="dag-more__item" data-dag-png="" onClick={() => void exportAs("png")}>
                    <Image {...SMALL} aria-hidden="true" />
                    <span>Download as PNG ({scale}×)</span>
                  </button>
                  <button type="button" role="menuitem" className="dag-more__item" data-dag-copy-svg="" onClick={() => void exportAs("copy")}>
                    <Copy {...SMALL} aria-hidden="true" />
                    <span>Copy the SVG source</span>
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
          {locked ? null : (
            <>
              {/* What is used least, behind one button: the stacking order, and keeping the
                  selection as a component. Each still has its key, which the menu says. */}
              <div className="dag-selbar__export">
                <button
                  type="button"
                  className={menu === "more" ? "dag-icon dag-icon--on" : "dag-icon"}
                  data-dag-selbar-more=""
                  aria-haspopup="menu"
                  aria-expanded={menu === "more"}
                  aria-label="More"
                  title="More: order, keep as a component"
                  onClick={() => setMenu((m) => (m === "more" ? null : "more"))}
                >
                  <MoreHorizontal {...ICON} aria-hidden="true" />
                </button>
                {menu === "more" ? (
                  <div className="dag-more__menu dag-selbar__menu" role="menu">
                    <MenuItem hook="front" keys="]" onClick={() => (setMenu(null), editor.ctl.bringToFront())}>
                      <BringToFront {...SMALL} aria-hidden="true" />
                      <span>Bring to front</span>
                    </MenuItem>
                    <MenuItem hook="back" keys="[" onClick={() => (setMenu(null), editor.ctl.sendToBack())}>
                      <SendToBack {...SMALL} aria-hidden="true" />
                      <span>Send to back</span>
                    </MenuItem>
                    <MenuItem
                      hook="keep"
                      attr="data-dag-save-component"
                      keys="Ctrl+Shift+K"
                      onClick={() => (setMenu(null), void editor.saveAsComponent())}
                    >
                      <PackagePlus {...SMALL} aria-hidden="true" />
                      <span>Keep as a component</span>
                    </MenuItem>
                  </div>
                ) : null}
              </div>
              <span className="dag-dock__rule" />
              <Tool hook="delete" label={inside ? `Delete the picked ${inside}` : "Delete"} keys="Del" danger onClick={editor.removeSelection}>
                <Trash2 {...ICON} aria-hidden="true" />
              </Tool>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** The margin the toolbar keeps from the selection's furniture and from the canvas edges. */
const GAP = 8;

interface Rect {
  l: number;
  t: number;
  r: number;
  b: number;
}
const empty = (): Rect => ({ l: Infinity, t: Infinity, r: -Infinity, b: -Infinity });
/** Widen `into` by a client rect, ignoring anything with no size — a handle that is not drawn. */
function grow(into: Rect, r: DOMRect): void {
  if (r.width === 0 && r.height === 0) return;
  into.l = Math.min(into.l, r.left);
  into.t = Math.min(into.t, r.top);
  into.r = Math.max(into.r, r.right);
  into.b = Math.max(into.b, r.bottom);
}

/**
 * One icon button: the name and the key are its tooltip, and the name alone is what a screen
 * reader says. `hook` is the `data-dag-selbar-*` attribute the checks find it by; `attr` is an
 * older hook a check already uses, kept beside it rather than renamed out from under it.
 */
function Tool({
  hook,
  attr,
  label,
  keys,
  danger,
  word,
  onClick,
  children,
}: {
  hook: string;
  attr?: string;
  label: string;
  keys?: string;
  danger?: boolean;
  /** A word beside the icon, for the one tool reached for most. */
  word?: string;
  onClick(): void;
  children: React.ReactNode;
}) {
  const data: Record<string, string> = { [`data-dag-selbar-${hook}`]: "" };
  if (attr) data[attr] = "";
  return (
    <button
      type="button"
      className={danger ? "dag-icon dag-selbar__danger" : word ? "dag-icon dag-selbar__worded" : "dag-icon"}
      aria-label={label.split(":")[0]}
      title={keys ? `${label} (${keys})` : label}
      onClick={onClick}
      {...data}
    >
      {children}
      {word ? <span>{word}</span> : null}
    </button>
  );
}

/** A row of the ⋯ menu, with its key at the end where a menu says one. */
function MenuItem({
  hook,
  attr,
  keys,
  onClick,
  children,
}: {
  hook: string;
  attr?: string;
  keys: string;
  onClick(): void;
  children: React.ReactNode;
}) {
  const data: Record<string, string> = { [`data-dag-selbar-${hook}`]: "" };
  if (attr) data[attr] = "";
  return (
    <button type="button" role="menuitem" className="dag-more__item" onClick={onClick} {...data}>
      {children}
      <kbd className="dag-selbar__key">{keys}</kbd>
    </button>
  );
}

/**
 * The toolbar while a change is out with the model or waiting to be accepted.
 *
 * Words here, where the tools are icons, because these are decisions rather than tools: Accept
 * writes the board and Discard throws away an answer that took seconds and a paid call to get, and
 * a glyph is not how either should be told apart. The notes hang *under* the row, which the old bar
 * claimed in a comment and did not do: it was a flex row, so they landed beside it.
 */
function Run({
  run,
  onAccept,
  onDiscard,
  onAsk,
}: {
  run: Exclude<RewriteRun, { phase: "idle" }>;
  onAccept(): void;
  onDiscard(): void;
  onAsk(): void;
}) {
  if (run.phase === "running") {
    return (
      <div className="dag-selbar__row" data-dag-rewrite-running="">
        <span className="dag-selbar__status">
          <LoaderCircle {...SMALL} className="dag-rewrite__spin" aria-hidden="true" /> Asking the model…
        </span>
        <button type="button" className="dag-icon" data-dag-rewrite-stop="" aria-label="Stop" title="Stop: cancel the request" onClick={onDiscard}>
          <X {...ICON} aria-hidden="true" />
        </button>
      </div>
    );
  }

  if (run.phase === "refused") {
    return (
      <div className="dag-rewrite__fail" role="alert">
        <div className="dag-selbar__row">
          <span className="dag-rewrite__message">{run.message}</span>
          <button type="button" className="dag-selbar__word" data-dag-rewrite-retry="" title="Change the description and ask again" onClick={onAsk}>
            <RotateCcw {...SMALL} aria-hidden="true" /> Try again
          </button>
          <button type="button" className="dag-icon" data-dag-rewrite-dismiss="" aria-label="Dismiss" title="Dismiss" onClick={onDiscard}>
            <X {...ICON} aria-hidden="true" />
          </button>
        </div>
        {run.detail?.length ? (
          <ul className="dag-rewrite__diags">
            {run.detail.map((d, i) => (
              <li key={i}>
                <code>{d.code}</code> {d.line ? `line ${d.line}: ` : ""}
                {d.message}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    );
  }

  return (
    <>
      <div className="dag-selbar__row">
        <span className="dag-selbar__status">Proposed change</span>
        <button
          type="button"
          className="dag-selbar__word dag-rewrite__go"
          data-dag-rewrite-accept=""
          title="Write this change into the board: one edit, one undo"
          onClick={onAccept}
        >
          <Check {...SMALL} aria-hidden="true" /> Accept
        </button>
        <button type="button" className="dag-selbar__word" data-dag-rewrite-discard="" title="Throw the change away: nothing has been written" onClick={onDiscard}>
          <X {...SMALL} aria-hidden="true" /> Discard
        </button>
      </div>
      {run.failed || run.unparsed || run.lost.length > 0 ? (
        <div className="dag-rewrite__notes">
          {/* A refused Accept, shown under the proposal it could not put down rather than in place
              of it: the draft is still the thing on screen and still the thing to retry. */}
          {run.failed ? (
            <p className="dag-rewrite__warn" role="alert">
              {run.failed}
            </p>
          ) : null}
          {run.unparsed ? (
            <p className="dag-rewrite__warn" role="alert">
              The proposed diagram does not parse.
            </p>
          ) : null}
          {run.lost.length > 0 ? (
            <p className="dag-rewrite__warn" role="alert">
              Other items link to {run.lost.length === 1 ? "an id" : "ids"} this change drops: <code>{run.lost.join(", ")}</code>. Accepting
              removes {run.lost.length === 1 ? "that link" : "those links"}.
            </p>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
