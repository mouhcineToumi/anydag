import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  appendPart,
  BROWSABLE,
  CATEGORIES,
  categoryOf,
  find,
  isFragment,
  LIBRARY,
  madeOf,
  matches,
  render,
  SHELVES,
  usesOf,
} from "@/board/library";
import { TEMPLATES } from "@/board/templates";
import { isDiagramType } from "@/board/types";
import { parseChart } from "@/dsl/chart";
import { parseDiagram } from "@/dsl/parse";
import { parseSequence } from "@/dsl/sequence";

/**
 * Every component in the library draws, and every composition holds together.
 *
 * A component that lands as an error card is worse than no component: the person reached for the
 * ready-made thing precisely because they did not want to learn the grammar first. So each whole
 * diagram parses clean, each fragment parses clean on its own and appended to its type's starter,
 * and a fragment's ids never collide with ones already in the diagram.
 *
 * The composition adds a second class of check the flat list could not have needed: a `use` has to
 * resolve, a layer may not depend on one above it, and no hole may survive rendering.
 */

const parse = (type: string, body: string) =>
  /* Dispatch by name: this is a place that has a parser to call for each, which is where
     `hasGraph()` says the knowledge belongs (`parseBoard.ts` makes the same branch). */
  type === "sequence" ? parseSequence(body) : type === "chart" ? parseChart(body) : parseDiagram(type, body);

const clean = (type: string, body: string, label: string) => {
  const model = parse(type, body);
  expect(model, label).not.toBeNull();
  expect(model!.diagnostics.map((d) => `${label}: ${d.code} ${d.message}`)).toEqual([]);
};

describe("the library", () => {
  it("has unique ids", () => {
    const ids = LIBRARY.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("draws every whole diagram without a diagnostic", () => {
    for (const c of LIBRARY) {
      if (isFragment(c) || c.inner || !isDiagramType(c.type)) continue;
      clean(c.type, render(c), c.id);
    }
  });

  it("draws every fragment, alone and appended to its type's starter", () => {
    for (const c of LIBRARY) {
      if (!isFragment(c)) continue;
      clean(c.type, render(c), `${c.id} alone`);
      const joined = appendPart(c, TEMPLATES[c.type]);
      clean(c.type, joined, `${c.id} appended`);
      /* And appended twice: the second copy must not reuse the first one's id. */
      clean(c.type, appendPart(c, joined), `${c.id} appended twice`);
    }
  });

  it("gives a fragment an id the diagram does not already use", () => {
    const svc = find("part-arch-service")!;
    expect(render(svc, 'service svc1 "A"\nservice svc2 "B"')).toContain("service svc3 ");
    expect(render(svc)).toContain("service svc1 ");
    /* `svc10` is not `svc1`. */
    expect(render(svc, 'service svc10 "A"')).toContain("service svc1 ");
  });

  it("matches every word of a query, in any order", () => {
    const table = find("part-erd-entity")!;
    expect(matches(table, "erd table")).toBe(true);
    expect(matches(table, "table erd")).toBe(true);
    expect(matches(table, "arch table")).toBe(false);
    expect(matches(table, "")).toBe(true);
  });

  it("matches the text a blueprint writes, not only its name", () => {
    /* The searches the name-and-section haystack could not answer: a starter whose store says
       "postgres", a pattern whose cache says "redis", a brand whose icon value is `gcp:bigquery`. */
    expect(matches(find("arch-web-app")!, "postgres")).toBe(true);
    expect(matches(find("pattern-arch-cache-aside")!, "redis")).toBe(true);
    expect(matches(find("part-arch-postgres")!, "postgres")).toBe(true);
    expect(matches(find("part-arch-bigquery")!, "bigquery")).toBe(true);
    expect(matches(find("part-arch-bigquery")!, "gcp")).toBe(true);
    /* And the grammar is not indexed — this is what keeps the search precise. Every `arch`
       statement carries the kind word and a `hue=` is in half the molecules; only a blueprint that
       names or describes a service answers "service". */
    expect(matches(find("part-erd-entity")!, "service")).toBe(false);
    expect(matches(find("part-sketch-box")!, "service")).toBe(false);
    expect(matches(find("part-arch-postgres")!, "service")).toBe(false);
  });
});

describe("the library's composition", () => {
  it("resolves every `use`, and every `madeOf`", () => {
    for (const c of LIBRARY) {
      for (const id of usesOf(c)) expect(find(id), `${c.id} uses ${id}`).toBeDefined();
      for (const id of c.madeOf ?? []) expect(find(id), `${c.id} madeOf ${id}`).toBeDefined();
    }
  });

  it("never depends on a higher layer, and never on another dialect", () => {
    for (const c of LIBRARY) {
      for (const id of [...usesOf(c), ...(c.madeOf ?? [])]) {
        const child = find(id)!;
        expect(child.layer, `${c.id} (L${c.layer}) uses ${id} (L${child.layer})`).toBeLessThanOrEqual(c.layer);
        expect(child.type, `${c.id} uses ${id}`).toBe(c.type);
      }
    }
  });

  it("leaves no hole unfilled", () => {
    for (const c of LIBRARY) expect(render(c), c.id).not.toContain("${");
  });

  it("only reaches an inner atom through the thing it is part of", () => {
    const row = find("part-arch-row")!;
    expect(isFragment(row)).toBe(false);
    expect(BROWSABLE).not.toContain(row);
    expect(madeOf(find("part-arch-service-rows")!)).toContain(row);
    expect(render(find("part-arch-service-rows")!)).toContain('svc1_a "what it needs"');
  });

  it("declares at most one id per atom", () => {
    for (const c of LIBRARY) {
      if (c.layer !== 0) continue;
      /* One statement. The one thing an atom may borrow is a lower atom with different props — a
         brand entry is the `store` atom with a logo as its default, and that is still one
         statement introducing one id. Two uses would be two statements; three, a pattern. */
      expect(usesOf(c).length, `${c.id} is an atom`).toBeLessThanOrEqual(1);
    }
  });

  it("builds the twelve templates out of the parts a person can drop", () => {
    /* The point of the whole exercise: the `arch` starter is the client, service and store atoms,
       so a change to one of them is a change to the template a new item begins as. */
    const arch = find("diagram-arch")!;
    expect(madeOf(arch).map((b) => b.id)).toEqual(["part-arch-client", "part-arch-service", "part-arch-store"]);
    expect(TEMPLATES.arch).toContain('service api "API" "what serves it" icon=server');
  });

  it("names an icon the panel actually has", () => {
    /* The same contract `check:icons` holds one layer down, and for the same reason: the panel
       resolves a glyph from an explicit map — importing the whole of Lucide would put twelve
       hundred of them in the bundle for forty — and a name that is not in it falls back to a
       generic box with nothing said. A check is the only thing between that and silent drift.
       Read as text rather than imported: the map lives in a React component, and the value it
       holds is the glyph, not the name. */
    const src = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src/edit/Library.tsx"), "utf8");
    const block = /const ICONS: Record<string, [^=]*> = \{([\s\S]*?)\};/.exec(src);
    expect(block, "the ICONS map moved — this check needs its new shape").not.toBeNull();
    const known = new Set(block![1]!.split(/[,\s]+/).filter(Boolean));
    for (const c of LIBRARY) expect(known, `${c.id} wants ${c.icon}`).toContain(c.icon);
  });

  it("puts a fragment in a section and a whole item in another", () => {
    expect(categoryOf(find("part-arch-service")!)).toBe("Atoms");
    expect(categoryOf(find("part-arch-group")!)).toBe("Parts");
    expect(categoryOf(find("diagram-arch")!)).toBe("Diagrams");
    expect(categoryOf(find("note")!)).toBe("Notes");
  });

  it("puts the branded nodes in a section of their own", () => {
    /* The same argument the shapes and the charts have: the section a person's mind is in, not a
       layer of composition. A store that already says postgres is reached for by the technology. */
    expect(categoryOf(find("part-arch-postgres")!)).toBe("Technologies");
    for (const c of LIBRARY) if (c.brand) expect(categoryOf(c), c.id).toBe("Technologies");
    expect(LIBRARY.some((c) => c.brand)).toBe(true);
  });

  it("keeps a whole dialect in one section — the shapes, and the charts", () => {
    /* `sketch` and `chart` are the two dialects whose section is the dialect: somebody opening the
       panel to draw a rectangle or to plot a number is not thinking about layers, so the atom and
       the whole item it composes sit together. Both are ahead of everything but *Generate*, which is
       not a thing to place but a way to get one of the others without knowing which. */
    expect(CATEGORIES.slice(0, 4)).toEqual(["Generate", "Shapes", "Objects", "Charts"]);
    for (const c of LIBRARY) {
      /* The one carve-out is the pictures: a `figure` on a shelf is a `sketch` atom too,
         and fifteen hundred of them would bury the circle — see the next test. */
      if (c.type === "sketch") expect(categoryOf(c), c.id).toBe(c.shelf ? "Objects" : "Shapes");
      if (c.type === "chart") expect(categoryOf(c), c.id).toBe("Charts");
    }
    expect(categoryOf(find("part-chart-series")!)).toBe("Charts");
    expect(categoryOf(find("chart-donut")!)).toBe("Charts");
  });

  it("puts every picture on exactly one shelf, as one figure, in the section of its own", () => {
    const objects = LIBRARY.filter((c) => c.shelf);
    /* Every emoji the set has, plus the drawn shelf — "as many as possible" is the brief. */
    expect(objects.length).toBeGreaterThan(1600);
    for (const c of objects) {
      expect(categoryOf(c), c.id).toBe("Objects");
      expect(SHELVES, c.id).toContain(c.shelf);
      expect(render(c), c.id).toMatch(/^figure \S+ "/);
    }
    const pictures = objects.map((c) => c.picture);
    expect(new Set(pictures).size, "a picture on two shelves answers a search twice").toBe(pictures.length);
    /* The stick figure is the first thing on the first shelf, and needs no icon to be one. */
    expect(objects[0]!.shelf).toBe("Drawn");
    expect(render(objects[0]!)).toBe('figure person1 "Stick figure"');
    expect(render(find("object-house")!)).toBe('figure house1 "House" icon=emoji:house');
  });

  it("finds a picture by what it is", () => {
    const hits = (q: string) => BROWSABLE.filter((c) => matches(c, q)).map((c) => c.id);
    expect(hits("house")).toContain("object-house");
    expect(hits("house")).toContain("object-line-house");
    expect(hits("stick")).toContain("object-line-stick-figure");
    expect(hits("kangaroo")).toContain("object-kangaroo");
  });

  it("puts the prompt card in a section of its own, and places it rather than appending it", () => {
    const card = find("prompt")!;
    expect(categoryOf(card)).toBe("Generate");
    expect(isFragment(card)).toBe(false);
    /* It opens empty, so its placeholder is what says what to write. */
    expect(render(card)).toBe("");
  });
});
