import { describe, expect, it } from "vitest";

import { CODES } from "@/dsl/codes";
import { parseTimeline } from "@/dsl/graph/timeline";

/**
 * A timeline date is a day on a real calendar, and `Date.UTC` quietly rolls an impossible one over
 * instead of refusing it: `2026-02-30` became 2 March, `2026-13-01` January 2027 and `2026-00-10`
 * December 2025. A typo moved a milestone a year, the card was drawn somewhere nobody meant, and
 * nothing was reported (#411).
 */

const errors = (src: string) => parseTimeline(src).diagnostics.filter((d) => d.severity === "error");

describe("a timeline date the calendar does not have", () => {
  it("reports month 13 on the date's own column, and draws no entry", () => {
    const g = parseTimeline('  2026-13-01 "Month 13"');

    expect(g.diagnostics).toEqual([
      {
        line: 1,
        col: 3,
        code: CODES.E_BAD_DATE,
        message: "`2026-13-01` is not a date: there is no month 13 (01–12)",
        severity: "error",
      },
    ]);
    expect(g.nodes).toEqual([]);
  });

  it("reports month 0", () => {
    expect(errors('2026-00-10 "Month 0"')[0]).toMatchObject({
      line: 1,
      col: 1,
      code: CODES.E_BAD_DATE,
      message: "`2026-00-10` is not a date: there is no month 0 (01–12)",
    });
  });

  it("reports a day the month does not have, and says how many it has", () => {
    expect(errors('2026-02-30 "February 30"')[0]?.message).toBe("`2026-02-30` is not a date: February 2026 has 28 days, not 30");
    expect(errors('2026-04-31 "April 31"')[0]?.message).toBe("`2026-04-31` is not a date: April 2026 has 30 days, not 31");
  });

  it("keeps the last day of a month and refuses the day after it", () => {
    expect(errors('2026-01-31 "Last of January"')).toEqual([]);
    expect(errors('2026-04-30 "Last of April"')).toEqual([]);
    expect(errors('2026-01-32 "Past the end"')).toHaveLength(1);
    expect(errors('2026-01-00 "Day zero"')[0]?.message).toBe("`2026-01-00` is not a date: January 2026 has 31 days, not 0");
  });

  it("skips the impossible entries and draws the valid ones around them", () => {
    const g = parseTimeline(
      [
        '2026-13-01 "Month 13"',
        '2026-02-30 "February 30"',
        '2026-04-31 "April 31"',
        '2026-00-10 "Month 0"',
        '2026-03-01 "Valid"',
      ].join("\n"),
    );

    expect(g.diagnostics.map((d) => [d.line, d.code])).toEqual([
      [1, CODES.E_BAD_DATE],
      [2, CODES.E_BAD_DATE],
      [3, CODES.E_BAD_DATE],
      [4, CODES.E_BAD_DATE],
    ]);
    expect(g.nodes.map((n) => n.title)).toEqual(["Valid"]);
  });

  it("reports an impossible range end where it is written", () => {
    const g = parseTimeline('2026-01-01 .. 2026-02-30 "Ranged"');

    expect(g.diagnostics).toEqual([
      {
        line: 1,
        col: 15,
        code: CODES.E_BAD_DATE,
        message: "`2026-02-30` is not a date: February 2026 has 28 days, not 30",
        severity: "error",
      },
    ]);
    expect(g.nodes).toEqual([]);
  });

  it("keeps the wording for text that is not a date at all", () => {
    expect(errors('not-a-date "No"')[0]).toMatchObject({
      line: 1,
      col: 1,
      code: CODES.E_BAD_DATE,
      message: "`not-a-date` is not a date (YYYY, YYYY-MM or YYYY-MM-DD)",
    });
  });

  it("refuses a year below 1000 rather than reading it as 19xx", () => {
    expect(errors('0999-01-01 "Old"')[0]?.message).toBe("`0999-01-01` is not a date: the year must be 1000–9999");
  });
});

describe("leap years in a timeline date", () => {
  it("accepts 29 February in a leap year", () => {
    expect(errors('2024-02-29 "Leap day"')).toEqual([]);
    expect(parseTimeline('2024-02-29 "Leap day"').nodes[0]?.meta).toBe("2024-02-29");
  });

  it("refuses 29 February in a common year", () => {
    expect(errors('2023-02-29 "No leap day"')[0]).toMatchObject({
      code: CODES.E_BAD_DATE,
      message: "`2023-02-29` is not a date: February 2023 has 28 days, not 29",
    });
  });

  it("follows the century rule: 2000 is a leap year, 1900 and 2100 are not", () => {
    expect(errors('2000-02-29 "Y2K leap day"')).toEqual([]);
    expect(errors('1900-02-29 "Not a leap day"')[0]?.message).toBe(
      "`1900-02-29` is not a date: February 1900 has 28 days, not 29",
    );
    expect(errors('2100-02-29 "Not a leap day"')[0]?.message).toBe(
      "`2100-02-29` is not a date: February 2100 has 28 days, not 29",
    );
  });
});
