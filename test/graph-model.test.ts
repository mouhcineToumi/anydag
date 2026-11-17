/**
 * The graph view's model (#457): the wire read into typed arrays, one rule semantics for every field,
 * the shown subgraph, palette slots and groups — none of it knowing a field by name, which the
 * made-up `mood` field below holds it to.
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { GraphVersion, groupsOf, read, shown } from "../src/graph/model";
import { SLOT_MUTED, SLOT_SLATE, SLOT_TOKENS, colours, paletteOf, slotOfHue, slotsOf } from "../src/graph/palette";
import { DEFAULT_VIEW, GROUP_BY_LINKS, viewOf, type GraphRule, type GraphView } from "../src/graph/view";
import type { GraphField, GraphWire } from "../src/graph/wire";
import { HUE_ORDER } from "../src/dsl/ir";

/*
 * Seven documents:
 *   0 a           note   folder —          tags —             mood calm
 *   1 b           note   Projects          tags draft, idea   mood calm
 *   2 c           task   Projects/Alpha    tags idea          mood —
 *   3 d           board  Projects/Alpha    tags —             mood wild
 *   4 e.pdf       attach Projects/Beta     tags —             mood —
 *   5 f           note   Projectsish       tags draft         mood calm
 *   6 g           note   —                 tags —             mood —       (no link)
 * Links: a–b, b–c, c–d, d–e, a–f.
 */
const WIRE: GraphWire = {
  v: 1,
  ids: ["id0000000a", "id0000000b", "id0000000c", "id0000000d", "id0000000e", "id0000000f", "id0000000g"],
  names: ["a", "b", "c", "d", "e.pdf", "f", "g"],
  titles: [null, "Bee", null, null, null, null, null],
  links: [0, 1, 1, 2, 2, 3, 3, 4, 0, 5],
  fields: [
    {
      key: "kind",
      label: "Kind",
      none: "No kind",
      type: "one",
      values: [
        { key: "note", label: "Notes" },
        { key: "task", label: "Tasks" },
        { key: "board", label: "Boards" },
        { key: "attachment", label: "Attachments" },
      ],
      of: [0, 0, 1, 2, 3, 0, 0],
    },
    {
      key: "folder",
      label: "Folder",
      none: "At the top",
      type: "one",
      tree: true,
      values: [
        { key: "Projects", label: "Projects" },
        { key: "Projects/Alpha", label: "Projects/Alpha" },
        { key: "Projects/Beta", label: "Projects/Beta" },
        { key: "Projectsish", label: "Projectsish" },
      ],
      of: [-1, 0, 1, 1, 2, 3, -1],
    },
    {
      key: "tag",
      label: "Tag",
      none: "No tag",
      type: "many",
      values: [
        { key: "draft", label: "draft", hue: "coral" },
        { key: "idea", label: "idea", hue: "teal" },
      ],
      start: [0, 0, 2, 3, 3, 3, 4, 4],
      items: [0, 1, 1, 0],
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
      of: [0, 0, -1, 1, -1, 0, -1],
    },
  ],
};

const view = (over: Partial<GraphView>): GraphView => ({ ...viewOf(null), rules: [], ...over });
const names = (rules: GraphRule[], over: Partial<GraphView> = {}): string[] => {
  const g = read(WIRE);
  const s = shown(g, view({ rules, ...over }));
  return Array.from(s.from, (i) => g.names[i]!);
};

describe("read", () => {
  it("reads the wire into typed arrays", () => {
    const g = read(WIRE);
    expect(g.n).toBe(7);
    expect(g.src).toBeInstanceOf(Int32Array);
    expect(Array.from(g.src)).toEqual([0, 1, 2, 3, 0]);
    expect(Array.from(g.dst)).toEqual([1, 2, 3, 4, 5]);
    expect(Array.from(g.degree)).toEqual([2, 2, 2, 2, 1, 1, 0]);
    const tag = g.field.get("tag")!;
    expect(tag.start).toBeInstanceOf(Int32Array);
    expect(tag.items).toBeInstanceOf(Int32Array);
    expect(g.field.get("mood")!.of).toBeInstanceOf(Int32Array);
    expect(g.field.get("folder")!.tree).toBe(true);
  });

  it("drops a pair to a document that is not there or to itself, and refuses a newer answer", () => {
    const g = read({ ...WIRE, links: [0, 1, 0, 0, 2, 99, -1, 3] });
    expect(Array.from(g.src)).toEqual([0]);
    expect(Array.from(g.dst)).toEqual([1]);
    expect(() => read({ ...WIRE, v: 2 as 1 })).toThrow(GraphVersion);
  });
});

describe("rules", () => {
  it("shows everything with no rule", () => {
    expect(names([])).toEqual(["a", "b", "c", "d", "e.pdf", "f", "g"]);
  });

  it("hide takes values out", () => {
    expect(names([{ field: "kind", hide: ["attachment", "board"] }])).toEqual(["a", "b", "c", "f", "g"]);
  });

  it("only keeps the named values and nothing else", () => {
    expect(names([{ field: "kind", only: ["task", "board"] }])).toEqual(["c", "d"]);
  });

  it('"" is "has none", in hide and in only', () => {
    expect(names([{ field: "mood", hide: [""] }])).toEqual(["a", "b", "d", "f"]);
    expect(names([{ field: "mood", only: ["", "wild"] }])).toEqual(["c", "d", "e.pdf", "g"]);
    expect(names([{ field: "mood", only: ["calm"] }])).toEqual(["a", "b", "f"]);
  });

  it("a many field passes when at least one of its values is allowed", () => {
    // b carries draft and idea: hiding draft leaves its idea. f carries only draft.
    expect(names([{ field: "tag", hide: ["draft"] }])).toEqual(["a", "b", "c", "d", "e.pdf", "g"]);
    expect(names([{ field: "tag", only: ["draft"] }])).toEqual(["b", "f"]);
    expect(names([{ field: "tag", hide: ["draft", "idea"] }])).toEqual(["a", "d", "e.pdf", "g"]);
    expect(names([{ field: "tag", hide: [""] }])).toEqual(["b", "c", "f"]);
  });

  it("on a tree field a key covers everything under it, and only under it", () => {
    expect(names([{ field: "folder", only: ["Projects"] }])).toEqual(["b", "c", "d", "e.pdf"]);
    expect(names([{ field: "folder", hide: ["Projects/Alpha"] }])).toEqual(["a", "b", "e.pdf", "f", "g"]);
    // A key is a path, not a prefix of the text: `Projects` does not cover `Projectsish`.
    expect(names([{ field: "folder", hide: ["Projects"] }])).toEqual(["a", "f", "g"]);
    // The top level is "none", which a tree key never covers.
    expect(names([{ field: "folder", only: [""] }])).toEqual(["a", "g"]);
  });

  it("every rule must pass, and a rule on a field the graph does not have is passed over", () => {
    expect(
      names([
        { field: "kind", hide: ["attachment"] },
        { field: "folder", only: ["Projects"] },
      ]),
    ).toEqual(["b", "c", "d"]);
    expect(names([{ field: "nope", only: ["x"] }])).toHaveLength(7);
  });

  it("without orphans hides documents with no link at all", () => {
    expect(names([], { orphans: false })).toEqual(["a", "b", "c", "d", "e.pdf", "f"]);
  });

  it("the default view hides attachments", () => {
    const g = read(WIRE);
    const s = shown(g, DEFAULT_VIEW);
    expect(Array.from(s.from, (i) => g.names[i])).toEqual(["a", "b", "c", "d", "f", "g"]);
  });
});

describe("shown", () => {
  it("renumbers what is shown, with index maps both ways, links, degree, adjacency and an order by degree", () => {
    const g = read(WIRE);
    const s = shown(g, view({ rules: [{ field: "kind", hide: ["board"] }] }));
    // d (3) is gone: c–d and d–e go with it.
    expect(Array.from(s.from)).toEqual([0, 1, 2, 4, 5, 6]);
    expect(Array.from(s.index)).toEqual([0, 1, 2, -1, 3, 4, 5]);
    expect(s.m).toBe(3);
    expect(Array.from(s.src)).toEqual([0, 1, 0]);
    expect(Array.from(s.dst)).toEqual([1, 2, 4]);
    expect(Array.from(s.degree)).toEqual([2, 2, 1, 0, 1, 0]);
    const near = (i: number) => Array.from(s.near.subarray(s.start[i], s.start[i + 1])).sort();
    expect(near(0)).toEqual([1, 4]);
    expect(near(1)).toEqual([0, 2]);
    expect(near(3)).toEqual([]);
    expect(Array.from(s.byDegree)).toEqual([0, 1, 2, 4, 3, 5]);
    for (const a of [s.from, s.index, s.src, s.dst, s.degree, s.start, s.near, s.byDegree]) expect(a).toBeInstanceOf(Int32Array);
  });
});

describe("palette", () => {
  it("names token slots, never colours", () => {
    expect(SLOT_TOKENS[SLOT_SLATE]).toBe("slate");
    expect(SLOT_TOKENS[SLOT_MUTED]).toBe("muted");
    expect(SLOT_TOKENS[slotOfHue("teal")]).toBe("hues-teal");
    expect(SLOT_TOKENS).toHaveLength(12);
  });

  it("hands the ten hues out from the commonest value down, the rest slate, none muted", () => {
    const values = Array.from({ length: 12 }, (_, i) => ({ key: `v${i}`, label: `V${i}` }));
    // Value v_i is carried by i + 1 documents, so v11 is the commonest.
    const of: number[] = values.flatMap((_, i) => Array<number>(i + 1).fill(i));
    of.push(-1);
    const field: GraphField = { key: "many-values", label: "M", none: "—", type: "one", values, of };
    const n = of.length;
    const g = read({
      v: 1,
      ids: of.map((_, i) => `d${i}`),
      names: of.map((_, i) => `d${i}`),
      titles: of.map(() => null),
      links: [],
      fields: [field],
    });
    expect(g.n).toBe(n);
    const p = paletteOf(g, "many-values")!;
    expect(Array.from(p.order).slice(0, 3)).toEqual([11, 10, 9]);
    expect(p.slots[11]).toBe(slotOfHue(HUE_ORDER[0]!));
    expect(p.slots[2]).toBe(slotOfHue(HUE_ORDER[9]!));
    expect(p.slots[1]).toBe(SLOT_SLATE);
    expect(p.slots[0]).toBe(SLOT_SLATE);
    expect(p.noneCount).toBe(1);
    expect(p.counts[11]).toBe(12);
    const s = shown(g, view({}));
    expect(slotsOf(g, s, p)[n - 1]).toBe(SLOT_MUTED);
  });

  it("keeps a value's own hue, and hands out only the hues nobody owns", () => {
    const g = read(WIRE);
    const tag = paletteOf(g, "tag")!;
    expect(tag.slots[0]).toBe(slotOfHue("coral"));
    expect(tag.slots[1]).toBe(slotOfHue("teal"));
    // The page may give a field's values hues of its own, by key.
    const kind = paletteOf(g, "kind", new Map([["note", "coral"]]))!;
    expect(kind.slots[0]).toBe(slotOfHue("coral"));
    const handed = [kind.slots[1], kind.slots[2], kind.slots[3]];
    expect(handed).not.toContain(slotOfHue("coral"));
    expect(new Set(handed).size).toBe(3);
  });

  it("colours a many field by the first value the rules let through", () => {
    const g = read(WIRE);
    const v = view({ colourBy: "tag", rules: [{ field: "tag", hide: ["draft"] }] });
    const s = shown(g, v);
    const c = colours(g, s, v)!;
    // b carries draft first, but draft is hidden: it is drawn as idea.
    expect(c.slots[s.index[1]!]).toBe(slotOfHue("teal"));
    expect(c.slots[s.index[0]!]).toBe(SLOT_MUTED);
    expect(colours(g, s, view({ colourBy: "nope" }))).toBeNull();
  });
});

describe("groups", () => {
  it("groups by a field's value, numbered from the biggest group down", () => {
    const g = read(WIRE);
    const s = shown(g, view({ groupBy: "kind" }));
    const groups = groupsOf(g, s, view({ groupBy: "kind" }))!;
    expect(groups.keys).toEqual(["note", "task", "board", "attachment"]);
    expect(groups.names).toEqual(["Notes", "Tasks", "Boards", "Attachments"]);
    expect(Array.from(groups.sizes)).toEqual([4, 1, 1, 1]);
    expect(Array.from(groups.of)).toEqual([0, 0, 1, 2, 3, 0, 0]);
    expect(groups.of).toBeInstanceOf(Int32Array);
  });

  it("puts a document with no value in no group, and is null for no field, an unknown one or the links", () => {
    const g = read(WIRE);
    const s = shown(g, view({}));
    const folder = groupsOf(g, s, view({ groupBy: "folder" }))!;
    expect(folder.keys).toEqual(["Projects/Alpha", "Projects", "Projects/Beta", "Projectsish"]);
    expect(Array.from(folder.of)).toEqual([-1, 1, 0, 0, 2, 3, -1]);
    expect(groupsOf(g, s, view({ groupBy: null }))).toBeNull();
    expect(groupsOf(g, s, view({ groupBy: "nope" }))).toBeNull();
    expect(groupsOf(g, s, view({ groupBy: GROUP_BY_LINKS }))).toBeNull();
  });
});

describe("a field the model has never heard of", () => {
  it("filters, colours and groups by it like any other", () => {
    const g = read(WIRE);
    const v = view({ colourBy: "mood", groupBy: "mood", rules: [{ field: "mood", hide: ["wild"] }] });
    const s = shown(g, v);
    expect(Array.from(s.from, (i) => g.names[i])).toEqual(["a", "b", "c", "e.pdf", "f", "g"]);
    const c = colours(g, s, v)!;
    expect(Array.from(c.slots)).toEqual([2, 2, SLOT_MUTED, SLOT_MUTED, 2, SLOT_MUTED]);
    expect(SLOT_TOKENS[c.slots[0]!]).toBe(`hues-${HUE_ORDER[0]}`);
    const groups = groupsOf(g, s, v)!;
    expect(groups.names).toEqual(["Calm"]);
    expect(Array.from(groups.of)).toEqual([0, 0, -1, -1, 0, -1]);
  });
});

describe("viewOf", () => {
  it("reads a remembered view, the default for whatever is missing or malformed", () => {
    expect(viewOf(undefined)).toEqual(DEFAULT_VIEW);
    expect(viewOf(JSON.parse(JSON.stringify(DEFAULT_VIEW)))).toEqual(DEFAULT_VIEW);
    const v = viewOf({
      colourBy: "tag",
      groupBy: null,
      rules: [{ field: "tag", only: ["a", 3], hide: "x" }, { nope: 1 }],
      orphans: false,
      forces: { repel: 0.5, gap: "far" },
    });
    expect(v.colourBy).toBe("tag");
    expect(v.groupBy).toBeNull();
    expect(v.rules).toEqual([{ field: "tag", only: ["a"] }]);
    expect(v.orphans).toBe(false);
    expect(v.forces).toEqual({ ...DEFAULT_VIEW.forces, repel: 0.5 });
  });
});

describe("the model's source", () => {
  it("names no field: a field key is a literal only in the view's defaults", () => {
    for (const file of ["model.ts", "palette.ts"]) {
      const text = readFileSync(new URL(`../src/graph/${file}`, import.meta.url), "utf8");
      expect(text, file).not.toMatch(/["'`](kind|folder|tag|project|status)["'`]/);
    }
  });
});
