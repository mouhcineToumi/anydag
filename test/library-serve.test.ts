import { describe, expect, it } from "vitest";

import { BROWSABLE } from "@/board/library";
import { libraryList, libraryOne, libraryServed, OBJECT_LIMIT } from "@/board/library/serve";
import { isDiagramType } from "@/board/types";
import { parseChart } from "@/dsl/chart";
import { parseDiagram } from "@/dsl/parse";
import { parseSequence } from "@/dsl/sequence";

/**
 * `GET /__board/library`, off the wire.
 *
 * `test/library.test.ts` already proves every blueprint composes and renders without a hole left
 * unfilled — that is not re-proven here. What is specific to the route is the wire shape: the same
 * function it calls (`libraryList`/`libraryOne`, from the browser-free module the plugin imports),
 * narrowed by `type`, reached by `id`, and — the one thing worth re-checking at this seam — that
 * what actually goes out over HTTP still parses clean, in case serving it differs from rendering it
 * inside a test.
 */

const parse = (type: string, body: string) =>
  /* Dispatch by name: this is a place that has a parser to call for each, which is where
     `hasGraph()` says the knowledge belongs (`parseBoard.ts` makes the same branch). */
  type === "sequence" ? parseSequence(body) : type === "chart" ? parseChart(body) : parseDiagram(type, body);

describe("libraryList", () => {
  it("lists every browsable blueprint the panel shows, the pictures aside", () => {
    const all = libraryList();
    expect(all.length).toBe(BROWSABLE.filter((b) => !b.shelf).length);
    expect(all.length).toBeGreaterThan(0);
  });

  it("renders every layer ≤ 3 entry clean, via the same parser its type uses", () => {
    for (const b of libraryList()) {
      if (b.layer > 3 || !isDiagramType(b.type)) continue;
      const model = parse(b.type, b.source);
      expect(model, b.id).not.toBeNull();
      expect(model!.diagnostics.map((d) => `${b.id}: ${d.code} ${d.message}`)).toEqual([]);
    }
  });

  it("narrows to one dialect with `type`", () => {
    const arch = libraryList("arch");
    expect(arch.length).toBeGreaterThan(0);
    expect(arch.every((b) => b.type === "arch")).toBe(true);
    expect(arch.length).toBeLessThan(libraryList().length);
  });

  it("serves the charts under `?type=chart`, forms and statements alike", () => {
    const chart = libraryList("chart");
    expect(chart.length).toBeGreaterThan(0);
    expect(chart.every((b) => b.type === "chart")).toBe(true);
    /* Both halves of what the dialect has: whole charts to place, and the two statements to drop
       onto one. Anything that parses is proven clean by the case above. */
    expect(chart.some((b) => b.layer === 3 && b.source.startsWith("donut "))).toBe(true);
    expect(chart.some((b) => b.layer === 0 && b.source.startsWith("series "))).toBe(true);
  });

  it("returns nothing for a dialect no blueprint speaks", () => {
    expect(libraryList("not-a-real-type")).toEqual([]);
  });
});

describe("libraryServed — the pictures", () => {
  it("accounts for the pictures without listing them", () => {
    const got = libraryServed();
    expect(got.blueprints.some((b) => b.shelf)).toBe(false);
    expect(got.objects.listed).toBe(0);
    expect(got.objects.total).toBe(BROWSABLE.filter((b) => b.shelf).length);
    expect(got.objects.total).toBeGreaterThan(1600);
    expect(got.objects.shelves.map((s) => s.shelf)[0]).toBe("Drawn");
    expect(got.objects.shelves.reduce((n, s) => n + s.count, 0)).toBe(got.objects.total);
    expect(got.objects.how).toContain("figure");
  });

  it("lists the pictures a search finds, as the text they write", () => {
    const got = libraryServed({ q: "delivery truck" });
    const truck = got.blueprints.find((b) => b.id === "object-delivery-truck");
    expect(truck).toMatchObject({ shelf: "Essentials", type: "sketch" });
    expect(truck!.source).toBe('figure delivery-truck1 "Delivery truck" icon=emoji:delivery-truck');
    expect(got.objects.listed).toBe(got.objects.total);
  });

  it("caps a search that matches too many, and says so", () => {
    const got = libraryServed({ q: "e" });
    expect(got.objects.total).toBeGreaterThan(OBJECT_LIMIT);
    expect(got.objects.listed).toBe(OBJECT_LIMIT);
    expect(got.blueprints.filter((b) => b.shelf)).toHaveLength(OBJECT_LIMIT);
  });

  it("searches the rest of the library too, and narrows by type as before", () => {
    expect(libraryServed({ q: "postgres" }).blueprints.map((b) => b.id)).toContain("part-arch-postgres");
    expect(libraryServed({ type: "arch", q: "house" }).blueprints.some((b) => b.shelf)).toBe(false);
  });
});

describe("libraryOne", () => {
  it("fetches one blueprint by id, rendered rather than as a template", () => {
    const one = libraryOne("part-arch-service");
    expect(one).toBeDefined();
    expect(one!.source).not.toContain("${");
    expect(one!.source).toContain("service");
  });

  it("reaches an inner atom too — not browsable, but nameable", () => {
    /* `part-arch-row` is `inner`, so it never appears in `libraryList()`; the panel only reaches it
       by expanding the molecule it belongs to, and `?id=` is that same reach for an agent. */
    expect(libraryList().some((b) => b.id === "part-arch-row")).toBe(false);
    expect(libraryOne("part-arch-row")).toBeDefined();
  });

  it("is undefined for an id nothing has", () => {
    expect(libraryOne("not-a-real-blueprint")).toBeUndefined();
  });
});
