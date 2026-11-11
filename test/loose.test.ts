import { describe, expect, it } from "vitest";

import { parseBoard } from "@/board/parseBoard";
import { parseDiagram } from "@/dsl/parse";
import { retargetRef } from "@/dsl/restate";
import { edgeTargets, looseOf, reattachLoose } from "@/edit/pick";
import { CODES } from "@/dsl/codes";
import { diagnoseBoard } from "@/dsl/diagnose";

/** A link to a card that is not there (#145): drawn hanging, not dropped. */
const BODY = ['service api "API"', 'store db "DB"', "api --> db", 'api --> ghost "reads"'].join("\n");

describe("a loose end", () => {
  const g = parseDiagram("arch", BODY)!;
  const stub = g.nodes.find((n) => n.kind === "loose");

  it("is drawn where the missing card would be, and the edge runs to it", () => {
    expect(stub).toMatchObject({ id: "__loose-0", loose: { ref: "ghost" }, line: 4 });
    expect(g.edges.some((e) => e.from.node === "api" && e.to.node === "__loose-0" && e.label === "reads")).toBe(true);
  });

  it("leaves the diagnostic exactly as an agent reads it, pointed at the edge", () => {
    const board = parseBoard("t", ["```arch {#a}", BODY, "```", ""].join("\n"));
    const [d] = diagnoseBoard(board).items[0]!.diagnostics;
    expect(d).toMatchObject({ code: CODES.E_UNKNOWN_ID, line: 5, target: { what: "edge" } });
  });

  it("is one stub per missing name per line, so a chain through it meets at one", () => {
    const chain = parseDiagram("arch", ['service a "A"', 'service b "B"', "a --> ghost --> b"].join("\n"))!;
    expect(chain.nodes.filter((n) => n.kind === "loose")).toHaveLength(1);
  });

  it("is not made when there is nothing for it to hang from", () => {
    expect(parseDiagram("arch", "x --> y")!.nodes.filter((n) => n.kind === "loose")).toEqual([]);
    /* The card it would hang from could not be read either: that statement is skipped, and so is this. */
    const skipped = parseDiagram("arch", ['database api "API"', "api --> ghost"].join("\n"))!;
    expect(skipped.nodes.filter((n) => n.kind === "loose")).toEqual([]);
  });

  it("is never offered as an end to point an edge at", () => {
    expect(edgeTargets("arch", BODY).nodes).toEqual(["api", "db"]);
  });
});

describe("dropping a loose end on a card", () => {
  it("names the card on the edge's line, and keeps its label", () => {
    expect(looseOf("arch", BODY, "__loose-0")).toMatchObject({ ref: "ghost", line: 4 });
    expect(reattachLoose("arch", BODY, "__loose-0", "db")).toBe(BODY.replace("api --> ghost", "api --> db"));
  });

  it("writes nothing for something that is not a stub, or onto another stub", () => {
    expect(reattachLoose("arch", BODY, "api", "db")).toBeNull();
    expect(reattachLoose("arch", BODY, "__loose-0", "__loose-1")).toBeNull();
  });

  it("mends every hop of a chain that named it", () => {
    expect(retargetRef("a --> ghost --> b", "ghost", "c")).toBe("a --> c --> b");
    expect(retargetRef('a --> ghost "ghost"', "ghost", "c")).toBe('a --> c "ghost"');
  });
});
