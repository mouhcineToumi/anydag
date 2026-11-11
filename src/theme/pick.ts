/**
 * Which theme a window is drawn in, as a rule with no React and no storage in it — so the order is
 * testable, and the one place that says it.
 *
 * Highest first:
 *
 * 1. **`address`** — `?theme=`, an instruction someone put in the URL (`snapshot.mjs --theme`, every
 *    Playwright check, a shared link). Nothing remembered may change what it shows.
 * 2. **`mine`** — the reader's own theme, but only when they turned on *Use my theme on every
 *    board*. A person who wants one look everywhere has said so; it is off unless they did.
 * 3. **`board`** — the board's `theme:` frontmatter: the look its author asked for.
 * 4. **`own`** — the reader's own theme, for a board that asks for none.
 * 5. **`default`**.
 *
 * A name counts only if a theme by that name is installed (`known`), so a `theme:` naming a folder
 * that was renamed falls through to the next source instead of drawing nothing.
 */
export type ThemeSource = "address" | "mine" | "board" | "own" | "default";

export interface ThemeInputs {
  /** `?theme=`. */
  explicit?: string | null;
  /** The board's `theme:`. */
  board?: string | null;
  /** What the reader picked in Settings. */
  chosen?: string | null;
  /** *Use my theme on every board*. */
  mine?: boolean;
}

export function pickTheme(
  inputs: ThemeInputs,
  known: (name: string | null | undefined) => string | null,
  fallback: string,
): { name: string; source: ThemeSource } {
  const address = known(inputs.explicit);
  if (address) return { name: address, source: "address" };
  const own = known(inputs.chosen);
  if (inputs.mine && own) return { name: own, source: "mine" };
  const board = known(inputs.board);
  if (board) return { name: board, source: "board" };
  if (own) return { name: own, source: "own" };
  return { name: fallback, source: "default" };
}
