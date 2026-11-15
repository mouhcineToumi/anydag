import { describe, expect, it } from "vitest";

import { fold, snippet, type SearchDoc, wordsOf } from "../src/search/engine";
import { searchDocs, typosFor, within } from "../server/words";

/** Matching and marking, over the FTS5 index a vault's search asks (`server/words.ts`). What the list shows is only as good as these two. */

const DOCS: SearchDoc[] = [
  {
    id: "a000000000",
    name: "work/checkout",
    kind: "board",
    title: "Checkout",
    units: [
      { what: "title", text: "Checkout" },
      { part: "intro", what: "md", text: "Payments settle through Stripe every night." },
      { part: "flow", what: "arch", text: "Orders API · FastAPI · Postgres · writes" },
    ],
  },
  {
    id: "b000000000",
    name: "notes/café",
    kind: "note",
    title: "Café notes",
    units: [
      { what: "title", text: "Café notes" },
      { part: "L3", what: "paragraph", text: "The espresso machine needs descaling." },
      { part: "^pay", what: "paragraph", text: "Payments at the till are card only." },
    ],
  },
];

const where = (q: string) => searchDocs(DOCS, q).map((h) => `${h.doc.name}#${h.unit.part ?? ""}`);

describe("search", () => {
  it("finds a word in notes and boards alike, in one list", () => {
    expect(where("payments").sort()).toEqual(["notes/café#^pay", "work/checkout#intro"]);
  });

  it("needs every word, in any order, and reads the words being typed as prefixes", () => {
    expect(where("settle pay")).toEqual(["work/checkout#intro"]);
    expect(where("espr")).toEqual(["notes/café#L3"]);
  });

  it("reaches inside a diagram, whose unit is every label it draws", () => {
    expect(where("postgres")).toEqual(["work/checkout#flow"]);
  });

  it("finds a title, which opens the document itself", () => {
    expect(where("checkout")).toEqual(["work/checkout#"]);
  });

  it("forgives a typo in a long word and none in a short one", () => {
    expect(where("espreso")).toEqual(["notes/café#L3"]);
    expect(where("apx")).toEqual([]);
  });

  it("ignores accents and case, both ways", () => {
    expect(where("CAFE")).toEqual(["notes/café#"]);
    expect(fold("Café")).toBe("cafe");
  });

  it("says nothing for an empty query", () => {
    expect(searchDocs(DOCS, "   ")).toEqual([]);
  });

  it("keeps a document from filling the list on its own", () => {
    const many: SearchDoc[] = [
      {
        id: "c000000000",
        name: "long",
        kind: "note",
        units: Array.from({ length: 10 }, (_, i) => ({ part: `L${i + 1}`, what: "paragraph", text: `alpha ${i}` })),
      },
      { id: "d000000000", name: "short", kind: "note", units: [{ part: "L1", what: "paragraph", text: "alpha too" }] },
    ];
    const hits = searchDocs(many, "alpha");
    expect(hits.filter((h) => h.doc.name === "long")).toHaveLength(3);
    expect(hits.some((h) => h.doc.name === "short")).toBe(true);
  });
});

describe("ranking and the words it marks", () => {
  it("ranks a whole-word match above a prefix of a longer word", () => {
    const docs: SearchDoc[] = [
      { id: "e000000000", name: "long", kind: "note", units: [{ part: "L1", what: "paragraph", text: "paymentsystem notes" }] },
      { id: "f000000000", name: "exact", kind: "note", units: [{ part: "L1", what: "paragraph", text: "payment notes" }] },
    ];
    expect(searchDocs(docs, "payment").map((h) => h.doc.name)).toEqual(["exact", "long"]);
  });

  it("names the words each hit matched, folded, for the snippet to mark", () => {
    const [hit] = searchDocs(DOCS, "pay STRI");
    expect(hit!.terms.sort()).toEqual(["payments", "stripe"]);
    const [typo] = searchDocs(DOCS, "espreso");
    expect(typo!.terms).toEqual(["espresso"]);
  });

  it("cuts and folds a text one way for the index, the query and the snippet", () => {
    expect(wordsOf("Orders API · FastAPI → Postgres\u0001x")).toEqual(["orders", "api", "fastapi", "postgres", "x"]);
    expect(wordsOf("api-gateway Café")).toEqual(["api", "gateway", "cafe"]);
  });

  it("forgives one typo in five letters from five on, and counts them the way MiniSearch did", () => {
    expect([4, 5, 7, 8, 12, 13, 40].map(typosFor)).toEqual([0, 1, 1, 2, 2, 3, 6]);
    expect(within("espreso", "espresso", 1)).toBe(true);
    expect(within("kitten", "sitting", 2)).toBe(false);
    expect(within("kitten", "sitting", 3)).toBe(true);
  });
});

describe("snippet", () => {
  const joined = (text: string, terms: string[]) =>
    snippet(text, terms)
      .map((r) => (r.hit ? `[${r.text}]` : r.text))
      .join("");

  it("marks exactly the words that matched, whatever their case", () => {
    expect(joined("Payments settle through Stripe.", ["stripe"])).toBe("Payments settle through [Stripe].");
  });

  it("shows a window around the first match of a long text, cut on a word, with ellipses", () => {
    const text = `${"lorem ".repeat(40)}needle ${"ipsum ".repeat(60)}`.trim();
    const out = joined(text, ["needle"]);
    expect(out.startsWith("…")).toBe(true);
    expect(out.endsWith("…")).toBe(true);
    expect(out).toContain("[needle]");
    expect(out.length).toBeLessThan(200);
    expect(out).not.toMatch(/…\S*lore\b/);
  });

  it("marks an accented word from its folded term", () => {
    expect(joined("Café notes", ["cafe"])).toBe("[Café] notes");
  });
});
