import { describe, expect, it } from "vitest";

import {
  addDays,
  addMonths,
  blocks,
  eventFrom,
  fieldsOf,
  withAllDay,
  withEnd,
  withStart,
  shiftEvent,
  shiftTask,
  withEdge,
  taskEdge,
  asAllDay,
  asTimed,
  daysBetween,
  daysFrom,
  itemsOf,
  lanes,
  placeEvent,
  placeTask,
  rangeOf,
  startOfWeek,
  step,
  weekday,
  whenWords,
  CAL_KINDS,
  HOUR,
  type CalItem,
} from "@/calendar/model";
import { timeOf } from "@/note/event";

/**
 * What the calendar shows and where. Days are strings in the zone of
 * whoever is looking, so every case here is written in local time and holds in any zone the suite
 * runs in (`TZ=… npx vitest run test/calendar.test.ts`).
 */

const ALL = new Set(CAL_KINDS);
const at = (y: number, m: number, d: number, h = 0, min = 0) => timeOf(new Date(y, m - 1, d, h, min));

describe("days", () => {
  it("moves along the calendar, not the clock", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    /* Across both of Europe's and America's clock changes, whatever zone this runs in. */
    expect(addDays("2026-03-28", 2)).toBe("2026-03-30");
    expect(addDays("2026-10-24", 2)).toBe("2026-10-26");
    expect(addDays("2026-11-01", 1)).toBe("2026-11-02");
    expect(daysBetween("2026-10-01", "2026-10-31")).toBe(30);
    expect(daysBetween("2026-10-31", "2026-10-01")).toBe(-30);
    expect(daysFrom("2026-10-30", "2026-11-02")).toEqual(["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02"]);
  });

  it("starts a week on Monday, or on whichever day is asked", () => {
    expect(weekday("2026-09-29")).toBe(2);
    expect(startOfWeek("2026-09-29", 1)).toBe("2026-09-28");
    expect(startOfWeek("2026-09-28", 1)).toBe("2026-09-28");
    expect(startOfWeek("2026-10-04", 1)).toBe("2026-09-28");
    expect(startOfWeek("2026-09-29", 0)).toBe("2026-09-27");
    expect(startOfWeek("2026-09-29", 6)).toBe("2026-09-26");
  });

  it("moves by months, keeping the date or the last of a short month", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2026-03-15", -1)).toBe("2026-02-15");
    expect(addMonths("2026-12-10", 1)).toBe("2027-01-10");
  });
});

describe("views", () => {
  it("covers whole weeks for a month, one week, or a run of days", () => {
    /* October 2026 begins on a Thursday and ends on a Saturday. */
    expect(rangeOf("month", "2026-10-15", 1, 3)).toEqual({ first: "2026-09-28", last: "2026-11-01" });
    expect(rangeOf("month", "2026-10-15", 0, 3)).toEqual({ first: "2026-09-27", last: "2026-10-31" });
    expect(rangeOf("week", "2026-10-15", 1, 3)).toEqual({ first: "2026-10-12", last: "2026-10-18" });
    expect(rangeOf("days", "2026-10-15", 1, 3)).toEqual({ first: "2026-10-15", last: "2026-10-17" });
    /* A run is one day to a fortnight, whatever is asked. */
    expect(rangeOf("days", "2026-10-15", 1, 0).last).toBe("2026-10-15");
    expect(rangeOf("days", "2026-10-15", 1, 99).last).toBe("2026-10-28");
  });

  it("steps a month, a week, or the run's own length", () => {
    expect(step("month", "2026-10-31", 1, 3)).toBe("2026-11-30");
    expect(step("week", "2026-10-15", -1, 3)).toBe("2026-10-08");
    expect(step("days", "2026-10-15", 1, 5)).toBe("2026-10-20");
  });
});

describe("placing", () => {
  it("puts an all-day event on its days, inclusive, and an end before the start nowhere", () => {
    expect(placeEvent({ start: "2026-10-12", end: "2026-10-14" })).toEqual({
      first: "2026-10-12",
      last: "2026-10-14",
      allDay: true,
    });
    expect(placeEvent({ start: "2026-10-12" })).toEqual({ first: "2026-10-12", last: "2026-10-12", allDay: true });
    expect(placeEvent({ start: "2026-10-12", end: "2026-10-10" })).toMatchObject({ first: "2026-10-12", last: "2026-10-12" });
  });

  it("puts a timed event in the grid, an hour long when it has no end, and a long one in the all-day row", () => {
    const one = placeEvent({ start: at(2026, 10, 3, 9) });
    expect(one).toMatchObject({ first: "2026-10-03", last: "2026-10-03", allDay: false });
    expect(one.at!.end - one.at!.start).toBe(HOUR);
    /* An end before the start is no end. */
    expect(placeEvent({ start: at(2026, 10, 3, 9), end: at(2026, 10, 3, 8) }).at!.end - one.at!.start).toBe(HOUR);
    /* Midnight to midnight is one day, not two. */
    expect(placeEvent({ start: at(2026, 10, 3, 22), end: at(2026, 10, 4, 0) })).toMatchObject({
      first: "2026-10-03",
      last: "2026-10-03",
    });
    expect(placeEvent({ start: at(2026, 10, 3, 22), end: at(2026, 10, 4, 1) })).toMatchObject({
      first: "2026-10-03",
      last: "2026-10-04",
      allDay: false,
    });
    expect(placeEvent({ start: at(2026, 10, 3, 9), end: at(2026, 10, 5, 9) })).toMatchObject({
      allDay: true,
      last: "2026-10-05",
    });
  });

  it("reads a time in the zone it was written in and places it in this one", () => {
    const utc = placeEvent({ start: "2026-10-03T12:00Z" });
    expect(utc.at!.start).toBe(Date.UTC(2026, 9, 3, 12));
  });

  it("puts a task from its start to its due date, or on the one it has", () => {
    expect(placeTask({ status: "todo", start: "2026-09-28", due: "2026-10-03" })).toEqual({
      first: "2026-09-28",
      last: "2026-10-03",
    });
    expect(placeTask({ status: "todo", due: "2026-10-03" })).toEqual({ first: "2026-10-03", last: "2026-10-03" });
    expect(placeTask({ status: "todo", start: "2026-09-28" })).toEqual({ first: "2026-09-28", last: "2026-09-28" });
    /* A start after the due date is the due date. */
    expect(placeTask({ status: "todo", start: "2026-10-05", due: "2026-10-03" })).toEqual({
      first: "2026-10-03",
      last: "2026-10-03",
    });
    expect(placeTask({ status: "todo" })).toBeUndefined();
  });
});

describe("items", () => {
  const listing = {
    notes: ["task", "event", "note", "project/note", "plain-task", "old"],
    titles: { task: "Ship", event: "Offsite", note: "Idea" },
    tasks: {
      task: { status: "todo" as const, start: "2026-10-01", due: "2026-10-03" },
      "plain-task": { status: "done" as const },
    },
    events: { event: { start: "2026-10-02" } },
    created: {
      task: "2026-01-01T00:00:00Z",
      event: "2026-01-01T00:00:00Z",
      note: new Date(2026, 9, 2, 12).toISOString(),
      "project/note": new Date(2026, 9, 2, 13).toISOString(),
      old: "2025-01-01T12:00:00Z",
    },
  };

  it("draws a task and an event by their dates, and a note on the day it was made, here", () => {
    const items = itemsOf(listing, ALL, "2026-09-28", "2026-10-04");
    expect(items.map((i) => [i.kind, i.name, i.first, i.last])).toEqual([
      ["task", "task", "2026-10-01", "2026-10-03"],
      ["event", "event", "2026-10-02", "2026-10-02"],
      ["note", "note", "2026-10-02", "2026-10-02"],
      ["note", "project/note", "2026-10-02", "2026-10-02"],
    ]);
    /* A title, else the file's last part. */
    expect(items.map((i) => i.title)).toEqual(["Ship", "Offsite", "Idea", "note"]);
  });

  it("switches a kind off, keeps a scope, and leaves out what the range does not touch", () => {
    expect(itemsOf(listing, new Set(["event", "note"] as const), "2026-09-28", "2026-10-04").map((i) => i.name)).toEqual([
      "event",
      "note",
      "project/note",
    ]);
    expect(itemsOf(listing, ALL, "2026-09-28", "2026-10-04", (n) => n.startsWith("project/")).map((i) => i.name)).toEqual([
      "project/note",
    ]);
    expect(itemsOf(listing, ALL, "2026-10-03", "2026-10-31").map((i) => i.name)).toEqual(["task"]);
  });
});

describe("lanes", () => {
  const item = (name: string, first: string, last: string): CalItem => ({
    kind: "event",
    name,
    title: name,
    first,
    last,
    allDay: true,
  });
  const week = daysFrom("2026-09-28", "2026-10-04");

  it("packs bars into the lowest lane free, and says where one runs off either end", () => {
    const bars = lanes(
      [
        item("long", "2026-09-20", "2026-09-30"),
        item("a", "2026-09-29", "2026-10-01"),
        item("b", "2026-10-01", "2026-10-02"),
        item("c", "2026-10-03", "2026-10-09"),
      ],
      week,
    );
    expect(bars.map((b) => [b.item.name, b.col, b.span, b.lane, b.before, b.after])).toEqual([
      ["long", 0, 3, 0, true, false],
      ["a", 1, 3, 1, false, false],
      ["b", 3, 2, 0, false, false],
      ["c", 5, 2, 0, false, true],
    ]);
  });
});

describe("the hour grid", () => {
  const timed = (name: string, start: string, end: string): CalItem => ({
    kind: "event",
    name,
    title: name,
    ...placeEvent({ start, end }),
  });

  it("cuts an event to the day and splits the width where events overlap", () => {
    const day = "2026-10-03";
    const items = [
      timed("a", at(2026, 10, 3, 9), at(2026, 10, 3, 11)),
      timed("b", at(2026, 10, 3, 10), at(2026, 10, 3, 12)),
      timed("c", at(2026, 10, 3, 11, 30), at(2026, 10, 3, 13)),
      timed("d", at(2026, 10, 3, 15), at(2026, 10, 3, 16)),
      timed("night", at(2026, 10, 2, 22), at(2026, 10, 3, 2)),
    ];
    const got = blocks(items, day).map((b) => [b.item.name, b.top, b.length, b.col, b.of, b.before, b.after]);
    expect(got).toEqual([
      ["night", 0, 120, 0, 1, true, false],
      ["a", 540, 120, 0, 2, false, false],
      ["b", 600, 120, 1, 2, false, false],
      ["c", 690, 90, 0, 2, false, false],
      ["d", 900, 60, 0, 1, false, false],
    ]);
    /* The night before, the same event runs off the bottom. */
    expect(blocks(items, "2026-10-02").map((b) => [b.item.name, b.top, b.length, b.after])).toEqual([["night", 1320, 120, true]]);
  });

  it("puts an event at its clock time on a day the clocks change", () => {
    /* America's two changes and Europe's two: in whichever zone this runs, one of them is a 23- or
       25-hour day, and nine o'clock is still drawn at nine. */
    for (const [y, m, d] of [
      [2026, 3, 8],
      [2026, 11, 1],
      [2026, 3, 29],
      [2026, 10, 25],
    ] as const) {
      const day = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      const got = blocks(
        [timed("talk", at(y, m, d, 9), at(y, m, d, 10)), timed("late", at(y, m, d, 23), at(y, m, d + 1, 1))],
        day,
      );
      expect(got.map((b) => [b.item.name, b.top, b.length])).toEqual([
        ["talk", 540, 60],
        ["late", 1380, 60],
      ]);
    }
  });
});

describe("words", () => {
  it("says when an event is", () => {
    expect(whenWords({ start: "2026-10-12", end: "2026-10-14" }, "2026")).toBe("Mon, Oct 12 – Wed, Oct 14");
    expect(whenWords({ start: "2026-10-12" }, "2027")).toBe("Mon, Oct 12, 2026");
    expect(whenWords({ start: at(2026, 10, 3, 9), end: at(2026, 10, 3, 17, 30) }, "2026")).toBe("Sat, Oct 3, 09:00 – 17:30");
    expect(whenWords({ start: at(2026, 10, 3, 22), end: at(2026, 10, 4, 1) }, "2026")).toBe(
      "Sat, Oct 3, 22:00 – Sun, Oct 4, 01:00",
    );
  });
});

describe("changing one", () => {
  it("reads an event into the bar's fields, here", () => {
    expect(fieldsOf({ start: "2026-10-12", end: "2026-10-14" })).toEqual({
      allDay: true,
      startDay: "2026-10-12",
      startTime: "",
      endDay: "2026-10-14",
      endTime: "",
    });
    expect(fieldsOf({ start: at(2026, 10, 3, 9), end: at(2026, 10, 3, 17, 30) })).toEqual({
      allDay: false,
      startDay: "2026-10-03",
      startTime: "09:00",
      endDay: "2026-10-03",
      endTime: "17:30",
    });
    /* No end: the hour the calendar draws. */
    expect(fieldsOf({ start: at(2026, 10, 3, 9) }).endTime).toBe("10:00");
  });

  it("writes every time with its offset, and an end that is not after the start an hour on", () => {
    expect(
      eventFrom({ allDay: false, startDay: "2026-10-03", startTime: "09:00", endDay: "2026-10-03", endTime: "08:00" }),
    ).toEqual({
      start: at(2026, 10, 3, 9),
      end: at(2026, 10, 3, 10),
    });
    expect(eventFrom({ allDay: true, startDay: "2026-10-03", startTime: "", endDay: "2026-10-03", endTime: "" })).toEqual({
      start: "2026-10-03",
      end: null,
    });
    expect(eventFrom({ allDay: true, startDay: "2026-10-03", startTime: "", endDay: "2026-10-01", endTime: "" })).toEqual({
      start: "2026-10-03",
      end: null,
    });
  });

  it("switches between all day and a time", () => {
    expect(withAllDay({ start: at(2026, 10, 3, 9), end: at(2026, 10, 3, 17) }, true)).toEqual({ start: "2026-10-03", end: null });
    expect(withAllDay({ start: at(2026, 10, 3, 22), end: at(2026, 10, 5, 0) }, true)).toEqual({
      start: "2026-10-03",
      end: "2026-10-04",
    });
    expect(withAllDay({ start: "2026-10-03" }, false)).toEqual({ start: at(2026, 10, 3, 9), end: at(2026, 10, 3, 10) });
    expect(withAllDay({ start: "2026-10-03", end: "2026-10-05" }, false)).toEqual({
      start: at(2026, 10, 3, 9),
      end: at(2026, 10, 5, 17),
    });
  });

  it("moves the start and keeps how long it is", () => {
    expect(withStart({ start: at(2026, 10, 3, 9), end: at(2026, 10, 3, 10, 30) }, "2026-10-05", "14:00")).toEqual({
      start: at(2026, 10, 5, 14),
      end: at(2026, 10, 5, 15, 30),
    });
    expect(withStart({ start: "2026-10-12", end: "2026-10-14" }, "2026-10-20")).toEqual({
      start: "2026-10-20",
      end: "2026-10-22",
    });
    expect(withEnd({ start: at(2026, 10, 3, 9) }, "2026-10-03", "12:00")).toEqual({
      start: at(2026, 10, 3, 9),
      end: at(2026, 10, 3, 12),
    });
  });

  it("moves an event by a drag: by days, by quarter hours, across midnight, keeping its length", () => {
    const meeting = { start: at(2026, 10, 3, 9), end: at(2026, 10, 3, 10, 30) };
    expect(shiftEvent(meeting, 2)).toEqual({ start: at(2026, 10, 5, 9), end: at(2026, 10, 5, 10, 30) });
    expect(shiftEvent(meeting, 0, 37, 15)).toEqual({ start: at(2026, 10, 3, 9, 30), end: at(2026, 10, 3, 11) });
    expect(shiftEvent(meeting, 1, 14 * 60 + 50, 15)).toEqual({ start: at(2026, 10, 4, 23, 45), end: at(2026, 10, 5, 1, 15) });
    expect(shiftEvent(meeting, 0, -10 * 60, 15)).toEqual({ start: at(2026, 10, 2, 23), end: at(2026, 10, 3, 0, 30) });
    expect(shiftEvent({ start: "2026-10-12", end: "2026-10-14" }, -3, 90)).toEqual({ start: "2026-10-09", end: "2026-10-11" });
    expect(shiftEvent({ start: "2026-10-12" }, 1)).toEqual({ start: "2026-10-13", end: null });
  });

  it("leaves an end nobody wrote unwritten when it moves an event", () => {
    expect(shiftEvent({ start: at(2026, 10, 3, 9) }, 0, 60, 15)).toEqual({ start: at(2026, 10, 3, 10), end: null });
  });

  it("moves a task's start and due date together, and only the ones it has", () => {
    expect(shiftTask({ status: "todo", start: "2026-10-01", due: "2026-10-03" }, 5)).toEqual({
      start: "2026-10-06",
      due: "2026-10-08",
    });
    expect(shiftTask({ status: "done", due: "2026-10-31" }, 1)).toEqual({ due: "2026-11-01" });
    expect(shiftTask({ status: "todo", start: "2026-10-01" }, -1)).toEqual({ start: "2026-09-30" });
  });

  it("pulls an event's edge, the other kept, never past it", () => {
    const meeting = { start: at(2026, 10, 3, 9), end: at(2026, 10, 3, 10) };
    expect(withEdge(meeting, "end", "2026-10-03", "11:30")).toEqual({ start: meeting.start, end: at(2026, 10, 3, 11, 30) });
    expect(withEdge(meeting, "end", "2026-10-03", "08:00")).toEqual({ start: meeting.start, end: at(2026, 10, 3, 9, 15) });
    expect(withEdge(meeting, "start", "2026-10-03", "08:15")).toEqual({
      start: at(2026, 10, 3, 8, 15),
      end: at(2026, 10, 3, 10),
    });
    expect(withEdge(meeting, "start", "2026-10-03", "12:00")).toEqual({
      start: at(2026, 10, 3, 9, 45),
      end: at(2026, 10, 3, 10),
    });
    expect(withEdge({ start: at(2026, 10, 3, 9) }, "end", "2026-10-04", "10:00")).toEqual({
      start: at(2026, 10, 3, 9),
      end: at(2026, 10, 4, 10),
    });
    const trip = { start: "2026-10-12", end: "2026-10-14" };
    expect(withEdge(trip, "end", "2026-10-16")).toEqual({ start: "2026-10-12", end: "2026-10-16" });
    expect(withEdge(trip, "end", "2026-10-01")).toEqual({ start: "2026-10-12", end: null });
    expect(withEdge(trip, "start", "2026-10-10")).toEqual({ start: "2026-10-10", end: "2026-10-14" });
    expect(withEdge(trip, "start", "2026-10-20")).toEqual({ start: "2026-10-14", end: null });
  });

  it("pulls a task's start or due date, never past the other", () => {
    const task = { status: "todo" as const, start: "2026-10-05", due: "2026-10-07" };
    expect(taskEdge(task, "end", "2026-10-09")).toEqual({ due: "2026-10-09" });
    expect(taskEdge(task, "end", "2026-10-01")).toEqual({ due: "2026-10-05", start: null });
    expect(taskEdge(task, "start", "2026-10-02")).toEqual({ start: "2026-10-02" });
    expect(taskEdge(task, "start", "2026-10-30")).toEqual({ start: null });
    expect(taskEdge({ status: "todo", due: "2026-10-07" }, "start", "2026-10-04")).toEqual({ start: "2026-10-04" });
    expect(taskEdge({ status: "todo", start: "2026-10-07" }, "end", "2026-10-09")).toEqual({ due: "2026-10-09" });
  });

  it("turns an event all day where it is dropped, over the days it touched, or timed at the hour it is dropped at", () => {
    expect(asAllDay({ start: at(2026, 10, 3, 9), end: at(2026, 10, 3, 10) }, "2026-10-05")).toEqual({
      start: "2026-10-05",
      end: null,
    });
    expect(asAllDay({ start: at(2026, 10, 3, 22), end: at(2026, 10, 5, 2) }, "2026-10-10")).toEqual({
      start: "2026-10-10",
      end: "2026-10-12",
    });
    expect(asTimed({ start: "2026-10-12", end: "2026-10-14" }, "2026-10-13", "14:00")).toEqual({
      start: at(2026, 10, 13, 14),
      end: at(2026, 10, 13, 15),
    });
    expect(asTimed({ start: at(2026, 10, 3, 9), end: at(2026, 10, 3, 10, 30) }, "2026-10-04", "16:00")).toEqual({
      start: at(2026, 10, 4, 16),
      end: at(2026, 10, 4, 17, 30),
    });
    expect(asTimed({ start: at(2026, 10, 3, 9) }, "2026-10-04", "16:00")).toEqual({ start: at(2026, 10, 4, 16), end: null });
  });
});
