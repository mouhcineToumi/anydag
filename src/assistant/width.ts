import { ASSISTANT_WIDTH, readPref, writePref } from "@/settings/prefs";

/**
 * How wide the Assistant's panel is, and where that number is kept.
 *
 * The panel is a column of the shell down the right (`Panel.tsx`), so its width is the one thing
 * about it a drag can change; the page beside it reflows through the flex row with no state of its
 * own. The shape is the inspector's (`src/edit/Inspector.tsx`), with one difference: the top is also
 * half the window, so a wide screen cannot give the chat more room than the page it sits beside.
 *
 * A settled width is the person's preference, in `PREF_KEYS` with the window's other widths. It is
 * **not** read under `?snapshot=1` — `readPref` holds that rule for every key — and a snapshot
 * draws no panel anyway (`Shell` is not rendered there).
 */
export const ASSISTANT_W = 380;
export const ASSISTANT_MIN = 320;
export const ASSISTANT_MAX = 720;

/** The widest the panel may be on a window `windowW` wide: half of it, kept inside the bounds. */
export function widthCap(windowW: number): number {
  return Math.min(ASSISTANT_MAX, Math.max(ASSISTANT_MIN, Math.floor(windowW / 2)));
}

/**
 * A width a drag or a keypress asked for, settled to whole pixels inside the range.
 *
 * Not finite is the default rather than `NaN`: a lost pointer (`NaN`) or a cap that divides by zero
 * must never reach a style, where it would collapse the column to nothing with nothing said.
 */
export function clampWidth(w: number, windowW: number): number {
  if (!Number.isFinite(w)) return ASSISTANT_W;
  return Math.min(widthCap(windowW), Math.max(ASSISTANT_MIN, Math.round(w)));
}

/**
 * What this browser remembers, settled for the window it is being opened in — a width chosen on a
 * wide screen is still usable on a narrower one. A junk value reads as the default, as an absent one
 * does: a preference that cannot be honoured is not an error.
 */
export function storedWidth(windowW: number): number {
  const n = Number(readPref(ASSISTANT_WIDTH));
  return Number.isFinite(n) && n > 0 ? clampWidth(n, windowW) : ASSISTANT_W;
}

/**
 * Remember a settled width, and hand back what was written.
 *
 * The drag and the arrow keys both end here, so one place decides the value the next reload reads;
 * the fixed bounds are applied again because a caller may hand over a width clamped to an older,
 * wider window.
 */
export function rememberWidth(w: number): number {
  const settled = Number.isFinite(w) ? Math.min(ASSISTANT_MAX, Math.max(ASSISTANT_MIN, Math.round(w))) : ASSISTANT_W;
  writePref(ASSISTANT_WIDTH, String(settled));
  return settled;
}
