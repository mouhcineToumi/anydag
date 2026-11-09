import { useCallback, useEffect, useRef, useState } from "react";
import {
  Hand,
  Keyboard,
  LayoutGrid,
  LibraryBig,
  MoreHorizontal,
  MousePointer2,
  PackagePlus,
  Pencil,
  Redo2,
  Sparkles,
  Spline,
  Undo2,
  Upload,
} from "lucide-react";

import type { Tool } from "@/canvas/Viewport";
import { chordFor, type Command } from "@/edit/bindings";
import { Tooltip } from "@/ui/Tooltip";

/**
 * The dock: what a person reaches for, over the board rather than across the top of it.
 *
 * An audit of the chrome produced it. The toolbar was one full-width strip of seventeen
 * controls, six of them wearing text labels, with a dead spacer down the middle throwing Import
 * and Export as far from Library as the window allowed. Every one of those six already had a key,
 * and the page tabs had already made this argument once — "what the toolbar keeps is what nothing else
 * reaches". Deleting them outright would have traded one problem for another, because a key is
 * discoverable only through `?`. Dropping the *label* and keeping the button is the synthesis both
 * references agree on, and it is what makes the keys discoverable for the first time: the tooltip
 * is now the only place a name lives, so every one of them carries its shortcut.
 *
 * **It is a dock and not a Miro rail because of where our chrome already is.** A vertical rail
 * down the left fights the board list, which is also down the left. A floating dock does not: it
 * is an absolutely-positioned sibling of the viewport inside `.dag-body`, which is exactly what
 * `SelectionBar` has been since M19 — so it takes no place in the flex tree and never touches
 * `.dag-viewport`'s `flex: 1; min-width: 0` contract, the thing the page tabs refused to wrap for a cosmetic
 * gain. And because `.dag-body` is a *sibling* of `PageBar` rather than its parent, `bottom` inside
 * it clears the page tabs for nothing — not even the margin the audit budgeted for.
 *
 * What is on it is ranked by how often it is actually used, which is the other half of the audit:
 * the tools and the history are permanent, creation is permanent, and everything rare is behind
 * the `⋯`. Links went there too — they are rarely used, beside Export.
 */

/*
 * The shortcut, as a tooltip says it: ` (space T)`, or nothing where a command has no chord.
 *
 * Read from `BINDINGS` rather than typed here, because every bare letter is a
 * chord and the tooltip is the only place a name or a key is written down. Two copies of
 * a closed set is the drift `check:skill` exists to catch one layer out.
 */
const hint = (c: Command) => {
  const k = chordFor(c);
  return k ? ` (${k})` : "";
};

/** Lucide at one size and weight, stated once. */
const ICON = { size: 16, strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" } as const;

/** What the dock can do to a board. Absent on a board that cannot be written. */
export interface DockActions {
  tool: Tool;
  onTool(tool: Tool): void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo(): void;
  onRedo(): void;
  library: boolean;
  onLibrary(open: boolean): void;
  /** A prompt card under the pointer — the one thing here that is deliberately promoted. */
  onPrompt(): void;
  /** Open the links between items — the page's `edges` fence — in the editor panel. */
  onLinks(): void;
  /** Tidy up: the board, or the selection when there is one. */
  onTidy(): void;
  /** Keep the selection — or the whole page — as a component in the library. */
  onKeep(): void;
  onHelp(): void;
  onImport(files: File[]): void;
}

/**
 * `edit` is absent on a board that cannot be written, and then **the dock draws nothing**.
 *
 * It used to draw the `⋯` alone, because Settings lived there and had to be
 * reachable on the one board you cannot fix by editing it. Both moved to the sidebar's
 * foot — the dock is *this board* and the sidebar is *the app* — so on a board with
 * nothing to edit the dock has nothing left to offer, and a menu of nothing is not a control.
 */
export function Dock({ edit }: { edit?: DockActions }) {
  const [more, setMore] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setMore(false), []);

  /*
   * Shut it by pressing somewhere else, or by Escape.
   *
   * The key is taken in the capture phase and stopped: `typing()` in `useEditor` skips the window's
   * Escape chain the moment focus is on a `BUTTON` or a `SELECT`, which is true here by
   * construction — the menu was opened by clicking one — but it stops being true as soon as focus
   * moves, and a menu that outlived Escape would be the one thing on the board Escape did not
   * close. Stopping it keeps the chain's order intact: the innermost thing held is the first let
   * go. Same argument the settings card makes, which is the other control that had to own its key.
   */
  useEffect(() => {
    if (!more) return;
    const down = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) close();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      e.preventDefault();
      close();
    };
    document.addEventListener("pointerdown", down);
    document.addEventListener("keydown", key, true);
    return () => {
      document.removeEventListener("pointerdown", down);
      document.removeEventListener("keydown", key, true);
    };
  }, [more, close]);

  if (!edit) return null;
  return (
    <div className="dag-dock" data-dag-dock="" role="toolbar" aria-label="Tools">
      {edit ? (
        <>
          <div className="dag-dock__group dag-dock__group--tools" role="radiogroup" aria-label="Tool">
            <Tooltip name="Select: click an item, drag the paper to select several" shortcut={chordFor("select")}>
              <button
                className={edit.tool === "select" ? "dag-icon dag-icon--on" : "dag-icon"}
                role="radio"
                aria-checked={edit.tool === "select"}
                aria-label={`Select${hint("select")}`}
                onClick={() => edit.onTool("select")}
              >
                <MousePointer2 {...ICON} aria-hidden="true" />
              </button>
            </Tooltip>
            <Tooltip name="Hand: drag the paper to move around" shortcut={chordFor("hand")}>
              <button
                className={edit.tool === "hand" ? "dag-icon dag-icon--on" : "dag-icon"}
                role="radio"
                aria-checked={edit.tool === "hand"}
                aria-label={`Hand${hint("hand")}`}
                onClick={() => edit.onTool("hand")}
              >
                <Hand {...ICON} aria-hidden="true" />
              </button>
            </Tooltip>
            {/* The pen, beside the two tools it is a third of: all three
            change what a press on the paper means, which is what makes them one radiogroup. */}
            <Tooltip name="Pen: draw a freehand stroke; it becomes an item" shortcut={chordFor("pen")}>
              <button
                className={edit.tool === "pen" ? "dag-icon dag-icon--on" : "dag-icon"}
                role="radio"
                aria-checked={edit.tool === "pen"}
                aria-label={`Pen${hint("pen")}`}
                onClick={() => edit.onTool("pen")}
              >
                <Pencil {...ICON} aria-hidden="true" />
              </button>
            </Tooltip>
          </div>

          <span className="dag-dock__rule dag-dock__rule--make" />

          <div className="dag-dock__group dag-dock__group--make">
            {/* Promoted, and accented, the way both references promote exactly one thing. Ours is the
            prompt card rather than an "AI" button, because the card is a real item on the board
            that survives a reload and is undone like anything else. */}
            <Tooltip name="Prompt card: describe a diagram and a model draws it" shortcut={chordFor("prompt")}>
              <button
                className="dag-icon dag-icon--accent"
                data-dag-dock-prompt=""
                aria-label={`Prompt card${hint("prompt")}`}
                onClick={edit.onPrompt}
              >
                <Sparkles {...ICON} aria-hidden="true" />
              </button>
            </Tooltip>
            <Tooltip name="Ready-made components to click or drag onto the board" shortcut={chordFor("library")}>
              <button
                className={edit.library ? "dag-icon dag-icon--on" : "dag-icon"}
                data-dag-library-toggle=""
                aria-pressed={edit.library}
                aria-label={`Library${hint("library")}`}
                onClick={() => edit.onLibrary(!edit.library)}
              >
                <LibraryBig {...ICON} aria-hidden="true" />
              </button>
            </Tooltip>
            <Tooltip
              name="Tidy up: line every item up in rows, columns and grids with even gaps; with a selection, just those"
              shortcut={chordFor("tidy")}
            >
              <button className="dag-icon" data-dag-tidy="" aria-label={`Tidy up${hint("tidy")}`} onClick={edit.onTidy}>
                <LayoutGrid {...ICON} aria-hidden="true" />
              </button>
            </Tooltip>
          </div>

          <span className="dag-dock__rule dag-dock__rule--make" />

          <div className="dag-dock__group dag-dock__group--history">
            <Tooltip name="Undo" shortcut="Ctrl+Z">
              <button
                className="dag-icon"
                data-dag-undo=""
                disabled={!edit.canUndo}
                aria-label="Undo (Ctrl+Z)"
                onClick={edit.onUndo}
              >
                <Undo2 {...ICON} aria-hidden="true" />
              </button>
            </Tooltip>
            <Tooltip name="Redo" shortcut="Ctrl+Shift+Z">
              <button
                className="dag-icon"
                data-dag-redo=""
                disabled={!edit.canRedo}
                aria-label="Redo (Ctrl+Shift+Z)"
                onClick={edit.onRedo}
              >
                <Redo2 {...ICON} aria-hidden="true" />
              </button>
            </Tooltip>
          </div>

          <span className="dag-dock__rule dag-dock__rule--more" />
        </>
      ) : null}

      <div className="dag-more" ref={wrap}>
        <Tooltip name="Everything else: links, components, import, shortcuts">
          <button
            className={more ? "dag-icon dag-icon--on" : "dag-icon"}
            data-dag-more=""
            aria-haspopup="menu"
            aria-expanded={more}
            aria-label="More"
            onClick={() => setMore((v) => !v)}
          >
            <MoreHorizontal {...ICON} aria-hidden="true" />
          </button>
        </Tooltip>
        {more ? <MoreMenu edit={edit} onDone={close} /> : null}
      </div>
    </div>
  );
}

/**
 * The rare half, behind one button.
 *
 * These keep their text, and that is not an inconsistency: the icon-only rule is about the dock,
 * where a row of glyphs is read at a glance and a label costs the width of the board. A menu is
 * read one line at a time and has nothing to save.
 *
 * **Export moved to the top bar**, where a
 * note — which has no dock — could have one too. Import stays: bringing a file *onto this board* is
 * this board's, and the dock is this board.
 */
function MoreMenu({ edit, onDone }: { edit?: DockActions; onDone(): void }) {
  return (
    <div className="dag-more__menu" data-dag-more-menu="" role="menu">
      {edit ? (
        <>
          <button
            className="dag-more__item"
            data-dag-links=""
            role="menuitem"
            title={`Links: the lines between items on this board, as text${hint("links")}`}
            onClick={() => {
              onDone();
              edit.onLinks();
            }}
          >
            <Spline {...ICON} aria-hidden="true" />
            <span>Links</span>
            <kbd>{chordFor("links")}</kbd>
          </button>
          <button
            className="dag-more__item"
            data-dag-keep=""
            role="menuitem"
            title="Keep as a component: the selection, or the whole page, joins the library for any board (Ctrl+Shift+K)"
            onClick={() => {
              onDone();
              edit.onKeep();
            }}
          >
            <PackagePlus {...ICON} aria-hidden="true" />
            <span>Keep as component</span>
            <kbd>⌃⇧K</kbd>
          </button>

          <span className="dag-more__rule" />

          {/* This stays exactly the control it was — a file input, worn by its own row. A menu item that
          only *looked* like one would need a second route to the file dialog. */}
          <label className="dag-more__item" title="Bring in files: images, text, a whole board">
            <Upload {...ICON} aria-hidden="true" />
            <span>Import…</span>
            <input
              className="dag-add__select"
              data-dag-import=""
              type="file"
              multiple
              accept="image/*,.md,.txt,.markdown,.csv,.tsv,text/*"
              aria-label="Import files"
              onChange={(e) => {
                const files = Array.from(e.target.files ?? []);
                e.target.value = "";
                onDone();
                if (files.length) edit.onImport(files);
              }}
            />
          </label>

          <span className="dag-more__rule" />

          <button
            className="dag-more__item"
            data-dag-help=""
            role="menuitem"
            title={`Keyboard shortcuts${hint("help")}`}
            onClick={() => {
              onDone();
              edit.onHelp();
            }}
          >
            <Keyboard {...ICON} aria-hidden="true" />
            <span>Shortcuts</span>
            <kbd>{chordFor("help")}</kbd>
          </button>
        </>
      ) : null}
    </div>
  );
}
