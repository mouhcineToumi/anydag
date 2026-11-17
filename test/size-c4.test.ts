import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { parseDiagram } from "@/dsl/parse";
import { layoutGraph } from "@/layout/elk";
import { fontOf, getMeasurer, setMeasurer, TableMeasurer, type TextMeasurer } from "@/layout/measure";
import { sizeGraph, sizeLabels, sizeNode } from "@/layout/size";
import { overlaps } from "@/quality/geometry";
import { scoreGraph } from "@/quality/score";
import type { Theme } from "@/theme/contract";
import neutral from "../themes/neutral/theme.json";
import paper from "../themes/paper/theme.json";
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

/* The issue's own shape: a ~75-character name, a short description, a card `c4W` wide. */
const LONG = "An analyst who reviews every supplier contract before it is signed";

const sized = (src: string, id: string, theme = T) => {
  const g = parseDiagram("c4", src)!;
  return sizeNode(g.nodes.find((n) => n.id === id)!, theme, "c4");
};

/** The name's wrap width: the card's content box, less its border, the tile and the gap beside it. */
const nameWidth = (w: number, theme = T) =>
  w - theme.metric.node.c4PadX * 2 - theme.metric.line.hair * 2 - theme.metric.tile.sizeC4 - theme.metric.node.c4HeadGap;

const nameLines = (title: string, w: number, theme = T) =>
  getMeasurer().lines(title, fontOf(theme, theme.type.c4Name, 600), nameWidth(w, theme));

const descLines = (desc: string, w: number, theme = T) =>
  getMeasurer().lines(desc, fontOf(theme, theme.type.c4Desc), w - theme.metric.node.c4PadX * 2);

const descLeading = (theme = T) => Math.round(theme.type.c4Desc * theme.type.c4DescLeading);

/** The height the card had before #409: the head counted as the icon tile, whatever the name did. */
const tileHead = (lines: number, theme = T) =>
  theme.metric.node.c4Pad * 2 +
  theme.metric.tile.sizeC4 +
  theme.metric.node.c4Gap +
  theme.type.c4Type +
  theme.metric.node.c4Gap +
  lines * descLeading(theme);

/* The four kinds a `c4` fence draws as a C4 card, with a short name. */
const SHORT = [
  ["person", 'person p "Analyst" "Reads contracts."', "p", "Analyst", "Reads contracts."],
  ["extsystem", 'extsystem e "Firebase Auth" "Signs learners in."', "e", "Firebase Auth", "Signs learners in."],
  ["container", 'system s "S" {\ncontainer c "Web app" "React" "Serves the tree."\n}', "c", "Web app", "Serves the tree."],
  ["db", 'system s "S" {\ndb d "Database" "Firestore" "Holds tracks."\n}', "d", "Database", "Holds tracks."],
] as const;

/*
 * #409: a C4 card was sized with one name line — the icon tile's height — while `.dag-c4__name`
 * wraps. A three-line name drew the card taller than its box, and `overflow: hidden` cut the last
 * line of the name in half and pushed the description out of the card entirely. The head is now
 * whichever of the tile and the wrapped name is taller.
 */
describe("a C4 card's height follows its wrapped name", () => {
  it.each([
    ["person", `person p "${LONG}" "Reads contracts."`, "p", "Reads contracts."],
    ["extsystem", `extsystem e "${LONG}" "Checks a vendor."`, "e", "Checks a vendor."],
    ["container", `system s "S" "software system" {\ncontainer c "${LONG}" "Next.js" "Takes it."\n}`, "c", "Takes it."],
    ["db", `system s "S" "software system" {\ndb d "${LONG}" "Object store" "Keeps it."\n}`, "d", "Keeps it."],
  ] as const)("%s: grows by the name's lines past the icon tile", (_kind, src, id, desc) => {
    const s = sized(src, id);
    const lines = nameLines(LONG, s.w);
    expect(lines).toBeGreaterThan(1);
    expect(s.h).toBe(tileHead(descLines(desc, s.w)) + (lines * T.type.c4Name * T.type.c4NameLeading - T.metric.tile.sizeC4));
    expect(s.h).toBeGreaterThan(tileHead(descLines(desc, s.w)));
  });

  it.each(SHORT)("%s: a one-line name keeps the card it always had", (_kind, src, id, title, desc) => {
    const s = sized(src, id);
    expect(nameLines(title, s.w)).toBe(1);
    expect(s.h).toBe(tileHead(descLines(desc, s.w)));
  });

  it("still counts the description's own lines under a wrapped name", () => {
    const one = "Reads contracts.";
    const more = "Reviews every supplier contract before it is signed by the team";
    const a = sized(`person p "${LONG}" "${one}"`, "p");
    const b = sized(`person p "${LONG}" "${more}"`, "p");
    expect(descLines(more, b.w) - descLines(one, a.w)).toBe(1);
    expect(b.h - a.h).toBe(descLeading());
  });

  it("wraps at the card's width: a wider card is shorter", () => {
    const narrow = sized(`person p "${LONG}" "Reads contracts."`, "p");
    const wide = sized(`person p "${LONG}" "Reads contracts." w=460`, "p");
    expect(wide.w).toBe(460);
    expect(nameLines(LONG, wide.w)).toBeLessThan(nameLines(LONG, narrow.w));
    expect(wide.h).toBeLessThan(narrow.h);
  });

  it("grows in every theme", () => {
    for (const [name, theme] of Object.entries(THEMES)) {
      const s = sized(`person p "${LONG}" "Reads contracts."`, "p", theme);
      expect(s.h, name).toBeGreaterThan(theme.metric.node.c4Pad * 2 + theme.metric.tile.sizeC4);
    }
  });

  it("still treats h= as a minimum", () => {
    const grown = sized(`person p "${LONG}" "Reads contracts."`, "p").h;
    expect(sized(`person p "${LONG}" "Reads contracts." h=500`, "p").h).toBe(500);
    expect(sized(`person p "${LONG}" "Reads contracts." h=20`, "p").h).toBe(grown);
  });

  /* The sizer's leading is only right if the drawing uses it: one token, read by both. */
  it("draws the name at the leading the sizer grows by", () => {
    const css = fs.readFileSync(path.resolve(__dirname, "../src/styles/nodes.css"), "utf8");
    const rule = /\.dag-c4__name \{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(rule).toContain("line-height: var(--dag-type-c4NameLeading)");
  });
});

describe("a tall C4 card in a laid-out diagram", () => {
  const src = `system s "S" "software system" {
  container c "${LONG}" "Next.js" "Takes the paperwork."
  db d "The immutable archive that keeps every submitted document for seven years" "Object store" "Keeps it."
}
person p "An analyst who reviews every supplier contract before it is signed" "Reads contracts."
p --> c "Uses" "HTTPS"
c --> d "Writes to" "S3"`;

  it("is placed at its grown height and overlaps nothing", async () => {
    const g = parseDiagram("c4", src)!;
    const sizes = sizeGraph(g, T);
    const labels = sizeLabels(g, T);
    const placed = await layoutGraph(g, sizes, labels, T.metric);
    expect(sizes["c"]!.h).toBeGreaterThan(tileHead(1));
    expect(placed.nodes["c"]!.h).toBe(sizes["c"]!.h);

    const boxes = Object.values(placed.nodes);
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++) expect(overlaps(boxes[i]!, boxes[j]!)).toBe(false);
    expect(scoreGraph(g, placed, labels, T).totals.nodeOverlaps).toBe(0);
  });
});
