import { describe, expect, it } from "vitest";

import { parseChart } from "@/dsl/chart";
import {
  addChartData,
  chartIdProblem,
  chartKeyRows,
  renameChartId,
  setChartHero,
  setChartKeyRows,
  setChartOption,
} from "@/dsl/restate";

/** What the panel's chart controls write: the donut's centre, the key's rows, new data, a new id. */

const DONUT = `donut "1.2M" "users"\nseries web "Web" 60\nseries mob "Mobile" 40\n`;
const BAR = `bar\nx Q1 Q2 Q3\nseries web "Web" 1 2 3\nseries mob "Mobile" 4 5 6\n`;
const clean = (body: string) => parseChart(body).diagnostics.filter((d) => d.severity === "error");

describe("setChartHero", () => {
  it("retypes the figure and keeps the caption", () => {
    const out = setChartHero(DONUT, { value: "9", label: "users" });
    expect(out.split("\n")[0]).toBe('donut "9" "users"');
    expect(parseChart(out).hero).toEqual({ value: "9", label: "users" });
  });

  it("writes one on a donut that had none, and an author's comment survives", () => {
    const out = setChartHero(`donut %% the split\nseries a "A" 1\n`, { value: "42", label: "n" });
    expect(out.split("\n")[0]).toBe('donut "42" "n" %% the split');
    expect(parseChart(out).hero?.value).toBe("42");
  });

  it("leaves a flag beside it where it was", () => {
    const out = setChartHero(`donut stacked "1" "a"\nseries a "A" 1\n`, { value: "2" });
    expect(out.split("\n")[0]).toBe('donut stacked "2"');
  });

  it("an emptied figure takes the caption with it", () => {
    const out = setChartHero(DONUT, { value: "  ", label: "users" });
    expect(out.split("\n")[0]).toBe("donut");
    expect(parseChart(out).hero).toBeUndefined();
  });

  it("null removes it, and a body with no form line is handed back", () => {
    expect(setChartHero(DONUT, null).split("\n")[0]).toBe("donut");
    const bare = `series a "A" 1\n`;
    expect(setChartHero(bare, { value: "1" })).toBe(bare);
  });

  it("quotes a figure that has a quote in it", () => {
    const out = setChartHero(DONUT, { value: 'say "hi"' });
    expect(parseChart(out).hero?.value).toBe('say "hi"');
    expect(clean(out)).toEqual([]);
  });
});

describe("the key's rows", () => {
  it("reads rows and not the placement", () => {
    const body = `bar\nlegend bottom\nlegend solid "a call"\nlegend dashed "a deploy"\nseries a "A" 1\n`;
    expect(chartKeyRows(body)).toEqual([
      { glyph: "solid", text: "a call" },
      { glyph: "dashed", text: "a deploy" },
    ]);
  });

  it("adds a row after the form line when there is none, and it parses back", () => {
    const out = setChartKeyRows(BAR, [{ glyph: "solid", text: "in sync" }]);
    expect(out.split("\n")[1]).toBe('legend solid "in sync"');
    expect(parseChart(out).legend).toEqual([{ glyph: "solid", text: "in sync" }]);
    expect(clean(out)).toEqual([]);
  });

  it("rewrites a row in place, keeping a trailing comment, and appends after the last one", () => {
    const body = `bar\nlegend solid "a" %% mine\nseries a "A" 1\n`;
    const out = setChartKeyRows(body, [
      { glyph: "quiet", text: "b" },
      { glyph: "done", text: "c" },
    ]);
    expect(out).toBe(`bar\nlegend quiet "b" %% mine\nlegend done "c"\nseries a "A" 1\n`);
  });

  it("removes surplus rows and drops one that cannot be read back", () => {
    const body = `bar\nlegend solid "a"\nlegend dashed "b"\nseries a "A" 1\n`;
    expect(setChartKeyRows(body, [{ glyph: "dashed", text: "b" }])).toBe(`bar\nlegend dashed "b"\nseries a "A" 1\n`);
    expect(setChartKeyRows(body, [])).toBe(`bar\nseries a "A" 1\n`);
    expect(
      chartKeyRows(
        setChartKeyRows(body, [
          { glyph: "two words", text: "x" },
          { glyph: "solid", text: "" },
        ]),
      ),
    ).toEqual([]);
  });

  it("changing the placement does not touch a key row, whichever comes first", () => {
    const body = `bar\nlegend solid "a"\nseries a "A" 1\nseries b "B" 2\n`;
    const out = setChartOption(body, "legend", "bottom");
    expect(out).toContain('legend solid "a"');
    expect(parseChart(out).legendAt).toBe("bottom");
    expect(parseChart(setChartOption(out, "legend", null)).legend).toEqual([{ glyph: "solid", text: "a" }]);
  });
});

describe("addChartData", () => {
  it("appends a series with one value per category, after the last statement of data", () => {
    const { body, id } = addChartData(`${BAR}unit "k"\n`, "series");
    expect(id).toBe("series1");
    expect(body.split("\n")[4]).toBe('series series1 "Series 1" 1 1 1');
    expect(clean(body)).toEqual([]);
    expect(parseChart(body).series.map((s) => s.id)).toEqual(["web", "mob", "series1"]);
  });

  it("numbers past an id that is taken, in either kind", () => {
    const first = addChartData(DONUT, "slice");
    const second = addChartData(first.body, "slice");
    expect([first.id, second.id]).toEqual(["slice1", "slice2"]);
    expect(addChartData(`pie\nseries slice1 "x" 1\n`, "slice").id).toBe("slice2");
  });

  it("writes into a chart that has no data yet, after the form line", () => {
    const { body } = addChartData("pie\n", "slice");
    expect(body).toBe('pie\nslice slice1 "Slice 1" 1\n');
    expect(clean(addChartData("", "series").body)).toEqual([]);
  });

  it("sizes a series to the longest one when there are no categories", () => {
    const { body } = addChartData(`line\nseries a "A" 3 4 5 6\n`, "series");
    expect(body).toContain('series series1 "Series 1" 1 1 1 1');
  });
});

describe("renameChartId", () => {
  it("renames the declaration and nothing that merely spells the same", () => {
    const body = `bar\nx web mob\nseries web "Web" 1 2\nseries mob "Mobile" 3 4\n`;
    const out = renameChartId(body, "web", "site");
    expect(out).toBe(`bar\nx web mob\nseries site "Web" 1 2\nseries mob "Mobile" 3 4\n`);
    expect(parseChart(out).series.map((s) => s.id)).toEqual(["site", "mob"]);
    expect(parseChart(out).categories).toEqual(["web", "mob"]);
  });

  it("renames a slice and keeps its hue and its comment", () => {
    const out = renameChartId(`pie\nslice a "A" 5 hue=coral %% note\n`, "a", "alpha");
    expect(out).toBe(`pie\nslice alpha "A" 5 hue=coral %% note\n`);
  });

  it("is refused for a taken id, a dotted one, an empty one and an unknown one", () => {
    expect(chartIdProblem(DONUT, "web", "mob")).toMatch(/already/);
    expect(chartIdProblem(DONUT, "web", "a.b")).toMatch(/letters/);
    expect(chartIdProblem(DONUT, "web", "")).toMatch(/empty/);
    expect(chartIdProblem(DONUT, "web", "web")).toBeNull();
    expect(renameChartId(DONUT, "web", "mob")).toBe(DONUT);
    expect(renameChartId(DONUT, "nope", "x")).toBe(DONUT);
  });
});
