import { describe, expect, it } from "vitest";

import { declaredIds, rebind, renameIds } from "@/dsl/rebind";
import { parseDiagram } from "@/dsl/parse";
import { parseSequence } from "@/dsl/sequence";

/**
 * Dropping a saved component onto a diagram that already uses some of its names.
 *
 * The component is stored as the literal source a person selected, so its ids are real; this is
 * what keeps two copies of it from being one duplicate-id error. Everything here is about the
 * boundary cases the ids' *shape* would get wrong if nobody had written them down.
 */

const clean = (type: string, src: string) => {
  const model = type === "sequence" ? parseSequence(src) : parseDiagram(type, src)!;
  expect(model.diagnostics.map((d) => `${d.code} ${d.message}`)).toEqual([]);
};

describe("declaredIds", () => {
  it("finds nodes, groups and lanes", () => {
    const src = 'group g "G" {\n  service api "API"\n}\nstore db "D"';
    expect(declaredIds("arch", src).sort()).toEqual(["api", "db", "g"]);
  });

  it("ignores what the parser invented rather than what was written", () => {
    /* `[*]` becomes `__start-1`; a sequence gives a column to any id it was not introduced to. */
    expect(declaredIds("state", 'state a "A"\n[*] --> a')).toEqual(["a"]);
    expect(declaredIds("sequence", 'participant a "A"\na ->> ghost : "hi"').sort()).toEqual(["a", "ghost"]);
  });

  it("leaves the three dialects whose ids are not the author's alone", () => {
    expect(declaredIds("mindmap", "root Topic\n  A branch")).toEqual([]);
    expect(declaredIds("timeline", 'section "One"\n2026-01-01 "A day"')).toEqual([]);
    /* `main` is seeded by the parser whether or not it is written, and renaming it breaks
       `checkout main` with an error about a branch that does not exist. */
    expect(declaredIds("gitgraph", 'commit "a"\nbranch f\ncommit "b"\ncheckout main')).toEqual([]);
  });
});

describe("renameIds", () => {
  it("renames a declaration and every reference, including the head of a dotted one", () => {
    const src = 'service api "API" {\n  content "reads"\n}\nstore db "D"\napi.content --> db';
    const out = renameIds(src, new Map([["api", "api2"]]));
    expect(out).toContain('service api2 "API"');
    expect(out).toContain("api2.content --> db");
    expect(out).toContain('store db "D"');
  });

  it("never touches a label, only a word", () => {
    const src = 'service api "the api that is an api"\nstore db "D"\napi --> db';
    expect(renameIds(src, new Map([["api", "core"]]))).toContain('"the api that is an api"');
  });

  it("keeps comments and blank lines, which tokens cannot rebuild", () => {
    const src = '%% what runs\nservice api "API"\n\nstore db "D"\napi --> db';
    const out = renameIds(src, new Map([["api", "core"]]));
    expect(out.startsWith("%% what runs\n")).toBe(true);
    expect(out).toContain('"API"\n\nstore');
  });

  it("renames an id used as an attribute value", () => {
    const src = 'group t "T" {\n  entity a { id uuid pk }\n}\nentity b { id uuid pk; a_id fk=t }';
    expect(renameIds(src, new Map([["t", "t2"]]))).toContain("fk=t2");
  });
});

describe("rebind", () => {
  const target = 'client web "Browser"\nservice api "API"\nstore db "D"\nweb --> api --> db';

  it("renames only what collides, and leaves the rest as written", () => {
    const fragment = 'service api "Mine"\nstore cache "C"\napi --> cache';
    const out = rebind("arch", fragment, target);
    expect(out).toContain('service api2 "Mine"');
    expect(out).toContain('store cache "C"');
    expect(out).toContain("api2 --> cache");
  });

  it("survives being dropped twice", () => {
    const fragment = 'service api "Mine"\nstore db "Mine too"\napi --> db';
    const once = `${target}\n\n${rebind("arch", fragment, target)}`;
    const twice = `${once}\n\n${rebind("arch", fragment, once)}`;
    clean("arch", twice);
    expect(twice).toContain("api2");
    expect(twice).toContain("api3");
  });

  it("passes a fragment of an unrebindable dialect through untouched", () => {
    const src = "root Topic\n  A branch";
    expect(rebind("mindmap", src, "root Other\n  A branch")).toBe(src);
  });
});
