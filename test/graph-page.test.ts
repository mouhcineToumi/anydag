/**
 * The Graph page (#459), as far as it is not pixels: the legend that is the filter, the camera, the
 * sliders' forces, the panel offering whatever fields the route sends — a made-up one included —
 * and the import graph that keeps the page, its worker and WebGL out of the entry's bundle.
 */
import fs from "node:fs";
import path from "node:path";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { boundsOf, centreOn, dotZoom, ease, fitTo, zoomAbout, ZOOM_MAX } from "@/graph/camera";
import { chipsOf, dropRules, legendOf, onlyValue, orphansOf, toggleValue } from "@/graph/legend";
import { read, shown } from "@/graph/model";
import { paletteOf } from "@/graph/palette";
import { DEFAULT_FORCES, GROUP_BY_LINKS, simForces, viewOf, type GraphView } from "@/graph/view";
import type { GraphWire } from "@/graph/wire";
import { Panel } from "@/ui/graph/Panel";

/*
 * Six documents and a field no part of the page has heard of, `mood`:
 *   0 a  note  mood calm   tags x
 *   1 b  note  mood calm   tags x, y
 *   2 c  task  mood wild   tags —
 *   3 d  board mood —      tags y
 *   4 e  note  mood wild   tags —
 *   5 f  task  mood —      tags —     (no link)
 * Links: a–b, b–c, c–d, d–e.
 */
const WIRE: GraphWire = {
  v: 1,
  ids: ["id0000000a", "id0000000b", "id0000000c", "id0000000d", "id0000000e", "id0000000f"],
  names: ["a", "b", "c", "d", "e", "f"],
  titles: [null, null, null, null, null, null],
  links: [0, 1, 1, 2, 2, 3, 3, 4],
  fields: [
    {
      key: "kind",
      label: "Kind",
      none: "No kind",
      type: "one",
      values: [
        { key: "note", label: "Notes", plain: true },
        { key: "task", label: "Tasks", hue: "spruce" },
        { key: "board", label: "Boards", hue: "indigo" },
      ],
      of: [0, 0, 1, 2, 0, 1],
    },
    {
      key: "tag",
      label: "Tag",
      none: "No tag",
      type: "many",
      values: [
        { key: "x", label: "x" },
        { key: "y", label: "y" },
      ],
      start: [0, 1, 3, 3, 4, 4, 4],
      items: [0, 0, 1, 1],
    },
    {
      key: "mood",
      label: "Mood",
      none: "No mood",
      type: "one",
      values: [
        { key: "calm", label: "Calm" },
        { key: "wild", label: "Wild" },
      ],
      of: [0, 0, 1, -1, 1, -1],
    },
  ],
};

const graph = read(WIRE);
const view = (over: Partial<GraphView> = {}): GraphView => ({ ...viewOf(null), rules: [], ...over });
const names = (v: GraphView) => Array.from(shown(graph, v).from, (i) => graph.names[i]!);

describe("the legend", () => {
  it("lists the coloured field's values, commonest first, then the files with none, all shown", () => {
    const v = view({ colourBy: "mood" });
    const rows = legendOf(graph, v, paletteOf(graph, "mood")!);
    expect(rows.map((r) => [r.key, r.label, r.count, r.shown])).toEqual([
      ["calm", "Calm", 2, true],
      ["wild", "Wild", 2, true],
      ["", "No mood", 2, true],
    ]);
  });

  it("hides a value on a press and shows it on the next, and a rule that hides nothing is dropped", () => {
    const off = toggleValue(graph, view({ colourBy: "mood" }), "mood", "wild");
    expect(off.rules).toEqual([{ field: "mood", hide: ["wild"] }]);
    expect(names(off)).toEqual(["a", "b", "d", "f"]);
    expect(toggleValue(graph, off, "mood", "wild").rules).toEqual([]);
  });

  it("keeps an Only an Only, so a value the vault gains later stays out", () => {
    const only = onlyValue(graph, view({ colourBy: "mood" }), "mood", "calm");
    expect(only.rules).toEqual([{ field: "mood", only: ["calm"] }]);
    const more = toggleValue(graph, only, "mood", "wild");
    expect(more.rules).toEqual([{ field: "mood", only: ["calm", "wild"] }]);
    expect(names(more)).toEqual(["a", "b", "c", "e"]);
  });

  it("shows every value again when Only is pressed on the value already alone", () => {
    const only = onlyValue(graph, view({ colourBy: "mood" }), "mood", "calm");
    expect(onlyValue(graph, only, "mood", "calm").rules).toEqual([]);
  });

  it("never hides the last value: a rule that would let nothing through is dropped", () => {
    let v = view({ colourBy: "mood" });
    for (const k of ["calm", "wild", ""]) v = toggleValue(graph, v, "mood", k);
    expect(v.rules).toEqual([]);
  });

  it("puts a chip on a rule the legend is not showing, and the chip takes it off", () => {
    const v = toggleValue(graph, view({ colourBy: "mood" }), "mood", "wild");
    expect(chipsOf(graph, v)).toEqual([]);
    const other = { ...v, colourBy: "kind" };
    expect(chipsOf(graph, other)).toEqual([{ field: "mood", label: "Mood", shown: 2, total: 3 }]);
    expect(dropRules(other, "mood").rules).toEqual([]);
  });

  it("puts no chip on a rule that leaves nothing of this vault out", () => {
    const v = view({ colourBy: "mood", rules: [{ field: "kind", hide: ["attachment"] }] });
    expect(chipsOf(graph, v)).toEqual([]);
  });

  it("counts the files with no links", () => {
    expect(orphansOf(graph)).toBe(1);
  });
});

describe("the camera", () => {
  it("fits a box in the room, centred, and never zooms a small graph in past 1.6", () => {
    const room = { x0: 0, y0: 0, x1: 1000, y1: 500 };
    const c = fitTo({ x0: -100, y0: -50, x1: 100, y1: 50 }, room, 0);
    expect(c.z).toBeCloseTo(1.6);
    expect(c.x).toBeCloseTo(500);
    expect(c.y).toBeCloseTo(250);
    const big = fitTo({ x0: 0, y0: 0, x1: 4000, y1: 1000 }, room, 0);
    expect(big.z).toBeCloseTo(0.25);
    expect(big.x + 2000 * big.z).toBeCloseTo(500);
  });

  it("boxes the first n positions, and a unit box when there are none", () => {
    const pos = new Float32Array([1, 2, -3, 4, 99, 99]);
    expect(boundsOf(pos, 2)).toEqual({ x0: -3, y0: 2, x1: 1, y1: 4 });
    expect(boundsOf(pos, 0)).toEqual({ x0: -1, y0: -1, x1: 1, y1: 1 });
  });

  it("zooms about a point that stays where it is, within its limits", () => {
    const c = { z: 1, x: 10, y: 20 };
    const z = zoomAbout(c, 110, 220, 2);
    expect(z.z).toBe(2);
    /* The layout point under (110, 220) before is under it after. */
    expect((110 - z.x) / z.z).toBeCloseTo((110 - c.x) / c.z);
    expect((220 - z.y) / z.z).toBeCloseTo((220 - c.y) / c.z);
    expect(zoomAbout(c, 0, 0, 1e6).z).toBe(ZOOM_MAX);
  });

  it("centres a layout point on a screen point", () => {
    const c = centreOn(5, -5, 400, 300, 2);
    expect(5 * c.z + c.x).toBe(400);
    expect(-5 * c.z + c.y).toBe(300);
  });

  it("eases towards its target and stops on it, so it stops asking for frames", () => {
    const from = { z: 1, x: 0, y: 0 };
    const to = { z: 2, x: 100, y: -100 };
    let steps = 0;
    while (ease(from, to, 0.3)) steps++;
    expect(from).toEqual(to);
    expect(steps).toBeGreaterThan(5);
    expect(steps).toBeLessThan(60);
    expect(ease(from, to, 0.3)).toBe(false);
  });

  it("draws a dot bigger as it zooms in, but less than the zoom", () => {
    expect(dotZoom(1)).toBe(1);
    expect(dotZoom(4)).toBeLessThan(4);
    expect(dotZoom(4)).toBeGreaterThan(1);
  });
});

describe("the sliders' forces", () => {
  it("are the simulation's own at the middle, a power of each base either side", () => {
    const v = view();
    expect(simForces(v)).toEqual({ repel: 1, link: 1, pull: 1, centre: 1, tight: 0, gap: 0 });
    expect(simForces({ ...v, forces: { ...DEFAULT_FORCES, repel: 1, link: -1, pull: 0.5, centre: 1 } })).toEqual({
      repel: 4,
      link: 1 / 3,
      pull: 2,
      centre: 6,
      tight: 0,
      gap: 0,
    });
  });

  it("hand the group forces on only while something is grouped", () => {
    const v = view({ groupBy: GROUP_BY_LINKS });
    expect(simForces(v)).toMatchObject({ tight: DEFAULT_FORCES.tight, gap: DEFAULT_FORCES.gap });
    expect(simForces({ ...v, groupBy: null })).toMatchObject({ tight: 0, gap: 0 });
  });

  it("keep a slider out of range, or not a number, within its range", () => {
    const f = simForces({ groupBy: "mood", forces: { ...DEFAULT_FORCES, repel: 9, tight: -2, gap: Number.NaN } });
    expect(f.repel).toBe(4);
    expect(f.tight).toBe(0);
    expect(f.gap).toBe(DEFAULT_FORCES.gap);
  });
});

describe("the panel", () => {
  const draw = (v: GraphView) =>
    renderToStaticMarkup(
      createElement(Panel, {
        graph,
        view: v,
        palette: paletteOf(graph, v.colourBy),
        shownFiles: 6,
        shownLinks: 4,
        groups: 0,
        onView: () => {},
        onLayout: () => {},
      }),
    );
  const options = (markup: string, attr: string) => {
    const select = markup.match(new RegExp(`<select[^>]*${attr}[^>]*>([\\s\\S]*?)</select>`))?.[1] ?? "";
    return [...select.matchAll(/<option[^>]*>([^<]*)<\/option>/g)].map((m) => m[1]);
  };

  it("offers a field it has never heard of, by its own label, to colour and to group by", () => {
    const markup = draw(view({ colourBy: "mood" }));
    expect(options(markup, "data-dag-graph-colour-by")).toEqual(["Kind", "Tag", "Mood"]);
    expect(options(markup, "data-dag-graph-group-by")).toEqual(["Nothing", "Linked clusters", "Kind", "Tag", "Mood"]);
    expect(markup).toContain('data-dag-graph-value="calm"');
    expect(markup).toContain('data-dag-graph-value="wild"');
  });

  it("draws a value's dot in a theme token, never a colour", () => {
    const markup = draw(view({ colourBy: "kind" }));
    const dots = [...markup.matchAll(/class="dag-graph__dot"[^>]*style="background:([^"]*)"/g)].map((m) => m[1]);
    expect(dots.length).toBe(3);
    for (const d of dots) expect(d).toMatch(/^var\(--dag-color-[a-z-]+\)$/);
  });

  it("leaves the group sliders off while nothing is grouped", () => {
    const off = draw(view({ groupBy: null }));
    expect(off).toMatch(/data-dag-graph-force="tight"[^>]*disabled/);
    const on = draw(view({ groupBy: "mood" }));
    expect(on).not.toMatch(/data-dag-graph-force="tight"[^>]*disabled/);
  });
});

const ROOT = path.resolve(import.meta.dirname, "..");
const SRC = path.join(ROOT, "src");

describe("the page's source", () => {
  it("names no field", () => {
    const files = [
      "graph/legend.ts",
      "graph/camera.ts",
      ...fs.readdirSync(path.join(SRC, "ui/graph")).map((f) => `ui/graph/${f}`),
    ];
    for (const file of files) {
      const text = fs.readFileSync(path.join(SRC, file), "utf8").replace(/role="status"/g, "");
      expect(text, file).not.toMatch(/["'`](kind|folder|tag|project|status)["'`]/);
    }
  });

  it("starts its simulation in a worker imported with ?worker, and ends it with the page", () => {
    const link = fs.readFileSync(path.join(SRC, "ui/graph/simLink.ts"), "utf8");
    expect(link).toMatch(/from "\.\/sim\.worker\?worker"/);
    const scene = fs.readFileSync(path.join(SRC, "ui/graph/scene.ts"), "utf8");
    const end = scene.slice(scene.indexOf("  end(): void {"));
    expect(end).toMatch(/this\.sim\.end\(\)/);
    expect(end).toMatch(/this\.gl\.dispose\(\)/);
    const gl = fs.readFileSync(path.join(SRC, "ui/graph/gl.ts"), "utf8");
    expect(gl).toMatch(/WEBGL_lose_context/);
  });
});

/* The walk `view-graph.test.ts` makes, from the entry: a static import is in the first bundle. */
function resolve(from: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = path.join(SRC, spec.slice(2));
  else if (spec.startsWith(".")) base = path.resolve(path.dirname(from), spec);
  else return null;
  for (const c of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts"), path.join(base, "index.tsx")])
    if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
  return null;
}

function staticImports(file: string): string[] {
  const text = fs
    .readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  const out: string[] = [];
  const re = /^\s*(import|export)\s+(type\s+)?([^'";]*?)\s*from\s*["']([^"']+)["']|^\s*import\s+["']([^"']+)["']/gm;
  for (const m of text.matchAll(re)) {
    if (m[5]) {
      out.push(m[5]);
      continue;
    }
    if (m[2]) continue;
    const named = /^\{([^}]*)\}$/.exec((m[3] ?? "").trim());
    if (named && named[1]!.split(",").every((p) => !p.trim() || p.trim().startsWith("type "))) continue;
    out.push(m[4]!);
  }
  return out;
}

function reach(entry: string): Set<string> {
  const files = new Set<string>();
  const stack = [entry];
  while (stack.length) {
    const f = stack.pop()!;
    if (files.has(f)) continue;
    files.add(f);
    if (!/\.tsx?$/.test(f)) continue;
    for (const spec of staticImports(f)) {
      const hit = resolve(f, spec);
      if (hit) stack.push(hit);
    }
  }
  return files;
}

describe("the Graph page's import graph", () => {
  const rel = (f: string) => path.relative(ROOT, f);
  const isGraph = (f: string) => f.startsWith("src/graph/") || f.startsWith("src/ui/graph/");

  it("keeps the graph out of the entry and out of the app's own bundle", () => {
    for (const from of ["main.tsx", "App.tsx"]) {
      const reached = [...reach(path.join(SRC, from))].map(rel);
      expect(reached.filter(isGraph), from).toEqual([]);
    }
  });

  it("asks for the page with an import() of its own", () => {
    const chunks = fs.readFileSync(path.join(SRC, "ui/chunks.tsx"), "utf8");
    expect(chunks).toMatch(/import\("\.\/graph\/GraphPage"\)/);
  });

  it("finds the model and the renderer from the page, so the walk itself is not blind", () => {
    const reached = [...reach(path.join(SRC, "ui/graph/GraphPage.tsx"))].map(rel);
    expect(reached).toContain("src/graph/model.ts");
    expect(reached).toContain("src/ui/graph/gl.ts");
  });
});
