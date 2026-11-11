import type { AttrValue } from "./attrs";
import type { MetaOp } from "./patch";

/**
 * What a board's own settings say, and what writing one changes.
 *
 * **Browser-free**, like everything beside it: the panel's controls and a test read the same rules.
 * Two groups live here because both are things the file said only in text until a control was made
 * for them — the board's frontmatter (`theme:` and `flow:`, beside the `pages:` the page tabs
 * write) and the one fence attribute whose only way in was typing it (`aspect=`).
 */

/**
 * Where the auto-flow wraps and how far it leaves between neighbours, when the board says nothing.
 * `parseBoard` reads these, so the control and the parser can never disagree about what *absent*
 * means.
 */
export const FLOW_DEFAULT = { width: 4000, gap: 80 } as const;

/**
 * What a control will write. A hand-written `flow:` outside these still parses as written — the file
 * is the author's — but a control that wrote `width: 3` would be a board whose every unplaced item
 * is a row of one, with nothing to say why.
 */
export const FLOW_RANGE = { width: { min: 320, max: 20000 }, gap: { min: 0, max: 400 } } as const;

/**
 * `theme:` set to a theme, or off the file.
 *
 * `null` is "follow the reader": a board with no `theme:` is drawn in whatever the window is set to,
 * and the frontmatter should say nothing at all rather than carry a word that means the same.
 */
export function themeMeta(name: string | null): MetaOp {
  return { meta: { theme: name && name.trim() ? name.trim() : null } };
}

/**
 * `flow:` for these two numbers — or `null` when one of them is not a number the control may write.
 *
 * Only what differs from the default is written, and nothing when neither does: the frontmatter of
 * a board nobody has changed stays as short as it was. Whole numbers, because the flow places
 * items on a grid and `4000.5` is a width nobody meant.
 */
export function flowMeta(width: number, gap: number): MetaOp | null {
  const ok = (n: number, r: { min: number; max: number }) => Number.isFinite(n) && n >= r.min && n <= r.max;
  if (!ok(width, FLOW_RANGE.width) || !ok(gap, FLOW_RANGE.gap)) return null;
  const w = Math.round(width);
  const g = Math.round(gap);
  const flow: Record<string, number> = {};
  if (w !== FLOW_DEFAULT.width) flow.width = w;
  if (g !== FLOW_DEFAULT.gap) flow.gap = g;
  return { meta: { flow: Object.keys(flow).length ? flow : null } };
}

/**
 * What an item's `aspect=` is saying, as a choice a person can make:
 *
 * - `auto` — absent; the theme's per-type shape applies.
 * - `off` — `0`, which is the one way to say "never wrap" and stop a chain folding into rows.
 * - `ratio` — a width over a height ELK folds the diagram towards.
 * - `invalid` — written, and not a number of at least zero (`EB_BAD_ASPECT`); the parser drops it,
 *   so the panel has to be able to say so and let the person replace it.
 */
export type AspectChoice = "auto" | "off" | "ratio" | "invalid";

export function aspectChoice(raw: AttrValue | undefined): AspectChoice {
  if (raw === undefined) return "auto";
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0) return "invalid";
  return raw === 0 ? "off" : "ratio";
}

/** What a fresh ratio starts from — the shape the theme gives a layered diagram when it says nothing else. */
export const ASPECT_START = 1.6;

/**
 * The attribute value a choice writes: `null` removes it, `0` is "never wrap".
 * `ratio` with something that is not a positive number writes nothing at all — `undefined` — so a
 * half-typed box cannot turn wrapping off by being `0`.
 */
export function aspectAttr(choice: Exclude<AspectChoice, "invalid">, ratio?: number): number | null | undefined {
  if (choice === "auto") return null;
  if (choice === "off") return 0;
  if (ratio === undefined || !Number.isFinite(ratio) || ratio <= 0) return undefined;
  return Math.round(ratio * 100) / 100;
}
