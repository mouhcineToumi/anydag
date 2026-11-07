import { describe, expect, it } from "vitest";

import { declaredAt, declaredOn } from "@/dsl/declared";
import { parseDiagram } from "@/dsl/parse";
import {
  addRow,
  edgeSpan,
  isArrow,
  moveStatement,
  removeEdge,
  removeNode,
  removeRefs,
  removeRow,
  renameId,
  replaceLine,
  setDesc,
  setEdgeArrow,
  setEdgeFlag,
  setEdgeHue,
  setLinkVia,
  setEdgeLabel,
  setFlag,
  setKind,
  setMeta,
  setModifier,
  setRow,
  setStatus,
  setTitle,
  statementSpan,
} from "@/dsl/restate";

/**
 * Editing one statement without disturbing the rest of it.
 *
 * These are the writes the panel's node controls make, and every one of them lands in a file a
 * person also edits by hand. So the property under test is not only "the value changed" but "the
 * line is otherwise byte-identical" — an author's spacing, their trailing comment and their row
 * block all survive.
 *
 * The writers that span several lines carry a second obligation the single-line ones do not: **what
 * comes out has to parse**. A delete that leaves an edge pointing at nothing hands the author
 * `E_UNKNOWN_ID` on a line they never touched, so `removeNode` is checked against the real parser
 * in every dialect that has one.
 */

/** Nothing the parser can complain about. The bar for every writer that touches more than a line. */
const clean = (type: string, src: string) => {
  const graph = parseDiagram(type, src);
  expect(graph).not.toBe(null);
  expect(graph!.diagnostics.map((d) => `${d.line} ${d.code} ${d.message}`)).toEqual([]);
};

describe("setModifier", () => {
  it("adds a hue where there was none", () => {
    expect(setModifier('service api "larkspur-api"', "hue", "teal")).toBe('service api "larkspur-api" hue=teal');
  });

  it("replaces a hue in place", () => {
    expect(setModifier('service api "x" hue=coral icon=server', "hue", "teal")).toBe(
      'service api "x" icon=server hue=teal',
    );
  });

  it("removes a hue with null, and the space that held it", () => {
    expect(setModifier('service api "x" hue=coral icon=server', "hue", null)).toBe('service api "x" icon=server');
  });

  it("goes before a row block, not after it", () => {
    expect(setModifier('service api "x" {', "hue", "teal")).toBe('service api "x" hue=teal {');
  });

  it("keeps the author's indentation", () => {
    expect(setModifier('    store fs "Firestore"', "hue", "moss")).toBe('    store fs "Firestore" hue=moss');
  });

  it("does not touch a status word living inside a label", () => {
    expect(setModifier('state s1 "we stop here"', "hue", "ochre")).toBe('state s1 "we stop here" hue=ochre');
  });

  it("carries a namespaced icon off in one piece", () => {
    expect(setModifier('service api "x" icon=aws:lambda hue=teal', "icon", "server")).toBe(
      'service api "x" hue=teal icon=server',
    );
  });

  it("quotes a value that needs it", () => {
    expect(setModifier('service api "x"', "icon", "two words")).toBe('service api "x" icon="two words"');
  });

  it("leaves a trailing comment alone", () => {
    expect(setModifier('service api "x" %% the api', "hue", "teal")).toBe('service api "x" hue=teal %% the api');
  });
});

describe("setStatus", () => {
  it("adds and replaces a flag", () => {
    expect(setStatus('service api "x"', "done")).toBe('service api "x" done');
    expect(setStatus('service api "x" wait', "done")).toBe('service api "x" done');
  });

  it("clears a flag", () => {
    expect(setStatus('service api "x" stop hue=teal', null)).toBe('service api "x" hue=teal');
  });

  it("does not mistake an id for a flag", () => {
    /* `state done "Done"` is the natural way to write a terminal state, and `done` there is the id.
       Setting a status must add one, not overwrite the node's name. */
    expect(setStatus('state done "Done"', "done")).toBe('state done "Done" done');
  });

  it("does not mistake an untitled node's id for a flag either", () => {
    /* The same statement with one fewer string. The old rule read the id as the flag and renamed
       the node to `wait`, which is the sort of edit nobody would look for. */
    expect(setStatus("state done", "wait")).toBe("state done wait");
    expect(setStatus("state done", null)).toBe("state done");
  });

  it("does not mistake a label for a flag", () => {
    expect(setStatus('state s1 "wait for it"', "done")).toBe('state s1 "wait for it" done');
  });
});

describe("setFlag", () => {
  it("adds one, and adding it twice writes it once", () => {
    const once = setFlag('service api "x"', "async", true);
    expect(once).toBe('service api "x" async');
    expect(setFlag(once, "async", true)).toBe(once);
  });

  it("carries two at a time, and takes one off", () => {
    const both = setFlag('service api "x" external', "async", true);
    expect(both).toBe('service api "x" external async');
    expect(setFlag(both, "external", false)).toBe('service api "x" async');
  });

  it("takes nothing off a line that has none", () => {
    expect(setFlag('service api "x"', "external", false)).toBe('service api "x"');
  });

  it("goes before a row block and before a comment", () => {
    expect(setFlag('entity a "A" {', "external", true)).toBe('entity a "A" external {');
    expect(setFlag('service api "x" %% the api', "async", true)).toBe('service api "x" async %% the api');
  });

  it("leaves an id that is spelt like a flag alone", () => {
    expect(setFlag('state async "Async"', "async", false)).toBe('state async "Async"');
    expect(setFlag("state async", "external", true)).toBe("state async external");
  });

  it("reads a ref as a ref, however it is spelt", () => {
    /* `quiet` after an arrow is a node, so the flag is appended rather than found. */
    expect(setFlag("a --> quiet", "quiet", true)).toBe("a --> quiet quiet");
    expect(setFlag('a --> b "hop"', "quiet", true)).toBe('a --> b "hop" quiet');
  });
});

describe("setFlag — bold / italic", () => {
  it("adds emphasis flags the way it adds any other flag", () => {
    const once = setFlag('service api "x"', "bold", true);
    expect(once).toBe('service api "x" bold');
    expect(setFlag(once, "bold", true)).toBe(once);
    expect(setFlag(once, "italic", true)).toBe('service api "x" bold italic');
  });

  it("takes one off and leaves the other", () => {
    expect(setFlag('service api "x" bold italic', "bold", false)).toBe('service api "x" italic');
    expect(setFlag('service api "x" bold italic', "italic", false)).toBe('service api "x" bold');
  });

  it("takes nothing off a line that has none", () => {
    expect(setFlag('service api "x"', "bold", false)).toBe('service api "x"');
    expect(setFlag('service api "x"', "italic", false)).toBe('service api "x"');
  });

  it("leaves the rest of the line byte-identical — indent, quoting, trailing comment", () => {
    expect(setFlag('    state done "Done" %% the end', "italic", true)).toBe(
      '    state done "Done" italic %% the end',
    );
  });

  it("does not mistake a title for a flag", () => {
    expect(setFlag('state s1 "bold move"', "bold", false)).toBe('state s1 "bold move"');
  });

  it("survives a status change beside the emphasis, in both directions", () => {
    expect(setStatus('service api "x" bold', "done")).toBe('service api "x" bold done');
    expect(setStatus('service api "x" done bold', null)).toBe('service api "x" bold');
    expect(setFlag('service api "x" done bold', "bold", false)).toBe('service api "x" done');
    expect(setFlag('service api "x" done italic', "italic", true)).toBe('service api "x" done italic');
  });
});

describe("setTitle / setMeta / setDesc", () => {
  it("adds a title to a node that had none", () => {
    expect(setTitle("service api", "The API")).toBe('service api "The API"');
  });

  it("replaces one in place, leaving the modifiers where they are", () => {
    expect(setTitle('service api "old" hue=teal icon=server', "new")).toBe('service api "new" hue=teal icon=server');
  });

  it("goes in before a flag, a row block and a comment", () => {
    expect(setTitle("service api done", "The API")).toBe('service api "The API" done');
    expect(setTitle("entity workspace {", "Workspace")).toBe('entity workspace "Workspace" {');
    expect(setTitle("service api hue=teal {", "The API")).toBe('service api "The API" hue=teal {');
    expect(setTitle("service api %% the api", "The API")).toBe('service api "The API" %% the api');
  });

  it("keeps the indentation of a node inside a group", () => {
    expect(setTitle('  store fs "old"', "Firestore")).toBe('  store fs "Firestore"');
  });

  it("quotes what it writes", () => {
    expect(setTitle('service api "x"', 'the "real" api')).toBe('service api "the \\"real\\" api"');
  });

  it("pads the slots it skips, because they are positional", () => {
    expect(setMeta("service api", "FastAPI")).toBe('service api "" "FastAPI"');
    expect(setDesc('person u "User"', "Somebody who logs in")).toBe('person u "User" "" "Somebody who logs in"');
  });

  it("writes the second and third strings where the parser reads them", () => {
    const c4 = 'container api "API" "FastAPI" "Serves the app"';
    expect(setMeta(c4, "Go")).toBe('container api "API" "Go" "Serves the app"');
    expect(setDesc(c4, "Serves it")).toBe('container api "API" "FastAPI" "Serves it"');
  });

  it("clears the last string outright and an earlier one to an empty slot", () => {
    /* Dropping the title would otherwise promote the meta into its place — a different diagram. */
    expect(setDesc('container api "API" "FastAPI" "Serves the app"', null)).toBe('container api "API" "FastAPI"');
    expect(setTitle('container api "API" "FastAPI"', null)).toBe('container api "" "FastAPI"');
    expect(setMeta('service api "API"', null)).toBe('service api "API"');
  });

  it("is idempotent", () => {
    const once = setTitle("service api", "The API");
    expect(setTitle(once, "The API")).toBe(once);
    const meta = setMeta(once, "FastAPI");
    expect(setMeta(meta, "FastAPI")).toBe(meta);
  });

  it("refuses an edge, whose strings are its labels", () => {
    expect(setTitle('a --> b "calls"', "nope")).toBe('a --> b "calls"');
    expect(setMeta("a & b --> c", "nope")).toBe("a & b --> c");
  });

  it("renames a sequence participant, which is the same shape", () => {
    expect(setTitle('participant web "Browser"', "The browser")).toBe('participant web "The browser"');
    expect(setTitle('  participant api "API" icon=aws:lambda', "The API")).toBe(
      '  participant api "The API" icon=aws:lambda',
    );
  });

  it("writes a mindmap topic, where the line is the title", () => {
    expect(setTitle("  Content", "Reading", "mindmap")).toBe("  Reading");
    expect(setTitle("root Larkspur", "Orbit", "mindmap")).toBe("root Orbit");
    /* Two words look exactly like a declaration, which is why the type is asked for at all. */
    expect(setTitle("  Content Management", "Reading", "mindmap")).toBe("  Reading");
  });
});

describe("setKind", () => {
  it("retypes a node and touches nothing else", () => {
    expect(setKind('service api "The API" icon=server', "store")).toBe('store api "The API" icon=server');
    expect(setKind('  entity workspace "Workspace" {', "entity")).toBe('  entity workspace "Workspace" {');
  });

  it("refuses anything that is not a declaration", () => {
    expect(setKind('a --> b "calls"', "store")).toBe('a --> b "calls"');
    expect(setKind('service "quoted"', "store")).toBe('service "quoted"');
  });
});

describe("replaceLine", () => {
  it("changes one line and nothing else", () => {
    expect(replaceLine("a\nb\nc", 2, "B")).toBe("a\nB\nc");
  });
  it("ignores a line that is not there", () => {
    expect(replaceLine("a\nb", 9, "x")).toBe("a\nb");
  });
});

describe("statementSpan", () => {
  const src = 'group gcp "GCP" {\n  service api "API" {\n    identity "verify"\n  }\n}\nstore db "D"';

  it("runs to the closing brace of the block a statement opens", () => {
    expect(statementSpan(src, 1)).toEqual({ from: 1, to: 5 });
    expect(statementSpan(src, 2)).toEqual({ from: 2, to: 4 });
    expect(statementSpan(src, 6)).toEqual({ from: 6, to: 6 });
  });

  it("counts braces as tokens, so one inside a label is text", () => {
    expect(statementSpan('service api "a { b"\nstore db "D"', 1)).toEqual({ from: 1, to: 1 });
  });
});

/* ------------------------------------------------------------------------------------ rows */

describe("rows", () => {
  it("makes the block when the statement has none", () => {
    expect(addRow('entity workspace "Workspace"', 1, "id uuid pk")).toBe(
      'entity workspace "Workspace" {\n  id uuid pk\n}',
    );
  });

  it("indents the new block two past the statement", () => {
    const src = 'group t "T" {\n  entity workspace "Workspace"\n}';
    expect(addRow(src, 2, "id uuid pk")).toBe('group t "T" {\n  entity workspace "Workspace" {\n    id uuid pk\n  }\n}');
  });

  it("appends to a block that is already open, at the rows' own indent", () => {
    const src = 'entity workspace "W" {\n    id uuid pk\n}\nentity other "O"';
    expect(addRow(src, 1, "slug text")).toBe('entity workspace "W" {\n    id uuid pk\n    slug text\n}\nentity other "O"');
  });

  it("appends to a one-liner in place rather than exploding it", () => {
    expect(addRow("entity workspace { id uuid pk }", 1, "slug text")).toBe(
      "entity workspace { id uuid pk; slug text }",
    );
    expect(addRow("entity workspace { }", 1, "id uuid pk")).toBe("entity workspace { id uuid pk }");
  });

  it("writes a block that parses, comment and all", () => {
    const out = addRow('entity workspace "W" %% the tenant', 1, "id uuid pk");
    expect(out).toBe('entity workspace "W" { %% the tenant\n  id uuid pk\n}');
    clean("erd", out);
  });

  it("rewrites one row, keeping its indent and its comment", () => {
    const src = 'entity workspace "W" {\n  id uuid pk %% the key\n}';
    expect(setRow(src, 2, "id bigint pk")).toBe('entity workspace "W" {\n  id bigint pk %% the key\n}');
  });

  it("takes a row out", () => {
    const src = 'entity workspace "W" {\n  id uuid pk\n  slug text\n}';
    expect(removeRow(src, 3)).toBe('entity workspace "W" {\n  id uuid pk\n}');
    clean("erd", removeRow(src, 3));
  });

  it("leaves an empty block behind rather than guessing", () => {
    const src = 'entity workspace "W" {\n  id uuid pk\n}';
    expect(removeRow(src, 2)).toBe('entity workspace "W" {\n}');
    clean("erd", removeRow(src, 2));
  });

  it("refuses a row that shares its line with the braces", () => {
    const src = "entity workspace { id uuid pk; slug text }";
    expect(removeRow(src, 1)).toBe(src);
    expect(setRow(src, 1, "id bigint pk")).toBe(src);
  });
});

/* ----------------------------------------------------------------------------------- edges */

describe("edgeSpan", () => {
  it("says nothing about a declaration", () => {
    expect(edgeSpan('service api "The API"')).toBe(null);
    expect(edgeSpan("  id uuid pk")).toBe(null);
  });

  it("counts one more ref list than arrows", () => {
    const e = edgeSpan('a & b --> c "reject" --> d')!;
    expect(e.arrows.map((t) => t.value)).toEqual(["-->", "-->"]);
    expect(e.refs.map((r) => r.tokens.map((t) => t.value))).toEqual([["a", "b"], ["c"], ["d"]]);
    expect(e.tails[1]!.strings.map((t) => t.value)).toEqual(["reject"]);
  });
});

describe("edge writers", () => {
  it("adds, replaces and clears a label", () => {
    expect(setEdgeLabel("a --> b", "calls")).toBe('a --> b "calls"');
    expect(setEdgeLabel('a --> b "calls"', "reads")).toBe('a --> b "reads"');
    expect(setEdgeLabel('a --> b "calls"', null)).toBe("a --> b");
  });

  it("puts a label before the modifiers, where the parser reads it", () => {
    expect(setEdgeLabel("a --> b quiet", "calls")).toBe('a --> b "calls" quiet');
  });

  it("leaves a Mermaid colon form intact", () => {
    expect(setEdgeLabel('a --> b: "old"', "new")).toBe('a --> b: "new"');
  });

  it("keeps the second label standing behind the first", () => {
    expect(setEdgeLabel('u --> api "uses" "HTTPS"', null)).toBe('u --> api "" "HTTPS"');
  });

  it("takes a segment on a chain", () => {
    expect(setEdgeLabel("a --> b --> c", "second", 1)).toBe('a --> b --> c "second"');
    expect(setEdgeLabel('a --> b "one" --> c', "first", 0)).toBe('a --> b "first" --> c');
  });

  it("swaps an arrow for another the tokenizer knows", () => {
    expect(setEdgeArrow("a --> b", "-.->")).toBe("a -.-> b");
    expect(setEdgeArrow("impl --|> base", "..|>")).toBe("impl ..|> base");
    expect(setEdgeArrow("a --> b --> c", "---", 1)).toBe("a --> b --- c");
  });

  it("swaps an ER cardinality, which is not in any table here", () => {
    expect(setEdgeArrow("workspace.id ||--o{ intake.workspace_id", "||--||")).toBe(
      "workspace.id ||--|| intake.workspace_id",
    );
  });

  it("refuses a spelling the tokenizer does not read as one arrow", () => {
    expect(setEdgeArrow("a --> b", "~~>")).toBe("a --> b");
    expect(setEdgeArrow("a --> b", "--> -->")).toBe("a --> b");
    expect(isArrow("-->")).toBe(true);
    expect(isArrow("~~>")).toBe(false);
  });

  it("writes a hue and the quiet flag", () => {
    expect(setEdgeHue('a --> b "calls"', "teal")).toBe('a --> b "calls" hue=teal');
    expect(setEdgeHue('a --> b "calls" hue=teal', null)).toBe('a --> b "calls"');
    expect(setEdgeFlag('a --> b "calls"', "quiet", true)).toBe('a --> b "calls" quiet');
    expect(setEdgeFlag('a --> b "calls" quiet', "quiet", false)).toBe('a --> b "calls"');
  });

  it("writes a bend as a quoted pair, and takes it off again", () => {
    /* Quoted, always: `,` is punctuation to the tokenizer, so `via=320,180` would be read as the
       value ending at the comma. `parseLinks` reads the string back, which is what the round trip
       in `links.test.ts` holds. */
    expect(setLinkVia('a --> b "calls"', { x: 320, y: 180 })).toBe('a --> b "calls" via="320,180"');
    expect(setLinkVia('a --> b "calls" via="320,180"', { x: -8, y: 0 })).toBe('a --> b "calls" via="-8,0"');
    expect(setLinkVia('a --> b "calls" via="320,180"', null)).toBe('a --> b "calls"');
    /* Rounded, for `setGeometry`'s reason: nobody meant to write `via="241.60000000000002,88"`. */
    expect(setLinkVia("a --> b", { x: 241.60000000000002, y: 88.4 })).toBe('a --> b via="242,88"');
  });

  it("takes a whole statement out, chain and bus alike", () => {
    const src = 'service a "A"\n\na --> b --> c\nb & c --> d';
    expect(removeEdge(src, 3)).toBe('service a "A"\n\nb & c --> d');
    expect(removeEdge(src, 4)).toBe('service a "A"\n\na --> b --> c');
    expect(removeEdge(src, 99)).toBe(src);
  });
});

/* -------------------------------------------------------------------------------- removeNode */

describe("removeNode", () => {
  it("takes the statement and every edge that named it", () => {
    const src = 'service api "API"\nstore db "D"\n\napi --> db "writes"';
    expect(removeNode(src, "api", { type: "arch" })).toBe('store db "D"');
  });

  it("drops one source off a bus and keeps the line", () => {
    const src = 'service a "A"\nservice b "B"\nstore c "C"\n\na & b --> c "writes" %% both of them';
    expect(removeNode(src, "a", { type: "arch" })).toBe(
      'service b "B"\nstore c "C"\n\nb --> c "writes" %% both of them',
    );
  });

  it("drops two sources off a bus without eating the third", () => {
    expect(removeNode("f1 --> a & b & c", "a")).toContain("f1 --> b & c");
    const two = removeNode(removeNode("f1 --> a & b & c", "a"), "b");
    expect(two).toBe("f1 --> c");
  });

  it("splits a chain and drops the segments that named it", () => {
    expect(removeNode("a --> b --> c --> d", "c")).toBe("a --> b");
    expect(removeNode("a --> b --> c", "b")).toBe("");
    expect(removeNode('a --> b "one" --> c "two"', "c")).toBe('a --> b "one"');
  });

  it("keeps a split segment exactly as it was written, comment included", () => {
    expect(removeNode('  a --> b "one" --> c --> d %% the chain', "c")).toBe('  a --> b "one" %% the chain');
  });

  it("keeps a split segment's own label and modifiers, and not the ones of the hop before it", () => {
    expect(removeNode('a --> b "one" hue=teal --> c "two" quiet', "c")).toBe('a --> b "one" hue=teal');
    expect(removeNode('a --> b "one" hue=teal --> c "two" quiet %% two hops', "a")).toBe('b --> c "two" quiet %% two hops');
    expect(removeNode("a --> b  -.->  c --> d", "d")).toBe("a --> b\nb  -.->  c");
  });

  it("counts a row reference as naming the card", () => {
    const src = 'entity workspace "W" {\n  id uuid pk\n}\nentity intake "I" {\n  ws uuid fk\n}\n\nworkspace.id ||--o{ intake.ws';
    expect(removeNode(src, "workspace", { type: "erd" })).toBe('entity intake "I" {\n  ws uuid fk\n}');
  });

  it("does not touch an id that only starts with the one being removed", () => {
    const src = 'service api "A"\nservice api2 "B"\nstore db "D"\n\napi --> db\napi2 --> db\napi2.x --> db';
    const out = removeNode(src, "api", { type: "arch" });
    expect(out).toContain('service api2 "B"');
    expect(out).toContain("api2 --> db");
    expect(out).toContain("api2.x --> db");
    expect(out).not.toMatch(/^api --> db$/m);
  });

  it("takes a group's children with it, and the edges that named them", () => {
    const src = 'group gcp "GCP" {\n  service api "API"\n  store fs "FS"\n}\nclient br "Browser"\n\nbr --> api\napi --> fs\nbr --> gcp';
    expect(removeNode(src, "gcp", { type: "arch" })).toBe('client br "Browser"');
  });

  it("does not leave the blank line the statement was sitting between", () => {
    const src = 'service api "API"\n\nstore db "D"\n\napi --> db';
    expect(removeNode(src, "db", { type: "arch" })).toBe('service api "API"');
  });

  it("is idempotent, and says nothing about an id that is not there", () => {
    const src = 'service api "API"\nstore db "D"\n\napi --> db';
    const once = removeNode(src, "api", { type: "arch" });
    expect(removeNode(once, "api", { type: "arch" })).toBe(once);
    expect(removeNode(src, "nope", { type: "arch" })).toBe(src);
  });

  it("finds the declaration without being told the dialect", () => {
    const src = 'service api "API"\nstore db "D"\n\napi --> db';
    expect(removeNode(src, "api")).toBe(removeNode(src, "api", { type: "arch" }));
  });

  /*
   * The bar every delete has to clear: what is left parses.
   *
   * One case per dialect that has a parser, each written the way a board is — a group or a lane, a
   * card with rows, a chain, a bus and a row reference — so the reference-stripping is exercised
   * rather than the happy path.
   */
  const CASES: { type: string; id: string; src: string }[] = [
    {
      type: "arch",
      id: "api",
      src: 'client browser "Browser"\n\ngroup gcp "Google Cloud" {\n  service api "API" {\n    identity "verify"\n  }\n  store fs "Firestore"\n}\n\nbrowser --> api "/api"\napi.identity --> fs\nbrowser & api --> fs',
    },
    {
      type: "erd",
      id: "workspace",
      src: 'group tenancy "Tenancy" {\n  entity workspace { id uuid pk; slug text }\n}\nentity intake "Intake" {\n  id uuid pk\n  workspace_id uuid fk=tenancy\n}\n\nworkspace.id ||--o{ intake.workspace_id',
    },
    { type: "state", id: "b", src: 'state a "A"\nstate b "B"\n\n[*] --> a --> b --> [*]' },
    {
      type: "class",
      id: "impl",
      src: 'class base "Base"\nclass impl "Impl" {\n  +run() void\n}\n\nimpl --|> base',
    },
    {
      type: "usecase",
      id: "u1",
      src: 'system s "System" {\n  usecase u1 "Do a thing"\n}\nactor a "Analyst"\n\na --> u1',
    },
    {
      type: "c4",
      id: "api",
      src: 'person u "User" "Somebody"\ncontainer api "API" "FastAPI" "Serves the app"\n\nu --> api "uses" "HTTPS"',
    },
    {
      type: "flow",
      id: "b",
      src: 'lane ops "Ops" {\n  step a "A"\n  step b "B"\n}\n\na --> b',
    },
  ];

  for (const { type, id, src } of CASES) {
    it(`leaves a ${type} that parses clean`, () => {
      clean(type, src);
      const out = removeNode(src, id, { type });
      expect(out).not.toContain(`"${id}"`);
      clean(type, out);
    });
  }
});

/* -------------------------------------------------------------------------------- removeRefs */

describe("removeRefs", () => {
  const dead = (...ids: string[]) => (word: string) => ids.includes(word);

  it("takes a whole statement whose one end is going, and the blank line its going would double", () => {
    expect(removeRefs("a --> b\n\nb --> c\n\nc --> d", dead("b"))).toBe("c --> d");
  });

  it("drops one source off a bus, and splits a chain rather than joining what it stood between", () => {
    expect(removeRefs("a & b --> c", dead("a"))).toBe("b --> c");
    expect(removeRefs('a --> b --> c "two" via="320,180"', dead("a"))).toBe('b --> c "two" via="320,180"');
    expect(removeRefs("a --> b --> c", dead("b"))).toBe("");
  });

  it("leaves a body that names nothing going exactly as it was", () => {
    const body = "a --> b  %% spaced\nc -.-> d";
    expect(removeRefs(body, dead("x"))).toBe(body);
  });

  it("asks about each reference as written, so the caller decides what a dotted one names", () => {
    expect(removeRefs("arch1.db --> note\narch2 --> note", (w) => w.startsWith("arch1."))).toBe("arch2 --> note");
  });
});

/* ---------------------------------------------------------------------------------- renameId */

describe("renameId", () => {
  it("renames the declaration, every reference and the head of a dotted one", () => {
    const src = 'service api "API" {\n  content "reads"\n}\nstore db "D"\napi --> db\napi.content --> db';
    const out = renameId(src, "api", "core");
    expect(out).toContain('service core "API"');
    expect(out).toContain("core --> db");
    expect(out).toContain("core.content --> db");
  });

  it("leaves an id that merely starts with it alone", () => {
    const src = 'service api "A"\nservice api2 "B"\napi --> api2';
    expect(renameId(src, "api", "core")).toBe('service core "A"\nservice api2 "B"\ncore --> api2');
  });

  it("never touches a string, and a rename to itself is not a write", () => {
    const src = 'service api "the api that is an api"\napi --> db';
    expect(renameId(src, "api", "core")).toContain('"the api that is an api"');
    expect(renameId(src, "api", "api")).toBe(src);
  });
});

/* ----------------------------------------------------------------------------- moveStatement */

const GROUPED = 'group gcp "GCP" {\n  service api "API"\n}\nstore db "D"';

describe("moveStatement", () => {
  it("moves a statement into a block, at the block's depth", () => {
    expect(moveStatement(GROUPED, 4, { intoBlockLine: 1 })).toBe(
      'group gcp "GCP" {\n  store db "D"\n  service api "API"\n}',
    );
    clean("arch", moveStatement(GROUPED, 4, { intoBlockLine: 1 }));
  });

  it("moves one out of a block, after a sibling", () => {
    const out = moveStatement(GROUPED, 2, { afterLine: 4 });
    expect(out).toBe('group gcp "GCP" {\n}\nstore db "D"\nservice api "API"');
    clean("arch", out);
  });

  it("carries a nested group's whole block, at the same relative indent", () => {
    const src =
      'group a "A" {\n  group b "B" {\n    service api "API"\n  }\n}\ngroup c "C" {\n  store db "D"\n}';
    const out = moveStatement(src, 2, { intoBlockLine: 6 });
    expect(out).toBe(
      'group a "A" {\n}\ngroup c "C" {\n  group b "B" {\n    service api "API"\n  }\n  store db "D"\n}',
    );
    clean("arch", out);
  });

  it("puts one at the top, with no indent", () => {
    expect(moveStatement(GROUPED, 2, { toTop: true })).toBe(
      'service api "API"\ngroup gcp "GCP" {\n}\nstore db "D"',
    );
  });

  it("takes the blank line the statement was sitting between", () => {
    const src = 'service api "API"\n\nstore db "D"\n\nclient br "B"';
    expect(moveStatement(src, 3, { toTop: true })).toBe('store db "D"\nservice api "API"\n\nclient br "B"');
  });

  it("is idempotent, and refuses to move a statement inside itself", () => {
    const once = moveStatement(GROUPED, 4, { intoBlockLine: 1 });
    expect(moveStatement(once, 2, { intoBlockLine: 1 })).toBe(once);
    expect(moveStatement(GROUPED, 1, { intoBlockLine: 1 })).toBe(GROUPED);
    expect(moveStatement(GROUPED, 1, { afterLine: 2 })).toBe(GROUPED);
  });

  it("refuses a target with no block to move into", () => {
    expect(moveStatement(GROUPED, 2, { intoBlockLine: 4 })).toBe(GROUPED);
    expect(moveStatement("entity a { id uuid pk }\nentity b \"B\"", 2, { intoBlockLine: 1 })).toBe(
      'entity a { id uuid pk }\nentity b "B"',
    );
  });
});

/* -------------------------------------------------------------------------------- declared */

const ARCH = `client browser "Browser" icon=monitor

group gcp "Google Cloud" hue=indigo {
  service api "larkspur-api" icon=server {
    identity "verify the id token"
  }
}

browser --> api "/api"`;

describe("declaredAt / declaredOn", () => {
  it("finds the line a node is declared on", () => {
    expect(declaredAt("arch", ARCH, "api")).toBe(4);
    expect(declaredAt("arch", ARCH, "browser")).toBe(1);
  });

  it("finds a group as well as a node", () => {
    expect(declaredAt("arch", ARCH, "gcp")).toBe(3);
  });

  it("says nothing for an id the diagram does not have", () => {
    expect(declaredAt("arch", ARCH, "nope")).toBe(null);
  });

  it("names what a line declares", () => {
    expect(declaredOn("arch", ARCH, 4)).toEqual({ id: "api", what: "node" });
    expect(declaredOn("arch", ARCH, 3)).toEqual({ id: "gcp", what: "group" });
  });

  it("names an edge, which is what the line at the bottom is", () => {
    const at = declaredOn("arch", ARCH, 9)!;
    expect(at.what).toBe("edge");
    expect(declaredAt("arch", ARCH, at.id)).toBe(9);
  });

  it("round-trips: the line a node is on is the line that declares it", () => {
    for (const id of ["browser", "api", "gcp"]) {
      const line = declaredAt("arch", ARCH, id);
      expect(line).not.toBe(null);
      expect(declaredOn("arch", ARCH, line!)?.id).toBe(id);
    }
  });

  it("finds a sequence participant, which carries no line of its own", () => {
    const seq = `participant web "Browser"\nparticipant api "API"\n\nweb ->> api "GET /x"`;
    expect(declaredAt("sequence", seq, "api")).toBe(2);
  });

  it("finds a mindmap topic, whose id is the parser's", () => {
    const map = "root Larkspur\n  Content\n  Progress";
    /* The ids count the edges too — `m1` then `e2` then `m3` — so they are the parser's in every
       sense, and a caller that guesses at them from the line order guesses wrong. */
    expect(declaredAt("mindmap", map, "m1")).toBe(2);
    expect(declaredOn("mindmap", map, 3)).toEqual({ id: "m3", what: "node" });
  });
});
