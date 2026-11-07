import { afterEach, describe, expect, it } from "vitest";

import { blocks, dayWords, fieldsOf, itemsOf, placeEvent, weekday, whenWords, withStart } from "@/calendar/model";
import { dayOf, momentOf, nextHourEvent, timeOf, withZone } from "@/note/event";
import { currentZone, instantOf, localZone, offsetOf, setZone, validZone, wallOf } from "@/note/zone";

/**
 * The account's time zone. Every case sets a zone that is not the machine's — whatever the
 * machine's is, since these run under any `TZ` — and checks that nothing reads the machine's instead.
 * `afterEach` puts the machine's back: the unit suite shares modules between files (`isolate: false`).
 */
afterEach(() => setZone(null));

describe("the zone", () => {
  it("is the machine's until one is set, and an unknown name is the machine's too", () => {
    expect(currentZone()).toBe(localZone());
    setZone("Asia/Tokyo");
    expect(currentZone()).toBe("Asia/Tokyo");
    setZone("Mars/Olympus");
    expect(currentZone()).toBe(localZone());
    expect(validZone("Europe/Paris")).toBe(true);
    expect(validZone("")).toBe(false);
    expect(validZone(42)).toBe(false);
  });

  it("reads a wall clock and an offset in the zone, across a clock change", () => {
    /* Paris: +02:00 in summer, +01:00 from the last Sunday of October at 01:00 UTC. */
    expect(offsetOf(Date.parse("2026-10-25T00:59Z"), "Europe/Paris")).toBe(120);
    expect(offsetOf(Date.parse("2026-10-25T01:00Z"), "Europe/Paris")).toBe(60);
    expect(wallOf(Date.parse("2026-10-03T07:30Z"), "Asia/Kolkata")).toEqual({ year: 2026, month: 10, day: 3, hour: 13, minute: 0, second: 0 });
  });

  it("turns a wall clock back into the instant, the earlier one in an overlap and an hour on in a gap", () => {
    expect(instantOf({ year: 2026, month: 10, day: 3, hour: 9 }, "America/New_York")).toBe(Date.parse("2026-10-03T13:00Z"));
    /* 02:30 happens twice in Paris on 2026-10-25: first at +02:00. */
    expect(instantOf({ year: 2026, month: 10, day: 25, hour: 2, minute: 30 }, "Europe/Paris")).toBe(Date.parse("2026-10-25T00:30Z"));
    /* 02:30 never happens in Paris on 2026-03-29: read as 03:30, where the clocks are. */
    expect(instantOf({ year: 2026, month: 3, day: 29, hour: 2, minute: 30 }, "Europe/Paris")).toBe(Date.parse("2026-03-29T01:30Z"));
    /* Hour 24 carries over to the next midnight. */
    expect(instantOf({ year: 2026, month: 10, day: 3, hour: 24 }, "UTC")).toBe(Date.parse("2026-10-04T00:00Z"));
  });
});

describe("events read and written in the account's zone", () => {
  it("the report: 08:00 written for Casablanca is 08:00 in Casablanca", () => {
    /* tzdata 2026c keeps Casablanca at +00 from 2026-09-20; an agent that wrote +01:00 wrote 07:00. */
    setZone("Africa/Casablanca");
    const offset = offsetOf(Date.parse("2026-10-01T08:00Z"));
    const written = withZone("2026-10-01T08:00")!;
    expect(fieldsOf({ start: written }).startTime).toBe("08:00");
    expect(written.endsWith(offset === 0 ? "+00:00" : "+01:00")).toBe(true);
  });

  it("writes the zone's offset, never the machine's", () => {
    setZone("Asia/Kolkata");
    expect(withZone("2026-10-03T09:00")).toBe("2026-10-03T09:00+05:30");
    expect(timeOf(Date.parse("2026-10-03T03:30Z"))).toBe("2026-10-03T09:00+05:30");
    setZone("America/Los_Angeles");
    expect(withZone("2026-12-03T09:00")).toBe("2026-12-03T09:00-08:00");
    expect(withZone("2026-07-03T09:00")).toBe("2026-07-03T09:00-07:00");
  });

  it("places a day's midnight and a time's day in the zone", () => {
    setZone("Pacific/Auckland");
    expect(momentOf("2026-10-03").toISOString()).toBe("2026-10-02T11:00:00.000Z");
    expect(dayOf(Date.parse("2026-10-02T12:00Z"))).toBe("2026-10-03");
    expect(placeEvent({ start: "2026-10-02T12:00Z" }).first).toBe("2026-10-03");
  });

  it("names a day and its weekday as the calendar does, in any zone", () => {
    for (const zone of ["Pacific/Kiritimati", "Pacific/Pago_Pago", "UTC"]) {
      setZone(zone);
      expect(weekday("2026-10-03")).toBe(6);
      expect(dayWords("2026-10-03", "2026")).toBe("Sat, Oct 3");
    }
  });

  it("draws a timed event at its wall-clock hour in the zone's grid", () => {
    setZone("Asia/Tokyo");
    const items = itemsOf({ notes: ["m"], events: { m: { start: "2026-10-03T00:00Z", end: "2026-10-03T01:00Z" } } }, new Set(["event"]), "2026-10-01", "2026-10-05");
    const [b] = blocks(items, "2026-10-03");
    expect(b!.top).toBe(9 * 60);
    expect(b!.length).toBe(60);
    expect(whenWords({ start: "2026-10-03T00:00Z", end: "2026-10-03T01:00Z" }, "2026")).toBe("Sat, Oct 3, 09:00 – 10:00");
  });

  it("moves an event in the zone, keeping its length and writing the zone's offset", () => {
    setZone("Europe/Paris");
    const moved = withStart({ start: "2026-10-24T09:00+02:00", end: "2026-10-24T10:30+02:00" }, "2026-10-26", "09:00");
    expect(moved).toEqual({ start: "2026-10-26T09:00+01:00", end: "2026-10-26T10:30+01:00" });
  });

  it("starts a new event at the next whole hour in the zone", () => {
    setZone("Asia/Kolkata");
    expect(nextHourEvent(new Date("2026-10-03T03:40Z"))).toEqual({ start: "2026-10-03T10:00+05:30", end: "2026-10-03T11:00+05:30" });
  });
});
