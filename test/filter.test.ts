import { describe, expect, it } from "vitest";

import { filterByKind, hiddenWords, kindCounts, parseHidden, SHOWN_KINDS, shownKind, type Kinds } from "@/ui/filter";
import { emptyFolders, keyOf, leaf, rows, tree, type Entry, type Row, type Tree } from "@/ui/tree";

/** One file of each kind, and the three note-shaped records that tell the note kinds apart. */
const entries: Entry[] = [
  { kind: "board", name: "plan" },
  { kind: "note", name: "idea" },
  { kind: "note", name: "errand" },
  { kind: "note", name: "client" },
  { kind: "note", name: "standup" },
  { kind: "quiz", name: "trivia" },
  { kind: "table", name: "deals" },
  { kind: "file", name: "spec.pdf" },
];

const kinds: Kinds = {
  tasks: { errand: { status: "todo" } },
  projects: { client: { status: "active" } },
  events: { standup: { start: "2026-11-15" } },
};

/** The tree as text, so a failure reads as the list somebody would see. */
function draw(node: Tree, depth = 0): string[] {
  const pad = "  ".repeat(depth);
  return [
    ...node.folders.flatMap((f) => [`${pad}${f.name}/`, ...draw(f, depth + 1)]),
    ...node.files.map((e) => `${pad}${leaf(e.name)}${e.kind === "note" ? " (note)" : ""}`),
  ];
}

describe("shownKind", () => {
  it("names every kind the menu has a row for", () => {
    expect(entries.map((e) => shownKind(e, kinds))).toEqual([
      "board",
      "note",
      "task",
      "project",
      "event",
      "quiz",
      "table",
      "attachment",
    ]);
  });

  it("wears the mark the row wears: a project before a task, and a task before an event", () => {
    const both = { ...kinds, tasks: { ...kinds.tasks, client: { status: "done" as const } } };
    expect(shownKind({ kind: "note", name: "client" }, both)).toBe("project");
    const eventedTask = { ...kinds, events: { ...kinds.events, errand: { start: "2026-11-15" } } };
    expect(shownKind({ kind: "note", name: "errand" }, eventedTask)).toBe("task");
  });
});

describe("filterByKind", () => {
  const t = tree([...entries, { kind: "board", name: "work/plan" }, { kind: "note", name: "work/idea" }], ["work", "empty"]);

  it("takes a hidden kind out and leaves the rest where they were", () => {
    expect(draw(filterByKind(t, new Set(["note"]), kinds))).toEqual([
      "empty/",
      "work/",
      "  plan",
      "client (note)",
      "deals",
      "errand (note)",
      "plan",
      "spec.pdf",
      "standup (note)",
      "trivia",
    ]);
  });

  it("keeps every folder even when everything in it is hidden", () => {
    const onlyWork = tree(
      [
        { kind: "note", name: "work/idea" },
        { kind: "note", name: "work/errand" },
      ],
      ["work"],
    );
    const got = filterByKind(onlyWork, new Set(["note", "task"]), kinds);
    expect(draw(got)).toEqual(["work/"]);
    /* And it is not called Empty: the vault holds two files there, both switched off. */
    const line = rows(got, new Set(["work"]), 0, [], emptyFolders(onlyWork)).find(
      (r): r is Extract<Row, { type: "folder" }> => r.type === "folder",
    );
    expect(line?.empty).toBe(false);
  });

  it("keeps the open file whatever its kind", () => {
    const got = filterByKind(t, new Set(["note"]), kinds, keyOf({ kind: "note", name: "work/idea" }));
    expect(draw(got)).toContain("  idea (note)");
    /* Nothing else plain-note comes back with it: the one at the top level stays hidden. */
    expect(draw(got)).not.toContain("idea (note)");
  });

  it("hides several kinds at once, and anything at all when everything is hidden", () => {
    expect(draw(filterByKind(t, new Set(["note", "board"]), kinds))).toEqual([
      "empty/",
      "work/",
      "client (note)",
      "deals",
      "errand (note)",
      "spec.pdf",
      "standup (note)",
      "trivia",
    ]);
    expect(draw(filterByKind(t, new Set(SHOWN_KINDS), kinds))).toEqual(["empty/", "work/"]);
  });

  it("hands the same tree back when nothing is hidden", () => {
    expect(filterByKind(t, new Set(), kinds)).toBe(t);
  });
});

describe("kindCounts", () => {
  it("counts each kind on its own row", () => {
    expect(kindCounts(entries, kinds)).toEqual({
      note: 1,
      task: 1,
      project: 1,
      event: 1,
      board: 1,
      quiz: 1,
      table: 1,
      attachment: 1,
    });
  });

  it("counts an empty vault as no files at all", () => {
    expect(Object.values(kindCounts([], kinds))).toEqual(SHOWN_KINDS.map(() => 0));
  });
});

describe("parseHidden", () => {
  it("reads the kinds this version knows and drops the rest", () => {
    expect([...parseHidden('["note","task"]')]).toEqual(["note", "task"]);
    expect([...parseHidden('["note","diagram","note",3]')]).toEqual(["note"]);
  });

  it("treats a missing, empty or broken value as nothing hidden", () => {
    expect(parseHidden(null).size).toBe(0);
    expect(parseHidden("[]").size).toBe(0);
    expect(parseHidden("{").size).toBe(0);
    expect(parseHidden('"note"').size).toBe(0);
  });
});

describe("hiddenWords", () => {
  it("says what is hidden, in the heading's words", () => {
    expect(hiddenWords(new Set())).toBe("");
    expect(hiddenWords(new Set(["task"]))).toBe("tasks hidden");
    expect(hiddenWords(new Set(["board", "note"]))).toBe("notes and boards hidden");
    expect(hiddenWords(new Set(["note", "task", "board"]))).toBe("3 kinds hidden");
  });
});
