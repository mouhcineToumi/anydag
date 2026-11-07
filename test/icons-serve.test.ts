import { describe, expect, it } from "vitest";

import { ICON_LIMIT, iconVocabulary, ICON_MODES } from "../plugins/icons";
import { ICON_NAMES } from "@/dsl/icon-names";

/**
 * `GET /__board/icons`, off the wire.
 *
 * `test/icons.test.ts` owns the grammar and the resolution order; `test/library-serve.test.ts` is
 * the model for what is specific to the route — the shape that goes out, the narrowing, and the
 * one thing worth re-checking at this seam: that the modes this module reports and the modes
 * `iconFor()` resolves are the same, since a route that said `brand` for a name the renderer drew
 * as a silhouette would be a worse lie than no route at all.
 */

describe("iconVocabulary — the emoji", () => {
  it("lists every picture under its namespace, drawn the way a brand is", () => {
    const got = iconVocabulary({ q: "emoji:house" });
    expect(got.icons).toContainEqual({ name: "emoji:house", mode: "brand" });
    /* The route and the renderer have to agree, and the renderer calls an emoji a brand too. */
    expect(iconVocabulary({ q: "emoji:", mode: "brand", limit: Number.MAX_SAFE_INTEGER }).total).toBeGreaterThan(1500);
    expect(iconVocabulary({ q: "emoji:", mode: "concept" }).total).toBe(0);
  });

  it("finds a picture by its plain word, beside the line drawing of the same name", () => {
    const names = iconVocabulary({ q: "house" }).icons.map((i) => i.name);
    expect(names).toContain("house");
    expect(names).toContain("emoji:house");
  });
});

describe("iconVocabulary", () => {
  it("lists every generated name, each with a mode", () => {
    const all = iconVocabulary({ limit: Number.MAX_SAFE_INTEGER });
    expect(all.total).toBe(ICON_NAMES.size);
    expect(all.icons).toHaveLength(ICON_NAMES.size);
    expect(all.truncated).toBe(false);
    expect(new Set(all.icons.map((i) => i.mode)).size).toBe(ICON_MODES.length);
    expect(all.icons.map((i) => i.name)).toEqual([...ICON_NAMES].sort());
  });

  it("answers in iconFor's own order — brand before mono before concept", () => {
    const modes = (names: string[]) =>
      Object.fromEntries(
        iconVocabulary({ limit: Number.MAX_SAFE_INTEGER })
          .icons.filter((i) => names.includes(i.name))
          .map((i) => [i.name, i.mode]),
      );
    /* postgresql is a full-colour brand, clickhouse ships as a silhouette only, `server` is
       Lucide's glyph, and `postgres` is an alias onto the brand. */
    expect(modes(["postgresql", "clickhouse", "server", "postgres"])).toEqual({
      postgresql: "brand",
      clickhouse: "mono",
      server: "concept",
      postgres: "brand",
    });
  });

  it("narrows by `?q=`, case-insensitively", () => {
    const hits = iconVocabulary({ q: "POSTGRE" });
    expect(hits.total).toBeGreaterThan(0);
    expect(hits.icons.every((i) => i.name.toLowerCase().includes("postgre"))).toBe(true);
    expect(hits.total).toBeLessThan(iconVocabulary().total);
  });

  it("narrows by `?mode=`", () => {
    const brand = iconVocabulary({ mode: "brand" });
    expect(brand.total).toBeGreaterThan(0);
    expect(brand.icons.every((i) => i.mode === "brand")).toBe(true);
    expect(brand.total).toBeLessThan(iconVocabulary().total);
    expect(iconVocabulary({ mode: "concept" }).total).toBeGreaterThan(0);
  });

  it("combines both narrowings, and a query that hits nothing is empty rather than the whole set", () => {
    const both = iconVocabulary({ q: "lambda", mode: "brand" });
    expect(both.icons.every((i) => i.mode === "brand" && i.name.includes("lambda"))).toBe(true);
    expect(iconVocabulary({ q: "not-a-single-icon" })).toEqual({ icons: [], total: 0, returned: 0, truncated: false });
  });

  it("truncates visibly — a count, a returned slice and the flag, never silently", () => {
    const small = iconVocabulary({ limit: 10 });
    expect(small.icons).toHaveLength(10);
    expect(small.returned).toBe(10);
    expect(small.total).toBeGreaterThan(10);
    expect(small.truncated).toBe(true);
    /* The default cap: an unfiltered fetch stays readable, and says it is a slice. */
    const cap = iconVocabulary();
    expect(cap.truncated).toBe(cap.total > ICON_LIMIT);
  });
});
