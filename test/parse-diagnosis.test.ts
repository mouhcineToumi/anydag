import { describe, expect, it } from "vitest";

import { CODES } from "@/dsl/codes";
import { parseDiagram } from "@/dsl/parse";
import { parseSequence } from "@/dsl/sequence";

/**
 * What a diagnostic is *for*.
 *
 * The rest of the parser tests ask whether a mistake is caught. These ask whether the report of it
 * can be acted on, which is a different question and was the one going unanswered: every case below
 * was caught before this file existed, and every one of them was reported as a cascade of true
 * statements that between them did not name the mistake.
 *
 * The measure used throughout is the count. One wrong word should cost one error — not because a
 * number is the goal, but because every extra line is a line whoever is fixing this has to read and
 * rule out, and the ones that arrive here are the ones that cannot be ruled out from the message.
 */

const errors = (src: string, type = "arch") =>
  parseDiagram(type, src)!.diagnostics.filter((d) => d.severity === "error");
const warnings = (src: string, type = "arch") =>
  parseDiagram(type, src)!.diagnostics.filter((d) => d.severity === "warn");

describe("an unrecognised node kind", () => {
  const src = `db pg "Postgres"\ndatabase other "Other"\nservice api "API"\napi --> other`;

  it("is reported as a kind, once", () => {
    const es = errors(src);
    expect(es).toHaveLength(1);
    expect(es[0]).toMatchObject({ line: 2, code: CODES.E_UNKNOWN_KIND });
  });

  it("names the vocabulary and the likely answer", () => {
    const m = errors(src)[0]!.message;
    expect(m).toContain("`database`");
    expect(m).toContain("Did you mean `db`");
    expect(m).toContain("container");
  });

  /* The whole point. `other` is undeclared *because* line 2 was rejected, so reporting it again on
     line 4 points at a line with nothing wrong on it. */
  it("does not take the edges that name it down too", () => {
    expect(errors(src).some((d) => d.code === CODES.E_UNKNOWN_ID)).toBe(false);
  });

  it("suggests the only kind there is, in a dialect that has one", () => {
    const es = errors(`table users { id uuid pk }`, "erd");
    expect(es).toHaveLength(1);
    expect(es[0]!.message).toContain("Did you mean `entity`");
  });

  it("still suggests when the wrong word is a synonym rather than a typo", () => {
    /* `component` is nine edits from `service` — no distance threshold reaches it, and it is the
       word a model reaches for. That is what the alias table is for. */
    expect(errors(`component api "API"`)[0]!.message).toContain("Did you mean `service`");
  });

  it("leaves a real edge statement alone", () => {
    expect(errors(`service a "A"\nservice b "B"\na --> b "calls"`)).toEqual([]);
  });
});

describe("Mermaid pasted into a fence", () => {
  it("is reported once, not once per line", () => {
    const es = errors(`graph LR\n  A[Web] --> B[API]\n  B --> C[(DB)]\n  subgraph cloud\n  end`);
    expect(es).toHaveLength(1);
    expect(es[0]).toMatchObject({ line: 1, code: CODES.E_MERMAID_SYNTAX });
    expect(es[0]!.message).toContain("dir=LR");
  });

  it("recognises every dialect's header", () => {
    for (const header of ["flowchart TD", "erDiagram", "classDiagram", "stateDiagram-v2", "gantt"]) {
      expect(errors(`${header}\nfoo`)[0]).toMatchObject({ code: CODES.E_MERMAID_SYNTAX });
    }
  });

  it("catches a piped edge label in an otherwise fine board", () => {
    const es = errors(`service a "A"\nservice b "B"\na -->|calls| b`);
    const m = es.find((d) => d.code === CODES.E_MERMAID_SYNTAX);
    expect(m).toMatchObject({ line: 3 });
    expect(m!.message).toContain('a --> b "label"');
  });

  it("catches `subgraph` and points at `group`", () => {
    const m = errors(`subgraph cloud\nend`).find((d) => d.code === CODES.E_MERMAID_SYNTAX);
    expect(m!.message).toContain("group");
  });

  it("says one thing once however many times the habit repeats", () => {
    const es = errors(`A[one] --> B\nC[two] --> D\nE[three] --> F`);
    expect(es.filter((d) => d.code === CODES.E_MERMAID_SYNTAX)).toHaveLength(1);
  });

  /* `||--o{` is an arrow next to pipes, `list[str]` is a bracket after a word, and `{ … }` opens
     every node that has rows. None of the three is Mermaid, and all three used to read as it. */
  it("does not fire on the grammar it resembles", () => {
    expect(errors(`entity a { id uuid pk }\nentity b { a_id fk }\na ||--o{ b "has"`, "erd")).toEqual([]);
    expect(errors(`class P { +skills: list[str]; +go() str }`, "class")).toEqual([]);
    expect(errors(`state s "S"\n[*] --> s\ns --> [*]`, "state")).toEqual([]);
  });
});

describe("the paste this was written for", () => {
  /*
   * Six lines of Mermaid habits, which is what arrives when a model is asked for an architecture
   * diagram and reaches for the syntax it has written most. It used to come back as sixteen errors
   * — two `expected an arrow` on a line whose problem was the word `database`, an undeclared id
   * called `calls` that is really a label between pipes, and nothing anywhere naming Mermaid.
   */
  const PASTED = `graph LR
database pg "Postgres" icon=postgres
service api [API Gateway]
api -->|calls| pg
api --> cache
service worker "Worker" focus`;

  it("is one error, because the header settles it", () => {
    const es = errors(PASTED);
    expect(es).toHaveLength(1);
    expect(es[0]!.code).toBe(CODES.E_MERMAID_SYNTAX);
  });

  it("is one diagnostic per mistake once the header is gone", () => {
    const g = parseDiagram("arch", PASTED.split("\n").slice(1).join("\n"))!;
    expect(g.diagnostics.map((d) => [d.line, d.code])).toEqual([
      [1, CODES.E_UNKNOWN_KIND], //   `database`
      [2, CODES.E_MERMAID_SYNTAX], // `[API Gateway]`
      [3, CODES.E_MERMAID_SYNTAX], // `-->|calls|`
      [4, CODES.E_UNKNOWN_ID], //     `cache`, genuinely never declared
      [5, CODES.W_RETIRED_FLAG], //   `focus`
    ]);
  });
});

describe("the shape of the list", () => {
  it("is in line order, whichever pass produced each entry", () => {
    /* `resolveRefs` runs last and appends, so an unknown id used to sort after a syntax error from
       a line above it however far down the file it was. */
    const es = errors(`service a "A"\na --> nope\nb[oops] --> a\nservice c "C"\nc --> alsonope`);
    const lines = es.map((d) => d.line);
    expect(lines).toEqual([...lines].sort((x, y) => x - y));
  });

  it("says each thing once", () => {
    const es = errors(`service a "A"\na --> nope\nservice b "B"\nb --> nope`);
    const unknown = es.filter((d) => d.code === CODES.E_UNKNOWN_ID);
    /* Two lines genuinely name it, so two entries — deduping is by line, not by message. */
    expect(unknown.map((d) => d.line)).toEqual([2, 4]);
    expect(new Set(es.map((d) => `${d.line}:${d.code}:${d.message}`)).size).toBe(es.length);
  });
});

describe("an unknown hue", () => {
  /*
   * Silent from M1 to here: `modifiers()` read any word into `hue` and `hueVars()` bound whatever
   * it was handed straight into `--dag-h`/`--dag-t`, so `hue=purple` produced no diagnostic and no
   * visible colour — a custom property nobody set, falling back to the theme's default by accident.
   * The value is dropped rather than kept and ignored, so the node falls back to what it would have
   * had with no `hue=` at all — inherited from its group, or the theme's default — not garbage.
   */
  it("is dropped and warned about on a node", () => {
    const g = parseDiagram("arch", `service a "A" hue=purple`)!;
    expect(g.nodes[0]!.hue).toBeUndefined();
    const w = warnings(`service a "A" hue=purple`);
    expect(w).toHaveLength(1);
    expect(w[0]).toMatchObject({ line: 1, code: CODES.W_UNKNOWN_HUE });
  });

  it("suggests the close hue when there is one", () => {
    const w = warnings(`service a "A" hue=purple`);
    expect(w[0]!.message).toContain("Did you mean `violet`");
  });

  it("names the closed set when nothing is close", () => {
    const w = warnings(`service a "A" hue=turquoise`);
    expect(w[0]!.message).not.toContain("Did you mean");
    expect(w[0]!.message).toContain("expected one of");
    expect(w[0]!.message).toContain("indigo");
  });

  it("says nothing about a real hue", () => {
    expect(warnings(`service a "A" hue=teal`)).toEqual([]);
  });

  it("is dropped and warned about on a group", () => {
    const w = warnings(`group g "G" hue=purple {\n  service a "A"\n}`);
    expect(w.map((d) => d.code)).toContain(CODES.W_UNKNOWN_HUE);
  });

  it("is dropped and warned about on a lane", () => {
    const w = warnings(`lane l "L" hue=purple {\n  step a "A"\n}`, "flow");
    expect(w.map((d) => d.code)).toContain(CODES.W_UNKNOWN_HUE);
  });

  it("is dropped and warned about on an edge", () => {
    const w = warnings(`service a "A"\nservice b "B"\na --> b hue=purple`);
    expect(w.map((d) => d.code)).toContain(CODES.W_UNKNOWN_HUE);
  });
});

describe("an unknown hue where modifiers() never looks", () => {
  /* Two readers take `hue=` off a line themselves — a sequence participant is not a `Node`, and a
     timeline section is a regex — so the check in `modifiers()` never saw them. F7a covered the
     four statement kinds it routes; these are the other two. */
  it("on a sequence participant", () => {
    const m = parseSequence(`participant web "Browser" hue=purple\nweb ->> web "tick"`);
    expect(m.participants[0]!.hue).toBeUndefined();
    const w = m.diagnostics.find((d) => d.code === CODES.W_UNKNOWN_HUE);
    expect(w?.severity).toBe("warn");
    expect(w?.message).toContain("violet");
  });
  it("on a timeline section", () => {
    const g = parseDiagram("timeline", `section "Phase" hue=amber\n2026-01 "kickoff"`)!;
    expect(g.groups[0]!.hue).not.toBe("amber");
    expect(g.diagnostics.some((d) => d.code === CODES.W_UNKNOWN_HUE)).toBe(true);
  });
});

/* A quote inside a title once drew three errors about an id and an arrow, and a reader could
   conclude a quote could not be written at all. */
describe("a quote inside a string", () => {
  it("is one error that says how to write it, on a node, an edge label and a sketch", () => {
    for (const [type, src, line] of [
      ["sketch", 'text a "s = "aa""', 1],
      ["arch", 'service api "the "real" API"', 1],
      ["arch", 'service a "A"\nservice b "B"\na --> b "the "x" label"', 3],
    ] as const) {
      const es = errors(src, type);
      expect(es, src).toHaveLength(1);
      expect(es[0]).toMatchObject({ line, code: CODES.E_UNESCAPED_QUOTE });
      expect(es[0]!.message).toContain('\\"');
    }
  });

  it("is a quote once it is escaped, and a backslash is a backslash", () => {
    const g = parseDiagram("sketch", 'text a "s = \\"aa\\""\nbox p "C:\\\\boards"')!;
    expect(g.diagnostics).toEqual([]);
    expect(g.nodes.map((n) => n.title)).toEqual(['s = "aa"', "C:\\boards"]);
  });

  it("says nothing about two strings a space apart", () => {
    expect(errors('box a "A" "meta"', "sketch")).toEqual([]);
  });
});
