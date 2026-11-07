import { itemsOf, whenWords, type CalItem } from "../../src/calendar/model";
import { allDay, dayOf, isDay, momentOf, nextHourEvent, withZone, type NoteEvent } from "../../src/note/event";
import { within } from "../../src/note/project";
import { dueOf, titleStem } from "../../src/note/task";
import { currentZone, setZone } from "../../src/note/zone";

import { UsageError, bool, str } from "../args";
import { emit, table, type Command, type Ctx } from "../context";
import { docUrl, launch, appBase } from "./docs";
import { projectNamed, type Listed as ListedProjects } from "./projects";

/**
 * Events: a note whose frontmatter has a `start:` and no `status:`.
 *
 * An event *is* a note, so reading its description, moving it and deleting it are the `note`
 * commands. What is here is what only an event has: the list, in the order the calendar reads it;
 * making a note that starts as one; and the one route that moves it without touching anything else.
 *
 * **This is a writer, so a time it writes carries an offset** — for a time typed without one, the
 * offset of the account's time zone, which `/api/auth/me` names: the one chosen in
 * Settings → Calendar, or the zone of the browser used last. Only an account that has neither falls
 * back to this machine's. Every time is printed in that zone too, so a terminal on a server in UTC
 * says the eight o'clock the calendar does.
 */

/**
 * Read and write times in the account's zone from here on, and say which it is. A server too old to
 * name one — or one that cannot be asked — leaves this machine's, which is what the CLI always used:
 * the command's own request then says what is wrong, with its own exit code.
 */
async function accountZone(ctx: Ctx): Promise<string> {
  try {
    const me = await ctx.api.get<{ zone?: string | null }>("/api/auth/me");
    setZone(me.zone ?? null);
  } catch {
    setZone(null);
  }
  return currentZone();
}

type Listed = ListedProjects & { events?: Record<string, NoteEvent>; created?: Record<string, string> };

/** A `--start` or `--end`: a date, or a time — the account's offset added when it has none. */
function whenArg(flag: string, raw: string): string {
  const when = withZone(raw);
  if (!when) throw new UsageError(`--${flag} \`${raw}\` is not a date or a time: write 2026-10-12, or 2026-10-12T09:00 (your time zone, ${currentZone()}) or 2026-10-12T09:00+02:00`);
  return when;
}

function dayArg(flag: string, raw: string): string {
  const d = dueOf(raw);
  if (!d) throw new UsageError(`--${flag} \`${raw}\` is not a date: write it YYYY-MM-DD`);
  return d;
}

async function setEvent(ctx: Ctx, name: string, change: { start?: string | null; end?: string | null }): Promise<void> {
  const done = await ctx.api.post<{ name: string; event: NoteEvent | null }>("/__board/event", { name, ...change });
  emit(ctx, done, () => {
    ctx.io.out(done.event ? `${done.name}  ${whenWords(done.event)}` : `${done.name}  not an event`);
  });
}

export const EVENTS: Command[] = [
  {
    name: ["event", "ls"],
    args: "[<folder>]",
    summary: "every event, soonest first — what the calendar draws from a start to an end",
    help:
      "Each line is when it is — read in the account's time zone, as the calendar reads it — its " +
      "file and its title. --from and --to keep the events that touch those days, both inclusive.",
    flags: [
      { name: "from", type: "string", value: "<YYYY-MM-DD>", help: "only what touches this day or later" },
      { name: "to", type: "string", value: "<YYYY-MM-DD>", help: "only what touches this day or earlier" },
      { name: "project", type: "string", value: "<project>", help: "only the events in this project: its folder, or its note" },
    ],
    routes: ["GET /__board/list", "GET /api/auth/me"],
    async run(ctx, p) {
      await accountZone(ctx);
      const listed = await ctx.api.get<Listed>("/__board/list");
      const under = p.pos[0]?.replace(/\/+$/, "");
      const from = str(p, "from");
      const to = str(p, "to");
      const named = str(p, "project");
      const scope = named ? projectNamed(listed, named).folder : undefined;
      const keep = (name: string) => (!under || name.startsWith(`${under}/`)) && (!scope || within(name, scope));
      const rows: CalItem[] = itemsOf(listed, new Set(["event"] as const), from ? dayArg("from", from) : "0000-01-01", to ? dayArg("to", to) : "9999-12-31", keep);
      const out = rows.map((r) => ({ name: r.name, title: r.title, ...r.event!, allDay: allDay(r.event!), first: r.first, last: r.last }));
      emit(ctx, out, () => {
        if (!out.length) return ctx.io.err("no events");
        for (const line of table(rows.map((r) => [whenWords(r.event!), r.name, r.title]))) ctx.io.out(line);
      });
    },
  },
  {
    name: ["event", "new"],
    args: "<title>",
    min: 1,
    summary: "make a note that is an event; its file is named after the title",
    help:
      "The words are the event's title, and the file is named after them, numbered if taken, in --folder when one is " +
      "given. A date is all day — `--start 2026-10-12 --end 2026-10-14` is three days — and a time is a time, written " +
      "with your time zone's offset when it has none. Without --start it begins at the next whole hour, and without " +
      "--end a timed event is an hour long; --all-day makes it today, or --start's day. Its description is the note's " +
      "body: write it with `note write` or `note edit`.",
    flags: [
      { name: "start", type: "string", value: "<when>", help: "a date, all day, or a time: 2026-10-12, 2026-10-12T09:00" },
      { name: "end", type: "string", value: "<when>", help: "the last day of an all-day event, or the moment a timed one stops" },
      { name: "all-day", type: "boolean", help: "a whole day, with no time" },
      { name: "folder", type: "string", value: "<folder>", help: "where it goes; made if it is not there" },
      { name: "open", type: "boolean", help: "open it in the browser afterwards" },
    ],
    routes: ["POST /__board/create", "GET /api/auth/me"],
    async run(ctx, p) {
      const title = p.pos.join(" ").trim();
      if (!title) throw new UsageError("an event needs a title");
      await accountZone(ctx);
      const rawStart = str(p, "start");
      const rawEnd = str(p, "end");
      let start = rawStart ? whenArg("start", rawStart) : undefined;
      let end = rawEnd ? whenArg("end", rawEnd) : undefined;
      if (bool(p, "all-day")) {
        start = start ? dayOf(momentOf(start)) : dayOf(new Date());
        end = end ? dayOf(momentOf(end)) : undefined;
      } else if (!start) {
        const next = nextHourEvent();
        start = next.start;
        end ??= next.end;
      }
      if (end && isDay(end) !== isDay(start)) throw new UsageError("an all-day event ends on a date, and a timed one at a time");
      if (end && momentOf(end) < momentOf(start)) throw new UsageError(`--end \`${end}\` is before --start \`${start}\``);
      const leaf = titleStem(title) || "untitled";
      const folder = str(p, "folder")?.replace(/^\/+|\/+$/g, "");
      const text = `---\ntitle: ${JSON.stringify(title)}\nstart: ${start}\n${end ? `end: ${end}\n` : ""}---\n`;
      const made = await ctx.api.post<{ name: string; id: string; base: string }>("/__board/create", {
        name: folder ? `${folder}/${leaf}` : leaf,
        text,
        kind: "note",
      });
      const event: NoteEvent = end ? { start, end } : { start };
      const url = docUrl(await appBase(ctx), made.name, "note", false);
      emit(ctx, { ...made, event, url }, () => {
        ctx.io.out(made.name);
        ctx.io.err(`made event ${made.name} (${whenWords(event)}) — ${url}`);
      });
      if (bool(p, "open")) launch(url);
    },
  },
  {
    name: ["event", "set"],
    args: "<name>",
    min: 1,
    summary: "move an event, make a note an event, or make an event a note again",
    help:
      "Changes the `start:` and `end:` lines of the note's frontmatter and nothing else, as the calendar's event bar " +
      "does. --start on a plain note makes it an event; --none takes both lines out and leaves a plain note. A task " +
      "is refused: its dates are `task set --start` and `--due`.",
    flags: [
      { name: "start", type: "string", value: "<when>", help: "a date, all day, or a time: 2026-10-12, 2026-10-12T09:00" },
      { name: "end", type: "string", value: "<when>", help: "the last day of an all-day event, or the moment a timed one stops" },
      { name: "no-end", type: "boolean", help: "take the end off" },
      { name: "none", type: "boolean", help: "no longer an event: take the start and the end off" },
    ],
    routes: ["POST /__board/event", "GET /api/auth/me"],
    async run(ctx, p) {
      if (!["none", "no-end"].some((f) => bool(p, f)) && !str(p, "start") && !str(p, "end")) {
        throw new UsageError("say what to change: --start, --end, --no-end or --none");
      }
      await accountZone(ctx);
      const change: { start?: string | null; end?: string | null } = {};
      if (bool(p, "none")) {
        change.start = null;
        change.end = null;
      }
      const s = str(p, "start");
      if (s) change.start = whenArg("start", s);
      const e = str(p, "end");
      if (e) change.end = whenArg("end", e);
      if (bool(p, "no-end")) change.end = null;
      if (!("start" in change) && !("end" in change)) throw new UsageError("say what to change: --start, --end, --no-end or --none");
      await setEvent(ctx, p.pos[0]!, change);
    },
  },
];
