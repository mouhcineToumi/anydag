import { describe, expect, it } from "vitest";

import { parseBoard } from "../src/board/parseBoard";
import type { BoardItem } from "../src/board/types";
import { parseItem } from "../src/dsl/diagnose";

import {
  addEdgeBody,
  addNodeBody,
  addRowBody,
  dupNodeBody,
  edgeOf,
  listDiagram,
  moveNodeBody,
  removeEdgeBody,
  removeNodeBody,
  removeRowBody,
  renameNodeBody,
  rowsOf,
  setChartBody,
  setEdgeBody,
  setNodeBody,
  setRowBody,
} from "../cli/inside";

/**
 * Reaching inside a diagram from a terminal: every writer here answers a new body, and every body
 * it answers has to be one the parser reads without an error — a writer that hands back a board
 * that does not parse is the one thing `restate.ts` says a writer may never do, and the CLI calls
 * the same writers, so it inherits the rule.
 */

const ARCH = `group gcp "Google Cloud" {
  service api "API" {
    identity "verify the id token"
  }
  store db "Database"
}
client web "Browser"

web --> api
api --> db`;

const CHART = `bar
x Q1 Q2 Q3
series web "Web" 1 2 3`;

function item(type: string, body: string, attrs = ""): BoardItem {
  const board = parseBoard("t", `\`\`\`${type} {#it${attrs ? ` ${attrs}` : ""}}\n${body}\n\`\`\`\n`);
  return board.items[0]!;
}

function clean(type: string, body: string): void {
  const errors = (parseItem({ type, body } as BoardItem)?.diagnostics ?? []).filter((d) => d.severity === "error");
  expect(errors, body).toEqual([]);
}

describe("a card's properties", () => {
  it("writes the panel's controls onto the one line, and nothing else", () => {
    const body = setNodeBody(item("arch", ARCH), "api", { title: "Orders", hue: "teal", status: "done", bold: true, icon: "server" });
    expect(body.split("\n")[1]).toBe('  service api "Orders" hue=teal done bold icon=server {');
    expect(body.split("\n").filter((l, i) => l !== ARCH.split("\n")[i])).toHaveLength(1);
    clean("arch", body);
  });

  it("takes one off with key=, and refuses a word the dialect does not have", () => {
    const on = setNodeBody(item("arch", ARCH), "api", { status: "done", bold: true });
    const off = setNodeBody(item("arch", on), "api", { status: null, bold: null });
    expect(off).toBe(ARCH);
    expect(() => setNodeBody(item("arch", ARCH), "api", { kind: "database" })).toThrow(/no kind/);
    expect(() => setNodeBody(item("arch", ARCH), "api", { hue: "purple" })).toThrow(/violet/);
    expect(() => setNodeBody(item("arch", ARCH), "apx", { title: "x" })).toThrow(/did you mean `api`/);
  });

  it("rewrites a chart series' numbers, with a gap", () => {
    const body = setNodeBody(item("chart", CHART), "web", { values: "4 - 6" });
    expect(body).toContain('series web "Web" 4 - 6');
    clean("chart", body);
  });
});

describe("adding a card", () => {
  it("puts a plain one after the last top-level declaration, ahead of the edges", () => {
    const { body, id } = addNodeBody(item("arch", ARCH), { kind: "queue", title: "Jobs" });
    expect(id).toBe("queue2");
    expect(body).toContain('client web "Browser"\nqueue queue2 "Jobs"\n\nweb --> api');
    clean("arch", body);
  });

  it("puts one inside a group, indented as the group's children are", () => {
    const { body } = addNodeBody(item("arch", ARCH), { kind: "store", id: "cache", title: "Cache", in: "gcp" });
    expect(body).toContain('  store db "Database"\n  store cache "Cache"\n}');
    expect(listDiagram(item("arch", body)).nodes.find((n) => n.id === "cache")!.in).toBe("gcp");
    clean("arch", body);
  });

  it("grows one from another with the edge, as the `+` does, and names it as asked", () => {
    const { body, id } = addNodeBody(item("arch", ARCH), { kind: "", from: "db", id: "replica", title: "Replica" });
    expect(id).toBe("replica");
    expect(body).toContain('store replica "Replica"');
    expect(body).toContain("db --> replica");
    clean("arch", body);
  });

  it("wants a coordinate in a hand-placed drawing, and writes it", () => {
    const sketch = item("sketch", 'box a "A" x=0 y=0');
    expect(() => addNodeBody(sketch, { kind: "circle", from: "a" })).toThrow(/--at/);
    const { body } = addNodeBody(sketch, { kind: "circle", title: "B", at: { x: 160, y: 0 } });
    expect(body).toContain('circle circle2 "B" x=160 y=0');
    clean("sketch", body);
  });

  it("adds a series to a chart, and refuses a card to a dialect with no kind words", () => {
    const { body } = addNodeBody(item("chart", CHART), { kind: "series", id: "mob", title: "Mobile", values: "1 - 3" });
    expect(body).toContain('series mob "Mobile" 1 - 3');
    clean("chart", body);
    expect(() => addNodeBody(item("mindmap", "Root\n  Child"), { kind: "topic" })).toThrow(/item body/);
  });
});

describe("removing, renaming, copying and moving a card", () => {
  it("takes a card and every edge that named it", () => {
    const body = removeNodeBody(item("arch", ARCH), "api");
    expect(body).not.toMatch(/\bapi\b/);
    clean("arch", body);
  });

  it("renames every reference, and refuses a name already used", () => {
    const body = renameNodeBody(item("arch", ARCH), "db", "pg");
    expect(body).toContain('store pg "Database"');
    expect(body).toContain("api --> pg");
    clean("arch", body);
    expect(() => renameNodeBody(item("arch", ARCH), "db", "web")).toThrow(/already/);
  });

  it("copies a statement under a fresh id", () => {
    const { body, id } = dupNodeBody(item("arch", ARCH), "web");
    expect(id).toBe("web2");
    clean("arch", body);
  });

  it("moves a statement out of its group and into another", () => {
    const out = moveNodeBody(item("arch", ARCH), "db", { top: true });
    expect(listDiagram(item("arch", out)).nodes.find((n) => n.id === "db")!.in).toBeUndefined();
    const back = moveNodeBody(item("arch", out), "db", { into: "gcp" });
    expect(listDiagram(item("arch", back)).nodes.find((n) => n.id === "db")!.in).toBe("gcp");
    clean("arch", back);
    expect(() => moveNodeBody(item("arch", ARCH), "db", { under: "api" })).toThrow(/mindmap/);
  });
});

describe("edges and rows", () => {
  it("adds, labels and removes an edge by its ends", () => {
    const added = addEdgeBody(item("arch", ARCH), "web", "db", { label: "reads", arrow: "-.->" });
    expect(added.endsWith('web -.-> db "reads"')).toBe(true);
    const it = item("arch", added);
    const labelled = setEdgeBody(it, edgeOf(it, "api", "db"), { label: "writes", hue: "coral" });
    expect(labelled).toContain('api --> db "writes" hue=coral');
    const gone = removeEdgeBody(item("arch", labelled), edgeOf(item("arch", labelled), "api", "db"));
    expect(gone).not.toContain("api --> db");
    clean("arch", gone);
    expect(() => addEdgeBody(item("arch", ARCH), "web", "nope", {})).toThrow(/declares no `nope`/);
  });

  it("asks which one when two edges share their ends", () => {
    const twice = item("arch", `${ARCH}\napi --> db "again"`);
    expect(() => edgeOf(twice, "api", "db")).toThrow(/`e2 -` or `e3 -`/);
    expect(edgeOf(twice, "e3").line).toBe(11);
  });

  it("numbers a card's rows and writes them in place", () => {
    const it = item("arch", ARCH);
    expect(rowsOf(it, "api").map((r) => r.text.trim())).toEqual(['identity "verify the id token"']);
    const added = addRowBody(it, "api", 'content "tracks"');
    expect(rowsOf(item("arch", added), "api")).toHaveLength(2);
    const set = setRowBody(item("arch", added), "api", 2, 'content "tracks · branches"');
    expect(set).toContain('    content "tracks · branches"');
    const removed = removeRowBody(item("arch", set), "api", 1);
    expect(removed).not.toContain("identity");
    clean("arch", removed);
    expect(() => setRowBody(it, "api", 3, "x")).toThrow(/no row 3/);
  });
});

describe("a chart's own statements", () => {
  it("writes each of the item view's controls as the body statement it is", () => {
    const body = setChartBody(item("chart", CHART), {
      form: "line",
      values: true,
      unit: "k€",
      min: 0,
      legend: "bottom",
      categories: "Jan, Feb, Mar",
    });
    expect(body).toContain("line");
    expect(body).toContain('unit "k€"');
    expect(body).toContain("x Jan Feb Mar");
    clean("chart", body);
    const undone = setChartBody(item("chart", body), { values: null, unit: null, min: null, legend: null });
    expect(undone).not.toMatch(/^values$|unit|^min|legend/m);
    expect(() => setChartBody(item("chart", CHART), { form: "radar" })).toThrow(/bar, line, pie, donut/);
    expect(() => setChartBody(item("arch", ARCH), { form: "bar" })).toThrow(/not a chart/);
  });
});
