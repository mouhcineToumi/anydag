import { describe, expect, it } from "vitest";

import { parseBoard } from "@/board/parseBoard";
import { referencedInto } from "@/board/survive";
import type { BoardLink } from "@/board/types";
import { CODES } from "@/dsl/codes";
import { reattachable, reattachLink, removeLooseLink } from "@/edit/connect";
import { routeLinks } from "@/layout/boardRoute";
import type { Theme } from "@/theme/contract";
import { listProblems } from "@/ui/problemList";

import theme from "../themes/paper/theme.json";

const T = theme as unknown as Theme;

/**
 * A board link to something that is not there hangs from a loose end (#173) — #168's loose end,
 * one level up, for the `edges` fence. Kept by the parse with the missing end as typed, drawn from
 * the end it has to a stub, mended by a drop that rewrites that one end, deleted by `removeNode`'s
 * rules, and pointed at by its problem so "Show" picks it.
 */

/* The `edges` fence opens on line 13, so its first statement is line 14. */
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

const withLinks = (...statements: string[]) => parseBoard("t", [ITEMS, "```edges {#links}", ...statements, "```", ""].join("\n"));

describe("a hanging board link, as parsed", () => {
  it("keeps a link to a card a diagram does not have, hanging from its other end", () => {
    const b = withLinks("infra.ghost --> a");
    expect(b.errors.map((e) => e.code)).toEqual([CODES.EB_LINK_UNKNOWN_NODE]);
    expect(b.links).toMatchObject([{ from: { item: "infra", node: "ghost" }, to: { item: "a" }, loose: "from" }]);
    expect(b.errors[0]?.target).toEqual({ what: "link", id: "links-1" });
  });

  it("drops a link with both ends missing: there is nothing for it to hang from", () => {
    const b = withLinks("ghost --> nobody");
    expect(b.links).toEqual([]);
    expect(b.errors.every((e) => e.target === undefined)).toBe(true);
  });

  it("hangs every hop of a chain through the missing name, and says it once, at the first", () => {
    const b = withLinks("a --> ghost --> b");
    expect(b.links.map((l) => l.loose)).toEqual(["to", "from"]);
    expect(b.errors).toHaveLength(1);
    expect(b.errors[0]?.target).toEqual({ what: "link", id: "links-1" });
  });

  it("is a name and not a card, so a rewrite has nothing of it to lose", () => {
    const b = withLinks("a --> infra.ghost", "a --> infra.api");
    expect(referencedInto(b, new Set(["infra"]))).toEqual([{ item: "infra", node: "api" }]);
  });

  it("is a problem a person sees, on the fence, with the link to pick", () => {
    const [p, ...rest] = listProblems(withLinks("a --> b", "a --> ghost"));
    expect(rest).toEqual([]);
    expect(p).toMatchObject({ code: CODES.EB_LINK_UNKNOWN_ITEM, item: "links", target: { what: "link", id: "links-2" } });
    expect(p?.words).not.toContain("EB_");
    expect(p?.words).not.toContain("ghost");
  });

  it("is not a problem a person sees when nothing could be drawn", () => {
    expect(listProblems(withLinks("ghost --> nobody"))).toEqual([]);
  });
});

const link = (extra: Partial<BoardLink>): BoardLink => ({
  id: "l1",
  fence: "links",
  from: { item: "a" },
  to: { item: "ghost" },
  loose: "to",
  dash: false,
  head: "chevron",
  tail: "none",
  line: 1,
  ...extra,
});

describe("where a hanging link's stub is drawn", () => {
  const boxes = new Map([
    ["a", { x: 0, y: 0, w: 200, h: 100 }],
    ["b", { x: 600, y: 0, w: 200, h: 100 }],
  ]);
  const m = T.metric;

  it("after the item for a missing target, level with it, and the line runs to it", () => {
    const r = routeLinks({ links: [link({})], boxes, nodeBoxes: new Map(), metric: m });
    expect(r.edges).toHaveLength(1);
    const [st] = r.loose;
    expect(st).toMatchObject({ link: "l1", ref: "ghost", size: m.node.end });
    expect(st!.x + r.origin.x).toBe(200 + m.edge.reach.min);
    expect(st!.y + r.origin.y + st!.size / 2).toBe(50);
  });

  it("before the item for a missing source", () => {
    const r = routeLinks({
      links: [link({ from: { item: "ghost" }, to: { item: "b" }, loose: "from" })],
      boxes,
      nodeBoxes: new Map(),
      metric: m,
    });
    const [st] = r.loose;
    expect(st!.x + r.origin.x + st!.size).toBe(600 - m.edge.reach.min);
  });

  it("stacks several from one item on one side, so none hides another", () => {
    const r = routeLinks({
      links: [link({}), link({ id: "l2", to: { item: "other" } })],
      boxes,
      nodeBoxes: new Map(),
      metric: m,
    });
    expect(r.loose).toHaveLength(2);
    expect(r.loose[1]!.y - r.loose[0]!.y).toBe(m.node.end + m.node.gap);
  });

  it("not at all when the end it has is not placed", () => {
    const r = routeLinks({ links: [link({ from: { item: "hidden" } })], boxes, nodeBoxes: new Map(), metric: m });
    expect(r.edges).toEqual([]);
    expect(r.loose).toEqual([]);
  });
});

describe("dropping a hanging link's loose end on something", () => {
  const hanging = link({});

  it("rewrites that one end, and nothing else on the line", () => {
    expect(reattachLink('a --> ghost "reads" hue=teal via="10,20"', hanging, { item: "b" })).toBe(
      'a --> b "reads" hue=teal via="10,20"',
    );
    expect(reattachLink("a --> ghost", hanging, { item: "infra", node: "api" })).toBe("a --> infra.api");
  });

  it("names the card, never a row or a boundary an `edges` fence cannot say", () => {
    expect(reattachLink("a --> ghost", hanging, { item: "infra", node: "api", row: "x" })).toBe("a --> infra.api");
    expect(reattachLink("a --> ghost", hanging, { item: "infra", node: "zone", boundary: true })).toBe("a --> infra");
  });

  it("mends a missing card inside a diagram the same way", () => {
    const lost = link({ to: { item: "infra", node: "ghost" } });
    expect(reattachLink("a -.-> infra.ghost", lost, { item: "infra", node: "api" })).toBe("a -.-> infra.api");
  });

  it("refuses the thing it hangs from, and a link that is not hanging", () => {
    expect(reattachable(hanging, { item: "a" })).toBe(false);
    expect(reattachLink("a --> ghost", hanging, { item: "a" })).toBeNull();
    expect(reattachLink("a --> b", link({ to: { item: "b" }, loose: undefined }), { item: "infra" })).toBeNull();
  });
});

describe("deleting a hanging link", () => {
  it("takes the statement when the missing name was all of one side", () => {
    expect(removeLooseLink("a --> b\na --> ghost", 2, "ghost")).toBe("a --> b");
    expect(removeLooseLink("a --> ghost", 1, "ghost")).toBe("");
  });

  it("by `removeNode`'s rules: a bus keeps its other sources, a chain the hop that did not touch it", () => {
    expect(removeLooseLink("ghost & a --> b", 1, "ghost")).toBe("a --> b");
    expect(removeLooseLink("a --> b --> ghost", 1, "ghost")).toBe("a --> b");
  });

  it("touches only its own line", () => {
    expect(removeLooseLink("a --> ghost\nb --> ghost", 1, "ghost")).toBe("b --> ghost");
  });
});
