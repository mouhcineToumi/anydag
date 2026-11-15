import { createContext, useContext } from "react";

/**
 * What a tab keeps while it is not in front (#264).
 *
 * **Two ways a tab keeps its state.** A note's editor holds what no file says — the caret, the
 * selection, ProseMirror's own undo — and building it again costs the most of any page, so the few
 * notes most recently in front stay **mounted**, hidden and inert (`LIVE_NOTES`, `App`'s `TabFrame`).
 * Every other page is **unmounted** when its tab goes behind, and what it would lose is kept here,
 * in memory, by tab: a board's view, selection and undo (which is versions of the file, so plain
 * data), and every page's scroll. Nothing here is written anywhere: switching tabs never writes a
 * byte, of a file or of the app home.
 *
 * A note pushed out of the mounted few flushes what it was holding as any page does when it goes
 * (`NoteView`), and comes back from the file with its scroll — but not its editor undo, which lived
 * in the editor.
 */

/** How many notes behind the one in front stay mounted. Measured: `e2e/doctabs-memory.spec.ts`. */
export const LIVE_NOTES = 3;

/** Which tab a page is drawn for, and whether it is the one in front. */
export interface TabFrameInfo {
  id: string;
  active: boolean;
}

/** No tab at all — a snapshot, an embed, a check: everything is in front, and nothing is kept. */
const NONE: TabFrameInfo = { id: "", active: true };

export const TabFrameContext = createContext<TabFrameInfo>(NONE);

/**
 * Whether the page this is drawn in is the tab in front. A page kept mounted behind it hears none of
 * the window's keys, events or address: everything a hook listens to on `window` or `document` asks
 * this first.
 */
export const useTabActive = (): boolean => useContext(TabFrameContext).active;

const bags = new Map<string, Map<string, unknown>>();

/** The value a tab keeps under `key`, made the first time it is asked for. */
export function keptFor<T>(tab: string, key: string, make: () => T): T {
  let bag = bags.get(tab);
  if (!bag) bags.set(tab, (bag = new Map()));
  if (!bag.has(key)) bag.set(key, make());
  return bag.get(key) as T;
}

/** A closed tab keeps nothing. */
export function forgetTab(tab: string): void {
  bags.delete(tab);
}

/**
 * The object this page's tab keeps under `key` — the same object every time the tab is drawn,
 * mounted again or not. Outside a tab (a snapshot, an embed) nothing is kept, and it is `undefined`.
 */
export function useTabKeep<T extends object>(key: string, make: () => T): T | undefined {
  const { id } = useContext(TabFrameContext);
  return id ? keptFor(id, key, make) : undefined;
}

/* ---- scroll ---- */

/** One scrolled box, found again by the path of classes from the frame down to it. */
export interface KeptScroll {
  path: string[];
  top: number;
  left: number;
}

const step = (el: Element): string => {
  const parent = el.parentElement;
  const sig = `${el.tagName}.${el.classList[0] ?? ""}`;
  if (!parent) return sig;
  let n = 0;
  for (const sib of parent.children) {
    if (sib === el) break;
    if (`${sib.tagName}.${sib.classList[0] ?? ""}` === sig) n++;
  }
  return `${sig}#${n}`;
};

/** Every box under `root` that is scrolled, and where to. Read before the page goes. */
export function saveScroll(root: Element): KeptScroll[] {
  const out: KeptScroll[] = [];
  for (const el of root.querySelectorAll("*")) {
    if (el.scrollTop === 0 && el.scrollLeft === 0) continue;
    const path: string[] = [];
    for (let at: Element | null = el; at && at !== root; at = at.parentElement) path.unshift(step(at));
    out.push({ path, top: el.scrollTop, left: el.scrollLeft });
  }
  return out;
}

function find(root: Element, path: readonly string[]): Element | null {
  let at: Element = root;
  for (const want of path) {
    const next = [...at.children].find((c) => step(c) === want);
    if (!next) return null;
    at = next;
  }
  return at;
}

/** How long a page that is still loading is given to grow tall enough to scroll back. */
const RESTORE_MS = 3000;
/**
 * And how long a box put back is held there: a page's own first effects — a row scrolled into view,
 * a field focused — run after the frame is mounted, and would otherwise move what was just restored.
 */
const SETTLE_MS = 600;

/**
 * Put the boxes back where they were, as the page fills in: a page mounted again loads its file
 * first, so a box may not exist yet, or not be tall enough. Tries on every change under `root` and
 * every frame until each one is back and has stayed back a moment, the time is up, or the person
 * scrolls or presses something — what they do wins. Returns the stop.
 */
export function restoreScroll(root: Element, kept: readonly KeptScroll[]): () => void {
  if (!kept.length) return () => {};
  const began = performance.now();
  let frame = 0;
  const attempt = () => {
    let back = true;
    for (const k of kept) {
      const el = find(root, k.path);
      if (!el) {
        back = false;
        continue;
      }
      if (el.scrollTop !== k.top) el.scrollTop = k.top;
      if (el.scrollLeft !== k.left) el.scrollLeft = k.left;
      if (Math.abs(el.scrollTop - k.top) > 1 || Math.abs(el.scrollLeft - k.left) > 1) back = false;
    }
    if (back && performance.now() - began > SETTLE_MS) stop();
  };
  const tick = () => {
    attempt();
    if (frame) frame = requestAnimationFrame(tick);
  };
  const watch = new MutationObserver(attempt);
  const timer = setTimeout(() => stop(), RESTORE_MS);
  const mine = { capture: true, passive: true } as const;
  const asks = ["wheel", "pointerdown", "keydown", "touchstart"];
  function stop(): void {
    watch.disconnect();
    clearTimeout(timer);
    cancelAnimationFrame(frame);
    frame = 0;
    for (const type of asks) removeEventListener(type, stop, mine);
  }
  for (const type of asks) addEventListener(type, stop, mine);
  watch.observe(root, { childList: true, subtree: true });
  frame = requestAnimationFrame(tick);
  attempt();
  return stop;
}
