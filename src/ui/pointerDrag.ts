import { DRAG_SLOP } from "@/canvas/geometry";

/**
 * A press that might turn out to be a drag.
 *
 * Pointer events, never HTML drag-and-drop: the canvas sets `touch-action: none` and listens for
 * pointers, and the native API answers with a `dragover` storm and a ghost it cannot style. The
 * shape here is the one `Library.tsx` and `useEditor` already use four times over — arm on
 * `DRAG_SLOP` so a click is still a click, mark the document while a drag is live so the cursor
 * and the text selection behave, listen on the window so the pointer may leave the element it
 * started on, and tear all three listeners down on the way out however the gesture ended.
 *
 * `onClick` is the press that never became a drag; `onDrop` fires only on a real `pointerup`, so a
 * `pointercancel` cleans up and commits nothing. Neither the tab strip nor the board list captures
 * the pointer: both want `elementFromPoint` to answer with what is *under* the cursor, which a
 * capture would not change but which is easier to reason about uncaptured.
 */
export function startDrag(
  e: { button: number; clientX: number; clientY: number; pointerType?: string },
  h: {
    /** Every move once the slop is passed. The first call is also the "a drag has begun" signal. */
    onMove(ev: PointerEvent, first: boolean): void;
    /** A real release, after at least one `onMove`. */
    onDrop(ev: PointerEvent): void;
    /** A press that never moved far enough to be a drag. */
    onClick?(): void;
    /** Always, drag or not, after everything else — where a gesture undoes its own painting. */
    onEnd?(): void;
    /** A finger held still for `hold`: from here a move is a drag, and lifting is neither a click nor a drop. */
    onHold?(): void;
  },
  /**
   * For a finger, how long it must rest before a move is a drag. Without it every swipe
   * over the element is a drag, which on anything that scrolls is every scroll. A move before the
   * hold is a scroll and ends the gesture: the element says `touch-action: pan-y`, so the browser
   * scrolls, and once held `holdStill` keeps it from scrolling under the drag.
   */
  hold?: number,
): void {
  if (e.button !== 0) return;
  const sx = e.clientX;
  const sy = e.clientY;
  let moved = false;
  /* Whether a move may start a drag yet: at once for a mouse or a pen, after the hold for a finger. */
  let armed = !(hold && e.pointerType === "touch");
  let held = false;
  const timer = armed
    ? undefined
    : window.setTimeout(() => {
        armed = true;
        held = true;
        h.onHold?.();
      }, hold);

  const done = () => {
    window.clearTimeout(timer);
    held = false;
    removeEventListener("pointermove", onMove);
    removeEventListener("pointerup", onUp);
    removeEventListener("pointercancel", onUp);
    delete document.documentElement.dataset.dagDragging;
  };

  const onMove = (ev: PointerEvent) => {
    let first = false;
    if (!moved) {
      if (Math.abs(ev.clientX - sx) + Math.abs(ev.clientY - sy) < DRAG_SLOP) return;
      if (!armed) {
        /* A finger that moved before it was held is scrolling: nothing here is a gesture any more. */
        done();
        h.onEnd?.();
        return;
      }
      moved = true;
      first = true;
      document.documentElement.dataset.dagDragging = "";
    }
    h.onMove(ev, first);
  };

  const onUp = (ev: PointerEvent) => {
    const wasHeld = held;
    done();
    if (!moved) {
      if (!wasHeld) h.onClick?.();
    } else if (ev.type === "pointerup") h.onDrop(ev);
    h.onEnd?.();
  };

  holding = () => held;
  addEventListener("pointermove", onMove);
  addEventListener("pointerup", onUp);
  addEventListener("pointercancel", onUp);
}

/* Whether a finger is holding something now — what `holdStill` asks. One gesture at a time. */
let holding: () => boolean = () => false;

/**
 * Keep `el` from scrolling under a held finger. `touch-action` is decided when the touch
 * starts and cannot be taken back, so a row that lets a list scroll would scroll under the drag it
 * was held for; a `touchmove` cancelled while something is held is what stops it. The listener is
 * on the element and not passive, which is what makes the browser ask it before it scrolls — one on
 * the document is passive by default, and a passive listener's `preventDefault` does nothing.
 * Returns the way to take it off.
 */
export function holdStill(el: HTMLElement): () => void {
  const stop = (ev: TouchEvent) => {
    if (holding() && ev.cancelable) ev.preventDefault();
  };
  el.addEventListener("touchmove", stop, { passive: false });
  return () => el.removeEventListener("touchmove", stop);
}
