import { beforeAll, describe, expect, it } from "vitest";

import { declaredAt, declaredOn } from "@/dsl/declared";
import { fragId, msgId, noteId, parseSequence, seqIdOn, seqLineOf, seqParts } from "@/dsl/sequence";
import {
  addBranch,
  branchesOf,
  canWrap,
  insertParticipant,
  insertStatement,
  messageParts,
  messageStatement,
  moveRow,
  noteParts,
  noteStatement,
  removeBranch,
  removeFragment,
  seqRows,
  setBranchLabel,
  setMessageArrow,
  setMessageEnd,
  setMessageMark,
  setMessageText,
  setNoteOver,
  setNoteText,
  unwrap,
  wrapIn,
} from "@/dsl/sequence-write";
import { setMeasurer, TableMeasurer } from "@/layout/measure";
import { layoutSequence } from "@/layout/sequence";
import type { Theme } from "@/theme/contract";

import theme from "../themes/paper/theme.json";

const T = theme as unknown as Theme;
beforeAll(() => setMeasurer(new TableMeasurer()));

const errors = (body: string) => parseSequence(body).diagnostics.filter((d) => d.severity === "error");

const BODY = [
  'participant a "A"',
  'participant b "B"',
  'a ->> b : "one"',
  'alt "yes"',
  '  b -->> a : "two"',
  'else "no"',
  '  b -->> a : "three"',
  "end",
  'a ->> b : "four"',
].join("\n");

describe("the model a pick reads", () => {
  it("counts messages, fragments and notes in the order the file says them", () => {
    const body = `a ->> b : "1"\nloop "x"\n  alt "y"\n    a ->> b : "2"\n  end\nend\nnote over a : "n"\na ->> b : "3"`;
    const parts = seqParts(parseSequence(body).events);
    expect(parts.messages.map((m) => m.line)).toEqual([1, 4, 8]);
    expect(parts.fragments.map((f) => [f.kind, f.line, f.end])).toEqual([
      ["loop", 2, 6],
      ["alt", 3, 5],
    ]);
    expect(parts.notes.map((n) => n.line)).toEqual([7]);
  });

  it("finds a pick's line, and the pick on a line, both ways round", () => {
    expect(seqLineOf(BODY, msgId(1))).toBe(5);
    expect(seqLineOf(BODY, fragId(0))).toBe(4);
    expect(seqLineOf(BODY, msgId(9))).toBeNull();
    expect(seqIdOn(BODY, 5)).toEqual({ id: msgId(1), what: "edge" });
    expect(seqIdOn(BODY, 6)).toEqual({ id: fragId(0), what: "group" });
    expect(seqIdOn(BODY, 8)).toEqual({ id: fragId(0), what: "group" });
    expect(seqIdOn(BODY, 1)).toEqual({ id: "a", what: "node" });
    expect(declaredAt("sequence", BODY, msgId(3))).toBe(9);
    expect(declaredOn("sequence", BODY, 9)).toEqual({ id: msgId(3), what: "edge" });
  });

  it("gives the layout the same ids and a height for every row", () => {
    const placed = layoutSequence(parseSequence(BODY), T);
    expect(placed.messages.map((m) => m.id)).toEqual([msgId(0), msgId(1), msgId(2), msgId(3)]);
    expect(placed.fragments.map((f) => f.id)).toEqual([fragId(0)]);
    expect(placed.rows.map((r) => r.line)).toEqual([3, 4, 5, 6, 7, 8, 9]);
    const ys = placed.rows.map((r) => r.y);
    expect(ys).toEqual([...ys].sort((x, y) => x - y));
    expect(seqRows(parseSequence(BODY).events)).toEqual(placed.rows.map(({ line, inside }) => ({ line, inside })));
  });

  it("numbers notes apart from fragments", () => {
    const placed = layoutSequence(parseSequence(`note over a : "n"\nopt "o"\n  a ->> b : "x"\nend`), T);
    expect(placed.fragments.map((f) => f.id).sort()).toEqual([fragId(0), noteId(0)]);
  });
});

describe("Mermaid's + and - on a message", () => {
  it("reads the marker written onto the target, before it, and after it", () => {
    for (const line of ['a ->>+ b : "x"', 'a ->> +b : "x"', 'a ->> b + : "x"']) {
      const m = parseSequence(line);
      expect(errors(line)).toEqual([]);
      expect(m.participants.map((p) => p.id)).toEqual(["a", "b"]);
      expect(m.events.map((e) => e.t)).toEqual(["activate", "msg"]);
    }
    const back = parseSequence('b -->>-a : "y"');
    expect(back.participants.map((p) => p.id)).toEqual(["b", "a"]);
    expect(back.events.map((e) => (e.t === "deactivate" ? `${e.t} ${e.who}` : e.t))).toEqual(["msg", "deactivate b"]);
  });
});

describe("a message's writers", () => {
  const line = '  a ->> b : "hello" %% why';

  it("reads every part", () => {
    expect(messageParts(line)).toEqual({ from: "a", to: "b", arrow: "->>", text: "hello", activates: false, deactivates: false });
    expect(messageParts('a ->> +b : "x"')?.activates).toBe(true);
    expect(messageParts("participant a")).toBeNull();
  });

  it("retypes the label, adds one where there was none, and takes it off", () => {
    expect(setMessageText(line, "bye")).toBe('  a ->> b : "bye" %% why');
    expect(setMessageText("a ->> b", "new")).toBe('a ->> b : "new"');
    expect(setMessageText("a ->> b :", "new")).toBe('a ->> b : "new"');
    expect(setMessageText(line, null)).toBe("  a ->> b %% why");
  });

  it("changes who sends and who receives, keeping a + on the target", () => {
    expect(setMessageEnd(line, "from", "c")).toBe('  c ->> b : "hello" %% why');
    expect(setMessageEnd('a ->> +b : "x"', "to", "c")).toBe('a ->> +c : "x"');
    expect(setMessageEnd(line, "to", "not ok")).toBe(line);
  });

  it("changes the arrow to one of the four, and nothing else", () => {
    expect(setMessageArrow(line, "-->>")).toBe('  a -->> b : "hello" %% why');
    expect(setMessageArrow(line, "-)")).toBe('  a -) b : "hello" %% why');
    expect(setMessageArrow(line, "-->")).toBe(line);
  });

  it("writes the activation marks as Mermaid does, and converges on one spelling", () => {
    expect(setMessageMark('a ->> b : "x"', "+", true)).toBe('a ->> +b : "x"');
    expect(setMessageMark('a ->>+ b : "x"', "+", false)).toBe('a ->> b : "x"');
    expect(setMessageMark('a ->> b + : "x"', "+", false)).toBe('a ->> b : "x"');
    expect(setMessageMark('b -->> a : "y"', "-", true)).toBe('b -->> -a : "y"');
    const both = setMessageMark('a ->> +b : "x"', "-", true);
    expect(both).toBe('a ->> +b - : "x"');
    expect(parseSequence(both).events.map((e) => e.t)).toEqual(["activate", "msg", "deactivate"]);
    expect(setMessageMark(both, "+", false)).toBe('a ->> -b : "x"');
  });
});

describe("where a new statement goes", () => {
  const msg = messageStatement("b", "a", "new");

  it("goes after the row it was dropped under, at that row's depth", () => {
    expect(insertStatement(BODY, { line: 5, inside: false }, msg)).toEqual({
      body: BODY.replace('"two"', '"two"\n  b ->> a : "new"'),
      line: 6,
    });
  });

  it("goes into a block when the row above opens one", () => {
    const out = insertStatement(BODY, { line: 6, inside: true }, msg);
    expect(out.body.split("\n")[6]).toBe('  b ->> a : "new"');
    expect(errors(out.body)).toEqual([]);
  });

  it("goes after an end at the fragment's own depth", () => {
    const out = insertStatement(BODY, { line: 8, inside: false }, msg);
    expect(out.body.split("\n")[8]).toBe('b ->> a : "new"');
  });

  it("goes before the first thing that happens, or after the participants of an empty conversation", () => {
    expect(insertStatement(BODY, null, msg).line).toBe(3);
    const empty = 'participant a "A"\nparticipant b "B"\n';
    expect(insertStatement(empty, null, msg)).toEqual({ body: `${empty.trimEnd()}\n${msg}\n`, line: 3 });
  });

  it("puts a participant after the last one declared", () => {
    expect(insertParticipant(BODY, "c", "C").split("\n").slice(0, 3)).toEqual([
      'participant a "A"',
      'participant b "B"',
      'participant c "C"',
    ]);
    expect(insertParticipant("", "a", "Participant")).toBe('participant a "Participant"');
  });
});

describe("moving a message one row along the drawing", () => {
  it("steps out of a fragment over its head, and into the next branch over an else", () => {
    const up = moveRow(BODY, 5, -1)!;
    expect(up.body.split("\n").slice(2, 5)).toEqual(['a ->> b : "one"', 'b -->> a : "two"', 'alt "yes"']);
    expect(up.line).toBe(4);
    const down = moveRow(BODY, 5, 1)!;
    expect(down.body.split("\n").slice(3, 7)).toEqual(['alt "yes"', 'else "no"', '  b -->> a : "two"', '  b -->> a : "three"']);
    expect(errors(down.body)).toEqual([]);
  });

  it("steps into the last branch from below an end, and refuses at either end", () => {
    const up = moveRow(BODY, 9, -1)!;
    expect(up.body.split("\n").slice(6, 9)).toEqual(['  b -->> a : "three"', '  a ->> b : "four"', "end"]);
    expect(moveRow(BODY, 3, -1)).toBeNull();
    expect(moveRow(BODY, 9, 1)).toBeNull();
    expect(moveRow(BODY, 4, 1)).toBeNull();
  });
});

describe("fragments", () => {
  it("wraps a run of statements in one list, and refuses a run that crosses a fragment's edge", () => {
    expect(canWrap(BODY, 3, 9)).toBe(true);
    expect(canWrap(BODY, 5, 9)).toBe(false);
    const out = wrapIn(BODY, 3, 9, "loop")!;
    expect(out.line).toBe(3);
    expect(out.body.split("\n")).toEqual([
      'participant a "A"',
      'participant b "B"',
      'loop "repeat"',
      '  a ->> b : "one"',
      '  alt "yes"',
      '    b -->> a : "two"',
      '  else "no"',
      '    b -->> a : "three"',
      "  end",
      '  a ->> b : "four"',
      "end",
    ]);
    expect(errors(out.body)).toEqual([]);
    expect(wrapIn(BODY, 5, 9, "opt")).toBeNull();
  });

  it("wraps one message inside a branch at its depth", () => {
    const out = wrapIn(BODY, 7, 7, "par")!;
    expect(out.body.split("\n").slice(5, 10)).toEqual([
      'else "no"',
      '  par "in parallel"',
      '    b -->> a : "three"',
      "  end",
      "end",
    ]);
  });

  it("unwraps back to what it wrapped, and an alt with two branches to both", () => {
    const wrapped = wrapIn(BODY, 3, 9, "loop")!;
    expect(unwrap(wrapped.body, wrapped.line)).toBe(BODY);
    expect(unwrap(BODY, 4).split("\n").slice(2)).toEqual([
      'a ->> b : "one"',
      'b -->> a : "two"',
      'b -->> a : "three"',
      'a ->> b : "four"',
    ]);
  });

  it("adds an else to an alt and an and to a par, and nothing to an opt", () => {
    const alt = addBranch(BODY, 4)!;
    expect(alt.body.split("\n").slice(6, 9)).toEqual(['  b -->> a : "three"', 'else "otherwise"', "end"]);
    expect(alt.line).toBe(8);
    const par = addBranch(`par "x"\n  a ->> b : "1"\nend`, 1)!;
    expect(par.body).toBe(`par "x"\n  a ->> b : "1"\nand "also"\nend`);
    expect(addBranch(`opt "x"\n  a ->> b : "1"\nend`, 1)).toBeNull();
  });

  it("removes a branch with what is in it, and the whole fragment", () => {
    expect(removeBranch(BODY, 6).split("\n").slice(3)).toEqual(['alt "yes"', '  b -->> a : "two"', "end", 'a ->> b : "four"']);
    expect(removeBranch(BODY, 4)).toBe(BODY);
    expect(removeFragment(BODY, 4).split("\n").slice(2)).toEqual(['a ->> b : "one"', 'a ->> b : "four"']);
  });

  it("reads and writes each branch's condition", () => {
    expect(branchesOf(BODY, 8)).toEqual({
      kind: "alt",
      branches: [
        { line: 4, label: "yes" },
        { line: 6, label: "no" },
      ],
    });
    expect(setBranchLabel('else "no"', "never")).toBe('else "never"');
    expect(setBranchLabel("else", "never")).toBe('else "never"');
    expect(setBranchLabel('  loop "x"', null)).toBe("  loop");
  });
});

describe("notes", () => {
  it("writes, reads and rewrites a note over one or two participants", () => {
    const line = noteStatement(["a", "b"], "both");
    expect(line).toBe('note over a, b : "both"');
    expect(parseSequence(line).events).toEqual([{ t: "note", over: ["a", "b"], text: "both", line: 1 }]);
    expect(noteParts(line)).toEqual({ over: ["a", "b"], text: "both" });
    expect(setNoteText(line, "one")).toBe('note over a, b : "one"');
    expect(setNoteText("note over a :", "one")).toBe('note over a : "one"');
    expect(setNoteOver(line, ["b"])).toBe('note over b : "both"');
    expect(setNoteOver('note over a : "x"', ["a", "c"])).toBe('note over a, c : "x"');
    expect(setNoteOver(line, [])).toBe(line);
  });
});
