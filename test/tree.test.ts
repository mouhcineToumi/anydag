import { describe, expect, it } from "vitest";

import {
  ancestors,
  between,
  contents,
  counted,
  emptyFolders,
  flatten,
  folderOf,
  follow,
  holds,
  KIND_WORDS,
  keyOf,
  labelOf,
  leaf,
  moveTargets,
  parentOf,
  picked,
  pickedContents,
  pickedCount,
  prune,
  rebase,
  rows,
  tally,
  tokens,
  tree,
  type Entry,
  type Row,
  type Tree,
} from "@/ui/tree";
import { FILE_KINDS } from "@/board/useBoard";

const B = (...names: string[]): Entry[] => names.map((name) => ({ kind: "board", name }));
const N = (...names: string[]): Entry[] => names.map((name) => ({ kind: "note", name }));
const Q = (...names: string[]): Entry[] => names.map((name) => ({ kind: "quiz", name }));
const T = (...names: string[]): Entry[] => names.map((name) => ({ kind: "table", name }));

/** The tree as indented text, which is what a reader of the list would see — and what a diff of a failure shows. */
function draw(node: Tree, depth = 0): string[] {
  const pad = "  ".repeat(depth);
  return [
    ...node.folders.flatMap((f) => [`${pad}${f.name}/`, ...draw(f, depth + 1)]),
    ...node.files.map((e) => `${pad}${leaf(e.name)}${e.kind === "note" ? " (note)" : ""}`),
  ];
}

describe("tree", () => {
  it("nests folders rather than heading a flat list with whole paths", () => {
    const t = tree(B("projects/201-notes/svg/logo", "projects/plan", "scratch"), []);
    expect(draw(t)).toEqual(["projects/", "  201-notes/", "    svg/", "      logo", "  plan", "scratch"]);
  });

  it("puts folders before files at every level", () => {
    const t = tree(B("a-board", "z/inner", "z/y/deeper", "b-board"), []);
    expect(draw(t)).toEqual(["z/", "  y/", "    deeper", "  inner", "a-board", "b-board"]);
  });

  it("sorts numbered names as numbers", () => {
    const t = tree(B("round-10", "round-2", "round-15", "round-1"), []);
    expect(draw(t)).toEqual(["round-1", "round-2", "round-10", "round-15"]);
  });

  it("keeps a folder nobody has filled yet", () => {
    const t = tree(B("plan"), ["ideas", "ideas/later"]);
    expect(draw(t)).toEqual(["ideas/", "  later/", "plan"]);
  });

  it("makes the parents of a folder the server did not list", () => {
    const t = tree(B("a/b/c/deep"), []);
    expect(t.folders.map((f) => f.path)).toEqual(["a"]);
    expect(t.folders[0]!.folders[0]!.path).toBe("a/b");
  });

  it("lists boards and notes side by side, a board first where they share a name", () => {
    const t = tree([...N("plan", "kickoff"), ...B("plan", "arch")], []);
    expect(draw(t)).toEqual(["arch", "kickoff (note)", "plan", "plan (note)"]);
  });
});

describe("titles", () => {
  const T = (name: string, title?: string): Entry => ({ kind: "board", name, title });

  it("a row says the title, and the last part of the name only for a file nobody titled", () => {
    expect(labelOf(T("work/untitled-3", "Untitled"))).toBe("Untitled");
    expect(labelOf(T("work/untitled-3"))).toBe("untitled-3");
  });

  it("sorts by what a row says, and by name among files called the same", () => {
    const t = tree([T("a-plan", "Zebra"), T("untitled-2", "Untitled"), T("z-last", "Apple"), T("untitled", "Untitled"), T("bare")], []);
    expect(t.files.map(labelOf)).toEqual(["Apple", "bare", "Untitled", "Untitled", "Zebra"]);
    expect(t.files.map((e) => e.name)).toEqual(["z-last", "bare", "untitled", "untitled-2", "a-plan"]);
  });

  it("finds a file by its title as well as by its name", () => {
    const t = tree([T("untitled-2", "Quarterly review"), T("reference/erd", "HunterOS candidates")], []);
    expect(flatten(prune(t, tokens("quarterly"))!).map((e) => e.name)).toEqual(["untitled-2"]);
    expect(flatten(prune(t, tokens("hunter erd"))!).map((e) => e.name)).toEqual(["reference/erd"]);
  });
});

describe("prune", () => {
  const t = tree(B("gym-data-model", "reference/sequence", "reference/erd", "work/data-lake", "misc"), []);

  it("matches every token, in any order, anywhere in the path", () => {
    expect(flatten(prune(t, tokens("data gym"))!).map((e) => e.name)).toEqual(["gym-data-model"]);
    expect(flatten(prune(t, tokens("ref seq"))!).map((e) => e.name)).toEqual(["reference/sequence"]);
  });

  it("keeps everything in a folder whose own path matches", () => {
    expect(flatten(prune(t, tokens("work"))!).map((e) => e.name)).toEqual(["work/data-lake"]);
    expect(flatten(prune(t, tokens("reference"))!).map((e) => e.name)).toEqual(["reference/erd", "reference/sequence"]);
  });

  it("never drops an ancestor out from under a hit", () => {
    const deep = tree(B("a/b/c/target"), []);
    expect(draw(prune(deep, tokens("target"))!)).toEqual(["a/", "  b/", "    c/", "      target"]);
  });

  it("answers null when nothing survives", () => {
    expect(prune(t, tokens("nothing-like-this"))).toBeNull();
  });
});

describe("flatten", () => {
  it("is the drawn order, which is what Enter opens the first of", () => {
    const t = tree(B("loose", "folder/inside"), []);
    expect(flatten(t).map((e) => e.name)).toEqual(["folder/inside", "loose"]);
  });
});

describe("emptyFolders", () => {
  it("counts a subfolder as something in a folder", () => {
    const t = tree([], ["201-notes", "201-notes/svg"]);
    expect([...emptyFolders(t)]).toEqual(["201-notes/svg"]);
  });

  it("counts a note as something in a folder", () => {
    const t = tree(N("ideas/first"), ["ideas"]);
    expect(emptyFolders(t).size).toBe(0);
  });

  it("is read off the whole tree, never off what a search left", () => {
    const t = tree(B("reference/erd"), ["reference"]);
    const pruned = prune(t, tokens("nothing"));
    expect(pruned).toBeNull();
    expect(emptyFolders(t).has("reference")).toBe(false);
  });
});

describe("contents", () => {
  const t = tree([...B("work/plan", "work/deep/arch", "work-2/plan", "scratch"), ...N("work/idea")], ["work/empty"]);

  it("is everything under a folder however deep, and not the folder itself", () => {
    const c = contents(t, "work")!;
    expect(c.files.map((e) => `${e.kind}:${e.name}`).sort()).toEqual(["board:work/deep/arch", "board:work/plan", "note:work/idea"]);
    expect(c.folders.sort()).toEqual(["work/deep", "work/empty"]);
  });

  it("never reaches a sibling that merely begins the same way", () => {
    expect(contents(t, "work-2")!.files.map((e) => e.name)).toEqual(["work-2/plan"]);
    expect(contents(t, "work")!.files.some((e) => e.name.startsWith("work-2"))).toBe(false);
  });

  it("finds a folder nested below the top", () => {
    expect(contents(t, "work/deep")).toEqual({ files: [{ kind: "board", name: "work/deep/arch" }], folders: [] });
  });

  it("is null for the top level and for a folder the tree does not have", () => {
    expect(contents(t, "")).toBeNull();
    expect(contents(t, "nope")).toBeNull();
    expect(contents(t, "work/nope")).toBeNull();
  });
});

describe("names", () => {
  it("leaf, folderOf and parentOf", () => {
    expect(leaf("a/b/c")).toBe("c");
    expect(leaf("top")).toBe("top");
    expect(folderOf("a/b/c")).toBe("a/b/");
    expect(folderOf("top")).toBe("");
    expect(parentOf("a/b/c")).toBe("a/b");
    expect(parentOf("top")).toBe("");
  });

  it("keyOf tells a board from a note of the same name", () => {
    expect(keyOf({ kind: "board", name: "plan" })).not.toBe(keyOf({ kind: "note", name: "plan" }));
  });

  it("ancestors are the folders only, outermost first", () => {
    expect(ancestors("a/b/c")).toEqual(["a", "a/b"]);
    expect(ancestors("top")).toEqual([]);
  });

  it("rebase follows a folder and nothing that merely begins the same way", () => {
    expect(rebase("clients/acme", "clients", "archive/clients")).toBe("archive/clients/acme");
    expect(rebase("clients", "clients", "archive/clients")).toBe("archive/clients");
    expect(rebase("clients-2/acme", "clients", "archive/clients")).toBe("clients-2/acme");
    expect(rebase("other", "clients", "x")).toBe("other");
  });
});

describe("rows", () => {
  const t = tree(B("clients/acme/arch", "clients/kickoff", "scratch"), ["clients/archive"]);
  const line = (r: Row) => `${"  ".repeat(r.depth)}${r.type === "folder" ? `${r.name}/${r.open ? "" : " (shut)"}` : leaf(r.entry.name)}`;

  it("leaves a shut folder's contents out", () => {
    expect(rows(t, new Set()).map(line)).toEqual(["clients/ (shut)", "scratch"]);
  });

  it("draws an open folder's contents one level in, folders first", () => {
    expect(rows(t, new Set(["clients"])).map(line)).toEqual([
      "clients/",
      "  acme/ (shut)",
      "  archive/ (shut)",
      "  kickoff",
      "scratch",
    ]);
  });

  it("says where each line sits among its siblings, for aria-setsize and aria-posinset", () => {
    const got = rows(t, new Set(["clients"]));
    expect(got.map((r) => [r.pos, r.size])).toEqual([
      [1, 2],
      [1, 3],
      [2, 3],
      [3, 3],
      [2, 2],
    ]);
  });

  it("knows which folders have nothing in them", () => {
    const got = rows(t, new Set(["clients"])).filter((r): r is Extract<Row, { type: "folder" }> => r.type === "folder");
    expect(got.map((r) => [r.path, r.empty])).toEqual([
      ["clients", false],
      ["clients/acme", false],
      ["clients/archive", true],
    ]);
  });

  it("keeps a folder open under a shut parent from showing", () => {
    expect(rows(t, new Set(["clients/acme"])).map(line)).toEqual(["clients/ (shut)", "scratch"]);
  });
});

describe("follow", () => {
  const favs = ["board:clients/acme/arch", "note:clients/kickoff", "board:clients-2/other", "board:scratch"];

  it("follows a file renamed or moved, and only that kind", () => {
    expect(follow(favs, { kind: "file", file: "board", from: "scratch", to: "archive/scratch" })).toEqual([
      "board:clients/acme/arch",
      "note:clients/kickoff",
      "board:clients-2/other",
      "board:archive/scratch",
    ]);
    expect(follow(favs, { kind: "file", file: "board", from: "clients/kickoff", to: "x" })).toEqual(favs);
  });

  it("drops a file deleted", () => {
    expect(follow(favs, { kind: "file", file: "note", from: "clients/kickoff", to: null })).not.toContain("note:clients/kickoff");
  });

  it("carries everything inside a folder moved, and nothing that merely begins the same way", () => {
    expect(follow(favs, { kind: "folder", from: "clients", to: "archive/clients" })).toEqual([
      "board:archive/clients/acme/arch",
      "note:archive/clients/kickoff",
      "board:clients-2/other",
      "board:scratch",
    ]);
  });

  it("never lists one file twice", () => {
    expect(follow(["board:a", "board:b"], { kind: "file", file: "board", from: "a", to: "b" })).toEqual(["board:b"]);
  });
});

describe("a third kind", () => {
  it("files a quiz in its folder beside the boards and notes, and draws it as itself", () => {
    const t = tree([...B("work/plan"), ...N("work/idea"), ...Q("work/postgres", "trivia")], []);
    expect(flatten(t).map(keyOf)).toEqual(["note:work/idea", "board:work/plan", "quiz:work/postgres", "quiz:trivia"]);
    expect(rows(t, new Set(["work"])).map((r) => (r.type === "folder" ? `${r.path}/` : keyOf(r.entry)))).toEqual([
      "work/",
      "note:work/idea",
      "board:work/plan",
      "quiz:work/postgres",
      "quiz:trivia",
    ]);
  });

  it("follows a favourite quiz through a rename, and never mistakes it for a board of the same name", () => {
    const favs = ["quiz:work/postgres", "board:work/postgres-notes"];
    expect(follow(favs, { kind: "file", file: "quiz", from: "work/postgres", to: "work/pg" })).toEqual(["quiz:work/pg", "board:work/postgres-notes"]);
    expect(follow(favs, { kind: "file", file: "board", from: "work/postgres", to: "x" })).toEqual(favs);
    expect(follow(favs, { kind: "folder", from: "work", to: "archive" })).toEqual(["quiz:archive/postgres", "board:archive/postgres-notes"]);
  });
});

describe("what a folder holds", () => {
  it("counts every kind on its own, and calls a quiz a quiz", () => {
    expect(tally([...B("a", "b"), ...N("c"), ...Q("d", "e", "f"), ...T("g")])).toEqual({ board: 2, note: 1, quiz: 3, table: 1, file: 0 });
    expect(tally([])).toEqual({ board: 0, note: 0, quiz: 0, table: 0, file: 0 });
    /* And an attachment, counted apart from the kinds that have a text. */
    expect(tally([...B("a"), { kind: "file" as const, name: "q3.pdf" }])).toEqual({ board: 1, note: 0, quiz: 0, table: 0, file: 1 });
    expect(holds(contents(tree([{ kind: "file" as const, name: "x/q3.pdf" }, { kind: "file" as const, name: "x/deck.pptx" }], []), "x")!)).toEqual([
      "2 files",
    ]);
  });

  it("says each kind it holds, boards first, then the folders, and nothing it holds none of", () => {
    const t = tree([...B("x/a", "x/b"), ...N("x/c"), ...Q("x/sub/d"), ...T("x/e", "x/f")], ["x/empty"]);
    expect(holds(contents(t, "x")!)).toEqual(["2 boards", "1 note", "1 quiz", "2 tables", "2 folders"]);
    expect(holds(contents(tree(Q("y/a", "y/b"), []), "y")!)).toEqual(["2 quizzes"]);
    expect(holds({ files: [], folders: [] })).toEqual([]);
  });

  it("has a word for every kind there is", () => {
    expect(Object.keys(KIND_WORDS).sort()).toEqual([...FILE_KINDS].sort());
    expect(counted(1, KIND_WORDS.quiz)).toBe("1 quiz");
    expect(counted(0, KIND_WORDS.quiz)).toBe("0 quizzes");
  });
});

describe("a selection", () => {
  const entries: Entry[] = [
    { kind: "board", name: "plan" },
    { kind: "note", name: "work/brief" },
    { kind: "board", name: "work/deep/map" },
    { kind: "quiz", name: "work-2/check" },
  ];
  const root = tree(entries, ["work", "work/deep", "work-2", "empty"]);

  it("drops what is inside a folder that is picked too, and keys that name nothing", () => {
    const p = picked(["board:plan", "note:work/brief", "folder:work", "folder:work/deep", "quiz:work-2/check", "board:gone"], entries);
    expect(p.folders).toEqual(["work"]);
    expect(p.files.map(keyOf)).toEqual(["board:plan", "quiz:work-2/check"]);
    expect(pickedCount(p)).toBe(3);
  });

  it("offers every folder but the picked ones and what is under them, the top level first", () => {
    expect(moveTargets(["work", "work/deep", "work-2", "empty"], picked(["folder:work", "board:plan"], entries))).toEqual(["", "empty", "work-2"]);
    expect(moveTargets(["b", "a"], picked(["board:plan"], entries))).toEqual(["", "a", "b"]);
  });

  it("counts everything a delete takes, a folder's contents included", () => {
    const all = pickedContents(root, picked(["folder:work", "board:plan", "folder:empty"], entries));
    expect(all.files.map(keyOf).sort()).toEqual(["board:plan", "board:work/deep/map", "note:work/brief"]);
    expect(all.folders.sort()).toEqual(["empty", "work", "work/deep"]);
    expect(holds(all)).toEqual(["2 boards", "1 note", "3 folders"]);
  });

  it("selects the rows between two, either way round", () => {
    const order = ["a", "b", "c", "d"];
    expect(between(order, "b", "d")).toEqual(["b", "c", "d"]);
    expect(between(order, "d", "b")).toEqual(["b", "c", "d"]);
    expect(between(order, null, "c")).toEqual(["c"]);
    expect(between(order, "gone", "c")).toEqual(["c"]);
    expect(between(order, "a", "gone")).toEqual([]);
  });
});
