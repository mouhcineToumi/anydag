/**
 * A table's problems as the page says them, and the writers that mend each: every diagnostic code a
 * person can reach is a sentence on the tab, column, row or cell it concerns, with a repair that
 * leaves the file without that problem and touches nothing else it did not mean to.
 */
import { describe, expect, it } from "vitest";

import { parseTable } from "../src/table/parse";
import { tableDiagnostics } from "../src/table/values";
import {
  closeFence,
  dropUnknownAttrs,
  reidColumn,
  reidRow,
  reidTab,
  removeStray,
  stampTable,
  strayOf,
  trimRow,
  widenToRow,
  wrapLooseTable,
} from "../src/table/write";
import { aboveGrid, countByTab, fixLabel, problemsOf, repair, said, type Fix, type Problem } from "../src/ui/table/problems";

const problems = (text: string): Problem[] => problemsOf(text, parseTable(text));
const codesOf = (text: string): string[] => tableDiagnostics(parseTable(text)).map((d) => d.code);
const only = (text: string, code: string): Problem => {
  const found = problems(text).filter((p) => p.code === code);
  expect(found, code).toHaveLength(1);
  return found[0]!;
};
/** The text a problem's first repair leaves, as the page writes it: ids given, then the repair. */
const mend = (text: string, p: Problem, which = 0): string => repair(stampTable(text), p, p.fixes[which]!);

const HEAD = "---\ntitle: T\n---\n\n";
const GRID = "| Name {#name} | Amount {#amount number} |\n| --- | ---: |\n| Acme {#ra} | 1 |\n| Globex {#rb} | 2 |\n";

describe("problems in words", () => {
  it("says nothing of an id still to be given, or of a table with no tabs: the page says those itself", () => {
    expect(problems(`${HEAD}## T\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n`)).toEqual([]);
    expect(codesOf(HEAD)).toEqual(["WT_EMPTY"]);
    expect(problems(HEAD)).toEqual([]);
  });

  it("puts a shared id on the tab, the column or the row that shares it", () => {
    const tabs = `${HEAD}## A {#t}\n\n${GRID}\n## B {#t}\n\n${GRID}`;
    const t = only(tabs, "ET_DUPLICATE_ID");
    expect(t.where).toEqual({ kind: "tab", tab: 1 });
    expect(t.words).toMatch(/^This tab shares its identity/);

    const cols = `${HEAD}## A {#a}\n\n| X {#x} | Y {#x} |\n| --- | --- |\n| 1 {#r1} | 2 |\n`;
    expect(only(cols, "ET_DUPLICATE_ID").where).toEqual({ kind: "column", tab: 0, column: 1 });

    const rows = `${HEAD}## A {#a}\n\n${GRID.replace("{#rb}", "{#ra}")}`;
    expect(only(rows, "ET_DUPLICATE_ID").where).toEqual({ kind: "row", tab: 0, row: 1 });
  });

  it("gives each of two shared column ids its own sentence, in order", () => {
    const text = `${HEAD}## A {#a}\n\n| X {#x} | Y {#x} | Z {#x} |\n| --- | --- | --- |\n| 1 {#r1} | 2 | 3 |\n`;
    const found = problems(text).filter((p) => p.code === "ET_DUPLICATE_ID");
    expect(found.map((p) => p.where)).toEqual([
      { kind: "column", tab: 0, column: 1 },
      { kind: "column", tab: 0, column: 2 },
    ]);
    expect(new Set(found.map((p) => p.key)).size).toBe(2);
  });

  it("names the unknown word on what carries it, and says a column's is not a type", () => {
    const text = `${HEAD}## A {#a colour=red}\n\n| X {#x numbr} | Y {#y h=3} |\n| --- | --- |\n| 1 {#r1} | 2 |\n`;
    const found = problems(text).filter((p) => p.code === "WT_UNKNOWN_ATTR");
    expect(found.map((p) => p.where)).toEqual([
      { kind: "tab", tab: 0 },
      { kind: "column", tab: 0, column: 0 },
      { kind: "column", tab: 0, column: 1 },
    ]);
    expect(found[0]!.words).toContain("“colour”");
    expect(found[1]!.words).toMatch(/“numbr” is not a column type/);
    expect(found[2]!.words).toContain("“h”");
  });

  it("puts a cell its column cannot read on the cell, with a fix for what the column is", () => {
    const text = `${HEAD}## A {#a}\n\n| Name {#n} | Stage {#s select options="Lead,Won"} | Due {#d date} |\n| --- | --- | --- |\n| Acme {#r1} | Lost | tomorrow |\n`;
    const found = problems(text).filter((p) => p.code === "WT_CELL");
    expect(found.map((p) => p.where)).toEqual([
      { kind: "cell", tab: 0, row: 0, column: 1 },
      { kind: "cell", tab: 0, row: 0, column: 2 },
    ]);
    expect(found[0]!.words).toBe("“Lost” is not one of the column's choices, which the column “Stage” holds.");
    expect(found[0]!.fixes.map((f) => f.kind)).toEqual(["add-option", "clear-cell", "make-text"]);
    expect(found[1]!.fixes.map((f) => f.kind)).toEqual(["clear-cell", "make-text"]);
  });

  it("counts a row's extra cells", () => {
    const text = `${HEAD}## A {#a}\n\n| X {#x} | Y {#y} |\n| --- | --- |\n| 1 {#r1} | 2 | 3 | 4 |\n`;
    const p = only(text, "WT_ROW_WIDTH");
    expect(p.where).toEqual({ kind: "row", tab: 0, row: 0 });
    expect(p.words).toBe("This row has 2 more cells than the table has columns, so they aren't shown.");
    expect(p.fixes.map((f) => f.kind)).toEqual(["widen", "trim-row"]);
  });

  it("says a sort or filter naming a column that went, and one that does not read, each as itself", () => {
    const text = `${HEAD}## A {#a sort="gone:desc, ???" filter="amount>1; nope; missing=3"}\n\n${GRID}`;
    const sorts = problems(text).filter((p) => p.code === "WT_BAD_SORT");
    expect(sorts.map((p) => p.words)).toEqual([
      "The sort “???” is not one the app can read.",
      "This tab is sorted by “gone”, a column it doesn't have.",
    ]);
    const filters = problems(text).filter((p) => p.code === "WT_BAD_FILTER");
    expect(filters.map((p) => p.words)).toEqual([
      "The filter “nope” is not one the app can read.",
      "This tab is filtered on “missing”, a column it doesn't have.",
    ]);
  });

  it("shows what text under a tab would be taken away, and says when no table can be read", () => {
    const stray = `${HEAD}## A {#a}\n\n${GRID}\nSome words under the table.\n`;
    const p = only(stray, "WT_STRAY");
    expect(p.words).toBe("There is text under this tab that is not part of its table, so it isn't shown.");
    expect(p.detail).toBe("Some words under the table.");
    const before = `${HEAD}## A {#a}\n\nWords first.\n\n${GRID}`;
    expect(only(before, "WT_STRAY").words).toMatch(/^There is no table under this tab/);
  });

  it("puts an open code block on its tab, or on the file above the first", () => {
    const inTab = `${HEAD}## A {#a}\n\n${GRID}\n\`\`\`\nnever closed\n`;
    expect(only(inTab, "WT_OPEN_FENCE").where).toEqual({ kind: "tab", tab: 0 });
    expect(only(`${HEAD}\`\`\`\nnever closed\n`, "WT_OPEN_FENCE").where).toEqual({ kind: "file" });
  });

  it("puts a table above the first tab on the file, and shows it above every tab's grid", () => {
    const text = `${HEAD}Words.\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n## T {#t}\n\n${GRID}`;
    const p = only(text, "WT_LOOSE_TABLE");
    expect(p.where).toEqual({ kind: "file" });
    expect(aboveGrid([p], 0)).toEqual([p]);
    expect(aboveGrid([p], 3)).toEqual([p]);
  });

  it("has a label for every fix", () => {
    const fixes: Fix[] = [
      { kind: "reid" },
      { kind: "clean" },
      { kind: "clear-cell" },
      { kind: "make-text" },
      { kind: "add-option", option: "Lost" },
      { kind: "trim-row" },
      { kind: "widen" },
      { kind: "drop-stray" },
      { kind: "fix-sort" },
      { kind: "fix-filter" },
      { kind: "close-fence", line: 1 },
      { kind: "wrap-table", line: 1 },
    ];
    for (const f of fixes) expect(fixLabel(f)).not.toBe("");
    expect(fixLabel({ kind: "add-option", option: "Lost" })).toBe("Add “Lost” to the choices");
  });

  it("is said by a switch: a diagnostic it does not know is not shown, not a crash", () => {
    const table = parseTable(`${HEAD}## A {#a}\n\n${GRID}`);
    expect(said("", table, { code: "WT_NO_ID", severity: "warning", line: 1, col: 1, message: "" }, 0)).toBeNull();
  });
});

describe("what mends each problem", () => {
  it("gives a shared tab, column or row an id of its own, and only that one", () => {
    const tabs = `${HEAD}## A {#t}\n\n${GRID}\n## B {#t}\n\n${GRID}`;
    const fixed = mend(tabs, only(tabs, "ET_DUPLICATE_ID"));
    expect(parseTable(fixed).tabs.map((t) => t.id)).toEqual(["t", "b"]);
    expect(codesOf(fixed)).toEqual([]);
    expect(fixed.startsWith(`${HEAD}## A {#t}\n\n${GRID}`)).toBe(true);

    const cols = `${HEAD}## A {#a}\n\n| X {#x} | Y {#x} |\n| --- | --- |\n| 1 {#r1} | 2 |\n`;
    const cfix = mend(cols, only(cols, "ET_DUPLICATE_ID"));
    expect(cfix).toContain("| X {#x} | Y {#y} |");
    expect(codesOf(cfix)).toEqual([]);

    const rows = `${HEAD}## A {#a}\n\n${GRID.replace("{#rb}", "{#ra}")}`;
    const rfix = mend(rows, only(rows, "ET_DUPLICATE_ID"));
    const ids = parseTable(rfix).tabs[0]!.rows.map((r) => r.id);
    expect(ids[0]).toBe("ra");
    expect(ids[1]).toMatch(/^r[0-9a-z]{5}$/);
    expect(rfix).toContain("| Acme {#ra} | 1 |");
    expect(codesOf(rfix)).toEqual([]);
  });

  it("leaves a repair alone when what it was for is no longer wrong", () => {
    const text = `${HEAD}## A {#a}\n\n${GRID}`;
    expect(reidTab(text, 0)).toBe(text);
    expect(reidColumn(text, 0, 1)).toBe(text);
    expect(reidRow(text, 0, 1)).toBe(text);
    expect(dropUnknownAttrs(text, 0)).toBe(text);
    expect(dropUnknownAttrs(text, 0, 1)).toBe(text);
    expect(trimRow(text, 0, 0)).toBe(text);
    expect(widenToRow(text, 0, 0)).toBe(text);
    expect(removeStray(text, 0)).toBe(text);
    expect(closeFence(text, 1)).toBe(text);
  });

  it("takes unknown words off the one heading or header cell, and keeps the rest", () => {
    const text = `${HEAD}## A {#a sort=x colour=red}\n\n| X {#x numbr w=90} | Y {#y} |\n| --- | --- |\n| 1 {#r1 h=40} | 2 |\n| 3 {#r2} | 4 |\n`;
    const all = problems(text).filter((p) => p.code === "WT_UNKNOWN_ATTR");
    let out = stampTable(text);
    for (const p of all) out = repair(out, p, { kind: "clean" });
    expect(out).toBe(
      `${HEAD}## A {#a sort=x}\n\n| X {#x w=90} | Y {#y} |\n| --- | --- |\n| 1 {#r1 h=40} | 2 |\n| 3 {#r2} | 4 |\n`,
    );
    expect(codesOf(out)).toEqual([]);
  });

  it("clears a cell, makes its column text, or adds the value to the choices", () => {
    const text = `${HEAD}## A {#a}\n\n| Name {#n} | Stage {#s select options="Lead,Won"} |\n| --- | --- |\n| Acme {#r1} | Lost |\n`;
    const p = only(text, "WT_CELL");
    expect(p.fixes.map((f) => f.kind)).toEqual(["add-option", "clear-cell", "make-text"]);
    expect(mend(text, p, 0)).toContain('{#s select options="Lead,Won,Lost"}');
    expect(mend(text, p, 1)).toContain("| Acme {#r1} | |");
    expect(mend(text, p, 2)).toContain("| Name {#n} | Stage {#s} |");
    for (const i of [0, 1, 2]) expect(codesOf(mend(text, p, i))).not.toContain("WT_CELL");
  });

  it("refuses a cell repair while two rows share an id, with a word, rather than writing to the first", () => {
    const text = `${HEAD}## A {#a}\n\n| N {#n} | M {#m number} |\n| --- | ---: |\n| a {#r} | x |\n| b {#r} | y |\n`;
    const p = problems(text).find((q) => q.code === "WT_CELL")!;
    expect(() => repair(text, p, { kind: "clear-cell" })).toThrow(/two rows share an id/);
  });

  it("drops a row's extra cells, or widens the table to keep them", () => {
    const text = `${HEAD}## A {#a}\n\n| X {#x} | Y {#y} |\n| --- | --- |\n| 1 {#r1} | 2 | 3 | 4 |\n| 5 {#r2} | 6 |\n`;
    const p = only(text, "WT_ROW_WIDTH");
    const trimmed = mend(text, p, 1);
    expect(trimmed).toBe(`${HEAD}## A {#a}\n\n| X {#x} | Y {#y} |\n| --- | --- |\n| 1 {#r1} | 2 |\n| 5 {#r2} | 6 |\n`);
    expect(codesOf(trimmed)).toEqual([]);

    const widened = mend(text, p, 0);
    const tab = parseTable(widened).tabs[0]!;
    expect(tab.columns.map((c) => c.name)).toEqual(["X", "Y", "Column 3", "Column 4"]);
    expect(tab.rows.map((r) => r.cells)).toEqual([
      ["1", "2", "3", "4"],
      ["5", "6", "", ""],
    ]);
    expect(codesOf(widened)).toEqual([]);
  });

  it("removes the text under a tab that is not its table, and what is above it when no table reads", () => {
    const text = `${HEAD}## A {#a}\n\n${GRID}\nStray words.\n\n## B {#b}\n\n${GRID}`;
    const p = only(text, "WT_STRAY");
    expect(mend(text, p)).toBe(`${HEAD}## A {#a}\n\n${GRID}\n## B {#b}\n\n${GRID}`);
    expect(strayOf(text, parseTable(text).tabs[0]!)).toBe("Stray words.");

    const noGrid = `${HEAD}## A {#a}\n\nJust words.\n`;
    expect(mend(noGrid, only(noGrid, "WT_STRAY"))).toBe(`${HEAD}## A {#a}\n`);
  });

  it("removes only the sort keys or filter rules that do not read", () => {
    const text = `${HEAD}## A {#a sort="gone, amount:desc" filter="nope; amount>1"}\n\n${GRID}`;
    const sorted = mend(text, problems(text).find((p) => p.code === "WT_BAD_SORT")!);
    expect(sorted).toContain('{#a sort="amount:desc" filter="nope; amount>1"}');
    const filtered = mend(text, problems(text).find((p) => p.code === "WT_BAD_FILTER")!);
    expect(filtered).toContain('{#a sort="gone, amount:desc" filter="amount>1"}');
    const both = repair(
      repair(stampTable(text), problems(text).find((p) => p.code === "WT_BAD_SORT")!, { kind: "fix-sort" }),
      problems(text).find((p) => p.code === "WT_BAD_FILTER")!,
      { kind: "fix-filter" },
    );
    expect(codesOf(both)).toEqual([]);
  });

  it("takes a sort or filter off when nothing in it reads", () => {
    const text = `${HEAD}## A {#a sort="gone" filter="???"}\n\n${GRID}`;
    const out = problems(text).reduce((t, p) => repair(t, p, p.fixes[0]!), stampTable(text));
    expect(out).toBe(`${HEAD}## A {#a}\n\n${GRID}`);
  });

  it("closes a code block before the tab it swallowed, or at the end", () => {
    const text = `${HEAD}## A {#a}\n\n${GRID}\n\`\`\`\nnever closed\n\n## B {#b}\n\n${GRID}`;
    expect(codesOf(text)).toContain("WT_OPEN_FENCE");
    const fixed = mend(text, only(text, "WT_OPEN_FENCE"));
    expect(codesOf(fixed)).toEqual(["WT_STRAY"]);
    expect(parseTable(fixed).tabs.map((t) => t.name)).toEqual(["A", "B"]);

    const atEnd = `${HEAD}~~~\nnever closed\n`;
    expect(closeFence(atEnd, 5)).toBe(`${HEAD}~~~\nnever closed\n~~~\n`);
  });

  it("puts a loose table in a tab of its own, with a blank line over the heading", () => {
    const text = `${HEAD}Words.\n\n| A | B |\n| - | - |\n| 1 | 2 |\n`;
    const p = only(text, "WT_LOOSE_TABLE");
    const fixed = mend(text, p);
    expect(fixed).toBe(`${HEAD}Words.\n\n## Tab 1\n\n| A | B |\n| - | - |\n| 1 | 2 |\n`);
    /* The tab has no id yet: the page's next write gives it one, as it does any tab. */
    expect(codesOf(fixed).every((c) => c === "WT_NO_ID")).toBe(true);

    const tight = `${HEAD}Words.\n| A | B |\n| - | - |\n| 1 | 2 |\n`;
    expect(wrapLooseTable(tight, 6)).toContain("Words.\n\n## Tab 1\n\n| A | B |");
    /* Past the first tab, a table is no longer loose. */
    const after = `${HEAD}## T {#t}\n\n${GRID}`;
    expect(wrapLooseTable(after, 7)).toBe(after);
  });
});

describe("what the tab strip counts", () => {
  it("counts the problems on each tab, and none for the file's own", () => {
    const text = `${HEAD}Words.\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n## A {#a sort="gone"}\n\n${GRID}\n## B {#b}\n\n${GRID}\n## C {#c}\n\n| X {#x} | Y {#y} |\n| --- | --- |\n| 1 {#r1} | 2 | 3 | 4 |\n| 5 {#r2} | 6 | 7 |\n`;
    const all = problems(text);
    expect(all.some((p) => p.where.kind === "file")).toBe(true);
    expect(countByTab(all, 3)).toEqual([1, 0, 2]);
    expect(countByTab([], 2)).toEqual([0, 0]);
  });

  it("counts a column's, a row's and a cell's problem on its tab", () => {
    const text = `${HEAD}## A {#a}\n\n| X {#x} | Y {#x number} |\n| --- | --- |\n| 1 {#r1} | lots |\n`;
    expect(
      problems(text)
        .map((p) => p.where.kind)
        .sort(),
    ).toEqual(["cell", "column"]);
    expect(countByTab(problems(text), 1)).toEqual([2]);
  });
});

describe("every problem shown is one the page can mend", () => {
  const FILES: Record<string, string> = {
    tabId: `${HEAD}## A {#t}\n\n${GRID}\n## B {#t}\n\n${GRID}`,
    columnId: `${HEAD}## A {#a}\n\n| X {#x} | Y {#x} |\n| --- | --- |\n| 1 {#r1} | 2 |\n`,
    rowId: `${HEAD}## A {#a}\n\n${GRID.replace("{#rb}", "{#ra}")}`,
    unknown: `${HEAD}## A {#a colour=red}\n\n| X {#x numbr} | Y {#y h=3} |\n| --- | --- |\n| 1 {#r1} | 2 |\n`,
    cell: `${HEAD}## A {#a}\n\n| Name {#n} | Stage {#s select options="Lead,Won"} | Due {#d date} | N {#m number} |\n| --- | --- | --- | --- |\n| Acme {#r1} | Lost | tomorrow | lots |\n`,
    width: `${HEAD}## A {#a}\n\n| X {#x} | Y {#y} |\n| --- | --- |\n| 1 {#r1} | 2 | 3 | 4 |\n`,
    stray: `${HEAD}## A {#a}\n\n${GRID}\nSome words under the table.\n`,
    noGrid: `${HEAD}## A {#a}\n\nJust words.\n`,
    sort: `${HEAD}## A {#a sort="gone:desc, ???"}\n\n${GRID}`,
    filter: `${HEAD}## A {#a filter="nope; missing=3"}\n\n${GRID}`,
    fence: `${HEAD}## A {#a}\n\n${GRID}\n\`\`\`\nnever closed\n`,
    fenceAbove: `${HEAD}\`\`\`\nnever closed\n`,
    loose: `${HEAD}Words.\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n## T {#t}\n\n${GRID}`,
  };
  const count = (text: string, code: string) => problems(text).filter((p) => p.code === code).length;

  it("has a button for it, and each button leaves one fewer of that kind", () => {
    const seen = new Set<string>();
    for (const [what, text] of Object.entries(FILES)) {
      const all = problems(text);
      expect(all.length, what).toBeGreaterThan(0);
      for (const p of all) {
        seen.add(p.code);
        expect(p.fixes.length, `${what}: ${p.code}`).toBeGreaterThan(0);
        for (const f of p.fixes) {
          const after = repair(stampTable(text), p, f);
          expect(count(after, p.code), `${what}: ${p.code} ${f.kind}`).toBeLessThan(count(text, p.code));
        }
      }
    }
    /* Every code the page shows was reached; the two it does not show are the page's own business. */
    expect([...seen].sort()).toEqual(
      [
        "ET_DUPLICATE_ID",
        "WT_BAD_FILTER",
        "WT_BAD_SORT",
        "WT_CELL",
        "WT_LOOSE_TABLE",
        "WT_OPEN_FENCE",
        "WT_ROW_WIDTH",
        "WT_STRAY",
        "WT_UNKNOWN_ATTR",
      ].sort(),
    );
  });
});
