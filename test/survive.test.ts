import { describe, expect, it } from "vitest";

import { parseBoard } from "@/board/parseBoard";
import { lost, referencedInto } from "@/board/survive";

/**
 * What survives a rewrite of one diagram's body.
 *
 * The failure being guarded against has no symptom on the canvas: `resolveLinks` pushes a link only
 * when both ends resolve, so a rewrite that drops an id removes the whole curve rather than leaving
 * half of it. These tests hold the module to the same judgement the resolver will make one parse
 * later — `nodeIdsOf` is that judgement, shared rather than copied.
 */

const parse = (body: string) => parseBoard("test", body);

/** The rewritten item, an `svc` item for links to end on, and one `edges` fence. */
const board = (rewriteType: string, rewriteBody: string, edges: string) =>
  parse(`
\`\`\`${rewriteType} {#x}
${rewriteBody}
\`\`\`

\`\`\`arch {#svc}
service api "API"
\`\`\`

\`\`\`edges {#l}
${edges}
\`\`\`
`);

const item = (b: ReturnType<typeof parseBoard>, id: string) => b.items.find((it) => it.id === id)!;

describe("referencedInto", () => {
  it("finds a node endpoint pointing into the item, from either end of a link", () => {
    const from = board("arch", `service db "DB"`, "x.db --> svc");
    expect(referencedInto(from, new Set(["x"]))).toEqual([{ item: "x", node: "db" }]);

    const to = board("arch", `service db "DB"`, "svc --> x.db");
    expect(referencedInto(to, new Set(["x"]))).toEqual([{ item: "x", node: "db" }]);
  });

  it("never reports a link naming the item itself", () => {
    const b = board("arch", `service db "DB"`, "x --> svc");
    expect(referencedInto(b, new Set(["x"]))).toEqual([]);
    expect(lost(b, item(b, "x"), `service database "Database"`)).toEqual({ parsed: true, lost: [] });
  });

  it("dedupes the same endpoint named by several links", () => {
    const b = board("arch", `service db "DB"`, "x.db --> svc\nx.db --> svc");
    expect(referencedInto(b, new Set(["x"]))).toEqual([{ item: "x", node: "db" }]);
  });
});

describe("lost", () => {
  it("reports nothing when the rewrite keeps the id", () => {
    const b = board("arch", `service db "DB"`, "x.db --> svc");
    expect(lost(b, item(b, "x"), `service db "DB"\nservice api "API"`)).toEqual({ parsed: true, lost: [] });
  });

  it("reports the id a rewrite dropped or renamed", () => {
    const b = board("arch", `service db "DB"`, "x.db --> svc");
    expect(lost(b, item(b, "x"), `service database "Database"`)).toEqual({ parsed: true, lost: ["db"] });
  });

  it("counts a group id as declared", () => {
    const b = board("arch", `group cloud {\n  service db "DB"\n}`, "x.cloud --> svc");
    expect(lost(b, item(b, "x"), `group cloud {\n  service api "API"\n}`)).toEqual({ parsed: true, lost: [] });
    expect(lost(b, item(b, "x"), `service api "API"`)).toEqual({ parsed: true, lost: ["cloud"] });
  });

  it("counts a sequence participant", () => {
    const b = board("sequence", `alice -> bob: "hi"`, "x.alice --> svc");
    expect(lost(b, item(b, "x"), `alice -> bob: "hi"`)).toEqual({ parsed: true, lost: [] });
    expect(lost(b, item(b, "x"), `carol -> dave: "hi"`)).toEqual({ parsed: true, lost: ["alice"] });
  });

  it("counts a chart series", () => {
    const b = board("chart", `bar\nx Q1 Q2\nseries web "Web" 1 2`, "x.web --> svc");
    expect(lost(b, item(b, "x"), `bar\nx Q1 Q2\nseries web "Web" 3 4`)).toEqual({ parsed: true, lost: [] });
    expect(lost(b, item(b, "x"), `bar\nx Q1 Q2\nseries mobile "Mobile" 3 4`)).toEqual({
      parsed: true,
      lost: ["web"],
    });
  });

  it("reads a retyped body with the new type's parser", () => {
    /* A rewrite may turn an arch into a state machine. Parsed as an arch, `state db` is an
       unknown kind — a body that "does not parse" when it is perfectly good in the type it is. */
    const b = board("arch", `service db "DB"`, "x.db --> svc");
    expect(lost(b, item(b, "x"), `state db "DB"`, "state")).toEqual({ parsed: true, lost: [] });
    expect(lost(b, item(b, "x"), `state other "Other"`, "state")).toEqual({ parsed: true, lost: ["db"] });
  });

  it("reports a body that does not parse distinctly from ids being lost", () => {
    const b = board("arch", `service db "DB"`, "x.db --> svc");
    /* An unknown kind is an error, and the ids a failed parse declares are nobody's to trust — so
       this is not `lost: ["db"]`, it is "the diagram does not parse". */
    expect(lost(b, item(b, "x"), `banana db "DB"`)).toEqual({ parsed: false });
  });
});
