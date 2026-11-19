import { useSyncExternalStore } from "react";

import { everyFile, FILE_KINDS, type BoardTree, type FileKind } from "@/board/useBoard";
import { desktop } from "@/vault/desktop";

/**
 * The window's own history: the documents and pages Back and Forward walk.
 *
 * **The entry is the address the app already uses.** Opening a file from the sidebar, the search
 * or a reference is a `pushState` of `?board=`, `?note=`, `?quiz=`, `?table=` or `?file=`, and a
 * listing page is its own key (`?tasks=`, `?calendar=`, …) — so in `anydag serve` the browser's
 * own Back, Forward, Alt+Left, ⌘[ and mouse buttons work with no help from us, and a reload lands
 * on the page the address names.
 *
 * **The state carries the file's id, and the address only its name.** A name is what a person
 * reads in a URL, and a rename changes it, so an entry whose id still resolves is followed to the
 * name the file has now (`resolvePlace`), and an entry whose file has gone to the trash is
 * skipped — the pop handler asks before it renders the page a 404, so a history is never a broken
 * page. Nothing in here is written to a vault: the state is the browser's.
 *
 * **The position is ours, not `history.length`'s.** The platform does not say where in its list a
 * tab is, only how many entries there are, and the initial about:blank is one of them — so every
 * entry this module makes carries `{ at, top }` in `history.state`, and the arrows are disabled at
 * `at === 0` and at `at === top`. `top` is kept on the entry too, because a reload restores the
 * state and the entries ahead of it are still there.
 *
 * **Keys and the mouse are the desktop's, and only the desktop's.** A browser already has those
 * four shortcuts, and taking them in the page as well would move two entries for one press. With
 * the shell's bridge present the page listens: Alt+Left/Right on Linux and Windows, ⌘[ and ⌘] on
 * macOS (where Option+Left belongs to the text), mouse buttons 3 and 4, and the `app-command`
 * events the shell forwards for the back and forward buttons Windows and Linux deliver outside the
 * DOM. A mouse press and the shell's own report of it are one gesture, so they share a short
 * cooldown.
 */

export interface HistoryPlace {
  kind: FileKind;
  /** The entry's own name, as the address had it — what a following entry compares against. */
  name: string;
  /** The file's permanent id, when the listing knew it: the half that survives a rename. */
  id?: string;
}

/**
 * One entry's mark in `history.state`; `top` is the furthest entry this window has reached, and
 * `tab` the document tab the entry was made in (`src/ui/tabs/`), so Back to it brings that tab to the
 * front again.
 */
interface Mark {
  at: number;
  top: number;
  place: HistoryPlace | null;
  tab?: string;
}

interface Position {
  at: number;
  top: number;
}

const KEY = "dagHistory";

let position: Position = { at: 0, top: 0 };
const listeners = new Set<() => void>();
let installed = false;

/** The state object the store hands React; a new one only when a number changed. */
const snapshot = (): Position => position;

const publish = (): void => {
  for (const listener of listeners) listener();
};

const isKind = (value: unknown): value is FileKind =>
  typeof value === "string" && (FILE_KINDS as readonly string[]).includes(value);

/** A place read back off `history.state`, which is whatever a past version of the page put there. */
function asPlace(raw: unknown): HistoryPlace | null {
  if (!raw || typeof raw !== "object") return null;
  const { kind, name, id } = raw as { kind?: unknown; name?: unknown; id?: unknown };
  if (!isKind(kind) || typeof name !== "string" || !name) return null;
  return typeof id === "string" && id ? { kind, name, id } : { kind, name };
}

/** A mark read back off `history.state`, or `null` for an entry this page did not make. */
function asMark(raw: unknown): Mark | null {
  if (!raw || typeof raw !== "object") return null;
  const held = (raw as { [KEY]?: unknown })[KEY];
  if (!held || typeof held !== "object") return null;
  const { at, top, place, tab } = held as { at?: unknown; top?: unknown; place?: unknown; tab?: unknown };
  if (typeof at !== "number" || !Number.isInteger(at) || at < 0) return null;
  const reached = typeof top === "number" && Number.isInteger(top) && top >= at ? top : at;
  return typeof tab === "string" && tab
    ? { at, top: reached, place: asPlace(place), tab }
    : { at, top: reached, place: asPlace(place) };
}

/** The state an entry is given: other writers' keys kept, this module's one replaced. */
function withMark(raw: unknown, mark: Mark): Record<string, unknown> {
  const held = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return { ...held, [KEY]: mark };
}

const samePlace = (a: HistoryPlace | null, b: HistoryPlace | null): boolean =>
  a === b || (!!a && !!b && a.kind === b.kind && a.name === b.name && a.id === b.id);

/**
 * Bring the store up, once: read the entry's mark (or write the first one), and listen for what
 * moves the window. Called before the first render by `main.tsx`, and lazily by anything that asks
 * for the controls, so a tab loaded straight onto a page still has its index.
 */
export function installHistory(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  const mark = asMark(history.state);
  if (mark) {
    position = { at: mark.at, top: Math.max(mark.top, mark.at) };
  } else {
    position = { at: 0, top: 0 };
    history.replaceState(withMark(history.state, { at: 0, top: 0, place: null }), "");
  }
  addEventListener("popstate", onPop);
  /* A browser already answers these four; only the shell has no chrome to answer with. */
  if (desktop()) {
    addEventListener("keydown", onKey, true);
    addEventListener("mouseup", onMouseUp, true);
    desktop()?.history?.onCommand?.(pointerCommand);
  }
}

function onPop(): void {
  const mark = asMark(history.state);
  const next = mark ? { at: mark.at, top: Math.max(position.top, mark.top) } : { at: 0, top: position.top };
  if (next.at === position.at && next.top === position.top) return;
  position = next;
  publish();
}

/** The mark an entry is given, its tab left off when it has none. */
const markOf = (place: HistoryPlace | null, tab: string | undefined): Mark =>
  tab ? { at: position.at, top: position.top, place, tab } : { at: position.at, top: position.top, place };

/** A new place in the history: what opening another document or page is, in document tab `tab`. */
export function pushHistory(url: string, place: HistoryPlace | null, tab?: string): number {
  installHistory();
  position = { at: position.at + 1, top: position.at + 1 };
  history.pushState({ [KEY]: markOf(place, tab) }, "", url);
  publish();
  return position.at;
}

/**
 * A change inside the entry somebody is on — a theme, a page's own tab, a rename of the open file.
 * The entry keeps its document tab unless `tab` names another.
 */
export function replaceHistory(url: string, place?: HistoryPlace | null, tab?: string): void {
  installHistory();
  const mark = asMark(history.state);
  const kept = place === undefined ? (mark?.place ?? null) : place;
  history.replaceState(withMark(history.state, markOf(kept, tab ?? mark?.tab)), "", url);
}

/** Whether `place` is what `search` names: one file key, the same kind and name — or none at all. */
export function placeInAddress(place: HistoryPlace | null, search: string): boolean {
  const said = new URLSearchParams(search);
  const named = FILE_KINDS.filter((kind) => said.get(kind) !== null);
  return place ? named.length === 1 && named[0] === place.kind && said.get(place.kind) === place.name : named.length === 0;
}

/** The current entry's place, when the listing did not know the file's id as it was pushed. */
export function markHistoryPlace(place: HistoryPlace | null): void {
  installHistory();
  /* **The entry is its address, and a pop moves the address before the page adopts it.** An effect
     left over from the page being left can ask to mark that page's place at exactly the moment the
     entry the pop made current becomes current: writing it would put the old page's file on the new
     entry's state, and the pop handler — which reads the place off that state — would then find the
     old page and never follow the entry's own file (#500). So only a place the address names is
     written. */
  if (typeof location !== "undefined" && !placeInAddress(place, location.search)) return;
  const mark = asMark(history.state);
  if (mark?.at === position.at && mark.top === position.top && samePlace(mark.place, place)) return;
  history.replaceState(withMark(history.state, markOf(place, mark?.tab)), "");
}

/** The current entry's document tab, when it was made in one and the window still knows which. */
export const historyTab = (): string | null => asMark(history.state)?.tab ?? null;

/** The current entry belongs to document tab `tab`: an entry made before it, or by a tab now closed. */
export function markHistoryTab(tab: string): void {
  installHistory();
  const mark = asMark(history.state);
  if (mark?.tab === tab) return;
  history.replaceState(withMark(history.state, markOf(mark?.place ?? null, tab)), "");
}

/** Where in the window's history the page is, for the pop handler below. */
export const historyAt = (): number => position.at;

/** Whether there is an entry ahead: what makes Forward possible. */
export const historyCanForward = (): boolean => position.at < position.top;

/** The entry's place, read off the state the browser restored it with. */
export const historyPlace = (): HistoryPlace | null => asMark(history.state)?.place ?? null;

const historyBack = (): void => {
  installHistory();
  if (position.at > 0) history.back();
};

const historyForward = (): void => {
  installHistory();
  if (position.at < position.top) history.forward();
};

/* A mouse press and the shell's own `app-command` for it are the same gesture. Long enough that a
   double report is one move, short enough that two real presses are two. */
let lastPointer = 0;
function pointerCommand(to: "back" | "forward"): void {
  const now = Date.now();
  if (now - lastPointer < 300) return;
  lastPointer = now;
  if (to === "back") historyBack();
  else historyForward();
}

function onMouseUp(e: MouseEvent): void {
  if (e.button !== 3 && e.button !== 4) return;
  e.preventDefault();
  pointerCommand(e.button === 3 ? "back" : "forward");
}

/**
 * Alt+Left/Right, or ⌘[ / ⌘] on a mac.
 *
 * Taken in the capture phase and stopped, so a selected item on a board does not also nudge with
 * Alt and a focused note does not treat the pair as a word. Registered before the page mounts, so
 * it is the first listener the window has.
 */
function onKey(e: KeyboardEvent): void {
  if (e.defaultPrevented || e.repeat) return;
  let to: "back" | "forward" | null = null;
  if (desktop()?.platform === "darwin") {
    if (!e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
    if (e.code === "BracketLeft" || e.key === "[") to = "back";
    else if (e.code === "BracketRight" || e.key === "]") to = "forward";
  } else {
    if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    if (e.key === "ArrowLeft") to = "back";
    else if (e.key === "ArrowRight") to = "forward";
  }
  if (!to) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  if (to === "back") historyBack();
  else historyForward();
}

const subscribe = (listener: () => void): (() => void) => {
  installHistory();
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** What the top bar draws: two arrows, disabled at the two ends. */
export function useHistoryControls(): {
  canBack: boolean;
  canForward: boolean;
  back(): void;
  forward(): void;
} {
  const now = useSyncExternalStore(subscribe, snapshot, snapshot);
  return { canBack: now.at > 0, canForward: now.at < now.top, back: historyBack, forward: historyForward };
}

/**
 * What a history entry's file is now: the same file, a name that moved, or one that has gone.
 *
 * Read off the listing, which is the server's answer on this page load: an id is what survives a
 * rename, and a kept list is not asked because it may name a file that has moved since. `wait` is
 * a list on its way — the caller holds the entry until it lands rather than deciding on nothing.
 */
export type PlaceAnswer = { state: "same" } | { state: "moved"; place: HistoryPlace } | { state: "gone" } | { state: "wait" };

export function resolvePlace(place: HistoryPlace, list: BoardTree): PlaceAnswer {
  if (!list.fresh) return { state: "wait" };
  if (place.id) {
    for (const file of everyFile(list)) {
      if (list.ids[file.name] !== place.id) continue;
      return file.kind === place.kind && file.name === place.name
        ? { state: "same" }
        : { state: "moved", place: { kind: file.kind, name: file.name, id: place.id } };
    }
    return { state: "gone" };
  }
  return everyFile(list).some((file) => file.kind === place.kind && file.name === place.name)
    ? { state: "same" }
    : { state: "gone" };
}

/**
 * The file an id names now, from the server. `null` is the answer for an id nothing holds, which
 * is what a trashed file is; anything else that is not an answer is thrown, so the caller shows
 * the page rather than treating a quiet server as a deletion.
 */
export async function resolvePlaceId(id: string): Promise<{ kind: FileKind; name: string } | null> {
  const response = await fetch(`/__board/resolve?id=${encodeURIComponent(id)}`);
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`resolve answered ${response.status}`);
  const body = (await response.json()) as { name?: unknown; kind?: unknown };
  if (typeof body.name !== "string" || !body.name || !isKind(body.kind)) throw new Error("resolve answered no file");
  return { kind: body.kind, name: body.name };
}

/** The chord the tooltips name, matching what this window actually listens for. */
export function historyChords(): { back: string; forward: string } {
  const mac = desktop()?.platform === "darwin" || (typeof navigator !== "undefined" && /Mac/.test(navigator.platform ?? ""));
  return mac ? { back: "⌘[", forward: "⌘]" } : { back: "Alt+Left", forward: "Alt+Right" };
}
