import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { DiagramType } from "@/dsl/ir";
import { parseDiagram } from "@/dsl/parse";
import { layoutGraph } from "@/layout/elk";
import { fontOf, getMeasurer, setMeasurer, TableMeasurer, type TextMeasurer } from "@/layout/measure";
import { sizeGraph, sizeLabels, sizeNode } from "@/layout/size";
import { overlaps } from "@/quality/geometry";
import { scoreGraph } from "@/quality/score";
import type { Theme } from "@/theme/contract";
import paper from "../themes/paper/theme.json";
import neutral from "../themes/neutral/theme.json";
import paperDark from "../themes/paper-dark/theme.json";

const T = paper as unknown as Theme;
const THEMES = { paper, neutral, "paper-dark": paperDark } as unknown as Record<string, Theme>;

/* The unit suite shares modules between files (`isolate: false`), so the measurer goes back. */
let before: TextMeasurer;
beforeAll(() => {
  before = getMeasurer();
  setMeasurer(new TableMeasurer());
});
afterAll(() => setMeasurer(before));

const LONG =
  "A step whose title is much longer than the card is wide, so it wraps onto more than one line and then some more words after that";

const sized = (type: DiagramType, src: string, id: string, theme = T) => {
  const g = parseDiagram(type, src)!;
  return sizeNode(g.nodes.find((n) => n.id === id)!, theme, type);
};

/** How many lines the title wraps to inside the card's content box, by the same measurer. */
const linesOf = (title: string, w: number, theme = T) =>
  getMeasurer().lines(
    title,
    fontOf(theme, theme.type.stepTitle, 600),
    w - (theme.metric.node.stepPadX + theme.metric.line.hair) * 2,
  );

/*
 * #406: a flow `step` and an activity `action` were a fixed `stepH` tall whatever their title said.
 * The title wraps and the card is `overflow: hidden`, so the third line onwards was cut off
 * mid-sentence with no diagnostic and no quality finding. The card grows by one title leading per
 * line past the `stepTitleLines` that `stepH` is drawn for.
 */
describe("a step's height follows its wrapped title", () => {
  const leading = T.type.stepTitle * T.type.stepTitleLeading;

  it.each([
    ["flow", "step"],
    ["activity", "action"],
  ] as const)("%s: a one-line title keeps the card at stepH", (type, kw) => {
    expect(sized(type, `${kw} a "Upload a CV"`, "a").h).toBe(T.metric.node.stepH);
  });

  it("keeps two lines at stepH, which is what the reference workflow board draws", () => {
    const s = sized("flow", 'step a "Store the raw file somewhere safe" "minio · original"', "a");
    expect(linesOf("Store the raw file somewhere safe", s.w)).toBe(2);
    expect(s.h).toBe(T.metric.node.stepH);
  });

  it.each([
    ["flow", "step", ' "kubectl apply"'],
    ["flow", "step", ""],
    ["activity", "action", ""],
  ] as const)("%s %s%s: a long title grows the card a leading per extra line", (type, kw, meta) => {
    const s = sized(type, `${kw} a "${LONG}"${meta}`, "a");
    const lines = linesOf(LONG, s.w);
    expect(lines).toBeGreaterThan(T.metric.node.stepTitleLines);
    expect(s.h).toBe(Math.ceil(T.metric.node.stepH + (lines - T.metric.node.stepTitleLines) * leading));
  });

  it("grows in every theme", () => {
    for (const [name, theme] of Object.entries(THEMES)) {
      const s = sized("flow", `step a "${LONG}"`, "a", theme);
      expect(s.h, name).toBeGreaterThan(theme.metric.node.stepH);
    }
  });

  it("wraps at the card's width: a wider card is shorter", () => {
    const narrow = sized("flow", `step a "${LONG}"`, "a");
    const wide = sized("flow", `step a "${LONG}" w=400`, "a");
    expect(wide.w).toBe(400);
    expect(wide.h).toBeLessThan(narrow.h);
  });

  it("still treats h= as a minimum", () => {
    expect(sized("flow", `step a "${LONG}" h=400`, "a").h).toBe(400);
    expect(sized("flow", `step a "${LONG}" h=40`, "a").h).toBe(sized("flow", `step a "${LONG}"`, "a").h);
  });

  /* The sizer's leading is only right if the drawing uses it: one token, read by both. */
  it("draws the title at the leading the sizer grows by", () => {
    const css = fs.readFileSync(path.resolve(__dirname, "../src/styles/nodes.css"), "utf8");
    const rule = /\.dag-step__title \{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(rule).toContain("line-height: var(--dag-type-stepTitleLeading)");
  });
});

describe("a tall step in a laid-out flow", () => {
  const src = `
lane a "A" {
  step s1 "${LONG}" "kubectl apply"
  step s3 "Ship"
}
lane b "B" {
  step s2 "Short"
  step s4 "Also short"
}
s1 --> s2 --> s3 --> s4
`;

  it("is placed at its grown height and overlaps nothing", async () => {
    const g = parseDiagram("flow", src)!;
    const sizes = sizeGraph(g, T);
    const labels = sizeLabels(g, T);
    const placed = await layoutGraph(g, sizes, labels, T.metric);
    expect(sizes["s1"]!.h).toBeGreaterThan(T.metric.node.stepH);
    expect(placed.nodes["s1"]!.h).toBe(sizes["s1"]!.h);

    const boxes = Object.values(placed.nodes);
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++) expect(overlaps(boxes[i]!, boxes[j]!)).toBe(false);
    expect(scoreGraph(g, placed, labels, T).totals.nodeOverlaps).toBe(0);
  });
});
