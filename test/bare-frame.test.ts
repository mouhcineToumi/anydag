import { describe, expect, it } from "vitest";

import { isFragment, LIBRARY } from "@/board/library";
import { framed } from "@/board/types";
import { parseDiagram } from "@/dsl/parse";

/**
 * The header rule: when a diagram wears a title, a rule and the type chip.
 *
 * A header used to be derived from the model — one node with nothing around it drew bare, whatever
 * the author wrote — so an atom dropped from the library grew a header the moment a second card
 * joined it, titled with its own generated id (`arch-f4t8`). Now a header is only ever something
 * the author asked for: `framed()` in `@/board/types` reads three fields off the item — `frame`,
 * `title`, `subtitle` — and nothing about the parsed diagram. That is the whole of what is worth
 * testing here: the node count plays no part any more, and `frame=` still overrides either way.
 */

describe("framed()", () => {
  it("is off with no title, no subtitle and no frame= override", () => {
    expect(framed({})).toBe(false);
  });

  it("is on the moment a title is set", () => {
    expect(framed({ title: "API" })).toBe(true);
  });

  it("is on with only a subtitle — a subtitle alone is still the author naming the drawing", () => {
    expect(framed({ subtitle: "what serves it" })).toBe(true);
  });

  it("frame=full wins even with neither a title nor a subtitle", () => {
    expect(framed({ frame: "full" })).toBe(true);
  });

  it("frame=none wins even with both a title and a subtitle", () => {
    expect(framed({ frame: "none", title: "API", subtitle: "what serves it" })).toBe(false);
  });
});

describe("node count plays no part", () => {
  it("a titled one-node diagram is framed", () => {
    const g = parseDiagram("arch", 'service api "API"')!;
    expect(g.nodes.length).toBe(1);
    expect(framed({ title: "API" })).toBe(true);
  });

  it("an untitled twelve-node diagram is frameless", () => {
    const body = Array.from({ length: 12 }, (_, i) => `service s${i} "Service ${i}"`).join("\n");
    const g = parseDiagram("arch", body)!;
    expect(g.nodes.length).toBe(12);
    expect(framed({})).toBe(false);
  });

  /**
   * The old rule refused to go bare on `mindmap`, `timeline` and `gitgraph` whatever they held — a
   * root with nothing hanging off it, a lone date, a lone commit are all "one node, no edge, no
   * group, no lane, no legend", the exact shape the old test held those three out of. There is no
   * dialect exception any more: the three parse exactly as before, and whether the item wears a
   * header depends only on whether the author named it, same as any other type.
   */
  it("no exception for mindmap, timeline or gitgraph", () => {
    for (const [type, body] of [
      ["mindmap", "Root"],
      ["timeline", '2026-01-01 "A moment"'],
      ["gitgraph", 'commit "one"'],
    ] as const) {
      const g = parseDiagram(type, body)!;
      expect(g, type).not.toBeNull();
      expect(framed({}), type).toBe(false);
      expect(framed({ title: "Whatever this is" }), type).toBe(true);
    }
  });
});

describe("the library, dropped on the paper", () => {
  const titleOf = (attrs: Record<string, unknown> | undefined) => ({
    title: attrs?.title as string | undefined,
    subtitle: attrs?.subtitle as string | undefined,
    frame: attrs?.frame as "none" | "full" | undefined,
  });

  it("frames only the worked starters an author already named — everything else is frameless", () => {
    const titled = LIBRARY.filter((b) => framed(titleOf(b.attrs)))
      .map((b) => b.id)
      .sort();
    /* The five worked starters (`STARTERS` in `library/diagrams.ts`) are the registered components
       the brief allows a title by construction — bigger, hand-authored diagrams whose author is
       this repository. Every atom, molecule, pattern and small template carries none. */
    expect(titled).toEqual(["arch-pipeline", "arch-web-app", "erd-shop", "flow-review", "sequence-auth"]);
  });

  it("keeps every fragment frameless, whatever it holds when dropped alone", () => {
    for (const b of LIBRARY.filter(isFragment)) {
      expect(framed(titleOf(b.attrs)), b.id).toBe(false);
    }
  });
});
