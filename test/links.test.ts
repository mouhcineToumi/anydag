import { describe, expect, it } from "vitest";

import { placeItems } from "@/board/flow";
import { endText, parseLinks } from "@/board/links";
import { parseBoard } from "@/board/parseBoard";
import { CODES } from "@/dsl/codes";

/**
 * The `edges` fence: links between items on the board.
 *
 * Two halves, tested apart because they fail apart. `parseLinks` reads the grammar and knows
 * nothing about what is on the board; `parseBoard` decides what each endpoint points at, which is
 * the half that can only be wrong in the presence of real items. The seam between them is the
 * endpoint split — the parser guesses `item.node`, the resolver overrules it when there is an item
 * called `item.node` — and that is the one thing tested from both sides.
 */

const links = (body: string) => parseLinks(body, 0, "l");
const codes = (ds: { code: string }[]) => ds.map((d) => d.code);

describe("the link grammar", () => {
  it("reads every arrow the tokenizer knows", () => {
    const cases: [string, boolean, string, string][] = [
      ["-->", false, "chevron", "none"],
      ["->", false, "chevron", "none"],
      ["-.->", true, "chevron", "none"],
      ["..>", true, "open", "none"],
      ["<->", false, "chevron", "chevron"],
      ["--", false, "none", "none"],
      ["---", false, "none", "none"],
      ["-.-", true, "none", "none"],
      ["..", true, "none", "none"],
      ["--|>", false, "triangle", "none"],
      ["*--", false, "none", "diamond"],
      ["--o", false, "diamond-hollow", "none"],
    ];
    for (const [arrow, dash, head, tail] of cases) {
      const { links: got, diagnostics } = links(`a ${arrow} b`);
      expect(codes(diagnostics), arrow).toEqual([]);
      expect([got[0]?.dash, got[0]?.head, got[0]?.tail], arrow).toEqual([dash, head, tail]);
    }
  });

  it("takes a label as a string, or after Mermaid's colon", () => {
    expect(links('a --> b "signs in"').links[0]?.label).toBe("signs in");
    expect(links('a --> b: "signs in"').links[0]?.label).toBe("signs in");
    /* A pasted Mermaid line has no quotes; joining the bare words is cheaper than making the author
       add them, and the join stops at the first modifier so nothing swallows `hue=`. */
    expect(links("a --> b: signs in").links[0]?.label).toBe("signs in");
    expect(links("a --> b: signs in hue=teal").links[0]).toMatchObject({ label: "signs in", hue: "teal" });
  });

  it("reads hue and quiet, and keeps quiet about a key it does not know", () => {
    expect(links('a --> b "x" hue=teal quiet').links[0]).toMatchObject({ hue: "teal", quiet: true });
    /* An unknown key is not an error anywhere else in a board file — a fence line preserves the ones
       it has never heard of — and a link statement disagreeing with that would be a trap. */
    const { links: got, diagnostics } = links("a --> b rank=3 owner=ops");
    expect(codes(diagnostics)).toEqual([]);
    expect(got).toHaveLength(1);
  });

  it("drops an unknown hue and warns, rather than binding it or refusing the statement", () => {
    const { links: got, diagnostics } = links("a --> b hue=purple");
    expect(got).toHaveLength(1);
    expect(got[0]?.hue).toBeUndefined();
    expect(codes(diagnostics)).toEqual([CODES.W_UNKNOWN_HUE]);
    expect(diagnostics[0]?.severity).toBe("warn");
    expect(diagnostics[0]?.message).toContain("Did you mean `violet`");
  });

  it("reads `via` as one point, and drops anything else with a warning", () => {
    expect(links('a --> b via="320,180"').links[0]?.via).toEqual({ x: 320, y: 180 });
    /* Negatives and decimals: the board is infinite in all four directions, and `parseAttrs`
       learned to read a coordinate above the origin in M10 for the same reason. */
    expect(links('a --> b via="-40,-8"').links[0]?.via).toEqual({ x: -40, y: -8 });
    expect(links('a --> b via=" 12 , 34 "').links[0]?.via).toEqual({ x: 12, y: 34 });

    /* Two points would be a polyline, and a polyline through hand-placed points is a drawing.
       Dropped and reported, never half-read: the link still draws, straight. */
    for (const bad of ['via="320"', 'via="320,180 400,90"', 'via="a,b"', "via=320"]) {
      const { links: got, diagnostics } = links(`a --> b ${bad}`);
      expect(got, bad).toHaveLength(1);
      expect(got[0]?.via, bad).toBeUndefined();
      expect(codes(diagnostics), bad).toEqual([CODES.WB_BAD_VIA]);
      expect(diagnostics[0]?.severity, bad).toBe("warn");
    }
  });

  it("gives every hop of a chain its own bend, because the modifiers belong to the hop", () => {
    const got = links('a --> b via="10,20" --> c via="30,40"').links;
    expect(got.map((l) => l.via)).toEqual([
      { x: 10, y: 20 },
      { x: 30, y: 40 },
    ]);
  });

  it("expands a chain and a bus", () => {
    const chain = links("a --> b --> c").links;
    expect(chain.map((l) => [l.from.item, l.to.item])).toEqual([
      ["a", "b"],
      ["b", "c"],
    ]);
    const bus = links("a & b --> c").links;
    expect(bus.map((l) => [l.from.item, l.to.item])).toEqual([
      ["a", "c"],
      ["b", "c"],
    ]);
    /* No trunk id: a board link is a curve between two boxes, and `&` is only shorthand for
       writing the statement twice. */
    expect(bus.map((l) => l.id)).toEqual(["l-1", "l-2"]);
  });

  it("splits an endpoint on the last dot", () => {
    expect(links("arch1.db --> b").links[0]?.from).toEqual({ item: "arch1", node: "db" });
    expect(links("a.b.c --> b").links[0]?.from).toEqual({ item: "a.b", node: "c" });
    expect(links("a --> b").links[0]?.from).toEqual({ item: "a" });
    /* And puts itself back together, which is how the resolver gets to try the whole string. */
    expect(endText({ item: "a.b", node: "c" })).toBe("a.b.c");
    expect(endText({ item: "a" })).toBe("a");
  });

  it("carries the fence's line, so a diagnostic can point at the file", () => {
    const { links: got } = parseLinks("\na --> b\nb --> c", 40, "l");
    expect(got.map((l) => l.line)).toEqual([42, 43]);
  });

  it("costs one diagnostic per bad statement and keeps the good ones", () => {
    const { links: got, diagnostics } = parseLinks("a --> b\nc d\nb --> c", 10, "l");
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({ code: CODES.EB_LINK_SYNTAX, line: 12 });
    expect(diagnostics[0]?.message).toContain("arrow");
    expect(got.map((l) => l.id)).toEqual(["l-1", "l-2"]);
  });

  it("drops the whole of a statement it could not finish", () => {
    /* Half of `a --> b --> ?` is a link nobody wrote, and the diagnostic is the whole report. */
    const { links: got, diagnostics } = links("a --> b -->\nx --> y");
    expect(diagnostics).toHaveLength(1);
    expect(got.map((l) => [l.from.item, l.to.item])).toEqual([["x", "y"]]);
  });

  it("never stalls on a token no statement can start with", () => {
    const { diagnostics } = links("}\na --> b");
    expect(codes(diagnostics)).toEqual([CODES.EB_LINK_SYNTAX]);
  });
});

const board = (body: string) => parseBoard("t", body);

/* Line 1 is the first fence, and each block below is three lines and a blank one, so the `edges`
   fence opens on line 13 and its first statement is on line 14. */
const ITEMS = [
  "```md {#a}",
  "one",
  "```",
  "",
  "```md {#b}",
  "two",
  "```",
  "",
  "```arch {#infra}",
  'service api "API"',
  "```",
  "",
].join("\n");

const withLinks = (...statements: string[]) => board([ITEMS, "```edges {#links}", ...statements, "```", ""].join("\n"));

describe("resolving a link against the board", () => {
  it("finds the fence's own line", () => {
    const b = withLinks("a --> b");
    expect(b.items.find((it) => it.id === "links")?.line).toBe(13);
    expect(b.links[0]?.line).toBe(14);
  });

  it("keeps a link whose ends are both on the page", () => {
    const b = withLinks("a --> b", "b -.-> infra.api");
    expect(b.errors).toEqual([]);
    expect(b.links.map((l) => l.id)).toEqual(["links-1", "links-2"]);
    expect(b.links[1]?.to).toEqual({ item: "infra", node: "api" });
  });

  it("reports an item nothing on the page is called", () => {
    const b = withLinks("a --> ghost");
    expect(codes(b.errors)).toEqual([CODES.EB_LINK_UNKNOWN_ITEM]);
    expect(b.errors[0]?.line).toBe(14);
    expect(b.errors[0]?.message).toContain("ghost");
    expect(b.links).toEqual([]);
  });

  it("suggests the item it was probably reaching for", () => {
    expect(withLinks("a --> infr").errors[0]?.message).toContain("Did you mean `infra`");
  });

  it("reports a node the named diagram does not declare", () => {
    const b = withLinks("a --> infra.nope");
    expect(codes(b.errors)).toEqual([CODES.EB_LINK_UNKNOWN_NODE]);
    expect(b.errors[0]?.line).toBe(14);
    expect(b.errors[0]?.message).toContain("`infra` has no node `nope`");
    /* Near enough to be worth saying gets said; `nope` is not, and a wrong guess is worse than
       none — the budget in `nearest()` is what decides. */
    expect(withLinks("a --> infra.ap").errors[0]?.message).toContain("Did you mean `api`");
  });

  it("reports a node ref on an item that is not a diagram", () => {
    const b = withLinks("a.header --> b");
    expect(codes(b.errors)).toEqual([CODES.EB_LINK_UNKNOWN_NODE]);
    expect(b.errors[0]?.message).toContain("not a diagram");
  });

  it("reports a syntax error against the board's own line", () => {
    const b = withLinks("a --> b", "c d");
    expect(codes(b.errors)).toEqual([CODES.EB_LINK_SYNTAX]);
    expect(b.errors[0]?.line).toBe(15);
    expect(b.links).toHaveLength(1);
  });

  it("prefers an item whose id contains a dot over the split", () => {
    /* `a.b` reads as node `b` of item `a` until an item is actually called `a.b`. An id that exists
       beats a split that might, which is how `resolveRefs()` reads a row ref too. */
    const b = board(["```md {#a.b}", "one", "```", "", "```edges {#links}", "a.b --> a.b", "```", ""].join("\n"));
    expect(b.errors).toEqual([]);
    expect(b.links[0]?.from).toEqual({ item: "a.b" });
  });

  it("says a wrong id once, however many times the statement mentions it", () => {
    /* A chain names its middle twice and a bus names its target once per source. */
    expect(codes(withLinks("a --> ghost --> b").errors)).toEqual([CODES.EB_LINK_UNKNOWN_ITEM]);
    expect(codes(withLinks("a & b --> ghost").errors)).toEqual([CODES.EB_LINK_UNKNOWN_ITEM]);
  });

  it("refuses to reach across a page", () => {
    /* A page is a separate drawing, and a curve cannot leave one. */
    const b = board(
      [
        "```md {#a}",
        "one",
        "```",
        "",
        "```md {#far page=page-2}",
        "two",
        "```",
        "",
        "```edges {#links}",
        "a --> far",
        "```",
        "",
      ].join("\n"),
    );
    expect(codes(b.errors)).toEqual([CODES.EB_LINK_UNKNOWN_ITEM]);
    expect(b.links).toEqual([]);
  });

  it("merges several fences in file order, with ids that cannot collide", () => {
    const b = board(
      [ITEMS, "```edges {#one}", "a --> b", "```", "", "```edges {#two}", "b --> a", "a --> infra", "```", ""].join("\n"),
    );
    expect(b.errors).toEqual([]);
    expect(b.links.map((l) => l.id)).toEqual(["one-1", "two-1", "two-2"]);
  });

  it("gives the edges fence no place on the paper", () => {
    /* It is an item so the panel, the patcher and undo can reach it, and it draws nothing — so a
       place would be a hole in the flow the size of an item nobody can see. */
    const b = withLinks("a --> b");
    expect(b.items.some((it) => it.id === "links")).toBe(true);
    expect(placeItems(b, "page-1", new Map()).has("links")).toBe(false);
  });
});

/**
 * A board-level group as a link endpoint.
 *
 * A group is a `group=` attribute shared by its members and nothing else: no wrapper item, no id.
 * What it has is a name, and a name is enough to be an endpoint, because what a link needs at the
 * far end is a box and the union of the members' boxes is one. Until this the grammar had no way
 * to say it: a person who grouped six pen strokes into a drawing could not link the drawing to
 * anything, and hand-typing the group's name came back `EB_LINK_UNKNOWN_ITEM`.
 */
describe("a link that names a group", () => {
  const grouped = (...statements: string[]) =>
    board(
      [
        "```md {#a group=g1}",
        "one",
        "```",
        "",
        "```md {#b group=g1}",
        "two",
        "```",
        "",
        "```md {#c}",
        "three",
        "```",
        "",
        "```edges {#links}",
        ...statements,
        "```",
        "",
      ].join("\n"),
    );

  it("resolves the group's name, and says it is one", () => {
    const b = grouped("g1 --> c");
    expect(b.errors).toEqual([]);
    expect(b.links[0]?.from).toEqual({ item: "g1", group: true });
    expect(b.links[0]?.to).toEqual({ item: "c" });
  });

  it("reads it at either end, and between two groups", () => {
    const b = board(
      [
        "```md {#a group=g1}",
        "one",
        "```",
        "",
        "```md {#b group=g2}",
        "two",
        "```",
        "",
        "```edges {#links}",
        "g1 --> g2",
        "```",
        "",
      ].join("\n"),
    );
    expect(b.errors).toEqual([]);
    expect(b.links[0]?.from).toEqual({ item: "g1", group: true });
    expect(b.links[0]?.to).toEqual({ item: "g2", group: true });
  });

  it("lets an item win a name both could answer to", () => {
    /* The order `resolveLinks` already uses for the dot, for the same reason: an item id is a
       thing somebody named and a group name is generated, so the one they typed on purpose wins. */
    const b = board(
      [
        "```md {#g1}",
        "an item that happens to be called g1",
        "```",
        "",
        "```md {#a group=g1}",
        "a member of the group also called g1",
        "```",
        "",
        "```edges {#links}",
        "g1 --> a",
        "```",
        "",
      ].join("\n"),
    );
    expect(b.errors).toEqual([]);
    expect(b.links[0]?.from).toEqual({ item: "g1" });
  });

  it("does not reach a group on another page", () => {
    const b = board(
      [
        "---",
        "pages:",
        "  - one",
        "  - two",
        "---",
        "",
        "```md {#a page=page-1 group=g1}",
        "here",
        "```",
        "",
        "```md {#b page=page-2}",
        "there",
        "```",
        "",
        "```edges {#links page=page-2}",
        "g1 --> b",
        "```",
        "",
      ].join("\n"),
    );
    expect(codes(b.errors)).toEqual([CODES.EB_LINK_UNKNOWN_ITEM]);
    expect(b.links).toEqual([]);
  });

  it("suggests a group name for a near miss, alongside the item ids", () => {
    expect(grouped("g2 --> c").errors[0]?.message).toContain("Did you mean `g1`");
  });

  it("refuses `group.node`, because a group has no cards of its own", () => {
    /* It splits on the last dot like anything else, finds no item called `g1`, and reports that —
       rather than quietly anchoring on the group and dropping the half nobody could honour. */
    const b = grouped("g1.thing --> c");
    expect(codes(b.errors)).toEqual([CODES.EB_LINK_UNKNOWN_ITEM]);
    expect(b.links).toEqual([]);
  });

  it("takes the link with it when the group stops existing", () => {
    /* `resolveLinks` pushes a link only when both ends resolve, so ungrouping makes the line
       vanish rather than dangle — the rule an unknown item has always followed. */
    const b = grouped("g1 --> c");
    expect(b.links).toHaveLength(1);
    const gone = board(
      ["```md {#a}", "one", "```", "", "```md {#c}", "three", "```", "", "```edges {#links}", "g1 --> c", "```", ""].join("\n"),
    );
    expect(codes(gone.errors)).toEqual([CODES.EB_LINK_UNKNOWN_ITEM]);
    expect(gone.links).toEqual([]);
  });
});
