import { useCallback, useEffect, useMemo, useState } from "react";

import { THEME, readPref, writePref } from "@/settings/prefs";

import { applyTheme } from "./applyTheme";
import type { Theme } from "./contract";
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

export const DEFAULT_THEME = THEMES.paper ? "paper" : (THEME_NAMES[0] ?? "");

/**
 * The theme a page of paper is printed in: the one on screen when it is light, and the default
 * otherwise. A PDF is paper, and a dark theme's ink is light — printed, it is pale text on
 * a white sheet, or a sheet the printer has to flood black. `paper-dark` shares the default's
 * metrics, so nothing measured for the screen is measured differently for the page.
 */
export function paperTheme(current: Theme): Theme {
  if (current.color.scheme !== "dark") return current;
  const fallback = THEMES[DEFAULT_THEME];
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
 * Which theme a page is drawn in.
 *
 * Two sources, in this order:
 *
 * 1. **`?theme=`** — an instruction someone put in the URL. `snapshot.mjs --theme` and every
 *    Playwright check are this, and a preference remembered in a browser must not be able to
 *    silently change what a shared link or a screenshot shows.
 * 2. **What the reader picked**, kept in `localStorage`. The same argument as the board list's open
 *    state: it is a preference about this window, not part of what a `?board=…` link means — which
 *    is exactly why it does not belong in the query string. It used to be React state alone, so
 *    every reload threw it away and the dark theme could not be anybody's preference; you could
 *    only ever be *visiting* it.
 *
 * Then the default. **A board is not a source.** It once could say `theme:` in its frontmatter, and
 * that made the same vault look different board to board and let a document override the person
 * reading it. The line still parses as YAML and stays in the file untouched — opening a vault never
 * writes a byte — but nothing reads it (issue #162).
 *
 * **A snapshot reads no storage at all** — source 2 is skipped when `snapshot` is set. `?snapshot=1`
 * means the page is a picture being taken by `snapshot.mjs`, `tidy.mjs` or a Playwright check, and a
 * picture of a board must be a fact about the board rather than about whoever last opened it here.
 * That held by accident for four milestones, because a fresh browser context has empty storage; a
 * person pointing the snapshot script at a persistent profile got their own theme in the picture and
 * nothing said so. `src/settings/store.ts` states the same rule for everything it owns.
 */
export function useTheme(explicit?: string, snapshot = false): { theme: Theme; name: string; setName(n: string): void } {
  const [chosen, setChosen] = useState<string | null>(() => (snapshot ? null : stored()));

  const name = known(explicit) ?? chosen ?? DEFAULT_THEME;
  const theme = THEMES[name] ?? THEMES[DEFAULT_THEME]!;

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const setName = useCallback((n: string) => {
    setChosen(known(n));
    writePref(THEME, n);
  }, []);

  return useMemo(() => ({ theme, name, setName }), [theme, name, setName]);
}
