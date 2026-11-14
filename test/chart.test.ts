import fs from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

import { parseBoard } from "@/board/parseBoard";
import { DIAGRAM_TYPES, resizeOf } from "@/board/types";
import { CHART_HUES_MAX, FORMS, parseChart } from "@/dsl/chart";
import { declaredAt, declaredOn } from "@/dsl/declared";
import { hasDialect, hasGraph } from "@/dsl/parse";
import { declaredIds, rebind } from "@/dsl/rebind";
import {
  setCategories,
  setChartFlag,
  setChartForm,
  setChartOption,
  setModifier,
  setTitle,
  setValues,
  removeNode,
  valuesText,
} from "@/dsl/restate";
import { duplicateStatement } from "@/edit/pick";
import { layoutChart, niceScale } from "@/layout/chart";
import { layoutKey } from "@/layout/client";
import { fontOf, setMeasurer, TableMeasurer } from "@/layout/measure";
import type { Bar, Box, ChartLabel, ChartPlaced } from "@/layout/types";
import dark from "../themes/paper-dark/theme.json";
import neutral from "../themes/neutral/theme.json";
import theme from "../themes/paper/theme.json";
import type { Theme } from "@/theme/contract";

/**
 * The fourteenth type, and the first one that draws data.
 *
 * Two things this file is watching for that the other parser tests are not. **A chart never
 * refuses data over its shape**: a series with the wrong number of values is padded or cut and
 * warned, because a fragment dropped from the library must not be able to break the chart it
 * landed on. And **`hue` is undefined until somebody writes one** — the layout fills it from the
 * theme, because which order of hues separates cleanly is a property of the theme's colours and
 * this layer has never seen one.
 */

const codes = (src: string): string[] => parseChart(src).diagnostics.map((d) => `${d.line}:${d.code}`);

describe("parseChart · the four forms", () => {
  it("reads a grouped bar chart", () => {
    const model = parseChart(`bar
x Q1 Q2 Q3 Q4
series web "Web" 120 140 160 180
series mob "Mobile" 40 60 90 130 hue=coral`);

    expect(model.kind).toBe("chart");
    expect(model.form).toBe("bar");
    expect(model.stacked).toBe(false);
    expect(model.horizontal).toBe(false);
    expect(model.categories).toEqual(["Q1", "Q2", "Q3", "Q4"]);
    expect(model.series).toEqual([
      { id: "web", title: "Web", values: [120, 140, 160, 180], line: 3 },
      { id: "mob", title: "Mobile", values: [40, 60, 90, 130], hue: "coral", line: 4 },
    ]);
    expect(model.slices).toEqual([]);
    expect(model.diagnostics).toEqual([]);
  });

  it("reads the flags, the options and a quoted category", () => {
    const model = parseChart(`bar stacked horizontal
x "Jan 24" "Feb 24"
series a "A" 3 4
legend bottom
values
unit "k€"
min 0
max 400`);

    expect(model.stacked).toBe(true);
    expect(model.horizontal).toBe(true);
    expect(model.categories).toEqual(["Jan 24", "Feb 24"]);
    expect(model.legendAt).toBe("bottom");
    expect(model.values).toBe(true);
    expect(model.unit).toBe("k€");
    expect(model.min).toBe(0);
    expect(model.max).toBe(400);
    expect(model.diagnostics).toEqual([]);
  });

  it("reads a line chart with a gap and a negative value", () => {
    const model = parseChart(`line
x a b c d
series t "Traffic" 10 - -4 3.5`);

    expect(model.form).toBe("line");
    expect(model.series[0]!.values).toEqual([10, null, -4, 3.5]);
    expect(model.diagnostics).toEqual([]);
  });

  it("reads a pie", () => {
    const model = parseChart(`pie
slice web "Web" 62
slice mob "Mobile" 28
slice oth "Other" 10 hue=bronze`);

    expect(model.form).toBe("pie");
    expect(model.hero).toBeUndefined();
    expect(model.slices).toEqual([
      { id: "web", title: "Web", value: 62, line: 2 },
      { id: "mob", title: "Mobile", value: 28, line: 3 },
      { id: "oth", title: "Other", value: 10, hue: "bronze", line: 4 },
    ]);
    expect(model.diagnostics).toEqual([]);
  });

  it("reads a donut's hero and its label", () => {
    const model = parseChart(`donut "1.2M" "users"
slice a "A" 1`);

    expect(model.form).toBe("donut");
    expect(model.hero).toEqual({ value: "1.2M", label: "users" });
    expect(model.diagnostics).toEqual([]);
  });

  it("defaults to a bar chart when nobody said", () => {
    const model = parseChart(`series a "A" 1 2 3`);
    expect(model.form).toBe("bar");
    expect(model.categories).toEqual([]);
    expect(model.diagnostics).toEqual([]);
  });

  it("takes a title, but no label, on a pie", () => {
    expect(parseChart('pie\nslice a "A" 1').hero).toBeUndefined();
    expect(parseChart('pie "48%"\nslice a "A" 1').hero).toEqual({ value: "48%", label: undefined });
  });
});

describe("parseChart · both cross-form readings", () => {
  /*
   * The whole reason the panel's Form select can be a menu rather than a validation: switching form
   * over data that is already there can never produce an error, because both statements parse in
   * every form with a meaning of their own.
   */
  it("takes a slice in a bar chart — one bar with its own hue", () => {
    const model = parseChart(`bar
slice a "A" 3 hue=moss
slice b "B" 5`);
    expect(model.form).toBe("bar");
    expect(model.slices.map((s) => [s.id, s.value])).toEqual([
      ["a", 3],
      ["b", 5],
    ]);
    expect(model.diagnostics).toEqual([]);
  });

  it("takes a series in a pie — one wedge worth the series' total", () => {
    const model = parseChart(`pie
series a "A" 1 2 3
series b "B" 4`);
    expect(model.form).toBe("pie");
    expect(model.series.map((s) => s.values)).toEqual([
      [1, 2, 3],
      [4, null, null],
    ]);
    /* The pad is warned; the parse is not refused. */
    expect(
      codes(`pie
series a "A" 1 2 3
series b "B" 4`),
    ).toEqual(["3:W_CHART_LENGTH"]);
  });
});

describe("parseChart · a hue is only ever what somebody wrote", () => {
  it("leaves an unwritten hue undefined, for the layout to fill from the theme", () => {
    const model = parseChart(`bar
series a "A" 1
series b "B" 2 hue=violet`);
    expect(model.series[0]!.hue).toBeUndefined();
    expect(model.series[1]!.hue).toBe("violet");
    /* Not `HUE_ORDER[0]`, and not a colour: this layer has never seen a theme. */
    expect(Object.prototype.hasOwnProperty.call(model.series[0]!, "hue")).toBe(false);
  });

  it("drops a hue outside the ten and offers the near miss", () => {
    const model = parseChart('bar\nseries a "A" 1 hue=purple');
    expect(model.series[0]!.hue).toBeUndefined();
    expect(model.diagnostics).toHaveLength(1);
    expect(model.diagnostics[0]!.code).toBe("W_UNKNOWN_HUE");
    expect(model.diagnostics[0]!.line).toBe(2);
    expect(model.diagnostics[0]!.message).toContain("violet");
  });
});

describe("parseChart · the diagnostics, with their lines", () => {
  it("E_CHART_VALUE names the word that is not a number, and costs exactly one diagnostic", () => {
    const model = parseChart(`bar
x a b
series s "S" 12 twelve`);
    expect(model.diagnostics.map((d) => [d.line, d.code])).toEqual([[3, "E_CHART_VALUE"]]);
    expect(model.diagnostics[0]!.message).toContain("twelve");
    /* The unreadable word is kept as a *gap*, so the series still has two values and nothing
       downstream raises a `W_CHART_LENGTH` about a symptom of the word above it. */
    expect(model.series[0]!.values).toEqual([12, null]);
  });

  it("E_CHART_VALUE also covers min and max", () => {
    expect(codes("bar\nmin lots\nmax 4")).toEqual(["1:W_CHART_EMPTY", "2:E_CHART_VALUE"]);
    expect(parseChart("bar\nmin lots\nmax 4").max).toBe(4);
  });

  it("W_CHART_LENGTH pads a short series and cuts a long one, and never errors", () => {
    const model = parseChart(`bar
x Q1 Q2 Q3
series short "Short" 1
series long "Long" 1 2 3 4 5`);

    expect(model.diagnostics.map((d) => [d.line, d.code, d.severity])).toEqual([
      [3, "W_CHART_LENGTH", "warn"],
      [4, "W_CHART_LENGTH", "warn"],
    ]);
    expect(model.series[0]!.values).toEqual([1, null, null]);
    expect(model.series[1]!.values).toEqual([1, 2, 3]);
  });

  it("W_CHART_LENGTH covers a slice given more than its one value", () => {
    const model = parseChart('pie\nslice a "A" 3 4 5');
    expect(codes('pie\nslice a "A" 3 4 5')).toEqual(["2:W_CHART_LENGTH"]);
    expect(model.slices[0]!.value).toBe(3);
  });

  it("pads against the longest series when there is no x line", () => {
    const model = parseChart(`line
series a "A" 1 2 3 4
series b "B" 1 2`);
    expect(
      codes(`line
series a "A" 1 2 3 4
series b "B" 1 2`),
    ).toEqual(["3:W_CHART_LENGTH"]);
    expect(model.series[1]!.values).toEqual([1, 2, null, null]);
    /* And the categories stay empty, which is what makes the ticks blank rather than invented. */
    expect(model.categories).toEqual([]);
  });

  it("E_CHART_FORM on a second form line, and the first one stands", () => {
    const model = parseChart(`bar
series a "A" 1
pie`);
    expect(model.diagnostics.map((d) => [d.line, d.code])).toEqual([[3, "E_CHART_FORM"]]);
    expect(model.form).toBe("bar");
  });

  it("W_CHART_EMPTY on a chart with no data at all", () => {
    expect(codes("bar\nx Q1 Q2")).toEqual(["1:W_CHART_EMPTY"]);
    expect(parseChart("bar\nx Q1 Q2").diagnostics[0]!.severity).toBe("warn");
  });

  it("W_CHART_MANY past the theme's chart hues, counting only the unhued", () => {
    const eight = ["bar", ...Array.from({ length: 8 }, (_, i) => `series s${i} "S${i}" 1`)].join("\n");
    const diag = parseChart(eight).diagnostics;
    expect(diag.map((d) => d.code)).toEqual(["W_CHART_MANY"]);
    /* Against the line of the first one past the list, which is the one that starts drawing muted. */
    expect(diag[0]!.line).toBe(2 + CHART_HUES_MAX);

    /* Hue one of them by hand and there are seven left to colour, which is exactly the list. */
    const hued = eight.replace('series s0 "S0" 1', 'series s0 "S0" 1 hue=indigo');
    expect(parseChart(hued).diagnostics).toEqual([]);
  });

  it("E_UNKNOWN_KIND names the chart vocabulary and suggests from the aliases", () => {
    const model = parseChart(`column
series a "A" 1`);
    expect(model.diagnostics.map((d) => [d.line, d.code])).toEqual([[1, "E_UNKNOWN_KIND"]]);
    expect(model.diagnostics[0]!.message).toContain("Did you mean `bar`");
    expect(model.diagnostics[0]!.message).toContain("series");
  });

  it.each([
    ["column", "bar"],
    ["area", "line"],
    ["ring", "donut"],
    ["label", "x"],
    ["data", "series"],
  ])("suggests %s → %s", (wrong, right) => {
    const said = parseChart(`${wrong} 1 2 3\nslice a "A" 1`).diagnostics.find((d) => d.code === "E_UNKNOWN_KIND");
    expect(said?.message).toContain(`Did you mean \`${right}\``);
  });

  it("E_DUPLICATE_ID, and the first declaration stands", () => {
    const model = parseChart(`bar
series a "First" 1
series a "Second" 2`);
    expect(model.diagnostics.map((d) => [d.line, d.code])).toEqual([[3, "E_DUPLICATE_ID"]]);
    expect(model.series.map((s) => s.title)).toEqual(["First"]);
  });

  it("W_UNKNOWN_ICON and W_UNKNOWN_ATTR ride along from the shared vocabulary", () => {
    expect(codes('bar\nseries a "A" 1 icon=nosuchicon')).toEqual(["2:W_UNKNOWN_ICON"]);
    expect(codes('bar\nseries a "A" 1 colour=red')).toEqual(["2:W_UNKNOWN_ATTR"]);
    expect(parseChart('bar\nseries a "A" 1 icon=server').diagnostics).toEqual([]);
  });

  it("W_UNKNOWN_ICON carries the same suggestion the node path does", () => {
    const said = parseChart('bar\nseries a "A" 1 icon=postgre').diagnostics.find((d) => d.code === "W_UNKNOWN_ICON");
    expect(said?.message).toContain("the legend draws its swatch alone");
    expect(said?.message).toContain("Did you mean `postgres`");
  });

  it("reports in line order, whatever order the passes produced them in", () => {
    /* The length pass runs at the end and pushes against line 2; the value errors were pushed while
       the tokens went past. Sorting is `tidy()`'s, shared with every other dialect. */
    const model = parseChart(`x a b c
series z "Z" 1
series y "Y" nope 2 3`);
    expect(model.diagnostics.map((d) => [d.line, d.code])).toEqual([
      [2, "W_CHART_LENGTH"],
      [3, "E_CHART_VALUE"],
    ]);
  });
});

describe("parseChart · the shared grammar it inherits", () => {
  it("takes `%%` comments, `;` separators and a glyph legend", () => {
    const model = parseChart(`bar          %% a comment
series a "A" 1; series b "B" 2
legend solid "in sync"`);
    expect(model.series.map((s) => s.id)).toEqual(["a", "b"]);
    expect(model.legend).toEqual([{ glyph: "solid", text: "in sync" }]);
    expect(model.legendAt).toBeUndefined();
    expect(model.diagnostics).toEqual([]);
  });

  it("tells a placement from a glyph legend by whether a string follows", () => {
    expect(parseChart("bar\nlegend none").legendAt).toBe("none");
    expect(parseChart('bar\nlegend bottom "the two lines"').legend).toEqual([{ glyph: "bottom", text: "the two lines" }]);
  });

  it("does not sniff for Mermaid, because `pie` is its own form word", () => {
    /* `detectMermaid` treats a leading `pie` as a fatal Mermaid header. Running it here would make
       the commonest chart body in existence a parse error. */
    const model = parseChart(`pie
slice a "A" 1`);
    expect(model.diagnostics).toEqual([]);
  });
});

describe("hasGraph · the predicate that replaced fifteen literals", () => {
  it("is true of every type whose model is a Graph and false of the two that own one", () => {
    for (const t of DIAGRAM_TYPES) {
      expect(hasGraph(t), t).toBe(t !== "sequence" && t !== "chart");
    }
    expect(DIAGRAM_TYPES).toHaveLength(14);
  });

  it("says nothing about whether a type is known", () => {
    expect(hasGraph("nonsense")).toBe(true);
    expect(hasDialect("nonsense")).toBe(false);
    expect(hasDialect("chart")).toBe(true);
  });
});

describe("the item a chart is", () => {
  it("sizes by its own box: the same bars are right at 320px and at 900px", () => {
    expect(resizeOf("chart")).toBe("box");
  });
});

describe("declaredAt / declaredOn", () => {
  const BODY = `bar
x Q1 Q2
series web "Web" 120 140
slice a "A" 3`;

  it("finds a series and a slice by id", () => {
    expect(declaredAt("chart", BODY, "web")).toBe(3);
    expect(declaredAt("chart", BODY, "a")).toBe(4);
    expect(declaredAt("chart", BODY, "nothing")).toBeNull();
  });

  it("finds them the other way, off the line", () => {
    expect(declaredOn("chart", BODY, 3)).toEqual({ id: "web", what: "node" });
    expect(declaredOn("chart", BODY, 4)).toEqual({ id: "a", what: "node" });
    expect(declaredOn("chart", BODY, 2)).toBeNull();
  });

  it("finds the same two shapes through the generic token scan", () => {
    /* `<kind> <id> "title"` is what the fallback looks for, and both statements are that — which is
       why the head shape was chosen. Asked as an unknown type, only the scan can answer. */
    expect(declaredAt("nosuchtype", 'series web "Web" 120', "web")).toBe(1);
    expect(declaredAt("nosuchtype", 'slice a "A" 3', "a")).toBe(1);
  });
});

describe("rebind", () => {
  it("renames a chart's series and slices, and leaves the categories alone", () => {
    expect(declaredIds("chart", 'bar\nx Q1 Q2\nseries a "A" 1 2\nslice b "B" 3').sort()).toEqual(["a", "b"]);
  });

  it("renames only what the target already uses", () => {
    const out = rebind("chart", 'series a "A" 1\nseries z "Z" 2', 'series a "Mine" 9');
    expect(out).toBe('series a2 "A" 1\nseries z "Z" 2');
  });
});

/* ------------------------------------------------------------------------------- the writers */

describe("setValues", () => {
  it("rewrites the run and leaves a trailing hue= and comment exactly as they were", () => {
    const line = 'series web  "Web"  120 140 160  hue=coral  %% Q1–Q3';
    expect(setValues(line, [1, 2])).toBe('series web  "Web"  1 2  hue=coral  %% Q1–Q3');
  });

  it("writes a gap as `-`", () => {
    expect(setValues('series a "A" 1 2 3', [1, null, 3])).toBe('series a "A" 1 - 3');
  });

  it("writes the first values onto a statement that has none", () => {
    expect(setValues('series a "A" hue=moss', [4, 5])).toBe('series a "A" 4 5 hue=moss');
    expect(setValues('slice a "A"', [4])).toBe('slice a "A" 4');
  });

  it("takes the run off when handed nothing", () => {
    expect(setValues('series a "A" 1 2 hue=moss', [])).toBe('series a "A" hue=moss');
  });

  it("is idempotent", () => {
    const once = setValues('series a "A" 9', [1, 2, 3]);
    expect(setValues(once, [1, 2, 3])).toBe(once);
  });

  it("hands back anything it cannot read", () => {
    expect(setValues("a --> b", [1])).toBe("a --> b");
    expect(setValues("", [1])).toBe("");
    expect(setValues("   ", [1])).toBe("   ");
  });

  it("leaves the rest of the statement's writers working on a chart line", () => {
    /* The head shape is `<kind> <id> "Label"`, which is what buys the shared writers for free. */
    expect(setTitle('series web "Web" 120 140', "Traffic")).toBe('series web "Traffic" 120 140');
    expect(setModifier('series web "Web" 120', "hue", "moss")).toBe('series web "Web" 120 hue=moss');
    expect(setModifier('series web "Web" 120 hue=moss', "hue", null)).toBe('series web "Web" 120');
  });
});

describe("valuesText", () => {
  it("reads the run back exactly as it is written, which is what the panel shows", () => {
    expect(valuesText('series web  "Web"  120 140 160  hue=coral  %% Q1–Q3')).toBe("120 140 160");
    expect(valuesText('series a "A" 1 - 3')).toBe("1 - 3");
    expect(valuesText('slice a "A" 62')).toBe("62");
  });

  it("is empty where there is no run, and where the line is not a statement", () => {
    expect(valuesText('series a "A" hue=moss')).toBe("");
    expect(valuesText("a --> b")).toBe("");
    expect(valuesText("")).toBe("");
  });

  it("is the inverse of `setValues` — what it reads, `setValues` writes back unchanged", () => {
    const line = 'series web "Web" 12 - 30 hue=coral';
    expect(setValues(line, [12, null, 30])).toBe(line);
    expect(valuesText(line)).toBe("12 - 30");
  });
});

describe("Delete and ctrl+D on a picked series", () => {
  const BODY = ["bar", "x Q1 Q2", 'series web "Web" 12 30', 'series mob "Mobile" 4 6', 'unit "k"'].join("\n");
  const errors = (body: string) => parseChart(body).diagnostics.filter((d) => d.severity === "error");

  it("takes the whole statement, and there is nothing else naming it to take", () => {
    /* `removeNode` also strips every edge that named the node. A chart has none — which is why
       there was nothing to write for C3 here, and why the test is what says so. */
    const next = removeNode(BODY, "web", { type: "chart" });
    expect(next.split("\n")).toEqual(["bar", "x Q1 Q2", 'series mob "Mobile" 4 6', 'unit "k"']);
    expect(errors(next)).toEqual([]);
    expect(parseChart(next).series.map((s) => s.id)).toEqual(["mob"]);
  });

  it("copies one under a free id, with its numbers and its hue", () => {
    const made = duplicateStatement("chart", BODY, "mob")!;
    expect(made.id).toBe("mob2");
    expect(errors(made.body)).toEqual([]);
    expect(parseChart(made.body).series.map((s) => [s.id, s.values])).toEqual([
      ["web", [12, 30]],
      ["mob", [4, 6]],
      ["mob2", [4, 6]],
    ]);
  });
});

describe("setChartForm", () => {
  const BODY = 'bar stacked\nx Q1 Q2\nseries a "A" 1 2';

  it("retypes the form word and leaves the flags on the line", () => {
    expect(setChartForm(BODY, "line")).toBe('line stacked\nx Q1 Q2\nseries a "A" 1 2');
  });

  it("writes a form line when there is none, at the top", () => {
    expect(setChartForm('series a "A" 1', "donut")).toBe('donut\nseries a "A" 1');
    expect(setChartForm("", "pie")).toBe("pie\n");
  });

  it("is idempotent, and every form round-trips", () => {
    for (const form of FORMS) {
      const once = setChartForm(BODY, form);
      expect(setChartForm(once, form)).toBe(once);
      expect(parseChart(once).form).toBe(form);
    }
  });
});

describe("setChartFlag", () => {
  it("adds and removes on the form line, leaving the form standing", () => {
    const on = setChartFlag('bar\nseries a "A" 1', "stacked", true);
    expect(on).toBe('bar stacked\nseries a "A" 1');
    expect(setChartFlag(on, "stacked", false)).toBe('bar\nseries a "A" 1');
  });

  it("is idempotent in both directions", () => {
    const body = 'bar stacked\nseries a "A" 1';
    expect(setChartFlag(body, "stacked", true)).toBe(body);
    const off = setChartFlag(body, "horizontal", false);
    expect(off).toBe(body);
  });

  it("writes the default form when a flag is turned on without one", () => {
    expect(setChartFlag('series a "A" 1', "horizontal", true)).toBe('bar horizontal\nseries a "A" 1');
    /* And turning one off with no form line is nothing to do, not a line to invent. */
    expect(setChartFlag('series a "A" 1', "horizontal", false)).toBe('series a "A" 1');
  });

  it("keeps the author's trailing comment behind the flag", () => {
    expect(setChartFlag("bar  %% by quarter", "stacked", true)).toBe("bar stacked %% by quarter");
  });
});

describe("setChartOption", () => {
  const BODY = 'bar\nx Q1 Q2\nseries a "A" 1 2';

  it("writes a new option after the form line", () => {
    expect(setChartOption(BODY, "unit", "k€")).toBe('bar\nunit "k€"\nx Q1 Q2\nseries a "A" 1 2');
    expect(setChartOption(BODY, "max", 400)).toBe('bar\nmax 400\nx Q1 Q2\nseries a "A" 1 2');
    expect(setChartOption(BODY, "legend", "bottom")).toBe('bar\nlegend bottom\nx Q1 Q2\nseries a "A" 1 2');
    expect(setChartOption(BODY, "values", true)).toBe('bar\nvalues\nx Q1 Q2\nseries a "A" 1 2');
  });

  it("rewrites the one that is there, leaving the comment behind it", () => {
    const body = 'bar\nmax 400   %% headroom\nseries a "A" 1';
    expect(setChartOption(body, "max", 500)).toBe('bar\nmax 500   %% headroom\nseries a "A" 1');
  });

  it("removes the line when handed null", () => {
    const body = 'bar\nunit "k€"\nseries a "A" 1';
    expect(setChartOption(body, "unit", null)).toBe('bar\nseries a "A" 1');
    /* Removing one that was never there is nothing to do. */
    expect(setChartOption(body, "min", null)).toBe(body);
  });

  it("is idempotent, and what it wrote parses back", () => {
    for (const [key, value, read] of [
      ["legend", "right", "legendAt"],
      ["unit", "k€", "unit"],
      ["min", -20, "min"],
      ["max", 400, "max"],
    ] as const) {
      const once = setChartOption(BODY, key, value);
      expect(setChartOption(once, key, value)).toBe(once);
      expect(parseChart(once)[read]).toBe(value);
      expect(parseChart(once).diagnostics).toEqual([]);
    }
    const once = setChartOption(BODY, "values", true);
    expect(setChartOption(once, "values", true)).toBe(once);
    expect(parseChart(once).values).toBe(true);
    /* `false` is what a checkbox hands you, and it means the same as `null` here. */
    expect(setChartOption(once, "values", false)).toBe(BODY);
  });
});

describe("setCategories", () => {
  const BODY = 'bar\nx Q1 Q2\nseries a "A" 1 2';

  it("rewrites the x line, quoting only what would not read back as one word", () => {
    expect(setCategories(BODY, ["Jan", "Feb 24", "Mar"])).toBe('bar\nx Jan "Feb 24" Mar\nseries a "A" 1 2');
  });

  it("writes the x line after the form when there is none", () => {
    expect(setCategories('bar\nseries a "A" 1', ["Q1"])).toBe('bar\nx Q1\nseries a "A" 1');
    expect(setCategories('series a "A" 1', ["Q1"])).toBe('x Q1\nseries a "A" 1');
  });

  it("takes the line away when handed nothing", () => {
    expect(setCategories(BODY, [])).toBe('bar\nseries a "A" 1 2');
    expect(setCategories('bar\nseries a "A" 1', [])).toBe('bar\nseries a "A" 1');
  });

  it("is idempotent, and round-trips through the parser", () => {
    const labels = ["Q1", "Feb 24", "-"];
    const once = setCategories(BODY, labels);
    expect(setCategories(once, labels)).toBe(once);
    expect(parseChart(once).categories).toEqual(labels);
  });
});

describe("a chart on a board", () => {
  const BOARD = `\`\`\`chart {#rev}
bar
x Q1 Q2
series web "Web" 120 140
slice one "One" 9
\`\`\`

\`\`\`md {#note}
Beside it.
\`\`\`

\`\`\`edges {#e}
note --> rev.web
note --> rev.one
\`\`\`
`;

  it("is an item, and a link reaches one of its series or slices", () => {
    const board = parseBoard("t", BOARD);
    expect(board.errors.map((e) => e.code)).toEqual([]);
    expect(board.items.find((i) => i.id === "rev")?.type).toBe("chart");
    expect(board.links.map((l) => [l.from.item, l.to.item, l.to.node])).toEqual([
      ["note", "rev", "web"],
      ["note", "rev", "one"],
    ]);
  });

  it("reports a link into a series the chart does not declare", () => {
    const board = parseBoard("t", BOARD.replace("rev.one", "rev.nope"));
    expect(board.errors.map((e) => e.code)).toEqual(["EB_LINK_UNKNOWN_NODE"]);
  });
});

/* -------------------------------------------------------------------------- layout */

/**
 * The scale, the geometry and the labels.
 *
 * Three invariants carry most of the weight here, and each one is a defect that would otherwise be
 * invisible until somebody looked at a picture. **A mark stays inside the plot**, whatever the
 * author pinned the scale to. **A stacked segment's far edge is the running sum**, to the pixel,
 * because that is the only thing a stacked chart claims and rounding a bar's cap to the 8px grid
 * would quietly break it. And **no two labels overlap**, which is not luck: every label is offered
 * and the ones that would collide with a more load-bearing one are dropped.
 */

const T = theme as unknown as Theme;
const M = new TableMeasurer();
beforeAll(() => setMeasurer(M));

const BOX = { w: 480, h: 254 };
const run = (src: string, box = BOX): ChartPlaced => layoutChart(parseChart(src), box, T, M);

const overlaps = (a: Box, b: Box): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const inside = (a: Box, b: Box): boolean =>
  a.x >= b.x - 0.5 && a.y >= b.y - 0.5 && a.x + a.w <= b.x + b.w + 0.5 && a.y + a.h <= b.y + b.h + 0.5;

/**
 * The rectangle a label occupies, measured the way the layout measured it.
 *
 * The pairs below have to be the ones `layoutChart` uses — a token is exactly a size and a weight,
 * which is the whole reason a `ChartLabel` carries a name rather than a number. Measuring with a
 * different font here would report overlaps the layout never had, or miss the ones it did.
 */
const labelBox = (l: ChartLabel): Box => {
  const face: Record<ChartLabel["token"], [number, number]> = {
    tick: [T.type.chartTick, 400],
    category: [T.type.chartLabel, 400],
    value: [T.type.chartValue, 500],
    legend: [T.type.chartLegend, 400],
    hero: [l.size ?? T.type.chartHero, 600],
    heroLabel: [T.type.chartHeroLabel, 400],
  };
  const [size, weight] = face[l.token];
  const w = M.width(l.text, fontOf(T, size, weight));
  const h =
    l.token === "hero" ? (l.size ?? T.type.chartHero) : l.token === "heroLabel" ? T.type.chartHeroLabel : T.metric.chart.lineH;
  const x = l.anchor === "middle" ? l.x - w / 2 : l.anchor === "end" ? l.x - w : l.x;
  return { x, y: l.y - h / 2, w, h };
};

const GROUPED = `bar
x Q1 Q2 Q3 Q4
series web "Web" 120 140 160 180
series mob "Mobile" 40 60 90 130`;

const STACKED = `bar stacked
x Q1 Q2 Q3
series a "A" 10 20 30
series b "B" 5 15 5
series c "C" 20 5 10`;

const DONUT = `donut "1.2M" "users"
slice web "Web" 62
slice mob "Mobile" 28
slice oth "Other" 10`;

describe("layoutChart · the plane", () => {
  it("draws every bar inside the plot", () => {
    for (const src of [GROUPED, STACKED, `${GROUPED}\nhorizontal`.replace("bar\n", "bar horizontal\n"), `${GROUPED}\nmax 100`]) {
      const placed = run(src);
      expect(placed.bars.length).toBeGreaterThan(0);
      for (const b of placed.bars) expect(inside(b, placed.plot), `${b.id} in ${JSON.stringify(b)}`).toBe(true);
    }
  });

  it("keeps grouped bars apart, and none of them wider than barMaxW", () => {
    const placed = run(GROUPED);
    expect(placed.bars).toHaveLength(8);
    for (const b of placed.bars) expect(b.w).toBeLessThanOrEqual(T.metric.chart.barMaxW);
    for (let i = 0; i < placed.bars.length; i++) {
      for (let j = i + 1; j < placed.bars.length; j++) {
        const a = placed.bars[i]!;
        const b = placed.bars[j]!;
        expect(overlaps(a, b), `${a.id}@${a.cat} overlaps ${b.id}@${b.cat}`).toBe(false);
      }
    }
  });

  it("puts a stacked segment's far edge on the running sum", () => {
    const placed = run(STACKED);
    /* The scale, recovered from the plot and the axis rather than trusted: `0` sits at the bottom
       and the top tick at the top, which is enough to invert the mapping the layout used. */
    const zero = placed.plot.y + placed.plot.h;
    const top = placed.yAxis!.ticks.at(-1)!;
    const per = (zero - top.y1) / Number(top.label);

    for (const cat of [0, 1, 2]) {
      let sum = 0;
      for (const b of placed.bars.filter((x) => x.cat === cat)) {
        sum += b.value;
        expect(Math.abs(b.y - (zero - sum * per))).toBeLessThan(1);
      }
    }
  });

  it("separates stacked segments by fillGap and rounds only the cap", () => {
    const placed = run(STACKED);
    const first = placed.bars.filter((b) => b.cat === 0);
    expect(first.map((b) => b.round)).toEqual(["none", "none", "top"]);
    expect(first.at(-1)!.r).toBe(T.metric.chart.barRadius);
    /* Every segment above the bottom one gives up `fillGap` at its near end. */
    for (let i = 1; i < first.length; i++) {
      expect(first[i - 1]!.y - (first[i]!.y + first[i]!.h)).toBeCloseTo(T.metric.chart.fillGap, 5);
    }
  });

  it("pads a short series with a gap, and draws one bar fewer", () => {
    const placed = run(`bar\nx Q1 Q2 Q3 Q4\nseries a "A" 1 2 3`);
    expect(parseChart(`bar\nx Q1 Q2 Q3 Q4\nseries a "A" 1 2 3`).diagnostics.map((d) => d.code)).toEqual(["W_CHART_LENGTH"]);
    expect(placed.bars).toHaveLength(3);
    expect(placed.bars.map((b) => b.cat)).toEqual([0, 1, 2]);
  });

  it("transposes the plane rather than drawing a second chart", () => {
    const up = run(GROUPED);
    const side = run(GROUPED.replace("bar", "bar horizontal"));

    expect(side.bars).toHaveLength(up.bars.length);
    expect(side.bars.map((b) => `${b.id}@${b.cat}`)).toEqual(up.bars.map((b) => `${b.id}@${b.cat}`));
    /* Thickness is the category axis and length is the value axis, so the two swap. */
    for (const b of side.bars) expect(b.h).toBeLessThanOrEqual(T.metric.chart.barMaxW);
    const len = (b: Bar, horizontal: boolean) => (horizontal ? b.w : b.h);
    const ratio = (bars: Bar[], horizontal: boolean) => len(bars[7]!, horizontal) / len(bars[0]!, horizontal);
    expect(ratio(side.bars, true)).toBeCloseTo(ratio(up.bars, false), 6);

    expect(up.yAxis!.kind).toBe("value");
    expect(up.xAxis!.kind).toBe("category");
    expect(side.xAxis!.kind).toBe("value");
    expect(side.yAxis!.kind).toBe("category");
    expect(side.xAxis!.side).toBe("bottom");
    expect(side.yAxis!.side).toBe("left");
  });

  it("opens a gap in a line rather than drawing through it, and marks its points", () => {
    const placed = run(`line\nx a b c d\nseries s "S" 5 - 9 4`);
    expect(placed.lines).toHaveLength(1);
    const line = placed.lines[0]!;
    expect(line.points.map((p) => p.cat)).toEqual([0, 2, 3]);
    expect(line.d.match(/M /g)).toHaveLength(2);
    expect(line.markers).toHaveLength(3);
  });

  it("drops the markers once there are more points than markerMax", () => {
    const many = Array.from({ length: T.metric.chart.markerMax + 1 }, (_, i) => i + 1).join(" ");
    const placed = run(`line\nseries s "S" ${many}`);
    expect(placed.lines[0]!.points).toHaveLength(T.metric.chart.markerMax + 1);
    expect(placed.lines[0]!.markers).toEqual([]);
  });
});

describe("a chart the scale cannot be drawn with (#9)", () => {
  /* Each of these once hung the page: past one unit in the last place, `v += step` gave `v` back,
     and the loop laying out the ticks never ended. */
  it("refuses a value, a min or a max past CHART_LARGEST, and keeps the value as a gap", () => {
    const model = parseChart(`bar\nx A B\nseries a "A" 1e308 -1e308\nseries b "B" 5 1e16`);
    // One per word, as `E_CHART_VALUE` is.
    expect(codes(`bar\nx A B\nseries a "A" 1e308 -1e308\nseries b "B" 5 1e16`)).toEqual([
      "3:E_CHART_RANGE",
      "3:E_CHART_RANGE",
      "4:E_CHART_RANGE",
    ]);
    expect(model.series.map((s) => s.values)).toEqual([
      [null, null],
      [5, null],
    ]);
    const pinned = parseChart(`line\nseries a "A" 1 2\nmin -1e300\nmax 1e300`);
    expect(pinned.diagnostics.map((d) => [d.line, d.code])).toEqual([
      [3, "E_CHART_RANGE"],
      [4, "E_CHART_RANGE"],
    ]);
    expect([pinned.min, pinned.max]).toEqual([undefined, undefined]);
    // The edge itself is a number like any other.
    expect(codes(`bar\nseries a "A" 1e15 -1e15`)).toEqual([]);
  });

  it("refuses a pinned span too narrow for its magnitude, and drops the pins", () => {
    const model = parseChart(
      `line\nx A B\nseries a "A" 100000000000000 100000000000000.01\nmin 100000000000000\nmax 100000000000000.01`,
    );
    expect(model.diagnostics.map((d) => [d.line, d.code])).toEqual([[4, "E_CHART_RANGE"]]);
    expect([model.min, model.max]).toEqual([undefined, undefined]);
    // A min alone is narrow against the values it leaves to set the top.
    expect(codes(`line\nseries a "A" 100000000000000.01\nmin 100000000000000`)).toEqual(["3:E_CHART_RANGE"]);
    // Narrow by the same amount at an ordinary magnitude is an ordinary chart.
    expect(codes(`line\nseries a "A" 1 1.01\nmin 1\nmax 1.01`)).toEqual([]);
  });

  it("draws what is left of such a chart, and draws it at once", () => {
    for (const src of [
      `line\nx A B\nseries a "A" 10000000000000000 10000000000000002\nmin 10000000000000000\nmax 10000000000000002`,
      `bar\nx A B\nseries a "A" 1e308 -1e308`,
      `line\nx A B\nseries a "A" 100000000000000 100000000000000.01\nmin 100000000000000\nmax 100000000000000.01`,
    ]) {
      const t = performance.now();
      const placed = run(src);
      expect(performance.now() - t).toBeLessThan(1000);
      expect(placed.yAxis!.ticks.length).toBeLessThanOrEqual(T.metric.chart.maxTicks);
    }
  });

  it("never lays out more ticks than the budget, whatever it is handed", () => {
    for (const [lo, hi, pinLo, pinHi] of [
      [1e16, 1e16 + 2, true, true],
      [-1e308, 1e308, false, false],
      [1e14, 1e14 + 0.01, true, true],
      [0, Number.POSITIVE_INFINITY, false, false],
    ] as const) {
      const s = niceScale(lo, hi, T.metric.chart.maxTicks, pinLo, pinHi);
      expect(s.ticks.length).toBeLessThanOrEqual(T.metric.chart.maxTicks);
      for (const v of [s.lo, s.hi, ...s.ticks]) expect(Number.isFinite(v)).toBe(true);
    }
  });
});

describe("layoutChart · the scale", () => {
  it("counts in ones, twos and fives and stops at maxTicks", () => {
    for (const [lo, hi] of [
      [0, 180],
      [0, 7],
      [0, 1_240_000],
      [-30, 90],
      [0, 0.4],
    ] as const) {
      const s = niceScale(lo, hi, T.metric.chart.maxTicks, false, false);
      expect(s.ticks.length).toBeLessThanOrEqual(T.metric.chart.maxTicks);
      expect(s.ticks.length).toBeGreaterThan(1);
      for (let i = 1; i < s.ticks.length; i++) expect(s.ticks[i]!).toBeGreaterThan(s.ticks[i - 1]!);
      expect(s.lo).toBeLessThanOrEqual(lo);
      expect(s.hi).toBeGreaterThanOrEqual(hi);
    }
  });

  it("puts zero in the domain of a bar chart, and of anything stacked", () => {
    expect(run(`bar\nseries a "A" 40 60 90`).yAxis!.ticks.map((t) => t.label)).toContain("0");
    expect(run(`line stacked\nseries a "A" 40 60\nseries b "B" 30 20`).yAxis!.ticks.map((t) => t.label)).toContain("0");
  });

  it("lets a line float, but only when a min is written", () => {
    expect(run(`line\nseries a "A" 40 60 90`).yAxis!.ticks.map((t) => t.label)).toContain("0");
    /* The pin wins over the zero rule — a `min` that changed nothing would be a control that lies.
       The ticks inside a pinned domain stay round, so the floor itself need not be one of them. */
    const floated = run(`line\nseries a "A" 40 60 90\nmin 30`);
    expect(floated.yAxis!.ticks.map((t) => t.label)).not.toContain("0");
    expect(Number(floated.yAxis!.ticks[0]!.label)).toBeGreaterThanOrEqual(30);
    expect(run(`bar\nseries a "A" 40 60 90\nmin 30`).yAxis!.ticks.map((t) => t.label)).not.toContain("0");
  });

  it("keeps a pinned ceiling exactly, and formats compactly with the unit", () => {
    const placed = run(`bar\nseries a "A" 120 900\nmax 1000\nunit "€"`);
    expect(placed.yAxis!.ticks.at(-1)!.label).toBe("1k€");
    expect(placed.yAxis!.ticks.map((t) => t.label)).toEqual(["0€", "200€", "400€", "600€", "800€", "1k€"]);
    expect(run(`bar\nseries a "A" 3400000`).yAxis!.ticks.at(-1)!.label).toBe("4M");
  });

  it("runs its ticks monotonically down the left and along the bottom", () => {
    const up = run(GROUPED).yAxis!.ticks;
    for (let i = 1; i < up.length; i++) expect(up[i]!.x).toBeLessThan(up[i - 1]!.x);
    const side = run(GROUPED.replace("bar", "bar horizontal")).xAxis!.ticks;
    for (let i = 1; i < side.length; i++) expect(side[i]!.x).toBeGreaterThan(side[i - 1]!.x);
  });
});

describe("layoutChart · pie and donut", () => {
  it("turns the whole circle, in declaration order", () => {
    const placed = run(DONUT);
    expect(placed.slices.map((w) => w.id)).toEqual(["web", "mob", "oth"]);
    expect(placed.slices.reduce((a, w) => a + (w.a1 - w.a0), 0)).toBeCloseTo(Math.PI * 2, 9);
    expect(placed.slices[0]!.a0).toBeCloseTo(-Math.PI / 2, 9);
    for (let i = 1; i < placed.slices.length; i++) expect(placed.slices[i]!.a0).toBeCloseTo(placed.slices[i - 1]!.a1, 9);
    expect(placed.slices.map((w) => w.pct)).toEqual([0.62, 0.28, 0.1]);
    for (const w of placed.slices) expect(w.d.startsWith("M ")).toBe(true);
  });

  it("reads a series as one wedge worth its own total, and a slice as one bar", () => {
    const wedges = run(`pie\nseries web "Web" 10 20 30\nseries mob "Mobile" 40`).slices;
    expect(wedges.map((w) => [w.id, w.value])).toEqual([
      ["web", 60],
      ["mob", 40],
    ]);
    const bars = run(`bar\nslice a "A" 3\nslice b "B" 4`).bars;
    expect(bars.map((b) => [b.id, b.cat, b.value])).toEqual([
      ["a", 0, 3],
      ["b", 1, 4],
    ]);
  });

  it("takes a label outside on a leader when the wedge is too narrow for it", () => {
    const placed = run(`pie\nslice big "Big" 90\nslice a "A" 5\nslice b "B" 5`);
    expect(placed.slices.map((w) => Boolean(w.leader))).toEqual([false, true, true]);
    /* Outside, the line points at a bare number unless the name comes with it. */
    const out = placed.labels.filter((l) => l.token === "value" && (l.of === "a" || l.of === "b")).map((l) => l.text);
    expect(out).toEqual(["A 5%", "B 5%"]);
    for (const l of placed.labels.filter((l) => l.token === "value")) {
      expect(l.x).toBeGreaterThanOrEqual(0);
      expect(l.x).toBeLessThanOrEqual(placed.size.w);
      expect(l.y).toBeGreaterThanOrEqual(0);
      expect(l.y).toBeLessThanOrEqual(placed.size.h);
    }
  });

  it("leaves a sliver unlabelled rather than drawing a label nobody can read", () => {
    const placed = run(`pie\nslice big "Big" 99\nslice tiny "Tiny" 1`);
    const shares = placed.labels.filter((l) => l.token === "value").map((l) => l.of);
    expect(shares).toContain("big");
    expect(shares).not.toContain("tiny");
  });

  it("sizes the hero to the hole, and only a donut has one", () => {
    const placed = run(DONUT);
    expect(placed.hero).toBeDefined();
    expect(placed.hero!.size).toBeLessThanOrEqual(T.type.chartHero);
    expect(placed.labels.filter((l) => l.token === "hero" || l.token === "heroLabel").map((l) => l.text)).toEqual([
      "1.2M",
      "users",
    ]);
    /* A wide value in a small donut shrinks rather than spilling out of the ring. */
    const tight = run(`donut "1,284,993,001"\nslice a "A" 1\nslice b "B" 1`, { w: 240, h: 160 });
    expect(tight.hero!.size).toBeLessThan(T.type.chartHero);
    expect(run(`pie "1.2M"\nslice a "A" 1`).hero).toBeUndefined();
  });
});

describe("layoutChart · what it says, and where", () => {
  it("never lets two labels overlap, on any of the four forms", () => {
    const boards = [
      GROUPED,
      `${STACKED}\nvalues\nunit "k"`,
      GROUPED.replace("bar", "bar horizontal") + "\nvalues",
      `line\nx a b c d e f\nseries s "S" 5 8 2 9 4 7\nseries t "T" 1 2 3 4 5 6\nvalues`,
      DONUT,
      `pie\nslice a "Alpha" 30\nslice b "Beta" 25\nslice c "Gamma" 20\nslice d "Delta" 15\nslice e "Epsilon" 10`,
    ];
    for (const src of boards) {
      const placed = run(src);
      expect(placed.labels.length).toBeGreaterThan(0);
      const boxes = placed.labels.map(labelBox);
      for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
          const a = placed.labels[i]!;
          const b = placed.labels[j]!;
          expect(overlaps(boxes[i]!, boxes[j]!), `"${a.text}" (${a.token}) overlaps "${b.text}" (${b.token})`).toBe(false);
        }
      }
    }
  });

  it("keeps the legend inside the chart's own box, whichever side it takes", () => {
    for (const at of ["right", "bottom"] as const) {
      const placed = run(`${GROUPED}\nlegend ${at}`);
      expect(placed.legend!.at).toBe(at);
      expect(inside(placed.legend!, { x: 0, y: 0, w: placed.size.w, h: placed.size.h })).toBe(true);
      for (const row of placed.legend!.rows) expect(inside(row.swatch, placed.legend!)).toBe(true);
    }
  });

  it("draws a legend for two things and none for one — a pie's slices included", () => {
    expect(run(`bar\nseries a "A" 1 2`).legend).toBeUndefined();
    expect(run(GROUPED).legend!.at).toBe("right");
    expect(run(`pie\nslice a "A" 1`).legend).toBeUndefined();
    expect(run(DONUT).legend!.rows.map((r) => r.id)).toEqual(["web", "mob", "oth"]);
    expect(run(`${GROUPED}\nlegend none`).legend).toBeUndefined();
    /* A slice is a category in a bar chart, labelled on the axis, so it is not a legend row. */
    expect(run(`bar\nslice a "A" 1\nslice b "B" 2`).legend).toBeUndefined();
  });

  it("writes a value beside a mark only when asked", () => {
    expect(run(GROUPED).labels.some((l) => l.token === "value")).toBe(false);
    const asked = run(`${GROUPED}\nvalues`);
    expect(asked.labels.filter((l) => l.token === "value").length).toBeGreaterThan(0);
    /* A pie labels its wedges whether or not anybody asked — that is what a percentage is for. */
    expect(
      run(DONUT)
        .labels.filter((l) => l.token === "value")
        .map((l) => l.text),
    ).toEqual(["62%", "28%", "10%"]);
    expect(
      run(`${DONUT}\nvalues`)
        .labels.filter((l) => l.token === "value")
        .map((l) => l.text),
    ).toEqual(["62", "28", "10"]);
  });

  it("puts a box round each series' marks, so a link can land on one", () => {
    const placed = run(GROUPED);
    expect(Object.keys(placed.nodes).sort()).toEqual(["mob", "web"]);
    for (const b of placed.bars) expect(inside(b, placed.nodes[b.id]!)).toBe(true);
    const pie = run(DONUT);
    expect(Object.keys(pie.nodes).sort()).toEqual(["mob", "oth", "web"]);
    for (const box of Object.values(pie.nodes)) expect(inside(box, pie.plot)).toBe(true);
  });
});

describe("layoutChart · colour is the theme's", () => {
  it("assigns chartHues in declaration order, counting only the unhued", () => {
    const placed = run(`bar\nseries a "A" 1\nseries b "B" 2 hue=teal\nseries c "C" 3`);
    expect(placed.hues).toEqual({ a: T.color.chartHues[0], b: "teal", c: T.color.chartHues[1] });
  });

  it("runs out rather than cycling, and says so at the parse", () => {
    const eight = Array.from({ length: 8 }, (_, i) => `series s${i} "S${i}" ${i + 1}`).join("\n");
    const placed = run(`bar\n${eight}`);
    expect(Object.values(placed.hues).slice(0, T.color.chartHues.length)).toEqual(T.color.chartHues);
    expect(placed.hues.s7).toBeNull();
    expect(parseChart(`bar\n${eight}`).diagnostics.map((d) => d.code)).toEqual(["W_CHART_MANY"]);
  });

  it("holds every theme to the same chart metrics, so a layout survives a theme switch", () => {
    const themes = [T, neutral as unknown as Theme, dark as unknown as Theme];
    const shape = (t: Theme) =>
      JSON.stringify([
        t.metric.chart,
        t.type.chartTick,
        t.type.chartLabel,
        t.type.chartValue,
        t.type.chartLegend,
        t.type.chartHero,
        t.type.chartHeroLabel,
        t.color.chartHues,
      ]);
    expect(new Set(themes.map(shape)).size).toBe(1);
    expect(T.color.chartHues.length).toBeLessThanOrEqual(CHART_HUES_MAX);
    for (const hue of T.color.chartHues) expect(Object.keys(T.color.hues)).toContain(hue);
  });
});

describe("the layout cache knows a chart's box", () => {
  it("keys on the box, because a chart's size is the author's and is not in the hash", () => {
    expect(layoutKey("h", T, { w: 560, h: 320 })).not.toBe(layoutKey("h", T, { w: 800, h: 320 }));
    expect(layoutKey("h", T, { w: 560, h: 320 })).not.toBe(layoutKey("h", T, { w: 560, h: 400 }));
    expect(layoutKey("h", T, { w: 560, h: 320 })).toBe(layoutKey("h", T, { w: 560, h: 320 }));
    /* Everything else is unchanged: a graph item passes no box and keys exactly as it always did. */
    expect(layoutKey("h", T)).not.toBe(layoutKey("h", T, { w: 560, h: 320 }));
  });

  it("actually redraws at the new width", () => {
    const wide = run(GROUPED, { w: 800, h: 254 });
    expect(wide.plot.w).toBeGreaterThan(run(GROUPED).plot.w);
    expect(wide.size).toEqual({ w: 800, h: 254 });
  });
});

/**
 * The whole answer, frozen.
 *
 * The invariants above say a bar is inside the plot and a label does not collide; they say nothing
 * about the drawing being the *same* drawing tomorrow. This does, and it is the only thing that
 * will catch a metric quietly changing meaning or a margin growing by six pixels.
 *
 * `UPDATE_GOLDEN=1 npx vitest run test/chart.test.ts` rewrites it. Read the diff.
 */
const GOLDEN = path.resolve(__dirname, "__golden__/chart-layout.txt");

function dump(name: string, placed: ChartPlaced): string {
  const round = (v: unknown): unknown =>
    typeof v === "number"
      ? Math.round(v * 100) / 100
      : Array.isArray(v)
        ? v.map(round)
        : v && typeof v === "object"
          ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, round(x)]))
          : v;
  return `## ${name}\n${JSON.stringify(round(placed), null, 1)}\n`;
}

describe("a chart's whole layout", () => {
  it("matches the golden", () => {
    const got = `${dump("grouped bar", run(GROUPED))}\n${dump("donut with a hero", run(DONUT))}`;
    if (process.env.UPDATE_GOLDEN === "1") {
      fs.writeFileSync(GOLDEN, got);
      return;
    }
    expect(fs.existsSync(GOLDEN), `${GOLDEN} is missing — run with UPDATE_GOLDEN=1`).toBe(true);
    expect(got).toBe(fs.readFileSync(GOLDEN, "utf8"));
  });
});
