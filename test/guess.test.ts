import { afterEach, describe, expect, it, vi } from "vitest";

import { forgetGuesses, guess, guessed, shown, tick } from "@/board/guess";
import type { BoardTree } from "@/board/useBoard";

/**
 * A sidebar change is drawn before the server answers, and taken back if it refuses.
 */

const TREE: BoardTree = {
  loaded: true,
  fresh: true,
  boards: ["plan", "work/arch"],
  folders: ["work", "empty"],
  notes: ["work/notes", "todo"],
  titles: { plan: "Plan", "work/notes": "Notes" },
  tasks: { todo: { status: "todo" } },
  projects: {},
  events: {},
  created: {},
  ids: { plan: "id1", "work/arch": "id2", "work/notes": "id3", todo: "id4" },
  quizzes: [],
  questions: {},
  tables: [],
  files: [],
  sizes: {},
};

afterEach(() => {
  forgetGuesses();
  vi.unstubAllGlobals();
});

describe("a guess on the list", () => {
  it("moves a file and everything known about it", () => {
    const stamp = tick();
    guess({ op: "move", kind: "board", from: "plan", to: "work/plan" });
    const t = guessed(TREE, stamp);
    expect(t.boards).toEqual(["work/plan", "work/arch"]);
    expect(t.titles["work/plan"]).toBe("Plan");
    expect(t.ids["work/plan"]).toBe("id1");
    expect("plan" in t.ids).toBe(false);
    /* The list itself is never changed. */
    expect(TREE.boards).toEqual(["plan", "work/arch"]);
  });

  it("takes a file, a folder with what is in it, and adds a folder or a file", () => {
    const stamp = tick();
    guess({ op: "remove", kind: "note", name: "todo" });
    guess({ op: "folder-remove", path: "work" });
    guess({ op: "folder-add", path: "new" });
    guess({ op: "add", kind: "board", name: "untitled", title: "Untitled" });
    const t = guessed(TREE, stamp);
    expect(t.notes).toEqual([]);
    expect(t.tasks).toEqual({});
    expect(t.boards).toEqual(["plan", "untitled"]);
    expect(t.titles.untitled).toBe("Untitled");
    expect(t.folders).toEqual(["empty", "new"]);
  });

  it("moves a folder's files and folders with it", () => {
    const stamp = tick();
    guess({ op: "folder-move", from: "work", to: "archive/work" });
    const t = guessed(TREE, stamp);
    expect(t.boards).toContain("archive/work/arch");
    expect(t.notes).toContain("archive/work/notes");
    expect(t.titles["archive/work/notes"]).toBe("Notes");
    expect(t.folders).toContain("archive/work");
    expect(t.folders).not.toContain("work");
  });

  it("does not guess a move onto a name that is taken, of any kind", () => {
    /* The server numbers it `work/notes-2`; a guess of `work/notes` drew two rows under one key, the
       second carrying the first one's title and id. */
    const stamp = tick();
    guess({ op: "move", kind: "board", from: "plan", to: "work/notes" });
    guess({ op: "move", kind: "note", from: "todo", to: "work/arch" });
    const t = guessed(TREE, stamp);
    expect(t.boards).toEqual(TREE.boards);
    expect(t.notes).toEqual(TREE.notes);
    expect(t.titles).toEqual(TREE.titles);
    expect(t.ids).toEqual(TREE.ids);
  });

  it("does not guess a folder moved onto one that exists", () => {
    const stamp = tick();
    guess({ op: "folder-move", from: "empty", to: "work" });
    const t = guessed(TREE, stamp);
    expect(t.folders).toEqual(TREE.folders);
  });

  it("retitles a row", () => {
    const stamp = tick();
    guess({ op: "title", kind: "board", name: "plan", title: "The plan" });
    expect(guessed(TREE, stamp).titles.plan).toBe("The plan");
  });

  it("is taken off at once when the server refuses, and the list is asked for again", () => {
    const fired: string[] = [];
    vi.stubGlobal("dispatchEvent", (e: Event) => fired.push(e.type));
    const stamp = tick();
    const done = guess({ op: "remove", kind: "board", name: "plan" });
    expect(guessed(TREE, stamp).boards).toEqual(["work/arch"]);
    done(false);
    expect(guessed(TREE, stamp)).toBe(TREE);
    expect(fired).toContain("dag:boards");
  });

  it("when done, stays until a list asked for after the answer arrives — never flickering back", () => {
    const before = tick();
    const done = guess({ op: "remove", kind: "board", name: "plan" });
    /* A list asked before the answer still shows the guess, whenever it lands. */
    done(true);
    expect(guessed(TREE, before).boards).toEqual(["work/arch"]);
    shown(before);
    expect(guessed(TREE, before).boards).toEqual(["work/arch"]);
    /* One asked after it already has the change, so the guess is let go. */
    const after = tick();
    const fresh = { ...TREE, boards: ["work/arch"] };
    expect(guessed(fresh, after)).toBe(fresh);
    shown(after);
    expect(guessed(TREE, before)).toBe(TREE);
  });
});
