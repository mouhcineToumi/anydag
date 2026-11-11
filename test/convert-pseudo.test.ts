import { describe, expect, it } from "vitest";

import { parseDiagram } from "@/dsl/parse";
import { convertPseudo } from "@/edit/build";

const item = (body: string) => ({ type: "state" as const, body, dir: undefined });

describe("convertPseudo", () => {
  const body = ['state new "New"', 'state done "Done"', "", "[*] --> new", "new --> done", "done --> [*]"].join("\n");

  it("declares a start above the line and names that one [*] with it", () => {
    const g = parseDiagram("state", body)!;
    const start = g.nodes.find((n) => n.kind === "start")!;
    const made = convertPseudo(item(body), start.id)!;
    expect(made.id).toBe("start2");
    expect(made.body).toBe(
      ['state new "New"', 'state done "Done"', "", "start start2", "start2 --> new", "new --> done", "done --> [*]"].join("\n"),
    );
  });

  it("an end becomes an end, and the start's [*] is left as written", () => {
    const g = parseDiagram("state", body)!;
    const end = g.nodes.find((n) => n.kind === "end")!;
    const made = convertPseudo(item(body), end.id)!;
    expect(made.body.split("\n").slice(3)).toEqual(["[*] --> new", "new --> done", "end end2", "done --> end2"]);
    expect(parseDiagram("state", made.body)!.nodes.find((n) => n.id === "end2")?.kind).toBe("end");
  });

  it("picks the right [*] on a chain, by the order the parser made them", () => {
    const chain = ['state a "A"', "[*] --> a --> [*]"].join("\n");
    const ends = parseDiagram("state", chain)!.nodes.filter((n) => n.id.startsWith("__"));
    expect(ends.map((n) => n.kind)).toEqual(["start", "end"]);
    expect(convertPseudo(item(chain), ends[1]!.id)!.body).toBe(['state a "A"', "end end2", "[*] --> a --> end2"].join("\n"));
    expect(convertPseudo(item(chain), ends[0]!.id)!.body).toBe(
      ['state a "A"', "start start2", "start2 --> a --> [*]"].join("\n"),
    );
  });

  it("keeps the line's indent, and a [*] inside a label is not one", () => {
    const nested = ['group outer "Outer" {', '  state a "A"', '  [*] --> a "from [*]"', "}"].join("\n");
    const start = parseDiagram("state", nested)!.nodes.find((n) => n.kind === "start")!;
    expect(convertPseudo(item(nested), start.id)!.body.split("\n").slice(2, 4)).toEqual([
      "  start start2",
      '  start2 --> a "from [*]"',
    ]);
  });

  it("refuses a declared start, a card, and a type with no pseudostates", () => {
    const declared = ["start s", 'state a "A"', "s --> a"].join("\n");
    expect(convertPseudo(item(declared), "s")).toBeNull();
    expect(convertPseudo(item(declared), "a")).toBeNull();
    expect(convertPseudo({ type: "flow", body: "step a", dir: undefined }, "__start-0")).toBeNull();
  });
});
