import { Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";

import type { BoardItem } from "@/board/types";
import { FieldEditor } from "@/blocks";
import type { Point } from "@/canvas/geometry";
import { ownAssets } from "@/render/assets";

/**
 * A board's `md` card, edited as rich text where it is drawn (#145).
 *
 * **The same bargain as a note: BlockNote never reads or writes a byte of the card.** The body goes
 * in and comes out through `src/note/markdown.ts`, inside `FieldEditor`'s `card` variant, so a block
 * the person did not touch keeps the bytes it was written with — an agent's table padding, its
 * wrapping, its `*` bullets — and a card opened and left writes nothing at all.
 *
 * **Over the card, not inside it**, for `Rename`'s reasons: `Item` is memoised and sized by
 * arithmetic, and the board file is the only copy of the text. So this is a box in the layer,
 * placed on the card's own rectangle and growing down from it while the person types; the card
 * under it is redrawn from the file a quarter of a second behind. It pans and zooms with the board
 * because the layer carries the transform.
 *
 * **Every change is the panel's write**: `onChange` goes through the same 250 ms debounce and the
 * same `body:<id>` key the source box used, so one sitting of typing is one undo. Escape, or a press
 * anywhere outside the box and its menus, writes what is pending and closes it.
 *
 * The editor's chunk is loaded here and not before: `?snapshot=1` and `?view=1` never reach this
 * file, and a board that nobody writes on never fetches BlockNote.
 */

const DEBOUNCE = 250;

interface Placed {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** What still belongs to the editor although it is drawn outside the box: its floating menus. */
const OURS = ".dag-card-text, .bn-container, .bn-ui-container, [data-floating-ui-portal], .mantine-Popover-dropdown";

export function CardText({
  item,
  boardName,
  scheme,
  toBoard,
  onChange,
  onDone,
}: {
  item: BoardItem;
  boardName: string;
  scheme: "light" | "dark";
  toBoard(clientX: number, clientY: number): Point;
  onChange(id: string, body: string): void;
  onDone(): void;
}) {
  const [placed, setPlaced] = useState<Placed | null>(null);
  const [start] = useState(item.body);
  const box = useRef<HTMLDivElement>(null);
  const pending = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef({ id: item.id, onChange, onDone });
  latest.current = { id: item.id, onChange, onDone };

  /* The card's rectangle in board units. A card made by `N` is not drawn yet when this mounts, so
     it is looked for again on the next frames until it is. */
  useLayoutEffect(() => {
    let frame = 0;
    const measure = () => {
      const el = document.querySelector<HTMLElement>(`[data-dag-item="${CSS.escape(item.id)}"] .dag-item__body`);
      if (!el) {
        frame = requestAnimationFrame(measure);
        return;
      }
      const r = el.getBoundingClientRect();
      const a = toBoard(r.left, r.top);
      const b = toBoard(r.right, r.bottom);
      setPlaced({ x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y });
    };
    measure();
    return () => cancelAnimationFrame(frame);
  }, [item.id, toBoard]);

  /* Placed, and so visible: the caret goes in if it is not there yet. `FieldEditor` focuses itself
     as it mounts, which can be while the box is still hidden and unplaced — and a focus inside a
     hidden box does not take, so the person opened the card from the panel and typed into nothing. */
  useEffect(() => {
    if (!placed) return;
    const frame = requestAnimationFrame(() => {
      const el = box.current;
      if (!el || el.contains(document.activeElement)) return;
      el.querySelector<HTMLElement>('[contenteditable="true"]')?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [placed]);

  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const md = pending.current;
    pending.current = null;
    if (md !== null) latest.current.onChange(latest.current.id, md);
  }, []);

  const done = useCallback(() => {
    flush();
    latest.current.onDone();
  }, [flush]);

  /* Unmounted by something else — the item deleted, the board changed: what was typed still lands. */
  useEffect(() => () => flush(), [flush]);

  /* A press outside the box and its menus is the person moving on. Capture, so the canvas's own
     press — which may select something else — sees a closed editor. */
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if ((e.target as Element | null)?.closest?.(OURS)) return;
      done();
    };
    addEventListener("pointerdown", onDown, true);
    return () => removeEventListener("pointerdown", onDown, true);
  }, [done]);

  const upload = useCallback(
    async (file: File): Promise<string> => {
      const dataUrl = await new Promise<string>((ok, fail) => {
        const reader = new FileReader();
        reader.onload = () => ok(String(reader.result));
        reader.onerror = () => fail(reader.error);
        reader.readAsDataURL(file);
      });
      const r = await fetch(`/__board/upload?name=${encodeURIComponent(boardName)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ dataUrl }),
      });
      if (!r.ok) throw new Error(`the picture was refused (${r.status})`);
      return ((await r.json()) as { src: string }).src;
    },
    [boardName],
  );

  const style: CSSProperties | undefined = placed
    ? { transform: `translate(${placed.x}px, ${placed.y}px)`, width: placed.w, minHeight: placed.h }
    : { visibility: "hidden" };

  return (
    <div
      ref={box}
      className="dag-card-text"
      data-dag-card-text={item.id}
      style={style}
      /* The canvas listens on the paper for presses, wheels and keys; none of them is its business here. */
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
    >
      <Suspense fallback={null}>
        <FieldEditor
          md={start}
          variant="card"
          label={`Text of ${item.title ?? item.id}`}
          scheme={scheme}
          upload={upload}
          resolve={(src) => ownAssets(boardName, src)}
          onChange={(md) => {
            pending.current = md;
            if (timer.current) clearTimeout(timer.current);
            timer.current = setTimeout(flush, DEBOUNCE);
          }}
          onDone={done}
        />
      </Suspense>
    </div>
  );
}
