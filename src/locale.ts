/**
 * The locale dates, times and words are formatted and sorted by, where the app has no language of
 * its own to impose (#304).
 *
 * In a browser and in Node it is the runtime's own (`undefined`), which already follows the system.
 * The desktop app is the exception: Chromium takes its default locale from the locale pack it
 * loads, and the app ships only the packs of the languages it speaks, so on a system in any other
 * language `navigator.language` is `en-US` — a German person would get a 12-hour clock and
 * month-first dates. The shell reads the system's locale without a pack (`app.getSystemLocale()`)
 * and the page hands it here at boot (`src/main.tsx`), before anything is drawn.
 *
 * Plain on purpose: no browser API and no `@/` alias, because `src/table/` and `src/quiz/`, which
 * the server and the CLI bundle verbatim, sort by it. Neither sets it, so both keep their own.
 *
 * Every site that formats a date or compares words for a person passes `locale()` (or uses
 * `collation()`) where it would pass `undefined`. A site that names `"en"` does so on purpose: the
 * words around it are English, and that is #265's to change.
 */

let current: string | undefined;

/** Take the system's locale, or go back to the runtime's own with anything that is not a tag. */
export function setLocale(tag: unknown): void {
  let next: string | undefined;
  if (typeof tag === "string" && tag !== "") {
    try {
      next = Intl.getCanonicalLocales(tag)[0];
    } catch {
      /* Not a language tag: the runtime's own locale is the better guess. */
    }
  }
  if (next === current) return;
  current = next;
  collators.clear();
}

/** The locale to pass where a call would pass `undefined`: `undefined` itself, unless the shell named one. */
export const locale = (): string | undefined => current;

type Words = Pick<Intl.CollatorOptions, "numeric" | "sensitivity">;

const collators = new Map<string, Intl.Collator>();

/**
 * A collator in the current locale, made once per set of options: sorting a long list compares
 * thousands of times, and `localeCompare` with a named locale may build a collator for each.
 */
export function collation(options: Words = {}): Intl.Collator {
  const key = `${options.numeric === true}|${options.sensitivity ?? ""}`;
  let c = collators.get(key);
  if (!c) collators.set(key, (c = new Intl.Collator(current, options)));
  return c;
}
