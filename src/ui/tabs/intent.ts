/**
 * Whether the press being handled asked for a new tab: a middle click, or a click with Ctrl or ⌘ —
 * opened behind the page it was made on, as a browser opens a link in a new tab, or in front with
 * Shift as well.
 *
 * Every place that opens a document — a search hit, a row on Home, a task, a card on the calendar —
 * calls `open` from its own click handler, and none of them was written to pass a modifier along.
 * So the window notes it in the capture phase, before any handler runs, and `open` asks while the
 * same event is still being dispatched; a timer clears it before the next one. A press that means
 * something else with the modifier — the sidebar's Ctrl/⌘-click, which picks a row — does not call
 * `open` at all, so it is not changed by this.
 *
 * A middle click is an `auxclick`, which a handler meant for `click` never hears: a row that opens a
 * file says so with `onAuxClick={middle(…)}` and gets the same answer.
 */

/** Where a new tab asked for by a press goes: behind the tab in front, or in front of it. */
export type NewTab = "behind" | "front";

let wanted: NewTab | null = null;
let installed = false;

const note = (e: MouseEvent): void => {
  const asks = e.type === "auxclick" ? e.button === 1 : e.button === 0 && (e.ctrlKey || e.metaKey);
  if (!asks) return;
  wanted = e.shiftKey ? "front" : "behind";
  setTimeout(() => {
    wanted = null;
  }, 0);
};

/** Start listening, once. Called when the shell first draws; a snapshot draws none. */
export function installTabIntent(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  addEventListener("click", note, true);
  addEventListener("auxclick", note, true);
}

/** Whether the click being dispatched now asked for a new tab, and where it goes. */
export const newTabWanted = (): NewTab | null => wanted;

/**
 * An `onAuxClick` for something that opens a document on a click: a middle click does what the click
 * does, and the click's `open` hears that it asked for a new tab. The middle press's own default — a
 * paste on Linux, autoscroll on Windows — is not the gesture, so it is stopped.
 */
export const middle =
  (open: () => void) =>
  (e: { button: number; preventDefault(): void }): void => {
    if (e.button !== 1) return;
    e.preventDefault();
    open();
  };
