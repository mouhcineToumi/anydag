import { useEffect, useRef, useState } from "react";
import { Plus, X } from "lucide-react";

import { dropBefore } from "@/board/pages";
import type { BoardPage } from "@/board/types";
import { startDrag } from "./pointerDrag";

interface Props {
  pages: BoardPage[];
  page: string;
  onPage(id: string): void;
  /** The page controls. Absent when the board cannot be written. */
  edit?: {
    add(): void;
    rename(id: string, name: string): void;
    remove(id: string): void;
    reorder(id: string, before: string | null): void;
  };
  /** How many problems a page has, by page id: a count beside its name, so one on a page nobody is looking at shows. Pages absent or at 0 show none. */
  flags?: Readonly<Record<string, number>>;
  /** What one is called, in the labels: a board's pages, a table's tabs. */
  noun?: "page" | "tab";
}

/**
 * The page tabs, along the bottom of the window.
 *
 * A spreadsheet's sheet tabs and Excalidraw's scenes are both down here, and that is not only
 * convention: a tab strip in the toolbar competes with the tools for a row that is already full,
 * which is what left a page called "What the office actually produces" wrapped onto three lines
 * inside a box with no border. Down here the strip owns its own width.
 *
 * It is a sibling of `.dag-body` rather than a child, so it spans the window under the board list
 * and the inspector alike. Wrapping the viewport instead would put a new element between
 * `.dag-body` and `.dag-viewport`, whose `flex: 1; min-width: 0` contract every selector in
 * `canvas.css` is written against — a real risk for a cosmetic gain.
 */
export function PageBar({ pages, page, onPage, edit, flags, noun = "page" }: Props) {
  /* Which tab is being renamed, if any. Local: nothing outside the strip cares. */
  const [renaming, setRenaming] = useState<string | null>(null);
  const scroll = useRef<HTMLDivElement>(null);
  /*
   * Whether the gesture that is ending was a drag, so the `click` after it does not also open the
   * page somebody was only reordering.
   *
   * Cleared when a press *starts* rather than by the click that reads it: a reorder ends on a
   * different tab than it began on, so no `click` is dispatched at all — and a flag waiting to be
   * consumed by an event that never comes stays set and swallows the next real click instead.
   */
  const dragged = useRef(false);

  /* Keep the page you are on in view. The strip scrolls rather than shrinking its tabs, so on a
     board with a dozen pages the active one can be off the end — including right after `add`,
     which opens the page it just appended. */
  useEffect(() => {
    scroll.current?.querySelector<HTMLElement>(`[data-dag-page="${CSS.escape(page)}"]`)?.scrollIntoView({
      block: "nearest",
      inline: "nearest",
    });
  }, [page, pages]);

  const clearMarks = () => {
    for (const el of scroll.current?.querySelectorAll<HTMLElement>("[data-dag-tab-drop]") ?? []) {
      delete el.dataset.dagTabDrop;
    }
  };

  const onPointerDown = (id: string) => (e: React.PointerEvent<HTMLButtonElement>) => {
    dragged.current = false;
    if (!edit || pages.length < 2 || renaming) return;
    const wrap = e.currentTarget.closest<HTMLElement>(".dag-tab-wrap");
    const startX = e.clientX;
    let before: string | null = null;
    let ok = false;

    startDrag(e, {
      onMove(ev, first) {
        if (first) wrap?.classList.add("dag-tab-wrap--dragging");
        if (wrap) wrap.style.transform = `translateX(${ev.clientX - startX}px)`;

        /* The tab under the pointer, not an index computed from where the drag began: the strip
           scrolls, so a drag across an overflowed strip passes tabs that were not on screen when
           it started. `pointer-events: none` on the dragged tab is what stops it answering for
           itself — `elementFromPoint` would otherwise always find the thing being carried. */
        clearMarks();
        ok = false;
        const over = document.elementFromPoint(ev.clientX, ev.clientY)?.closest<HTMLElement>("[data-dag-page]");
        const target = over?.dataset.dagPage;
        if (!over || !target || target === id) return;
        const box = over.getBoundingClientRect();
        const after = ev.clientX > box.x + box.width / 2;
        over.closest<HTMLElement>(".dag-tab-wrap")?.setAttribute("data-dag-tab-drop", after ? "after" : "before");
        before = dropBefore(pages, target, after);
        ok = true;
      },
      onDrop() {
        if (!ok) return;
        dragged.current = true;
        edit.reorder(id, before);
      },
      onEnd() {
        clearMarks();
        wrap?.classList.remove("dag-tab-wrap--dragging");
        if (wrap) wrap.style.transform = "";
      },
    });
  };

  /* Shift+arrows do the same thing from the keyboard, and plain arrows rove the tablist — the
     WAI pattern, and the only way this gesture is reachable without a pointer. */
  const onKeyDown = (id: string, at: number) => (e: React.KeyboardEvent) => {
    const dir = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!dir) return;
    e.preventDefault();
    if (e.shiftKey) {
      if (!edit) return;
      const to = at + dir;
      if (to < 0 || to >= pages.length) return;
      /* Moving right means landing in front of the page after the one you are passing. */
      edit.reorder(id, dir < 0 ? pages[to]!.id : (pages[to + 1]?.id ?? null));
      return;
    }
    const next = pages[at + dir];
    if (next) scroll.current?.querySelector<HTMLElement>(`[data-dag-page="${CSS.escape(next.id)}"]`)?.focus();
  };

  return (
    <footer className="dag-pagebar" data-dag-pagebar="">
      <div className="dag-pagebar__scroll" ref={scroll} role="tablist" aria-label={noun === "tab" ? "Tabs" : "Pages"}>
        {pages.map((p, at) =>
          renaming === p.id && edit ? (
            <input
              key={p.id}
              className="dag-tab__name"
              data-dag-page-name=""
              autoFocus
              spellCheck={false}
              aria-label={noun === "tab" ? "Tab name" : "Page name"}
              defaultValue={p.name}
              onBlur={() => setRenaming(null)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  const v = e.currentTarget.value.trim();
                  setRenaming(null);
                  if (v && v !== p.name) edit.rename(p.id, v);
                } else if (e.key === "Escape") setRenaming(null);
              }}
            />
          ) : (
            <span key={p.id} className="dag-tab-wrap">
              <button
                role="tab"
                data-dag-page={p.id}
                aria-selected={p.id === page}
                tabIndex={p.id === page ? 0 : -1}
                className={`${p.id === page ? "dag-tab dag-tab--on" : "dag-tab"}${flags?.[p.id] ? " dag-tab--flagged" : ""}`}
                /* The whole name, since the tab itself shows one truncated line of it. */
                title={p.name}
                onPointerDown={onPointerDown(p.id)}
                onKeyDown={onKeyDown(p.id, at)}
                onClick={() => {
                  if (!dragged.current) onPage(p.id);
                }}
                onDoubleClick={() => edit && setRenaming(p.id)}
              >
                {flags?.[p.id] ? (
                  <>
                    <span className="dag-tab__label">{p.name}</span>
                    <span
                      className="dag-tab__flag"
                      data-dag-page-flag={flags[p.id]}
                      aria-label={`${flags[p.id]} ${flags[p.id] === 1 ? "problem" : "problems"}`}
                    >
                      {flags[p.id]}
                    </span>
                  </>
                ) : (
                  p.name
                )}
              </button>
              {edit && pages.length > 1 && p.id === page ? (
                <button
                  className="dag-tab__close"
                  data-dag-page-remove={p.id}
                  aria-label={`Remove ${p.name}`}
                  title={
                    noun === "tab"
                      ? "Remove this tab and its rows (Ctrl+Z brings it back)"
                      : "Remove this page: what is on it moves to the first"
                  }
                  onClick={() => edit.remove(p.id)}
                >
                  <X size={12} strokeWidth={2} aria-hidden="true" />
                </button>
              ) : null}
            </span>
          ),
        )}
        {edit ? (
          <button
            className="dag-tab dag-tab__add"
            data-dag-page-add=""
            aria-label={`Add a ${noun}`}
            title={`Add a ${noun}`}
            onClick={edit.add}
          >
            <Plus size={14} strokeWidth={2} aria-hidden="true" />
          </button>
        ) : null}
      </div>
    </footer>
  );
}
