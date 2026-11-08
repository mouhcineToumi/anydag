/**
 * The time zone a person reads and writes times in.
 *
 * The machine's zone was the implicit one before this existed: every event time was placed with
 * `getHours` and written with `getTimezoneOffset`, and an event asked for at eight could be drawn
 * at seven — an agent guessing a zone's offset gets it wrong, and nothing anywhere said which zone
 * the account meant. Now the account says: `dag:time-zone` in
 * Settings → Calendar, an IANA name, and absent it is the browser's own, as before.
 *
 * **One zone for the whole page, held here**, not threaded through every function that turns a
 * moment into a day: those are called from forty places and the zone is a fact about who is
 * looking, which is exactly what the machine's zone was — a global nobody passed. `setZone` is called
 * by the page when the preference is read or changed and by the CLI with the account's; a test sets
 * it and puts it back. Unset, it is the machine's, so the local server and a share link's visitor
 * behave exactly as they did.
 *
 * Every conversion goes through `Intl` with a named zone, never through `Date`'s local getters, which
 * only ever know the machine's. No browser API past `Intl`, no `@/` aliases: the local server
 * imports `src/note/event.ts`, which imports this.
 */

/** A wall-clock reading in some zone. `month` is 1 to 12. */
export interface Wall {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

let chosen: string | undefined;

/**
 * `Date.UTC`, but a year below a hundred is that year — `Date.UTC` reads `26` as 1926, and `dueOf`
 * says `0026-10-03` is a day like any other. Fields out of range carry over, as they do there.
 */
export function utc(year: number, month: number, day: number, hour = 0, minute = 0, second = 0): number {
  const at = new Date(0);
  at.setUTCFullYear(year, month - 1, day);
  at.setUTCHours(hour, minute, second, 0);
  return at.getTime();
}

/** The zone this machine keeps, by its IANA name — `UTC` when the engine will not say. */
export function localZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/** Whether `zone` is a time zone this engine knows by that name. */
export function validZone(zone: unknown): zone is string {
  if (typeof zone !== "string" || !zone.trim()) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** The zone times are read and written in: the one set, or the machine's. */
export function currentZone(): string {
  return chosen ?? localZone();
}

/** Read and write times in `zone` from now on — or, given nothing or a name nobody knows, the machine's. */
export function setZone(zone?: string | null): void {
  chosen = validZone(zone) ? zone : undefined;
}

const walls = new Map<string, Intl.DateTimeFormat>();

function wallFormat(zone: string): Intl.DateTimeFormat {
  let f = walls.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    walls.set(zone, f);
  }
  return f;
}

/** What a clock in `zone` reads at `at`. */
export function wallOf(at: Date | number, zone: string = currentZone()): Wall {
  const parts: Record<string, number> = {};
  for (const p of wallFormat(zone).formatToParts(at)) if (p.type !== "literal") parts[p.type] = Number(p.value);
  return {
    year: parts.year!,
    month: parts.month!,
    day: parts.day!,
    /* `h23` is 0 to 23; an engine that still says 24 at midnight means 0. */
    hour: parts.hour! % 24,
    minute: parts.minute!,
    second: parts.second!,
  };
}

/** How far east of UTC `zone`'s clocks are at `at`, in minutes — `60` for `+01:00`. */
export function offsetOf(at: Date | number, zone: string = currentZone()): number {
  const t = typeof at === "number" ? at : at.getTime();
  const w = wallOf(t, zone);
  const asUtc = utc(w.year, w.month, w.day, w.hour, w.minute, w.second);
  return Math.round((asUtc - Math.floor(t / 1000) * 1000) / 60_000);
}

/**
 * The instant a wall-clock reading in `zone` names, in milliseconds. A field out of range carries
 * over, as `Date.UTC`'s do, so hour 24 is the next midnight.
 *
 * The offsets a day either side are the only two a clock change can be between, so each is tried:
 * one that reads back as the wall asked for is the answer, the earlier of two in an overlap (the
 * first half-past-one of a fall-back night). In a gap — two-thirty on a spring-forward night, which
 * no clock showed — neither reads back, and it is read with the offset from before the change, which
 * lands an hour on, where the clocks do. `Temporal`'s `compatible`, by hand.
 */
export function instantOf(wall: Partial<Wall> & Pick<Wall, "year" | "month" | "day">, zone: string = currentZone()): number {
  const guess = utc(wall.year, wall.month, wall.day, wall.hour ?? 0, wall.minute ?? 0, wall.second ?? 0);
  const DAY = 86_400_000;
  const before = guess - offsetOf(guess - DAY, zone) * 60_000;
  const after = guess - offsetOf(guess + DAY, zone) * 60_000;
  const reads = (t: number) => {
    const w = wallOf(t, zone);
    return utc(w.year, w.month, w.day, w.hour, w.minute, w.second) === Math.floor(guess / 1000) * 1000;
  };
  const fits = [before, after].filter(reads);
  return fits.length ? Math.min(...fits) : before;
}

/** A zone as a person reads it at `at` — `GMT+1`, `CEST` — or its offset when the engine has no name. */
export function zoneName(at: Date | number, zone: string = currentZone()): string {
  try {
    return (
      new Intl.DateTimeFormat("en", { timeZone: zone, timeZoneName: "short" })
        .formatToParts(at)
        .find((p) => p.type === "timeZoneName")?.value ?? ""
    );
  } catch {
    return "";
  }
}
