/** The vault store's contract, one case per rule, against `server/vault.ts`. */
import "./sqlite-shim";
import fs from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { frontId, validId, validInstant } from "../../server/ids";
import { byKind, Conflict, NotFound, Refused, sha1, version } from "../../server/vault";
import { BOARD, NOTE, PDF, QUIZ, TABLE, has, makeEnv, readText, sweepTemps, write, type Env } from "./helpers";

let env: Env;
beforeEach(() => {
  env = makeEnv();
});
afterEach(async () => {
  await env.cleanup();
  sweepTemps();
});

/** A created text carries its id in the frontmatter, so it is the original plus one line. */
const withoutId = (text: string): string => text.replace(/^id: .*\n/m, "");

describe("read and write", () => {
  it("a document that is not there reads as null", async () => {
    expect(await env.vault.read("nope")).toBeNull();
  });

  it("create then read round-trips with a version", async () => {
    const name = await env.vault.create("plan", "board", BOARD);
    const got = (await env.vault.read(name))!;
    expect(got).toEqual(version(got.text));
    expect(withoutId(got.text)).toBe(BOARD);
    expect(frontId(got.text)).toMatch(/^[0-9a-z]{10}$/);
    expect(got.base).toBe(sha1(got.text));
  });

  it("a write against the current version lands", async () => {
    const name = await env.vault.create("plan", "board", BOARD);
    const cur = (await env.vault.read(name))!;
    const after = await env.vault.write(name, "board", cur.text + "\nmore\n", cur.base);
    expect(after.text.endsWith("more\n")).toBe(true);
    expect((await env.vault.read(name))!.base).toBe(after.base);
  });

  it("a write against a version that moved is refused with the current one", async () => {
    const name = await env.vault.create("plan", "board", BOARD);
    const first = (await env.vault.read(name))!;
    await env.vault.write(name, "board", "changed by somebody else\n", null);
    const err = await env.vault.write(name, "board", "mine\n", first.base).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Conflict);
    expect((err as Conflict).text).toBe("changed by somebody else\n");
    expect((err as Conflict).base).toBe(sha1("changed by somebody else\n"));
    expect(readText(env.root, "plan.board.md")).toBe("changed by somebody else\n");
  });

  it("a base of null or undefined overwrites, which is what an asset append needs", async () => {
    const name = await env.vault.create("plan", "board", BOARD);
    await env.vault.write(name, "board", "whatever\n", null);
    expect((await env.vault.read(name))!.text).toBe("whatever\n");
    await env.vault.write(name, "board", "again\n");
    expect((await env.vault.read(name))!.text).toBe("again\n");
  });

  it("writing a document that is not there is not found", async () => {
    await expect(env.vault.write("nope", "board", "x", null)).rejects.toBeInstanceOf(NotFound);
  });

  it("an unchanged write succeeds and reports the same version", async () => {
    const name = await env.vault.create("plan", "board", BOARD);
    const cur = (await env.vault.read(name))!;
    expect(await env.vault.write(name, "board", cur.text, cur.base)).toEqual(cur);
  });

  it("refuses a name that leaves the vault", async () => {
    expect(() => env.vault.abs("../outside")).toThrow(Refused);
    expect(env.vault.abs("")).toBe(env.vault.root);
    await expect(env.vault.read("../outside")).rejects.toBeInstanceOf(Refused);
    await expect(env.vault.create("../../etc/passwd", "board", BOARD)).resolves.toBe("etc/passwd");
  });

  it("a newly written text is born on disk at the kind's suffix", async () => {
    await env.vault.create("a", "board", BOARD);
    await env.vault.create("b", "note", NOTE);
    await env.vault.create("c", "quiz", QUIZ);
    await env.vault.create("d", "table", TABLE);
    expect(["a.board.md", "b.md", "c.quiz.md", "d.table.md"].every((f) => has(env.root, f))).toBe(true);
    expect(has(env.root, "b.note.md")).toBe(false);
  });
});

describe("names", () => {
  it("the vault numbers a taken name Obsidian-style and says which it used", async () => {
    expect(await env.vault.create("plan", "board", BOARD)).toBe("plan");
    expect(await env.vault.create("plan", "board", BOARD)).toBe("plan 2");
    expect(await env.vault.create("plan", "board", BOARD)).toBe("plan 3");
  });

  it("a name is the person's: spaces and capitals are kept", async () => {
    expect(await env.vault.create("Meeting notes.md", "note", NOTE)).toBe("Meeting notes");
    expect(has(env.root, "Meeting notes.md")).toBe(true);
    expect(await env.vault.create("Q3: Plan?", "board", BOARD)).toBe("Q3 Plan");
  });

  it("uniqueness ignores case", async () => {
    expect(await env.vault.create("Plan", "board", BOARD)).toBe("Plan");
    expect(await env.vault.create("plan", "board", BOARD)).toBe("plan 2");
    expect(await env.vault.create("PLAN", "note", NOTE)).toBe("PLAN 3");
  });

  it("a folder is part of the name", async () => {
    expect(await env.vault.create("reference/erd", "board", BOARD)).toBe("reference/erd");
    expect((await env.vault.tree()).boards).toEqual(["reference/erd"]);
  });

  it("one name across every text kind", async () => {
    expect(await env.vault.create("plan", "board", BOARD)).toBe("plan");
    expect(await env.vault.create("plan", "note", NOTE)).toBe("plan 2");
    expect(await env.vault.create("plan", "quiz", QUIZ)).toBe("plan 3");
    expect(await env.vault.create("plan", "table", TABLE)).toBe("plan 4");
    expect(await env.vault.read("plan", "quiz")).toBeNull();
    expect(await env.vault.read("plan", "table")).toBeNull();
    expect(await env.vault.read("plan", "note")).toBeNull();
  });

  it("a note beside a board of one stem is two files, and `.md` wins over `.note.md`", async () => {
    write(env.root, "both.md", "# new\n");
    write(env.root, "both.note.md", "# old\n");
    const tree = await env.vault.tree();
    expect(tree.notes).toEqual(["both"]);
    expect((await env.vault.read("both", "note"))!.text).toBe("# new\n");
  });

  it("a note stored only as `.note.md` stays there when written", async () => {
    write(env.root, "old.note.md", "# old\n");
    await env.vault.write("old", "note", "# new\n", null);
    expect(has(env.root, "old.md")).toBe(false);
    expect(readText(env.root, "old.note.md")).toBe("# new\n");
  });
});

describe("rename", () => {
  it("renaming into a folder is all a move is", async () => {
    await env.vault.create("plan", "board", BOARD);
    expect(await env.vault.rename("plan", "board", "work/plan")).toBe("work/plan");
    expect(await env.vault.read("plan")).toBeNull();
    expect(withoutId((await env.vault.read("work/plan"))!.text)).toBe(BOARD);
  });

  it("renaming to the name it already has is not a move to `plan 2`", async () => {
    await env.vault.create("plan", "board", BOARD);
    expect(await env.vault.rename("plan", "board", "plan")).toBe("plan");
    expect(await env.vault.read("plan")).not.toBeNull();
  });

  it("a duplicate gets its own name and leaves the original", async () => {
    await env.vault.create("plan", "board", BOARD);
    expect(await env.vault.rename("plan", "board", "plan", { copy: true })).toBe("plan 2");
    expect(await env.vault.read("plan")).not.toBeNull();
    expect(withoutId((await env.vault.read("plan 2"))!.text)).toBe(BOARD);
  });

  it("a rename to a different case is a rename, not a numbered copy", async () => {
    await env.vault.create("plan", "board", BOARD);
    expect(await env.vault.rename("plan", "board", "Plan")).toBe("Plan");
    expect((await env.vault.tree()).boards).toEqual(["Plan"]);
    expect(fs.readdirSync(env.root).filter((f) => f.toLowerCase().startsWith("plan"))).toEqual(["Plan.board.md"]);
  });

  it("a rename onto another document's name is numbered", async () => {
    await env.vault.create("a", "board", BOARD);
    await env.vault.create("b", "board", BOARD);
    expect(await env.vault.rename("a", "board", "B")).toBe("B 2");
  });

  it("renaming something that is not there", async () => {
    await expect(env.vault.rename("nope", "board", "other")).rejects.toBeInstanceOf(NotFound);
  });

  it("an edit rides on the rename: the new name holds the edited text and keeps the id", async () => {
    await env.vault.create("untitled", "board", BOARD);
    const ident = await env.vault.ident("untitled");
    const moved = await env.vault.rename("untitled", "board", "Q3 plan", {
      edit: (t) => t.replace("title: t", "title: Q3 plan"),
    });
    expect(moved).toBe("Q3 plan");
    expect((await env.vault.read("Q3 plan"))!.text).toContain("title: Q3 plan");
    expect(await env.vault.read("untitled")).toBeNull();
    expect(await env.vault.ident("Q3 plan")).toBe(ident);
    expect((await env.vault.tree()).titles).toEqual({ "Q3 plan": "Q3 plan" });
  });

  it("an edit with no change of name still writes", async () => {
    await env.vault.create("plan", "board", BOARD);
    await env.vault.rename("plan", "board", "plan", { edit: (t) => t.replace("title: t", "title: Changed") });
    expect((await env.vault.tree()).titles.plan).toBe("Changed");
  });
});

describe("delete", () => {
  it("a deleted document takes its legacy pictures", async () => {
    await env.vault.create("plan", "board", BOARD);
    write(env.root, "plan.assets/paste-ab12.png", "x");
    await env.vault.delete("plan");
    expect(await env.vault.read("plan")).toBeNull();
    expect(await env.vault.getAsset("plan.assets/paste-ab12.png")).toBeNull();
  });

  it("deleting something that is not there", async () => {
    await expect(env.vault.delete("nope")).rejects.toBeInstanceOf(NotFound);
  });
});

describe("folders", () => {
  it("an empty folder exists, which is the whole point", async () => {
    expect(await env.vault.mkdir("empty")).toBe("empty");
    const tree = await env.vault.tree();
    expect(tree.folders).toEqual(["empty"]);
    expect(tree.boards).toEqual([]);
  });

  it("the directories that are not folders are refused", async () => {
    for (const name of ["plan.assets", ".obsidian", ".anydag", "node_modules", ""])
      await expect(env.vault.mkdir(name), name).rejects.toBeInstanceOf(Refused);
  });

  it("a folder with something in it is not removed", async () => {
    await env.vault.mkdir("work");
    await env.vault.create("work/plan", "board", BOARD);
    await expect(env.vault.rmdir("work")).rejects.toBeInstanceOf(Refused);
    expect(await env.vault.read("work/plan")).not.toBeNull();
  });

  it("an empty one is removed", async () => {
    await env.vault.mkdir("work");
    expect(await env.vault.rmdir("work")).toMatchObject({ folders: ["work"], boards: [] });
    expect((await env.vault.tree()).folders).toEqual([]);
  });

  it("the top level is not a folder", async () => {
    await expect(env.vault.rmdir("")).rejects.toBeInstanceOf(Refused);
    await expect(env.vault.rmdir("", true)).rejects.toBeInstanceOf(Refused);
  });

  it("a folder holding only a note is not empty", async () => {
    await env.vault.create("work/n", "note", NOTE);
    await expect(env.vault.rmdir("work")).rejects.toBeInstanceOf(Refused);
  });

  it("recursive takes the folder and everything under it", async () => {
    await env.vault.create("work/plan", "board", BOARD);
    await env.vault.create("work/deep/arch", "board", BOARD);
    await env.vault.create("work/idea", "note", NOTE);
    await env.vault.mkdir("work/empty");
    write(env.root, "work/plan.assets/shot.png", "png");
    const gone = await env.vault.rmdir("work", true);
    expect(gone.boards).toEqual(["work/deep/arch", "work/plan"]);
    expect(gone.notes).toEqual(["work/idea"]);
    expect(gone.folders).toEqual(["work", "work/deep", "work/empty"]);
    const tree = await env.vault.tree();
    expect([tree.boards, tree.notes, tree.folders]).toEqual([[], [], []]);
    expect(has(env.root, "work")).toBe(false);
  });

  it("recursive leaves a sibling that merely begins the same way", async () => {
    await env.vault.create("work/plan", "board", BOARD);
    await env.vault.create("work-2/plan", "board", BOARD);
    write(env.root, "work-2/plan.assets/shot.png", "png");
    await env.vault.rmdir("work", true);
    expect((await env.vault.tree()).boards).toEqual(["work-2/plan"]);
    expect((await env.vault.getAsset("work-2/plan.assets/shot.png"))!.toString()).toBe("png");
  });

  it("recursive leaves the folder above where it was", async () => {
    await env.vault.create("clients/acme/plan", "board", BOARD);
    await env.vault.rmdir("clients/acme", true);
    const tree = await env.vault.tree();
    expect(tree.folders).toEqual(["clients"]);
    expect(tree.boards).toEqual([]);
  });

  it("recursive takes the ids with it", async () => {
    await env.vault.create("work/plan", "board", BOARD);
    const ident = (await env.vault.ident("work/plan"))!;
    await env.vault.rmdir("work", true);
    expect(await env.vault.resolve(ident)).toBeNull();
    await env.vault.create("work/plan", "board", BOARD);
    expect(await env.vault.ident("work/plan")).not.toBe(ident);
  });

  it("recursive on a folder that is not there", async () => {
    await expect(env.vault.rmdir("nope", true)).rejects.toBeInstanceOf(NotFound);
    await expect(env.vault.rmdir("nope")).rejects.toBeInstanceOf(NotFound);
  });

  it("an empty folder reports itself", async () => {
    await env.vault.mkdir("work");
    const gone = await env.vault.rmdir("work", true);
    expect([gone.boards, gone.notes, gone.folders]).toEqual([[], [], ["work"]]);
  });

  it("a folder moves with everything under it", async () => {
    await env.vault.create("work/plan", "board", BOARD);
    await env.vault.create("work/deep/arch", "board", BOARD);
    await env.vault.create("work/idea", "note", NOTE);
    await env.vault.mkdir("work/empty");
    write(env.root, "work/plan.assets/shot.png", "png");
    const before = (await env.vault.read("work/plan"))!;
    expect(await env.vault.moveFolder("work", "archive/work 2025")).toBe("archive/work 2025");
    const tree = await env.vault.tree();
    expect(tree.boards).toEqual(["archive/work 2025/deep/arch", "archive/work 2025/plan"]);
    expect(tree.notes).toEqual(["archive/work 2025/idea"]);
    expect(tree.folders).toContain("archive/work 2025/empty");
    expect(tree.folders.some((f) => f === "work" || f.startsWith("work/"))).toBe(false);
    expect(await env.vault.read("archive/work 2025/plan")).toEqual(before);
    expect((await env.vault.getAsset("archive/work 2025/plan.assets/shot.png"))!.toString()).toBe("png");
    expect(await env.vault.getAsset("work/plan.assets/shot.png")).toBeNull();
  });

  it("a sibling that merely begins the same way stays put", async () => {
    await env.vault.create("work/plan", "board", BOARD);
    await env.vault.create("work-2/plan", "board", BOARD);
    await env.vault.moveFolder("work", "done");
    expect(await env.vault.read("work-2/plan")).not.toBeNull();
  });

  it("an empty folder moves too", async () => {
    await env.vault.mkdir("later");
    await env.vault.moveFolder("later", "someday");
    expect((await env.vault.tree()).folders).toEqual(["someday"]);
  });

  it("the folder above the source stays where it was", async () => {
    await env.vault.create("clients/acme/plan", "board", BOARD);
    await env.vault.moveFolder("clients/acme", "acme");
    const tree = await env.vault.tree();
    expect(tree.folders).toContain("clients");
    expect(tree.boards).toEqual(["acme/plan"]);
  });

  it("moving a folder to where it is does nothing", async () => {
    await env.vault.create("work/plan", "board", BOARD);
    expect(await env.vault.moveFolder("work", "work")).toBe("work");
    expect((await env.vault.tree()).boards).toEqual(["work/plan"]);
  });

  it("a destination that exists is refused, not numbered", async () => {
    await env.vault.create("work/plan", "board", BOARD);
    await env.vault.mkdir("done");
    await env.vault.create("old/thing", "board", BOARD);
    for (const taken of ["done", "old"]) await expect(env.vault.moveFolder("work", taken), taken).rejects.toBeInstanceOf(Refused);
    expect((await env.vault.tree()).boards).toEqual(["old/thing", "work/plan"]);
  });

  it("a destination that differs from an existing folder only by case is refused", async () => {
    await env.vault.create("work/plan", "board", BOARD);
    await env.vault.mkdir("done");
    await expect(env.vault.moveFolder("work", "DONE")).rejects.toBeInstanceOf(Refused);
  });

  it("a folder cannot go inside itself, but `ab` is a sibling of `a`", async () => {
    await env.vault.create("a/plan", "board", BOARD);
    await expect(env.vault.moveFolder("a", "a/b")).rejects.toBeInstanceOf(Refused);
    expect(await env.vault.moveFolder("a", "ab")).toBe("ab");
  });

  it("the ends that are not folders are refused", async () => {
    await env.vault.create("work/plan", "board", BOARD);
    for (const [src, dst] of [
      ["", "x"],
      ["work", ""],
      ["work", ".anydag"],
      ["work", "plan.assets"],
    ] as const)
      await expect(env.vault.moveFolder(src, dst), `${src}->${dst}`).rejects.toBeInstanceOf(Refused);
  });

  it("a folder that is not there", async () => {
    await expect(env.vault.moveFolder("nope", "still-nope")).rejects.toBeInstanceOf(NotFound);
  });

  it("a case-only folder rename is a rename", async () => {
    await env.vault.create("work/plan", "board", BOARD);
    expect(await env.vault.moveFolder("work", "Work")).toBe("Work");
    expect((await env.vault.tree()).boards).toEqual(["Work/plan"]);
  });

  it("the tree skips pictures, dot-folders, node_modules and saved components", async () => {
    await env.vault.create("plan", "board", BOARD);
    write(env.root, "plan.assets/shot.png", "x");
    write(env.root, ".obsidian/app.json", "{}");
    write(env.root, ".git/HEAD", "ref");
    write(env.root, "node_modules/x/readme.md", "# no\n");
    await env.vault.create("components/card", "board", BOARD);
    const tree = await env.vault.tree();
    expect(tree.boards).toEqual(["plan"]);
    expect(tree.notes).toEqual([]);
    expect(tree.folders).toEqual([]);
  });
});

describe("legacy pictures (`<name>.assets/`)", () => {
  it("are read, listed per document and dropped without removing the directory", async () => {
    await env.vault.create("a", "board", BOARD);
    await env.vault.create("b", "board", BOARD);
    write(env.root, "a.assets/one.png", "x");
    write(env.root, "b.assets/two.png", "yy");
    expect((await env.vault.getAsset("a.assets/one.png"))!.toString()).toBe("x");
    const files = await env.vault.assetFiles("a");
    expect(files).toEqual([{ path: "a.assets/one.png", bytes: 1 }]);
    await env.vault.dropAssets(["a.assets/one.png"]);
    expect(await env.vault.getAsset("a.assets/one.png")).toBeNull();
    expect(await env.vault.assetFiles("a")).toEqual([]);
    expect(has(env.root, "a.assets")).toBe(true);
  });

  it("cannot reach a path that is not a picture folder or that escapes the vault", async () => {
    await expect(env.vault.getAsset("../../etc/passwd")).rejects.toBeInstanceOf(Refused);
    await expect(env.vault.getAsset("plan.board.md")).rejects.toBeInstanceOf(Refused);
    await expect(env.vault.getAsset("../x.assets/y.png")).rejects.toBeInstanceOf(Refused);
  });

  it("travel with the document when it moves and stay with a copy", async () => {
    const name = await env.vault.create("n", "note", NOTE);
    write(env.root, "n.assets/paste-1.png", "png");
    const moved = await env.vault.rename(name, "note", "work/n");
    expect((await env.vault.getAsset("work/n.assets/paste-1.png"))!.toString()).toBe("png");
    expect(await env.vault.getAsset("n.assets/paste-1.png")).toBeNull();
    const copied = await env.vault.rename(moved, "note", "copy", { copy: true });
    expect(withoutId((await env.vault.read(copied, "note"))!.text)).toBe(withoutId((await env.vault.read(moved, "note"))!.text));
    await env.vault.delete(moved, "note");
    expect(await env.vault.getAsset("work/n.assets/paste-1.png")).toBeNull();
    expect((await env.vault.getAsset("copy.assets/paste-1.png"))!.toString()).toBe("png");
  });
});

describe("texts and components", () => {
  it("texts keys a board by its name and any other kind `<name>.<kind>.md`, and includes components", async () => {
    await env.vault.create("plan", "board", BOARD);
    await env.vault.create("n", "note", NOTE + "![](plan.assets/paste-1.png)\n");
    await env.vault.create("drill", "quiz", QUIZ);
    await env.vault.create("deals", "table", TABLE);
    await env.vault.create("components/card", "board", "a component\n");
    const texts = await env.vault.texts();
    expect(Object.keys(texts).sort()).toEqual(["components/card", "deals.table.md", "drill.quiz.md", "n.note.md", "plan"]);
    expect(texts["n.note.md"]).toContain("paste-1.png");
  });

  it("components are stored in `.anydag/components`, are not listed, and are the components slice of texts", async () => {
    await env.vault.create("components/card", "board", "a component\n");
    await env.vault.create("components/ui/button", "board", "another\n");
    await env.vault.create("plan", "board", BOARD);
    expect(has(env.root, ".anydag/components/card.board.md")).toBe(true);
    expect((await env.vault.tree()).boards).toEqual(["plan"]);
    const got = await env.vault.components();
    expect(got).toEqual({ "components/card": "a component\n", "components/ui/button": "another\n" });
    const texts = await env.vault.texts();
    expect(Object.fromEntries(Object.entries(texts).filter(([k]) => k.startsWith("components/")))).toEqual(got);
    expect(await env.vault.read("components/card")).toEqual(version("a component\n"));
  });

  it("a component is numbered when its name is taken, and a write to it works", async () => {
    expect(await env.vault.create("components/card", "board", "one\n")).toBe("components/card");
    expect(await env.vault.create("components/card", "board", "two\n")).toBe("components/card 2");
    await env.vault.write("components/card", "board", "three\n", null);
    expect((await env.vault.components())["components/card"]).toBe("three\n");
    await env.vault.delete("components/card", "board");
    expect(Object.keys(await env.vault.components())).toEqual(["components/card 2"]);
  });

  it("texts honours a tree the caller already listed", async () => {
    await env.vault.create("plan", "board", BOARD);
    await env.vault.create("n", "note", NOTE);
    const tree = await env.vault.tree();
    expect(await env.vault.texts(tree)).toEqual(await env.vault.texts());
  });

  it("texts skips a file that went between the listing and the read", async () => {
    await env.vault.create("plan", "board", BOARD);
    const tree = await env.vault.tree();
    tree.boards.unshift("ghost");
    expect(Object.keys(await env.vault.texts(tree))).toEqual(["plan"]);
    expect(await env.vault.read("ghost")).toBeNull();
  });
});

describe("kinds", () => {
  it("a note round-trips and is listed apart from the boards", async () => {
    const name = await env.vault.create("work/onboarding", "note", NOTE);
    expect(name).toBe("work/onboarding");
    expect(withoutId((await env.vault.read(name, "note"))!.text)).toBe(NOTE);
    const tree = await env.vault.tree();
    expect([tree.notes, tree.boards, tree.folders]).toEqual([["work/onboarding"], [], ["work"]]);
  });

  it("asking for the wrong kind finds nothing", async () => {
    await env.vault.create("plan", "board", BOARD);
    await env.vault.create("notes", "note", NOTE);
    expect(await env.vault.read("plan", "note")).toBeNull();
    expect(await env.vault.read("notes")).toBeNull();
    await expect(env.vault.write("notes", "board", "x", null)).rejects.toBeInstanceOf(NotFound);
    await expect(env.vault.delete("plan", "note")).rejects.toBeInstanceOf(NotFound);
  });

  it("a note writes under the same version rule", async () => {
    const name = await env.vault.create("n", "note", NOTE);
    const cur = (await env.vault.read(name, "note"))!;
    const after = await env.vault.write(name, "note", cur.text + "More.\n", cur.base);
    const err = await env.vault.write(name, "note", "mine\n", cur.base).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Conflict);
    expect((err as Conflict).text).toBe(after.text);
  });

  it("a quiz is listed with its questions and its title", async () => {
    await env.vault.create("plan", "board", BOARD);
    const name = await env.vault.create("study/drill", "quiz", QUIZ);
    const tree = await env.vault.tree();
    expect(tree.quizzes).toEqual(["study/drill"]);
    expect(tree.questions).toEqual({ "study/drill": ["q1", null] });
    expect(tree.titles[name]).toBe("Drill");
    expect(tree.ids[name]).toBeTruthy();
    await env.vault.write(name, "quiz", QUIZ + "\n## Three {#q3}\n- [x] a\n- [ ] b\n", null);
    expect((await env.vault.tree()).questions).toEqual({ "study/drill": ["q1", null, "q3"] });
  });

  it("a table is listed apart, with its title, and byKind picks the list", async () => {
    await env.vault.create("plan", "board", BOARD);
    const name = await env.vault.create("sales/deals", "table", TABLE);
    const tree = await env.vault.tree();
    expect(tree.tables).toEqual(["sales/deals"]);
    expect(tree.titles[name]).toBe("Deals");
    expect(byKind(tree).table).toEqual(["sales/deals"]);
    expect(byKind(tree).board).toEqual(["plan"]);
  });

  it("a rename keeps a table's id and a recursive rmdir says it went", async () => {
    const name = await env.vault.create("work/deals", "table", TABLE);
    const ident = await env.vault.ident(name, "table");
    const moved = await env.vault.rename(name, "table", "work/pipeline");
    expect(await env.vault.ident(moved, "table")).toBe(ident);
    expect(await env.vault.resolve(ident!)).toEqual({ name: "work/pipeline", kind: "table" });
    const gone = await env.vault.rmdir("work", true);
    expect(gone.tables).toEqual(["work/pipeline"]);
    expect((await env.vault.tree()).tables).toEqual([]);
  });

  it("a recursive rmdir says which quizzes went", async () => {
    await env.vault.create("work/drill", "quiz", QUIZ);
    expect((await env.vault.rmdir("work", true)).quizzes).toEqual(["work/drill"]);
  });
});

describe("ids", () => {
  it("a created document has an id that resolves to it", async () => {
    const name = await env.vault.create("plan", "board", BOARD);
    const ident = (await env.vault.ident(name))!;
    expect(validId(ident)).toBe(true);
    expect(await env.vault.resolve(ident)).toEqual({ name, kind: "board" });
    expect(frontId(readText(env.root, "plan.board.md"))).toBe(ident);
  });

  it("every listed document carries its id", async () => {
    await env.vault.create("plan", "board", BOARD);
    await env.vault.create("work/n", "note", NOTE);
    const tree = await env.vault.tree();
    expect(Object.keys(tree.ids).sort()).toEqual(["plan", "work/n"]);
    expect(tree.ids.plan).toBe(await env.vault.ident("plan"));
    expect(tree.ids["work/n"]).toBe(await env.vault.ident("work/n", "note"));
  });

  it("the id survives a rename, a move and an edit", async () => {
    const name = await env.vault.create("plan", "board", BOARD);
    const ident = await env.vault.ident(name);
    await env.vault.write(name, "board", (await env.vault.read(name))!.text + "more\n", null);
    const moved = await env.vault.rename(name, "board", "work/renamed");
    expect(await env.vault.ident(moved)).toBe(ident);
    expect(await env.vault.resolve(ident!)).toEqual({ name: moved, kind: "board" });
  });

  it("every id survives its folder moving", async () => {
    const board = await env.vault.create("work/deep/plan", "board", BOARD);
    const note = await env.vault.create("work/n", "note", NOTE);
    const ids = [await env.vault.ident(board), await env.vault.ident(note, "note")];
    await env.vault.moveFolder("work", "archive/work");
    expect(await env.vault.resolve(ids[0]!)).toEqual({ name: "archive/work/deep/plan", kind: "board" });
    expect(await env.vault.resolve(ids[1]!)).toEqual({ name: "archive/work/n", kind: "note" });
  });

  it("a copy is a new document", async () => {
    const name = await env.vault.create("plan", "board", BOARD);
    const ident = await env.vault.ident(name);
    const copy = await env.vault.rename(name, "board", "plan", { copy: true });
    const copyId = await env.vault.ident(copy);
    expect(validId(copyId)).toBe(true);
    expect(copyId).not.toBe(ident);
    expect(await env.vault.resolve(ident!)).toEqual({ name, kind: "board" });
  });

  it("a deleted document resolves to nothing", async () => {
    const name = await env.vault.create("plan", "board", BOARD);
    const ident = await env.vault.ident(name);
    await env.vault.delete(name);
    expect(await env.vault.resolve(ident!)).toBeNull();
    expect(await env.vault.ident(name)).toBeNull();
  });

  it("a free id is adopted and a taken one is not", async () => {
    const first = await env.vault.create("a", "board", BOARD, { id: "0123456789" });
    expect(await env.vault.ident(first)).toBe("0123456789");
    const second = await env.vault.create("b", "board", BOARD, { id: "0123456789" });
    expect(await env.vault.ident(second)).not.toBe("0123456789");
    const third = await env.vault.create("c", "board", BOARD, { id: "not an id" });
    expect(validId(await env.vault.ident(third))).toBe(true);
  });

  it("an id already in the text is adopted when free (an export imported again)", async () => {
    const name = await env.vault.create("a", "board", "---\nid: abcdefghjk\ntitle: t\n---\n\nx\n");
    expect(await env.vault.ident(name)).toBe("abcdefghjk");
    const again = await env.vault.create("b", "board", "---\nid: abcdefghjk\ntitle: t\n---\n\nx\n");
    expect(await env.vault.ident(again)).not.toBe("abcdefghjk");
    expect(frontId(readText(env.root, "b.board.md"))).not.toBe("abcdefghjk");
  });

  it("nonsense resolves to nothing", async () => {
    expect(await env.vault.resolve("")).toBeNull();
    expect(await env.vault.resolve("../../etc")).toBeNull();
    expect(await env.vault.resolve("zzzzzzzzzz")).toBeNull();
  });
});

describe("titles", () => {
  it("the tree carries each title, and a document with none is called by its name's last segment", async () => {
    await env.vault.create("plan", "board", BOARD);
    await env.vault.create("work/n", "note", NOTE);
    await env.vault.create("bare", "board", "```md {#a}\nx\n```\n");
    await env.vault.create("Meeting notes", "note", "no frontmatter\n");
    expect((await env.vault.tree()).titles).toEqual({
      plan: "t",
      "work/n": "Onboarding",
      bare: "bare",
      "Meeting notes": "Meeting notes",
    });
  });

  it("a new title is listed after the write that made it", async () => {
    const name = await env.vault.create("plan", "board", BOARD);
    expect((await env.vault.tree()).titles).toEqual({ plan: "t" });
    const cur = (await env.vault.read(name))!;
    await env.vault.write(name, "board", cur.text.replace("title: t", "title: Renamed"), cur.base);
    expect((await env.vault.tree()).titles).toEqual({ plan: "Renamed" });
  });

  it("a title follows its document to a new name", async () => {
    await env.vault.create("plan", "board", BOARD);
    const moved = await env.vault.rename("plan", "board", "work/plan");
    expect((await env.vault.tree()).titles).toEqual({ [moved]: "t" });
  });
});

describe("tasks, projects and events", () => {
  it("the tree carries each task and only a note is one", async () => {
    await env.vault.create("todo", "note", "---\ntitle: T\nstatus: todo\ndue: 2026-10-03\n---\n# T\n");
    await env.vault.create("work/done", "note", "---\nstatus: Done\n---\n");
    await env.vault.create("plain", "note", NOTE);
    await env.vault.create("plan", "board", "---\ntitle: t\nstatus: todo\n---\n\n```md {#a}\nx\n```\n");
    expect((await env.vault.tree()).tasks).toEqual({
      todo: { status: "todo", due: "2026-10-03" },
      "work/done": { status: "done" },
    });
  });

  it("a status written is listed and one taken out is not", async () => {
    const name = await env.vault.create("n", "note", NOTE);
    expect((await env.vault.tree()).tasks).toEqual({});
    await env.vault.write(name, "note", "---\nstatus: in-progress\n---\n" + NOTE, null);
    expect((await env.vault.tree()).tasks).toEqual({ n: { status: "in-progress" } });
    await env.vault.write(name, "note", NOTE, null);
    expect((await env.vault.tree()).tasks).toEqual({});
  });

  it("a task follows its note to a new name", async () => {
    await env.vault.create("n", "note", "---\nstatus: todo\n---\n");
    const moved = await env.vault.rename("n", "note", "work/n");
    expect((await env.vault.tree()).tasks).toEqual({ [moved]: { status: "todo" } });
  });

  it("the tree carries each project and only a note is one", async () => {
    await env.vault.create("work/p/p", "note", "---\ntitle: P\nproject: active\nhue: coral\n---\n");
    await env.vault.create("work/q/q", "note", "---\nproject: Done\n---\n");
    await env.vault.create("work/p/plain", "note", NOTE);
    await env.vault.create("plan", "board", "---\ntitle: t\nproject: active\n---\n\n```md {#a}\nx\n```\n");
    expect((await env.vault.tree()).projects).toEqual({
      "work/p/p": { status: "active", hue: "coral" },
      "work/q/q": { status: "done" },
    });
  });

  it("a project written is listed, one taken out is not, and it follows its folder", async () => {
    const name = await env.vault.create("w/n", "note", NOTE);
    await env.vault.write(name, "note", "---\nproject: paused\n---\n" + NOTE, null);
    expect((await env.vault.tree()).projects).toEqual({ "w/n": { status: "paused" } });
    await env.vault.moveFolder("w", "x");
    expect((await env.vault.tree()).projects).toEqual({ "x/n": { status: "paused" } });
    await env.vault.write("x/n", "note", NOTE, null);
    expect((await env.vault.tree()).projects).toEqual({});
  });

  it("the tree carries each event and a task with a start is a task", async () => {
    await env.vault.create("offsite", "note", "---\ntitle: O\nstart: 2026-10-03T09:00+02:00\n---\n");
    await env.vault.create("work/conf", "note", "---\nstart: 2026-10-12\nend: 2026-10-14\n---\n");
    await env.vault.create("chore", "note", "---\nstatus: todo\nstart: 2026-10-12\n---\n");
    await env.vault.create("plan", "board", "---\ntitle: t\nstart: 2026-10-12\n---\n\n```md {#a}\nx\n```\n");
    const tree = await env.vault.tree();
    expect(tree.events).toEqual({
      offsite: { start: "2026-10-03T09:00+02:00" },
      "work/conf": { start: "2026-10-12", end: "2026-10-14" },
    });
    expect(tree.tasks).toEqual({ chore: { status: "todo", start: "2026-10-12" } });
  });

  it("a start written is listed and one taken out is not", async () => {
    const name = await env.vault.create("n", "note", NOTE);
    await env.vault.write(name, "note", "---\nstart: 2026-10-12\n---\n" + NOTE, null);
    expect((await env.vault.tree()).events).toEqual({ n: { start: "2026-10-12" } });
    await env.vault.write(name, "note", NOTE, null);
    expect((await env.vault.tree()).events).toEqual({});
  });
});

describe("created", () => {
  it("a document is dated when it is made", async () => {
    const before = Math.floor(Date.now() / 1000) * 1000;
    const note = await env.vault.create("n", "note", NOTE);
    const board = await env.vault.create("plan", "board", BOARD);
    const made = (await env.vault.tree()).created;
    for (const doc of [note, board]) {
      expect(validInstant(made[doc])).toBe(true);
      const t = Date.parse(made[doc]!);
      expect(t).toBeGreaterThanOrEqual(before);
      expect(t).toBeLessThanOrEqual(Date.now());
    }
  });

  it("a date given is adopted", async () => {
    const name = await env.vault.create("n", "note", NOTE, { created: "2020-01-02T03:04:05Z" });
    expect((await env.vault.tree()).created[name]).toBe("2020-01-02T03:04:05Z");
    expect(await env.vault.created(name, "note")).toBe("2020-01-02T03:04:05Z");
  });

  it("a date that is not an instant is not adopted", async () => {
    const other = await env.vault.create("m", "note", NOTE, { created: "yesterday" });
    expect(validInstant((await env.vault.tree()).created[other])).toBe(true);
  });

  it("a rename and a folder move carry it and a copy does not", async () => {
    await env.vault.create("w/n", "note", NOTE, { created: "2020-01-02T03:04:05Z" });
    const moved = await env.vault.rename("w/n", "note", "w/m");
    expect((await env.vault.tree()).created[moved]).toBe("2020-01-02T03:04:05Z");
    const copied = await env.vault.rename(moved, "note", "w/copy", { copy: true });
    expect((await env.vault.tree()).created[copied]).not.toBe("2020-01-02T03:04:05Z");
    await env.vault.moveFolder("w", "x");
    expect((await env.vault.tree()).created["x/m"]).toBe("2020-01-02T03:04:05Z");
  });
});

describe("attachments", () => {
  it("a file is listed with its id, title and size and reads back byte for byte", async () => {
    const name = await env.vault.putFile("specs/q3-report.pdf", PDF, "Q3 Report.pdf");
    expect(name).toBe("specs/q3-report.pdf");
    const tree = await env.vault.tree();
    expect(tree.files).toEqual(["specs/q3-report.pdf"]);
    expect(tree.titles[name]).toBe("Q3 Report.pdf");
    expect(tree.sizes[name]).toBe(PDF.length);
    expect(validId(tree.ids[name])).toBe(true);
    expect(tree.folders).toContain("specs");
    expect(await env.vault.getFile(name)).toEqual(PDF);
    expect(await env.vault.fileInfo(name)).toEqual({ name, title: "Q3 Report.pdf", bytes: PDF.length });
  });

  it("a name keeps its spaces and capitals, and a taken one is numbered before its extension", async () => {
    expect(await env.vault.putFile("Q3 Report.PDF", PDF, null)).toBe("Q3 Report.pdf");
    expect(await env.vault.putFile("q3 report.pdf", PDF, null)).toBe("q3 report 2.pdf");
    expect(await env.vault.putFile("Q3 REPORT.pdf", PDF, null)).toBe("Q3 REPORT 3.pdf");
  });

  it("two uploads of one name at once each keep their own", async () => {
    const [a, b] = await Promise.all([
      env.vault.putFile("report.pdf", Buffer.from("%PDF one"), null),
      env.vault.putFile("report.pdf", Buffer.from("%PDF two"), null),
    ]);
    expect(new Set([a, b])).toEqual(new Set(["report.pdf", "report 2.pdf"]));
    expect(new Set([(await env.vault.getFile(a))!.toString(), (await env.vault.getFile(b))!.toString()])).toEqual(
      new Set(["%PDF one", "%PDF two"]),
    );
    const tree = await env.vault.tree();
    expect(tree.ids[a]).not.toBe(tree.ids[b]);
  });

  it("a file keeps the day it is given and leaves no temp file behind", async () => {
    const name = await env.vault.putFile("report.pdf", PDF, null, { created: "2024-05-06T07:08:09Z" });
    expect((await env.vault.tree()).created[name]).toBe("2024-05-06T07:08:09Z");
    expect(fs.readdirSync(env.root).filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });

  it("a board and a file of one stem are two documents", async () => {
    expect(await env.vault.create("report", "board", BOARD)).toBe("report");
    expect(await env.vault.putFile("report.pdf", PDF, null)).toBe("report.pdf");
    const tree = await env.vault.tree();
    expect([tree.boards, tree.files]).toEqual([["report"], ["report.pdf"]]);
  });

  it("a file is not among the texts", async () => {
    await env.vault.putFile("report.pdf", PDF, null);
    expect(Object.keys(await env.vault.texts())).not.toContain("report.pdf");
  });

  it("a name that is not a file's is refused", async () => {
    await expect(env.vault.putFile("no-extension", PDF, null)).rejects.toBeInstanceOf(Refused);
    await expect(env.vault.putFile("memo.html", PDF, null)).rejects.toBeInstanceOf(Refused);
  });

  it("a rename carries the bytes, the id and the title, and keeps the extension", async () => {
    const name = await env.vault.putFile("report.pdf", PDF, "Report.pdf");
    const ident = await env.vault.ident(name, "file");
    const moved = await env.vault.rename(name, "file", "work/final");
    expect(moved).toBe("work/final.pdf");
    expect(await env.vault.getFile(moved)).toEqual(PDF);
    expect(await env.vault.getFile(name)).toBeNull();
    expect(await env.vault.ident(moved, "file")).toBe(ident);
    expect((await env.vault.fileInfo(moved))!.title).toBe("Report.pdf");
    expect(await env.vault.resolve(ident!)).toEqual({ name: moved, kind: "file" });
    const record = JSON.parse(readText(env.root, `.anydag/files/${ident}.json`)) as { path: string };
    expect(record.path).toBe(moved);
  });

  it("a rename to another extension keeps its own", async () => {
    const name = await env.vault.putFile("report.pdf", PDF, null);
    expect(await env.vault.rename(name, "file", "report.docx")).toBe("report.docx.pdf");
  });

  it("a copy is a new document called the same", async () => {
    const name = await env.vault.putFile("report.pdf", PDF, "Report.pdf");
    const ident = await env.vault.ident(name, "file");
    const copy = await env.vault.rename(name, "file", name, { copy: true });
    expect(copy).toBe("report 2.pdf");
    expect(await env.vault.getFile(copy)).toEqual(PDF);
    expect(await env.vault.getFile(name)).toEqual(PDF);
    const copyId = await env.vault.ident(copy, "file");
    expect(validId(copyId)).toBe(true);
    expect(copyId).not.toBe(ident);
    expect((await env.vault.fileInfo(copy))!.title).toBe("Report.pdf");
  });

  it("a delete takes the bytes and the id record", async () => {
    const name = await env.vault.putFile("report.pdf", PDF, null);
    const ident = await env.vault.ident(name, "file");
    await env.vault.delete(name, "file");
    expect(await env.vault.getFile(name)).toBeNull();
    expect(await env.vault.fileInfo(name)).toBeNull();
    expect(await env.vault.resolve(ident!)).toBeNull();
    expect(has(env.root, `.anydag/files/${ident}.json`)).toBe(false);
    expect((await env.vault.tree()).files).toEqual([]);
    await expect(env.vault.delete(name, "file")).rejects.toBeInstanceOf(NotFound);
  });

  it("a title is set on the id record and listed", async () => {
    const name = await env.vault.putFile("report.pdf", PDF, null);
    expect((await env.vault.tree()).titles[name]).toBe("report.pdf");
    await env.vault.titleFile(name, "Final numbers.pdf");
    expect((await env.vault.tree()).titles[name]).toBe("Final numbers.pdf");
    expect(readText(env.root, `.anydag/files/${(await env.vault.ident(name, "file"))!}.json`)).toContain("Final numbers.pdf");
    await expect(env.vault.titleFile("nope.pdf", "x")).rejects.toBeInstanceOf(NotFound);
  });

  it("a folder move carries its files with their ids and titles", async () => {
    const name = await env.vault.putFile("work/report.pdf", PDF, "Report.pdf");
    const ident = await env.vault.ident(name, "file");
    await env.vault.moveFolder("work", "archive/work");
    expect((await env.vault.tree()).files).toEqual(["archive/work/report.pdf"]);
    expect(await env.vault.getFile("archive/work/report.pdf")).toEqual(PDF);
    expect(await env.vault.ident("archive/work/report.pdf", "file")).toBe(ident);
    expect((await env.vault.fileInfo("archive/work/report.pdf"))!.title).toBe("Report.pdf");
  });

  it("a recursive delete says which files went", async () => {
    await env.vault.putFile("work/report.pdf", PDF, null);
    await env.vault.putFile("keep.png", Buffer.from("png"), null);
    const gone = await env.vault.rmdir("work", true);
    expect(gone.files).toEqual(["work/report.pdf"]);
    expect(await env.vault.getFile("work/report.pdf")).toBeNull();
    expect((await env.vault.tree()).files).toEqual(["keep.png"]);
  });

  it("an id is adopted when it is free", async () => {
    const name = await env.vault.putFile("report.pdf", PDF, null, { id: "abcdefghjk" });
    expect(await env.vault.ident(name, "file")).toBe("abcdefghjk");
    const again = await env.vault.putFile("report.pdf", PDF, null, { id: "abcdefghjk" });
    expect(await env.vault.ident(again, "file")).not.toBe("abcdefghjk");
  });

  it("is confined to a name it could list", async () => {
    expect(await env.vault.getFile("../outside.pdf")).toBeNull();
    expect(await env.vault.getFile("memo.html")).toBeNull();
    expect(path.isAbsolute(env.vault.abs("a.pdf"))).toBe(true);
  });
});
