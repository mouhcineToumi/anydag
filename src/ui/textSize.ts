import { CHANGED, TEXT_SIZE, readPref, writePref } from "@/settings/prefs";

/**
 * How big a person reads: the reading text of a note, and the app's own words with it (#325).
 *
 * One preference rather than two controls, because a person who needs the sidebar bigger almost
 * always needs the note beside it bigger too, and two sizes that disagree are a layout nobody chose.
 * The three steps are `--text-scale` on `<html>`, read by `chrome.css`: it multiplies the theme's
 * `ui.text.*` steps for the chrome and its `type.md*` ramp for a note. **A board is not in this** —
 * its diagram reads `--dag-type-*` and `--dag-metric-*` directly, and the canvas has its own zoom —
 * so nothing about a drawing moves when the setting does.
 *
 * The value is the person's, in every vault (`settings/prefs.ts`), and it is read through `readPref`,
 * which is what makes `?snapshot=1` read none of it: a picture of a board is a fact about the board,
 * and a print or a PDF of a note is a fact about the note.
 */

/** The three steps, in the order the control lists them. */
export type TextSize = "small" | "default" | "large";

/** Every step and the word the Appearance tab calls it. */
export const TEXT_SIZE_STEPS: readonly { value: TextSize; label: string }[] = [
  { value: "small", label: "Small" },
  { value: "default", label: "Default" },
  { value: "large", label: "Large" },
];

const SIZES = new Set<string>(TEXT_SIZE_STEPS.map((step) => step.value));

/** The stored step, or the default for an absent one and for anything no step names. */
export function readTextSize(): TextSize {
  const raw = readPref(TEXT_SIZE);
  return raw !== null && SIZES.has(raw) ? (raw as TextSize) : "default";
}

/**
 * Remember a step. The default is written as *no key* — it is what an absent value already means, so
 * a reset leaves nothing for the sync to carry.
 */
export function writeTextSize(size: TextSize): void {
  writePref(TEXT_SIZE, size === "default" ? null : size);
}

/** The step this browser holds, put on `<html>` — what `chrome.css` reads its scale from. */
export function applyTextSize(root: Pick<HTMLElement, "dataset"> = document.documentElement): void {
  root.dataset.dagTextSize = readTextSize();
}

/**
 * Apply the step now, and again whenever a preference changes.
 *
 * Called once from `main.tsx`, after the gate has pulled the account's copy and before the first
 * render, so the chrome never paints at the wrong size. The listener is what makes the control in
 * Appearance take effect as it is used: the write announces on `dag:prefs`, and this is the one
 * place that turns the key into an attribute, so a second control added later cannot forget to.
 */
export function watchTextSize(): void {
  const apply = () => applyTextSize();
  apply();
  addEventListener(CHANGED, apply);
}
