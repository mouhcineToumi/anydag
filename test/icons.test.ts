import { describe, expect, it } from "vitest";

import { CODES } from "@/dsl/codes";
import { ICON_NAMES } from "@/dsl/icon-names";
import { parseDiagram } from "@/dsl/parse";
import { iconFor } from "@/render/Icon";
import type { Theme } from "@/theme/contract";

/**
 * The icon vocabulary, at the two seams that can break silently.
 *
 * The grammar seam: `icon=aws:lambda` needs a colon inside an attribute value, which the tokenizer
 * does not give a bare word. It is joined in `modifiers()` rather than in the tokenizer, so the
 * thing to prove is that edge labels and sequence messages still get to keep their own colons.
 *
 * The resolution seam: which of three vocabularies a name lands in decides whether a card draws a
 * tinted silhouette or a full-colour logo. Order matters more than coverage here — Lucide has to
 * win, or a brand set adding a `server` slug silently redraws every board written since M1a.
 */

const theme = { icons: { service: "Server", store: "Database", default: "Box" } } as unknown as Theme;

/** `parseDiagram` returns null for an unknown type; `arch` is not one, so assert rather than guard. */
const arch = (src: string) => {
  const g = parseDiagram("arch", src);
  if (!g) throw new Error("arch failed to parse");
  return g;
};

describe("icon= grammar", () => {
  it("reads a namespaced value", () => {
    const g = arch(`service a "A" icon=aws:lambda`);
    expect(g.diagnostics).toEqual([]);
    expect(g.nodes[0]!.icon).toBe("aws:lambda");
  });

  it("reads the mono: override", () => {
    const g = arch(`service a "A" icon=mono:postgresql`);
    expect(g.diagnostics).toEqual([]);
    expect(g.nodes[0]!.icon).toBe("mono:postgresql");
  });

  it("still lets an edge label keep its colon", () => {
    const g = arch(`service a "A"\nservice b "B"\na --> b : "POST /x"`);
    expect(g.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(g.edges).toHaveLength(1);
    expect(g.edges[0]!.label).toBe("POST /x");
  });

  it("does not swallow the next statement", () => {
    const g = arch(`service a "A" icon=docker\nservice b "B"`);
    expect(g.diagnostics).toEqual([]);
    expect(g.nodes.map((n) => n.id)).toEqual(["a", "b"]);
    expect(g.nodes[0]!.icon).toBe("docker");
  });
});

describe("W_UNKNOWN_ICON", () => {
  it("warns on a name no set has, and still draws the node", () => {
    const g = arch(`service a "A" icon=not-a-real-icon`);
    const warn = g.diagnostics.find((d) => d.code === CODES.W_UNKNOWN_ICON);
    expect(warn?.severity).toBe("warn");
    expect(g.nodes).toHaveLength(1);
  });

  /* The whole reason this diagnostic exists: these resolve to real, different companies, so a
     silent fallback would draw the wrong logo rather than an obviously-missing one. */
  it.each(["groq", "together", "zookeeper", "haproxy", "dagster"])("warns on the near-miss %s", (name) => {
    const g = arch(`service a "A" icon=${name}`);
    expect(g.diagnostics.some((d) => d.code === CODES.W_UNKNOWN_ICON)).toBe(true);
  });

  it("says nothing about a name that resolves", () => {
    const g = arch(`service a "A" icon=postgresql\nservice b "B" icon=server\nservice c "C" icon=mono:docker`);
    expect(g.diagnostics).toEqual([]);
  });

  it("accepts an alias", () => {
    expect(ICON_NAMES.has("postgres")).toBe(true);
    const g = arch(`service a "A" icon=postgres`);
    expect(g.diagnostics).toEqual([]);
  });
});

describe("W_UNKNOWN_ICON suggests", () => {
  /* `groq`/`grok` is the near-miss this diagnostic exists for — the suggestion names the closest
     real name and leaves the author to say whether it is the one they meant. */
  it("suggests the close name when there is one", () => {
    const w = arch(`service a "A" icon=postgre`).diagnostics.find((d) => d.code === CODES.W_UNKNOWN_ICON)!;
    expect(w.message).toContain("Did you mean `postgres`");
  });

  it("carries the prefix back, so the suggestion can be pasted into the line", () => {
    const w = arch(`service a "A" icon=mono:postgre`).diagnostics.find((d) => d.code === CODES.W_UNKNOWN_ICON)!;
    expect(w.message).toContain("Did you mean `mono:postgres`");
  });

  it("suggests the vendor-qualified name a bare service word reaches for", () => {
    const w = arch(`service a "A" icon=lambda`).diagnostics.find((d) => d.code === CODES.W_UNKNOWN_ICON)!;
    expect(w.message).toContain("Did you mean `aws:lambda`");
  });

  /* The alias table must outrun distance here: `py` is one edit from `pg`, and suggesting another
     product's mark for Python is the wrong-logo failure this whole warning exists for. */
  it("answers an abbreviation before edit distance can answer badly", () => {
    const w = arch(`service a "A" icon=py`).diagnostics.find((d) => d.code === CODES.W_UNKNOWN_ICON)!;
    expect(w.message).toContain("Did you mean `python`");
    expect(w.message).not.toContain("`pg`");
  });

  it("stays silent when nothing is close — no suggestion is better than a wrong one", () => {
    const w = arch(`service a "A" icon=zookeeper`).diagnostics.find((d) => d.code === CODES.W_UNKNOWN_ICON)!;
    expect(w.message).not.toContain("Did you mean");
    expect(w.message).toContain('no icon named "zookeeper"');
  });
});

describe("iconFor", () => {
  it("falls back to the kind's glyph with no override", () => {
    expect(iconFor("service", theme)).toEqual({ mode: "concept", name: "Server" });
  });

  it("gives a Lucide glyph for a name no brand set claims", () => {
    expect(iconFor("service", theme, "server")).toEqual({ mode: "concept", name: "Server" });
    expect(iconFor("service", theme, "key-round")).toEqual({ mode: "concept", name: "KeyRound" });
  });

  it("resolves a brand to full colour", () => {
    expect(iconFor("service", theme, "postgresql")).toEqual({ mode: "brand", name: "postgresql" });
    expect(iconFor("service", theme, "aws:lambda")).toEqual({ mode: "brand", name: "aws:lambda" });
  });

  /* The five names both vocabularies claim. All five are brands, so the logo is the right answer
     and Lucide's approximation was shadowing it; `check-icons.mjs` prints this set on every run. */
  it.each(["figma", "github", "gitlab", "slack", "vault"])("gives %s the brand, not Lucide's glyph", (name) => {
    expect(iconFor("service", theme, name).mode).not.toBe("concept");
  });

  it("lets lucide: ask for the concept glyph anyway", () => {
    expect(iconFor("service", theme, "lucide:github")).toEqual({ mode: "concept", name: "Github" });
    expect(iconFor("service", theme, "lucide:server")).toEqual({ mode: "concept", name: "Server" });
  });

  it("honours mono: even where a colour version exists", () => {
    expect(iconFor("service", theme, "mono:postgresql")).toEqual({ mode: "mono", name: "postgresql" });
  });

  it("resolves an alias before looking anything up", () => {
    expect(iconFor("service", theme, "postgres")).toEqual({ mode: "brand", name: "postgresql" });
  });

  it("falls back rather than throwing on a name nothing has", () => {
    expect(iconFor("store", theme, "not-a-real-icon")).toEqual({ mode: "concept", name: "Database" });
    expect(iconFor("store", theme, "mono:not-a-real-icon")).toEqual({ mode: "concept", name: "Database" });
  });
});

describe("the generated name list", () => {
  it("covers all three vocabularies", () => {
    expect(ICON_NAMES.has("server")).toBe(true); // lucide
    expect(ICON_NAMES.has("postgresql")).toBe(true); // brand
    expect(ICON_NAMES.has("aws:lambda")).toBe(true); // cloud
  });

  it("is written in kebab-case, the way a board writes it", () => {
    expect(ICON_NAMES.has("key-round")).toBe(true);
    expect(ICON_NAMES.has("KeyRound")).toBe(false);
  });
});
