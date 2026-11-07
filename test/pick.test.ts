import { describe, expect, it } from "vitest";

import { parseChart } from "@/dsl/chart";
import { parseDiagram } from "@/dsl/parse";
import { duplicateStatement, edgeAt, edgeLabelOf } from "@/edit/pick";

/**
 * The three questions a pick asks that `restate.ts` does not answer.
 *
 * `edgeAt` is the one worth testing hardest, because it is arithmetic over two things that agree
 * only by construction: `parseEdge` emits one edge per (source, target) pair per arrow, and
 * `edgeSpan` reads the ref lists off the text. A bus and a chain are the two shapes where the count
 * and the arrow index come apart, and getting it wrong writes a label onto the wrong segment of a
 * line — silently, because both are valid places for one.
 */

const errorsIn = (type: string, body: string) =>
  (parseDiagram(type, body)?.diagnostics ?? []).filter((d) => d.severity === "error");

describe("edgeAt", () => {
  const body = [
    'service a "A"',
    'service b "B"',
    'service c "C"',
    'service d "D"',
    "",
    "a --> b",
    'b --> c "via" --> d',
    "a & b --> d",
  ].join("\n");

  const ids = () => parseDiagram("arch", body)!.edges.map((e) => e.id);

  it("finds the line of a plain edge", () => {
    expect(edgeAt("arch", body, undefined, ids()[0]!)).toEqual({ line: 6, seg: 0 });
  });

  it("numbers the segments of a chain along its arrows", () => {
    const [, second, third] = ids();
    expect(edgeAt("arch", body, undefined, second!)).toEqual({ line: 7, seg: 0 });
    expect(edgeAt("arch", body, undefined, third!)).toEqual({ line: 7, seg: 1 });
  });

  it("gives both edges of a bus the same segment — one arrow made them", () => {
    const [, , , fourth, fifth] = ids();
    expect(edgeAt("arch", body, undefined, fourth!)).toEqual({ line: 8, seg: 0 });
    expect(edgeAt("arch", body, undefined, fifth!)).toEqual({ line: 8, seg: 0 });
  });

  it("answers nothing for an id no edge has", () => {
    expect(edgeAt("arch", body, undefined, "e99")).toBeNull();
    expect(edgeAt("sequence", "alice -> bob: hi", undefined, "e1")).toBeNull();
  });
});

describe("edgeLabelOf", () => {
  it("reads the label of the segment asked for", () => {
    const line = 'b --> c "via" --> d "then"';
    expect(edgeLabelOf(line, 0)).toBe("via");
    expect(edgeLabelOf(line, 1)).toBe("then");
  });

  it("is empty where there is no label, and where there is no edge", () => {
    expect(edgeLabelOf("a --> b", 0)).toBe("");
    expect(edgeLabelOf('service a "A"', 0)).toBe("");
  });
});

describe("duplicateStatement", () => {
  it("copies a one-liner under a free name, below the line it copied", () => {
    const body = ['service api "The API" icon=server', 'store db "Database"', "api --> db"].join("\n");
    const made = duplicateStatement("arch", body, "api")!;
    expect(made.id).toBe("api2");
    expect(made.body.split("\n")[1]).toBe('service api2 "The API" icon=server');
    /* Only the declaration is copied: the edge is the author's statement about `api`, not `api2`. */
    expect(made.body).toContain("api --> db");
    expect(made.body).not.toContain("api2 --> db");
    expect(errorsIn("arch", made.body)).toEqual([]);
  });

  it("takes a group's children with it, and the edges between them", () => {
    const body = [
      'group gcp "Google Cloud" hue=indigo {',
      '  service api "API"',
      '  store db "DB"',
      "  api --> db",
      "}",
    ].join("\n");
    const made = duplicateStatement("arch", body, "gcp")!;
    expect(made.id).toBe("gcp2");
    expect(made.body).toContain('group gcp2 "Google Cloud" hue=indigo {');
    expect(made.body).toContain('service api2 "API"');
    expect(made.body).toContain("api2 --> db2");
    /* The original is untouched, and the whole thing still parses — the point of the exercise. */
    expect(made.body).toContain("  api --> db");
    expect(errorsIn("arch", made.body)).toEqual([]);
  });

  it("keeps the author's spacing and comment", () => {
    const body = 'service  api   "The API"   %% the one that matters';
    const made = duplicateStatement("arch", body, "api")!;
    expect(made.body.split("\n")[1]).toBe('service  api2   "The API"   %% the one that matters');
  });

  it("skips a name already written down anywhere", () => {
    const body = ['service api "A"', 'service api2 "B"', 'service api3 "C"'].join("\n");
    expect(duplicateStatement("arch", body, "api")!.id).toBe("api4");
  });

  it("answers nothing for an id the body does not declare", () => {
    expect(duplicateStatement("arch", 'service api "A"', "nope")).toBeNull();
  });

  it("works on a dialect that hands back no graph", () => {
    const made = duplicateStatement("sequence", 'participant alice "Alice"\nalice -> alice: think', "alice")!;
    expect(made.id).toBe("alice2");
    expect(made.body).toContain('participant alice2 "Alice"');
  });

  it("copies a chart series under a fresh id, with the same numbers", () => {
    /* ctrl+D on a picked series. The values come through because the *statement* is copied as
       written — there is nothing here that understands what a value is, and nothing that needs to. */
    const body = ['bar', 'x Q1 Q2', 'series web "Web" 12 30 hue=coral', 'series mob "Mobile" 4 6'].join("\n");
    const made = duplicateStatement("chart", body, "web")!;
    expect(made.id).toBe("web2");
    expect(made.body.split("\n")[3]).toBe('series web2 "Web" 12 30 hue=coral');
    expect(parseChart(made.body).diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(parseChart(made.body).series.map((x) => x.id)).toEqual(["web", "web2", "mob"]);
  });
});
