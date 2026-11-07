import { useCallback, useMemo } from "react";

import { currentZone, localZone, setZone, validZone } from "@/note/zone";
import { CALENDAR_HIDE, CHANGED, TIME_ZONE, TIME_ZONE_SEEN, WEEK_START, readPref, writePref } from "@/settings/prefs";
import { usePref } from "@/settings/usePref";

import { CAL_KINDS, type CalKind } from "./model";

/**
 * The calendar's two person-level preferences — where a week starts and which kinds are off —
 * read and written in one place, because two surfaces draw them: the Calendar page and the Settings
 * modal's Calendar tab. Both go through `usePref`, so a change in one redraws the other under it.
 */
export function useWeekStart(): [number, (day: number) => void] {
  const raw = Number(usePref(WEEK_START, "1"));
  const day = Number.isInteger(raw) && raw >= 0 && raw <= 6 ? raw : 1;
  /* Monday is the default and is written as nothing, so the saved bundle holds only a choice. */
  const set = useCallback((next: number) => writePref(WEEK_START, next === 1 ? null : String(next)), []);
  return [day, set];
}

/** The kinds switched off, stored as what is off so a kind added later is shown by default. */
export function useCalendarHidden(): [ReadonlySet<CalKind>, (kind: CalKind, hide: boolean) => void] {
  const raw = usePref(CALENDAR_HIDE, "") ?? "";
  const hidden = useMemo(() => new Set(raw.split(",").filter((k): k is CalKind => (CAL_KINDS as readonly string[]).includes(k))), [raw]);
  const set = useCallback(
    (kind: CalKind, hide: boolean) => {
      const next = new Set(hidden);
      if (hide) next.add(kind);
      else next.delete(kind);
      writePref(CALENDAR_HIDE, next.size ? [...next].sort().join(",") : null);
    },
    [hidden],
  );
  return [hidden, set];
}

/**
 * Read the chosen time zone into `src/note/zone.ts` now and whenever
 * it changes — in this tab, another, or through the sync — and record which zone this
 * browser is in, so the server's "the default is theirs" has something to go on. Once, from
 * `main.tsx`, after the preferences are pulled and before the first render; registered before any
 * component subscribes, so a component that redraws on the change reads the new zone.
 */
let watching = false;
export function watchZone(): void {
  const apply = () => setZone(readPref(TIME_ZONE));
  apply();
  if (!watching) {
    watching = true;
    addEventListener(CHANGED, apply);
    addEventListener("storage", apply);
  }
  const here = localZone();
  if (readPref(TIME_ZONE_SEEN) !== here) writePref(TIME_ZONE_SEEN, here);
}

/**
 * The zone times are shown in, and the choice behind it: `null` when it follows the browser. A
 * component that draws a time calls this so it redraws when the zone changes, and puts the zone in
 * the dependencies of anything it memoises that placed a moment.
 */
export function useZone(): [string, string | null, (zone: string | null) => void] {
  const raw = usePref(TIME_ZONE);
  const choice = validZone(raw) ? raw : null;
  const set = useCallback((zone: string | null) => writePref(TIME_ZONE, zone && validZone(zone) ? zone : null), []);
  return [choice ?? currentZone(), choice, set];
}
