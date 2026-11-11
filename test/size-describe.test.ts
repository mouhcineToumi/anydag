import { describe, expect, it } from "vitest";

import { CODES } from "@/dsl/codes";
import { retiredLines } from "@/dsl/diagnose";
import { descriptionSlot, parseDiagram } from "@/dsl/parse";
import {
  participantKind,
  readModifier,
  removeRow,
  rowLines,
  setExtent,
  setGroupDir,
  setKind,
  setParticipantKind,
  setRow,
  takeBodyDir,
  updateRetired,
} from "@/dsl/restate";
import { PARTICIPANT_KINDS, parseSequence } from "@/dsl/sequence";

/**
 * Sizing and describing any card — the writers behind the controls that replaced typing `w=`, a
 * third string, a one-line row block, `kind=`, a group's `dir=` and the flags the grammar retired.
 *
 * Every one is held to the property the rest of `restate.ts` is held to: the line is otherwise
 * byte-identical, and a writer handed something it cannot read hands it back unchanged.
 */

describe("readModifier", () => {
  it("reads the value as written, off the tokens", () => {
    expect(readModifier('service api "A" w=320 hue=teal', "w")).toBe("320");
    expect(readModifier('service api "A" w=320 hue=teal', "hue")).toBe("teal");
    expect(readModifier('service api "A"', "w")).toBeNull();
  });

  it("does not read a key out of a quoted title", () => {
    expect(readModifier('service api "set w=10 here"', "w")).toBeNull();
  });

  it("unquotes a quoted value", () => {
    expect(readModifier('service api "A" icon="two words"', "icon")).toBe("two words");
  });
});

describe("setExtent", () => {
  it("writes a width and leaves the rest of the line alone", () => {
    expect(setExtent('service api "The API" icon=server %% edge', "w", 320)).toBe(
      'service api "The API" icon=server w=320 %% edge',
    );
  });

  it("replaces one that is there, and takes it off with null", () => {
    expect(setExtent('service api "A" w=200 hue=teal', "w", 280)).toBe('service api "A" hue=teal w=280');
    expect(setExtent('service api "A" w=200 hue=teal', "w", null)).toBe('service api "A" hue=teal');
    expect(setExtent('service api "A"', "w", null)).toBe('service api "A"');
  });

  it("rounds, because the file is for people", () => {
    expect(setExtent('box a "A"', "h", 99.6)).toBe('box a "A" h=100');
  });

  it("refuses what is not a size", () => {
    for (const bad of [0, -4, 0.2, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(setExtent('box a "A"', "w", bad)).toBe('box a "A"');
    }
  });

  it("refuses an edge and a line that declares nothing", () => {
    expect(setExtent("a --> b", "w", 10)).toBe("a --> b");
    expect(setExtent("", "w", 10)).toBe("");
  });

  it("goes before the brace on a group, and the parse reads it", () => {
    const line = setExtent('group phone "Sign in" x=0 y=0 {', "w", 320);
    expect(line).toBe('group phone "Sign in" x=0 y=0 w=320 {');
    const g = parseDiagram("sketch", `${setExtent(line, "h", 456)}\n  box a "A" x=8 y=8\n}`)!;
    expect(g.groups[0]).toMatchObject({ id: "phone", w: 320, h: 456 });
  });

  it("is what an ELK-laid card's width means to the parse", () => {
    const g = parseDiagram("arch", setExtent('service api "API"', "w", 300))!;
    expect(g.nodes[0]!.w).toBe(300);
    expect(g.diagnostics).toEqual([]);
  });

  it("gives a sketch shape both sides", () => {
    const g = parseDiagram("sketch", setExtent(setExtent('circle c "C" x=0 y=0', "w", 120), "h", 90))!;
    expect(g.nodes[0]).toMatchObject({ w: 120, h: 90 });
  });
});

describe("setGroupDir", () => {
  it("writes the group's own direction, and takes it off", () => {
    expect(setGroupDir('group g "G" {', "TB")).toBe('group g "G" dir=TB {');
    expect(setGroupDir('group g "G" dir=TB {', "LR")).toBe('group g "G" dir=LR {');
    expect(setGroupDir('group g "G" dir=TB {', null)).toBe('group g "G" {');
  });

  it("is what the parser reads as the group's direction", () => {
    const g = parseDiagram("arch", `${setGroupDir('group g "G" {', "TB")}\n  service a "A"\n}`)!;
    expect(g.groups[0]!.dir).toBe("DOWN");
    expect(g.diagnostics).toEqual([]);
  });

  it("refuses a line that is not a declaration", () => {
    expect(setGroupDir("a --> b", "TB")).toBe("a --> b");
  });
});

describe("a description on every card that draws one", () => {
  it("is the third string on a C4 container and db", () => {
    expect(descriptionSlot("c4", "container", 2)).toBe(2);
    expect(descriptionSlot("c4", "db", 0)).toBe(2);
    expect(descriptionSlot("c4", "store", 3)).toBe(2);
  });

  it("is the second string on a C4 person and external system, until a third is written", () => {
    expect(descriptionSlot("c4", "person", 2)).toBe(1);
    expect(descriptionSlot("c4", "extsystem", 1)).toBe(1);
    expect(descriptionSlot("c4", "external", 2)).toBe(1);
    expect(descriptionSlot("c4", "person", 3)).toBe(2);
  });

  it("is the third string on a person anywhere else, and absent on a card that draws none", () => {
    expect(descriptionSlot("arch", "person", 1)).toBe(2);
    expect(descriptionSlot("arch", "service", 3)).toBeNull();
    expect(descriptionSlot("erd", "entity", 3)).toBeNull();
    expect(descriptionSlot("sketch", "box", 3)).toBeNull();
    expect(descriptionSlot("c4", "nonsense", 2)).toBeNull();
    expect(descriptionSlot("mindmap", "person", 2)).toBeNull();
  });

  it("names the slot the card really draws, for every kind of every dialect", () => {
    /* The claim is about drawing, so hold it to the parse: a description written into the slot
       reaches `Node.desc` exactly when the function says the kind draws one. */
    const dialects = ["arch", "c4", "erd", "state", "flow", "activity", "class", "usecase", "sketch"] as const;
    for (const type of dialects) {
      const words = {
        arch: ["service", "store", "client", "person", "queue", "external", "container"],
        c4: ["person", "container", "db", "store", "extsystem", "external"],
        erd: ["entity"],
        state: ["state"],
        flow: ["step", "decision"],
        activity: ["action", "decision"],
        class: ["class"],
        usecase: ["usecase", "actor"],
        sketch: ["box", "text"],
      }[type];
      for (const word of words) {
        const slot = descriptionSlot(type, word, 2);
        const two = parseDiagram(type, `${word} x "Title" "second"`)!.nodes[0]!;
        const three = parseDiagram(type, `${word} x "Title" "second" "third"`)!.nodes[0]!;
        if (slot === 1) expect(two.desc, `${type} ${word}`).toBe("second");
        if (slot === 2) expect(three.desc, `${type} ${word}`).toBe("third");
        /* A kind with no slot draws none: its card is not the one that has a description. */
        if (slot === null)
          expect(three.kind === "person" || three.kind === "extsystem" || type === "c4", `${type} ${word}`).toBe(false);
      }
    }
  });
});

describe("inline rows", () => {
  const ONE = 'entity user "User" { id uuid pk; slug text } %% two rows';

  it("lists each row of a one-line block with its place on the line", () => {
    expect(rowLines(ONE, 1)).toEqual([
      { line: 1, text: "id uuid pk", nth: 0 },
      { line: 1, text: "slug text", nth: 1 },
    ]);
  });

  it("still lists a block's rows by line alone", () => {
    expect(rowLines('entity a "A" {\n  id uuid pk\n  n text\n}', 1)).toEqual([
      { line: 2, text: "id uuid pk" },
      { line: 3, text: "n text" },
    ]);
  });

  it("reads a `;` inside a quoted string as part of the row, and a run of them as one boundary", () => {
    expect(rowLines('entity a "A" { x text; y text;; z text }', 1).map((r) => r.text)).toEqual(["x text", "y text", "z text"]);
    expect(rowLines('class A { +f(a "x;y") ; +g() }', 1).map((r) => r.text)).toEqual(['+f(a "x;y")', "+g()"]);
  });

  it("rewrites the nth row in place and nothing else", () => {
    expect(setRow(ONE, 1, "handle text unique", 1)).toBe('entity user "User" { id uuid pk; handle text unique } %% two rows');
    expect(setRow(ONE, 1, "id int pk", 0)).toBe('entity user "User" { id int pk; slug text } %% two rows');
  });

  it("refuses text that would end the row or the block, and a row that is not there", () => {
    expect(setRow(ONE, 1, "a; b", 0)).toBe(ONE);
    expect(setRow(ONE, 1, "a }", 0)).toBe(ONE);
    expect(setRow(ONE, 1, "a", 5)).toBe(ONE);
  });

  it("removes the nth row, keeping the others and the comment", () => {
    expect(removeRow(ONE, 1, 0)).toBe('entity user "User" { slug text } %% two rows');
    expect(removeRow(ONE, 1, 1)).toBe('entity user "User" { id uuid pk } %% two rows');
    expect(removeRow('entity a "A" { n text }', 1, 0)).toBe('entity a "A" { }');
    expect(removeRow(ONE, 1, 9)).toBe(ONE);
  });

  it("leaves the card parsing to the rows that are left", () => {
    const edited = setRow(removeRow(ONE, 1, 0), 1, "slug int", 0);
    expect(parseDiagram("erd", edited)!.nodes[0]!.rows.map((r) => r.name)).toEqual(["slug"]);
  });

  it("is untouched for a block row, which is addressed by its line", () => {
    const body = 'entity a "A" {\n  id uuid pk\n  n text\n}';
    expect(setRow(body, 3, "m text")).toBe('entity a "A" {\n  id uuid pk\n  m text\n}');
    expect(removeRow(body, 2)).toBe('entity a "A" {\n  n text\n}');
  });
});

describe("kind=", () => {
  it("is taken off when the kind is chosen from the menu, so the choice is not overridden", () => {
    expect(setKind('service api "API" kind=store hue=teal', "queue")).toBe('queue api "API" hue=teal');
    const g = parseDiagram("arch", setKind('service api "API" kind=store', "client"))!;
    expect(g.nodes[0]!.kind).toBe("client");
  });

  it("leaves a line with no override as it always did", () => {
    expect(setKind('service api "API" hue=teal', "queue")).toBe('queue api "API" hue=teal');
  });

  it("types a sequence participant with kind=, and the parser agrees", () => {
    const line = setParticipantKind('participant learner "Learner" "signed in"', "person");
    expect(line).toBe('participant learner "Learner" "signed in" kind=person');
    expect(parseSequence(line).participants[0]!.kind).toBe("person");
    expect(participantKind(line, PARTICIPANT_KINDS)).toBe("person");
  });

  it("takes kind= off when the word already says it", () => {
    expect(setParticipantKind('participant a "A" kind=person', "service")).toBe('participant a "A"');
    expect(setParticipantKind('actor a "A" kind=db', "person")).toBe('actor a "A"');
    expect(setParticipantKind('actor a "A"', "db")).toBe('actor a "A" kind=db');
  });

  it("reads a participant's kind from the word when there is no override", () => {
    expect(participantKind('participant a "A"', PARTICIPANT_KINDS)).toBe("service");
    expect(participantKind('actor a "A"', PARTICIPANT_KINDS)).toBe("person");
    expect(participantKind('participant a "A" kind=nonsense', PARTICIPANT_KINDS)).toBe("service");
    expect(participantKind("a ->> b: hi", PARTICIPANT_KINDS)).toBeNull();
  });

  it("refuses a line that is not a participant", () => {
    expect(setParticipantKind("a ->> b: hi", "db")).toBe("a ->> b: hi");
  });
});

describe("retired flags", () => {
  const BODY = [
    'service api "API" focus',
    'store db "DB" done current hue=teal',
    "api --> db",
    'legend focus "the one in focus"',
  ].join("\n");

  it("lists the lines the parser warned on, once each", () => {
    expect(retiredLines({ type: "arch", body: BODY })).toEqual([1, 2, 4]);
    expect(retiredLines({ type: "arch", body: 'service api "API"' })).toEqual([]);
    expect(retiredLines({ type: "sequence", body: "a ->> b: hi" })).toEqual([]);
    expect(retiredLines({ type: "gitgraph", body: "commit" })).toEqual([]);
  });

  it("brings the statements up to date and touches nothing else", () => {
    const next = updateRetired(BODY, [1, 2, 4]);
    expect(next).toBe(['service api "API"', 'store db "DB" done hue=teal', "api --> db"].join("\n"));
    expect(parseDiagram("arch", next)!.diagnostics.filter((d) => d.code === CODES.W_RETIRED_FLAG)).toEqual([]);
  });

  it("only touches the lines it is handed", () => {
    expect(updateRetired(BODY, [1]).split("\n")[1]).toBe('store db "DB" done current hue=teal');
  });

  it("leaves a column that happens to be called `current` alone", () => {
    const body = 'entity a "A" focus { current bool; focus text }';
    expect(updateRetired(body, retiredLines({ type: "erd", body }))).toBe('entity a "A" { current bool; focus text }');
  });

  it("drops a flag that is the last word before a comment, and an edge's", () => {
    expect(updateRetired('service a "A" focus %% note', [1])).toBe('service a "A" %% note');
    expect(updateRetired("a --> b focus", [1])).toBe("a --> b");
  });

  it("ignores a line number that is not there", () => {
    expect(updateRetired('service a "A"', [9])).toBe('service a "A"');
  });
});

describe("a body's dir=", () => {
  it("is moved out of the body and handed back as the direction", () => {
    expect(takeBodyDir('dir=TB\nservice a "A"')).toEqual({ body: 'service a "A"', dir: "TB" });
  });

  it("answers with the last one, because that is the one that won", () => {
    expect(takeBodyDir('dir=LR\nservice a "A"\ndir=TB\nservice b "B"')).toEqual({
      body: 'service a "A"\nservice b "B"',
      dir: "TB",
    });
  });

  it("is null when the body sets none, and never takes a group's", () => {
    expect(takeBodyDir('service a "A"')).toBeNull();
    expect(takeBodyDir('group g "G" dir=TB {\n  service a "A"\n}')).toBeNull();
  });

  it("leaves a direction it cannot read for the parser to report", () => {
    expect(takeBodyDir('dir=BT\nservice a "A"')).toBeNull();
  });

  it("draws the same diagram once the value is on the fence", () => {
    const moved = takeBodyDir('dir=TB\nservice a "A"\nservice b "B"\na --> b')!;
    expect(parseDiagram("arch", moved.body, moved.dir)!.dir).toBe(
      parseDiagram("arch", 'dir=TB\nservice a "A"\nservice b "B"\na --> b')!.dir,
    );
  });
});
