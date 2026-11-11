import { describe, expect, it } from "vitest";
import { moveEntry, parseTimeline, readWhen, sectionOfLine, sectionsOf, setWhen, whenOf } from "../src/dsl/graph/timeline";

const ok = (text: string) => {
  const w = readWhen(text);
  if (!w.ok) throw new Error(`unreadable: ${text} (${w.why})`);
  return w;
};

describe("readWhen", () => {
  it("reads a year, a month and a day at the precision typed", () => {
    expect(ok("2026")).toMatchObject({ start: "2026", end: null, echo: "2026" });
    expect(ok("Mar 2026")).toMatchObject({ start: "2026-03", end: null, echo: "March 2026" });
    expect(ok("2026-03")).toMatchObject({ start: "2026-03", echo: "March 2026" });
    expect(ok("1 Mar 2026")).toMatchObject({ start: "2026-03-01", echo: "1 March 2026" });
    expect(ok("March 1, 2026")).toMatchObject({ start: "2026-03-01" });
    expect(ok("2026-3-1")).toMatchObject({ start: "2026-03-01" });
    expect(ok("2026/03/01")).toMatchObject({ start: "2026-03-01" });
  });

  it("reads a range joined by – - → or to", () => {
    for (const text of [
      "Mar 2026 – Jun 2026",
      "Mar 2026 - Jun 2026",
      "Mar 2026 → Jun 2026",
      "Mar 2026 to Jun 2026",
      "2026-03..2026-06",
      "2026-03-2026-06",
    ]) {
      expect(ok(text), text).toMatchObject({ start: "2026-03", end: "2026-06", echo: "March 2026 → June 2026" });
    }
    expect(ok("2026-2027")).toMatchObject({ start: "2026", end: "2027" });
    expect(ok("2026-03-01-2026-06")).toMatchObject({ start: "2026-03-01", end: "2026-06" });
  });

  it("says why it could not read the text", () => {
    expect(readWhen("")).toEqual({ ok: false, why: "type a date" });
    expect(readWhen("soon").ok).toBe(false);
    expect(readWhen("2026-13").ok).toBe(false);
    expect(readWhen("30 Feb 2026").ok).toBe(false);
    expect(readWhen("Mar 2026 → soon")).toMatchObject({ ok: false });
    expect(readWhen("Jun 2026 → Mar 2026")).toEqual({ ok: false, why: "the end is before the start" });
  });
});

describe("setWhen / whenOf", () => {
  it("writes the date and keeps the label and the flags", () => {
    expect(setWhen('2026-09 "Design" done', "2027-01-05", null)).toBe('2027-01-05 "Design" done');
    expect(setWhen('  2026-09 "Design"', "2026", null)).toBe('  2026 "Design"');
  });

  it("turns a point into a range and back", () => {
    expect(setWhen('2026-09 "Design" wait', "2026-09", "2026-11")).toBe('2026-09 .. 2026-11 "Design" wait');
    expect(setWhen('2026-09 .. 2026-11 "Design" wait', "2026-09", null)).toBe('2026-09 "Design" wait');
  });

  it("keeps the author's spacing around `..`", () => {
    expect(setWhen('2026-09..2026-11 "A"', "2026-10", "2026-12")).toBe('2026-10..2026-12 "A"');
  });

  it("refuses a line with no date", () => {
    expect(setWhen('section "2026"', "2026", null)).toBeNull();
  });

  it("shows the date as written, with an arrow for a range", () => {
    expect(whenOf('2026-09 "A"')).toBe("2026-09");
    expect(whenOf('2026-09 .. 2026-11 "A"')).toBe("2026-09 → 2026-11");
    expect(whenOf('section "x"')).toBe("");
  });

  it("writes a line the parser reads back", () => {
    const line = setWhen('2026-09 "A" done', "2026-03-01", "2026-06")!;
    const g = parseTimeline(line);
    expect(g.diagnostics).toEqual([]);
    expect(g.nodes[0]).toMatchObject({ meta: "2026-03-01 → 2026-06", status: "done" });
  });
});

const BODY = `section "H1"
  2026-01 "A"
  2026-02 "B"

  %% held back
section "H2"
  2026-07 "C"
section "Empty"
`;

describe("choosing a section", () => {
  it("lists the sections and finds an entry's", () => {
    expect(sectionsOf(BODY)).toEqual([
      { line: 1, label: "H1" },
      { line: 6, label: "H2" },
      { line: 8, label: "Empty" },
    ]);
    expect(sectionOfLine(BODY, 2)).toBe(1);
    expect(sectionOfLine(BODY, 7)).toBe(6);
    expect(sectionOfLine('2026 "x"\nsection "a"', 1)).toBeNull();
  });

  const sectionOf = (body: string, label: string) => {
    const g = parseTimeline(body);
    const n = g.nodes.find((x) => x.title === label)!;
    return g.groups.find((x) => x.id === n.group)?.label;
  };

  it("moves an entry to the end of another section, after its last entry", () => {
    const r = moveEntry(BODY, 2, 6)!;
    expect(r.body).toBe(`section "H1"
  2026-02 "B"

  %% held back
section "H2"
  2026-07 "C"
  2026-01 "A"
section "Empty"
`);
    expect(r.body.split("\n")[r.line - 1]).toBe('  2026-01 "A"');
    expect(sectionOf(r.body, "A")).toBe("H2");
  });

  it("moves into an empty section, directly under its line", () => {
    const r = moveEntry(BODY, 7, 8)!;
    expect(r.body.split("\n").slice(5, 8)).toEqual(['section "H2"', 'section "Empty"', '  2026-07 "C"']);
    expect(sectionOf(r.body, "C")).toBe("Empty");
  });

  it("moves to a later section and keeps every other line", () => {
    const r = moveEntry(BODY, 3, 8)!;
    expect(r.body.split("\n")).toHaveLength(BODY.split("\n").length);
    expect(sectionOf(r.body, "B")).toBe("Empty");
  });

  it("takes an entry out of every section", () => {
    const r = moveEntry(BODY, 2, null)!;
    expect(r.body.startsWith('2026-01 "A"\nsection "H1"')).toBe(true);
    expect(r.line).toBe(1);
    expect(sectionOf(r.body, "A")).toBeUndefined();
  });

  it("lands after the entries already above the first section", () => {
    const body = '2026 "Top"\nsection "S"\n  2027 "In"';
    const r = moveEntry(body, 3, null)!;
    expect(r.body).toBe('2026 "Top"\n2027 "In"\nsection "S"');
    expect(r.line).toBe(2);
  });

  it("does nothing where it already is, or for a line that is not an entry", () => {
    expect(moveEntry(BODY, 2, 1)).toBeNull();
    expect(moveEntry(BODY, 1, 6)).toBeNull();
    expect(moveEntry(BODY, 5, 6)).toBeNull();
    expect(moveEntry(BODY, 2, 3)).toBeNull();
  });
});
