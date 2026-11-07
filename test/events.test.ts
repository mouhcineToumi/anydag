import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { allDay, dayOf, eventOf, hasOffset, isDay, momentOf, offsetAt, timeOf, whenOf, withEvent, withZone, type EventChange } from "@/note/event";
import { splitNote } from "@/note/format";
import { taskOf } from "@/note/task";
import { indexTexts } from "@/refs/extract";

/**
 * What makes a note an event.
 *
 * The server, the note page, the calendar, a card on a board and the index all read it through
 * `src/note/event.ts`, held here to `test/fixtures/events.json`.
 */
const FIXTURE = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "events.json"), "utf8")) as {
  read: { why: string; text: string; event: { start: string; end?: string } | null }[];
  write: { why: string; text: string; set: EventChange; out: string }[];
  when: { why: string; raw: unknown; when: string | null }[];
};

describe("reading an event", () => {
  it.each(FIXTURE.read.map((c) => [c.why, c] as const))("%s", (_, c) => {
    expect(eventOf(c.text) ?? null).toEqual(c.event);
  });
});

describe("reading a moment", () => {
  it.each(FIXTURE.when.map((c) => [c.why, c] as const))("%s", (_, c) => {
    expect(whenOf(c.raw) ?? null).toBe(c.when);
  });
});

describe("writing an event", () => {
  it.each(FIXTURE.write.map((c) => [c.why, c] as const))("%s", (_, c) => {
    expect(withEvent(c.text, c.set)).toBe(c.out);
  });

  it("writes what it reads back, all day and timed", () => {
    for (const [start, end] of [
      ["2026-10-12", "2026-10-14"],
      ["2026-10-12T09:00+02:00", "2026-10-12T10:30+02:00"],
      ["2026-10-12T09:00Z", undefined],
    ] as const) {
      const text = withEvent("---\ntitle: T\n---\nbody\n", { start, end: end ?? null });
      expect(eventOf(text)).toEqual(end ? { start, end } : { start });
      /* The note editor carries the frontmatter byte for byte and the body is the page's. */
      expect(splitNote(text).body).toBe("body\n");
      expect(splitNote(text).title).toBe("T");
      /* An event is never a task: nothing here wrote a status. */
      expect(taskOf(text)).toBeUndefined();
    }
  });
});

describe("the parts", () => {
  afterEach(() => vi.useRealTimers());

  it("tells a day from a time, and a time that says where from one that does not", () => {
    expect(isDay("2026-10-12")).toBe(true);
    expect(isDay("2026-10-12T09:00Z")).toBe(false);
    expect(allDay({ start: "2026-10-12" })).toBe(true);
    expect(hasOffset("2026-10-12T09:00Z")).toBe(true);
    expect(hasOffset("2026-10-12T09:00-03:30")).toBe(true);
    expect(hasOffset("2026-10-12T09:00")).toBe(false);
  });

  it("writes a moment on this machine's clock, with the offset it keeps then", () => {
    const at = new Date(2026, 9, 3, 9, 5);
    expect(dayOf(at)).toBe("2026-10-03");
    expect(timeOf(at)).toBe(`2026-10-03T09:05${offsetAt(at)}`);
    expect(offsetAt(at)).toMatch(/^[+-]\d{2}:\d{2}$/);
    /* Whatever the zone the suite runs in, the instant written is the instant meant. */
    expect(new Date(timeOf(at)).getTime()).toBe(at.getTime());
    expect(whenOf(timeOf(at))).toBe(timeOf(at));
  });

  it("reads a day as its midnight here, and a time as the instant it names", () => {
    const day = momentOf("2026-10-03");
    expect([day.getFullYear(), day.getMonth(), day.getDate(), day.getHours()]).toEqual([2026, 9, 3, 0]);
    expect(momentOf("2026-10-03T07:00Z").toISOString()).toBe("2026-10-03T07:00:00.000Z");
    expect(momentOf("2026-10-03T09:00+02:00").toISOString()).toBe("2026-10-03T07:00:00.000Z");
    /* No offset: that wall-clock time here. */
    const here = momentOf("2026-10-03T09:00");
    expect([here.getDate(), here.getHours(), here.getMinutes()]).toEqual([3, 9, 0]);
    /* A year below a hundred is a year, as `dueOf` says. */
    expect(momentOf("0026-10-03").getFullYear()).toBe(26);
  });

  it("gives a time typed without an offset this machine's, and leaves everything else as it reads", () => {
    const zoned = withZone("2026-10-03 09:00");
    expect(zoned).toBe(`2026-10-03T09:00${offsetAt(new Date(2026, 9, 3, 9, 0))}`);
    expect(withZone("2026-10-03T09:00:30")).toBe(`2026-10-03T09:00:30${offsetAt(new Date(2026, 9, 3, 9, 0, 30))}`);
    expect(withZone("2026-10-03")).toBe("2026-10-03");
    expect(withZone("2026-10-03T09:00+0200")).toBe("2026-10-03T09:00+02:00");
    expect(withZone("next tuesday")).toBeUndefined();
  });
});

describe("the index", () => {
  it("says which notes are events, and never a board or a task", () => {
    const docs = indexTexts({
      "a.note.md": "---\ntitle: A\nstart: 2026-10-12\n---\n",
      "b.note.md": "---\ntitle: B\nstatus: todo\nstart: 2026-10-12\n---\n",
      c: "---\ntitle: C\nstart: 2026-10-12\n---\n",
    });
    expect(docs["a.note.md"]!.event).toEqual({ start: "2026-10-12" });
    expect(docs["b.note.md"]!.event).toBeUndefined();
    expect(docs["b.note.md"]!.task).toEqual({ status: "todo", start: "2026-10-12" });
    expect(docs["c"]!.event).toBeUndefined();
  });
});
