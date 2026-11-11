import { useCallback, useEffect, useMemo, useState } from "react";

import { OWN_THEME, THEME, readPref, writePref } from "@/settings/prefs";
import { usePref } from "@/settings/usePref";

import { applyTheme } from "./applyTheme";
import type { Theme } from "./contract";
import { pickTheme, type ThemeSource } from "./pick";
import { resolveTheme } from "./resolve";

/**
 * Every theme in `themes/`, found by shape rather than by a list.
 *
 * Adding a look is adding a folder — nothing in `src/` names `paper`, which is the property the
 * whole theme layer exists to have. Eager because there are two of them and a lazy import would put
 * a flash of unstyled board between the first paint and the theme.
 *
 * Resolved once, here, so every later reader — CSS through `applyTheme`, arithmetic through
 * `size.ts`, the measurer's font strings — sees the same numbers.
 */
const modules = import.meta.glob<{ default: Theme }>("/themes/*/theme.json", { eager: true });

export const THEMES: Record<string, Theme> = Object.fromEntries(
  Object.values(modules).map((m) => [m.default.name, resolveTheme(m.default)]),
);

export const THEME_NAMES = Object.keys(THEMES).sort();

const DEFAULT = THEMES.paper ? "paper" : (THEME_NAMES[0] ?? "");

/**
 * The theme a page of paper is printed in: the one on screen when it is light, and the default
 * otherwise. A PDF is paper, and a dark theme's ink is light — printed, it is pale text on
 * a white sheet, or a sheet the printer has to flood black. `paper-dark` shares the default's
 * metrics, so nothing measured for the screen is measured differently for the page.
 */
export function paperTheme(current: Theme): Theme {
  if (current.color.scheme !== "dark") return current;
  const fallback = THEMES[DEFAULT];
  if (fallback && fallback.color.scheme !== "dark") return fallback;
  return Object.values(THEMES).find((t) => t.color.scheme !== "dark") ?? current;
}

/* The reader's own choice of theme: `settings/prefs.ts`, with the other four preferences. */

/** A name only if a theme by that name exists — a folder can be renamed or removed. */
const known = (n: string | null | undefined): string | null => (n && THEMES[n] ? n : null);

function stored(): string | null {
  /* `readPref` is what answers for a blocked accessor and for `?snapshot=1`, where nothing about
     this machine may reach the picture. */
  return known(readPref(THEME));
}

/**
 * Which theme the board is drawn in — the order is `pickTheme`'s, and it is:
 *
 * 1. **`?theme=`** — an instruction someone put in the URL. `snapshot.mjs --theme` and every
 *    Playwright check are this, and a preference remembered in a browser must not be able to
 *    silently change what a shared link or a screenshot shows.
 * 2. **The reader's own theme, if they turned on *Use my theme on every board*.** Off unless they did.
 * 3. **The board's `theme:` frontmatter** — what its author asked for.
 * 4. **What the reader picked**, kept in `localStorage` (a preference about this window, not part of
 *    what a `?board=…` link means), then the default.
 *
 * **The board's own theme beats the reader's** unless the reader says otherwise. It used to be the
 * other way round, so a `theme:` written in a file — by a person in *Board settings*, or by an agent —
 * drew nothing for anyone with a theme saved in Settings, which is everybody who ever touched it.
 *
 * **A snapshot reads no storage at all** — the stored theme and the switch are skipped when
 * `snapshot` is set. `?snapshot=1` means the page is a picture being taken by `snapshot.mjs`,
 * `tidy.mjs` or a Playwright check, and a picture of a board must be a fact about the board rather
 * than about whoever last opened it here. That held by accident for four milestones, because a fresh
 * browser context has empty storage; a person pointing the snapshot script at a persistent profile
 * got their own theme in the picture and nothing said so. `src/settings/store.ts` states the same
 * rule for everything it owns.
 *
 * `own` is the reader's theme whatever is drawn — what the Settings select shows, so choosing in
 * it on a board that names its own look does not snap back. `source` is which rule decided.
 */
export function useTheme(
  explicit?: string,
  boardTheme?: string,
  snapshot = false,
): { theme: Theme; name: string; own: string; source: ThemeSource; setName(n: string): void } {
  const [chosen, setChosen] = useState<string | null>(() => (snapshot ? null : stored()));
  /* `readPref` answers `null` for a snapshot, so the switch is off there without a branch. */
  const raw = usePref(OWN_THEME);
  const mine = raw !== null && raw !== "0";

  const { name, source } = pickTheme({ explicit, board: boardTheme, chosen, mine }, known, DEFAULT);
  const theme = THEMES[name] ?? THEMES[DEFAULT]!;
  const own = known(explicit) ?? chosen ?? DEFAULT;

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const setName = useCallback((n: string) => {
    setChosen(known(n));
    writePref(THEME, n);
  }, []);

  return useMemo(() => ({ theme, name, own, source, setName }), [theme, name, own, source, setName]);
}
