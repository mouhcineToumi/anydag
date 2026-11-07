import { describe, expect, it } from "vitest";

import { CODES } from "@/dsl/codes";
import { parseDiagram } from "@/dsl/parse";

const SRC = `
group gcp "Google Cloud" "larkspur-prod · europe-west1" hue=indigo {
  group run "Cloud Run" hue=teal {
    service web "larkspur-web" "nginx · the built spa"
    service api "larkspur-api" "fastapi · uvicorn" {
      identity "verify the id token"
      content  "tracks · branches · nodes"
    }
  }
  group fb "Firebase" hue=spruce {
    store auth "Authentication" "google · email link"
    store db "Firestore" "larkspur-dev"
  }
}
client browser "Learner's browser" "react 19 · vite"
external gha "GitHub Actions" "larkspur/larkspur-app"

browser --> web "https"
browser --> api "/api"
api.identity --> auth
api.content --> db
gha -.-> run "deploys"
legend solid "a call at runtime"
`;

describe("arch", () => {
  const g = parseDiagram("arch", SRC)!;

  it("parses without errors", () => {
    expect(g.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  });

  it("nests groups and records the level", () => {
    expect(g.groups.map((x) => [x.id, x.level, x.parent])).toEqual([
      ["gcp", 0, undefined],
      ["run", 1, "gcp"],
      ["fb", 1, "gcp"],
    ]);
  });

  it("puts nodes in their innermost group", () => {
    expect(g.nodes.find((n) => n.id === "api")!.group).toBe("run");
    expect(g.nodes.find((n) => n.id === "browser")!.group).toBeUndefined();
  });

  it("reads ports as rows", () => {
    expect(g.nodes.find((n) => n.id === "api")!.rows).toEqual([
      { id: "identity", name: "identity", detail: "verify the id token", tags: [], kind: "port" },
      { id: "content", name: "content", detail: "tracks · branches · nodes", tags: [], kind: "port" },
    ]);
  });

  it("anchors an edge to the row that owns it", () => {
    const e = g.edges.find((x) => x.from.row === "identity")!;
    expect(e.from).toEqual({ node: "api", row: "identity" });
    expect(e.to.node).toBe("auth");
  });

  it("inherits the hue of the nearest group, through nesting", () => {
    expect(g.nodes.find((n) => n.id === "api")!.hue).toBe("teal");
    expect(g.nodes.find((n) => n.id === "db")!.hue).toBe("spruce");
  });

  it("gives an edge its source's hue", () => {
    expect(g.edges.find((e) => e.from.node === "api" && e.to.node === "db")!.hue).toBe("teal");
  });

  it("marks a dashed edge and keeps its label", () => {
    const e = g.edges.find((x) => x.from.node === "gha")!;
    expect(e.dash).toBe(true);
    expect(e.label).toBe("deploys");
    expect(e.to.node).toBe("run");
  });

  it("takes a retired `focus` without breaking the statement it sits in", () => {
    const r = parseDiagram("arch", `service api "API" focus {\n  content "tracks"\n}`)!;
    expect(r.nodes.map((n) => n.id)).toEqual(["api"]);
    expect(r.nodes[0]!.rows.map((x) => x.name)).toEqual(["content"]);
    expect(r.diagnostics).toContainEqual({
      line: 1,
      code: CODES.W_RETIRED_FLAG,
      message: "`focus` no longer marks anything. Hovering a node rings it now",
      severity: "warn",
    });
  });
});

describe("emphasis flags", () => {
  const g = parseDiagram(
    "arch",
    `
    service a "A" bold
    service b "B" italic
    service c "C" bold italic
    service d "D"
    service e "E" done bold
    `,
  )!;

  it("parses without errors", () => {
    expect(g.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  });

  it("reads the two flags independently, and both together", () => {
    expect(g.nodes.find((n) => n.id === "a")!.bold).toBe(true);
    expect(g.nodes.find((n) => n.id === "a")!.italic).toBeUndefined();
    expect(g.nodes.find((n) => n.id === "b")!.italic).toBe(true);
    expect(g.nodes.find((n) => n.id === "b")!.bold).toBeUndefined();
    expect(g.nodes.find((n) => n.id === "c")!.bold).toBe(true);
    expect(g.nodes.find((n) => n.id === "c")!.italic).toBe(true);
    /* "Normal" is the absence of both. */
    expect(g.nodes.find((n) => n.id === "d")!.bold).toBeUndefined();
    expect(g.nodes.find((n) => n.id === "d")!.italic).toBeUndefined();
  });

  it("keeps a status beside the emphasis, whichever order they were written in", () => {
    /* `done bold` must not cost the status: before the explicit branch existed, the flag fell
       through to `STATUS_OF["bold"]`, which is `undefined`, and the status was cleared. */
    const e = g.nodes.find((n) => n.id === "e")!;
    expect(e.status).toBe("done");
    expect(e.bold).toBe(true);
  });
});

describe("arch errors", () => {
  /* The code and the line are the contract; the sentence is for a person and may be reworded, so
     asserting it in full is how a better error message becomes a failing test. */
  it("names the line of an unknown id", () => {
    const g = parseDiagram("arch", `service a "A"\na --> nope`)!;
    const d = g.diagnostics.find((x) => x.code === CODES.E_UNKNOWN_ID);
    expect(d).toMatchObject({ line: 2, severity: "error" });
    expect(d!.message).toContain("nope");
  });

  it("offers the id it was probably a typo for", () => {
    const g = parseDiagram("arch", `service content "Content"\nservice a "A"\na --> contnet`)!;
    const d = g.diagnostics.find((x) => x.code === CODES.E_UNKNOWN_ID);
    expect(d!.message).toContain("`content`");
  });

  it("rejects a duplicate id", () => {
    const g = parseDiagram("arch", `service a "A"\nservice a "B"`)!;
    expect(g.diagnostics.some((d) => d.code === CODES.E_DUPLICATE_ID)).toBe(true);
  });

  it("warns when a row does not exist", () => {
    const g = parseDiagram("arch", `service a "A" {\n  p "port"\n}\nservice b "B"\na.q --> b`)!;
    /* The code is what a fix loop branches on; the sentence is free to be reworded. */
    expect(g.diagnostics.some((d) => d.code === CODES.W_MISSING_ROW && d.severity === "warn")).toBe(true);
  });
});
