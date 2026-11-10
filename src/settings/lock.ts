/**
 * The lock: the app in read-only mode, so somebody can browse without changing anything by
 * accident.
 *
 * **What it stops is every change to a file**: a board's items, a note's text and title, a quiz's
 * form, a table's cells, the task, event and project bars, a status button, a drag on the calendar
 * or the Tasks page, and the sidebar's New, rename, move, delete, upload and drag. What it leaves is
 * everything that only reads or is not a file: opening, search, export,
 * practising a quiz, Settings, and selecting and panning on a board.
 *
 * **It is this browser's, and survives a reload**. A phone can stay
 * locked while the laptop edits, which is the case the lock is most for: a finger brushing a board is
 * how a card gets moved nobody meant to move. So it is {@link writeLocal}, never in `PREF_KEYS`, and
 * every tab of this browser follows it through the `storage` event. `?snapshot=1` reads none of it,
 * as it reads no preference: a picture is a fact about the file, and a snapshot is read-only anyway.
 *
 * Each page asks {@link useLocked} and draws its read-only half; each place that writes asks
 * {@link isLocked} as well, as a floor under the drawing, and says so with {@link refuseLocked} —
 * which `LockNotice` turns into a word on the screen rather than a press that silently did nothing.
 */

import { useSyncExternalStore } from "react";

import { readPref, writeLocal } from "./prefs";

/** Where this browser keeps whether it is locked: `"1"`, or absent. */
export const LOCKED = "dag:locked";
/** Dispatched on `window` when this tab locks or unlocks. Another tab hears `storage` instead. */
export const LOCK_CHANGED = "dag:lock";
/** Dispatched on `window` when something that writes was refused because the app is locked. */
export const LOCK_REFUSED = "dag:lock-refused";

/** The chord, for the button's tooltip, the notice and the shortcut sheet: Obsidian's ctrl+E is the
    note editor's inline code, so it is L, for lock. */
export const LOCK_KEYS = "Ctrl+Shift+L";

/** What a control that writes says while the app is locked, before it is pressed and on hover. */
export const LOCK_HINT = `Read only — unlock (${LOCK_KEYS})`;

/** What the lock's notice has to say: the switch, a refusal, or the word that unlocking worked. */
export type LockSaid = "locked" | "unlocked" | "refused";

export function lockNoticeText(said: LockSaid): string {
  switch (said) {
    case "unlocked":
      return "Unlocked: you can edit again.";
    case "locked":
      return "Read only: nothing here changes until you unlock.";
    case "refused":
      return "Read only: unlock to change this.";
  }
}

/**
 * Which lines leave on the notice's timer. *Locked* and *unlocked* are announcements and go; a
 * *refused* line stays until it is dismissed or the app is unlocked, because a press that was
 * stopped is the thing the person is looking for an answer to. The notice handles the timer and the
 * dismiss; this is the rule, kept beside the words.
 */
export function lockNoticeLeaves(said: LockSaid): boolean {
  return said !== "refused";
}

/**
 * What a control that writes wears while the app is locked: `aria-disabled`, the class hook the
 * chrome styles, and the one sentence a hover explains it with. Spreading nothing when unlocked is
 * deliberate — a control that writes should not carry a lock's attributes all the time.
 */
export function lockedAffordance(locked: boolean): {
  "aria-disabled"?: true;
  "data-dag-readonly-blocked"?: "";
  title?: string;
} {
  return locked ? { "aria-disabled": true, "data-dag-readonly-blocked": "", title: LOCK_HINT } : {};
}

export function isLocked(): boolean {
  return readPref(LOCKED) === "1";
}

export function setLocked(on: boolean): void {
  if (on === isLocked()) return;
  writeLocal(LOCKED, on ? "1" : null);
  dispatchEvent(new CustomEvent(LOCK_CHANGED, { detail: on }));
}

export function toggleLock(): void {
  setLocked(!isLocked());
}

/**
 * Say that something was refused because of the lock. One call wherever a write would have gone, so
 * a press, a key or a drop on a locked page is answered rather than ignored. Returns `false`, for the
 * callers that answer a write with whether it landed.
 */
export function refuseLocked(): false {
  dispatchEvent(new CustomEvent(LOCK_REFUSED));
  return false;
}

/** Is the press, key or drop that is about to write allowed? Refuses, and says so, when it is not. */
export function mayEdit(): boolean {
  return isLocked() ? refuseLocked() : true;
}

function subscribe(onChange: () => void): () => void {
  const onStorage = (e: StorageEvent) => {
    if (e.key === LOCKED || e.key === null) onChange();
  };
  addEventListener(LOCK_CHANGED, onChange);
  addEventListener("storage", onStorage);
  return () => {
    removeEventListener(LOCK_CHANGED, onChange);
    removeEventListener("storage", onStorage);
  };
}

/** Whether the app is locked, for a component that draws differently when it is. */
export function useLocked(): boolean {
  return useSyncExternalStore(subscribe, isLocked, () => false);
}
