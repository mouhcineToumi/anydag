/** Ported from the hosted api's `test_names.py`, against `server/names.ts` and the local naming rules. */
import { describe, expect, it } from "vitest";

import {
  assetsPrefix,
  cleanSegment,
  classify,
  extOf,
  fileNameFrom,
  fileTarget,
  folderFrom,
  folderMove,
  folderOf,
  ignored,
  kindOf,
  leafOf,
  nameFrom,
  refusal,
  same,
  titleName,
  unique,
  uniqueFile,
} from "../../server/names";

describe("nameFrom", () => {
  it("keeps a folder, because a folder is part of a name", () => {
    expect(nameFrom("reference/erd")).toBe("reference/erd");
  });

  it("collapses a run of slashes", () => {
    expect(nameFrom("a//b")).toBe("a/b");
    expect(nameFrom("a///b//c")).toBe("a/b/c");
  });

  it("cannot express a traversal", () => {
    expect(nameFrom("../../etc/passwd")).not.toContain("..");
    expect(nameFrom("..")).toBe("Untitled");
    expect(nameFrom("/etc/passwd")).toBe("etc/passwd");
  });

  it("strips a kind suffix and keeps the person's case and spaces", () => {
    expect(nameFrom("Plan.board.md")).toBe("Plan");
    expect(nameFrom("Meeting notes.md")).toBe("Meeting notes");
    expect(nameFrom("Écoles.note.md")).toBe("Écoles");
    expect(nameFrom("")).toBe("Untitled");
    expect(nameFrom(undefined, "fallback")).toBe("fallback");
  });

  it("takes out what Windows cannot store without inventing anything", () => {
    expect(nameFrom("Q3: plan?")).toBe("Q3 plan");
    expect(nameFrom('a<b>c|d*e"f')).toBe("a b c d e f");
    expect(nameFrom("back\\slash")).toBe("back/slash");
  });

  it("drops trailing dots and spaces and leading dots", () => {
    expect(nameFrom("plan. .")).toBe("plan");
    expect(nameFrom(".hidden")).toBe("hidden");
  });

  it("gives a device name a trailing underscore", () => {
    expect(nameFrom("CON")).toBe("CON_");
    expect(nameFrom("work/aux")).toBe("work/aux_");
  });

  it("never lets a name be hidden from the walk", () => {
    expect(nameFrom("plan.assets")).toBe("plan assets");
    expect(nameFrom("node_modules")).toBe("node modules");
    expect(nameFrom("a.sync-conflict-20240101")).not.toContain(".sync-conflict-");
    expect(refusal(nameFrom("plan.assets"))).toBeNull();
  });

  it("caps a segment", () => {
    expect(cleanSegment("x".repeat(500)).length).toBeLessThanOrEqual(120);
  });
});

describe("refusal", () => {
  it("accepts any portable name, spaces and capitals included", () => {
    for (const ok of ["plan", "Meeting notes", "Q3 Plan", "Écoles", "work/Q3 Plan", "a.b"]) expect(refusal(ok)).toBeNull();
  });

  it("refuses what is not portable", () => {
    for (const bad of [
      "",
      "/abs",
      "a//b",
      "a/./b",
      "a/../b",
      "a:b",
      "a?b",
      "a*b",
      'a"b',
      "a<b",
      "a|b",
      "a\\b",
      "a\x01b",
      "CON",
      "nul.txt",
      "COM1",
      "lpt9",
      "a.",
      "a ",
      "work/b ",
      ".hidden",
      "a/.git/b",
      "plan.assets",
      "node_modules",
    ])
      expect(refusal(bad), JSON.stringify(bad)).not.toBeNull();
  });
});

describe("titleName", () => {
  it("files a title under its own words, verbatim", () => {
    expect(titleName("Q3 Plan")).toBe("Q3 Plan");
    expect(titleName("Q3: plan?", "work")).toBe("work/Q3 plan");
  });

  it("treats a slash in a title as a character, never a folder", () => {
    expect(titleName("TCP/IP notes")).toBe("TCP-IP notes");
  });

  it("falls back to Untitled", () => {
    expect(titleName("???")).toBe("Untitled");
    expect(titleName("", "w")).toBe("w/Untitled");
  });
});

describe("leafOf, folderOf, same", () => {
  it("split a name", () => {
    expect(leafOf("a/b/c")).toBe("c");
    expect(leafOf("c")).toBe("c");
    expect(folderOf("a/b/c")).toBe("a/b");
    expect(folderOf("c")).toBe("");
  });

  it("compare names without case", () => {
    expect(same("Plan", "plan")).toBe(true);
    expect(same("Plan", "plan 2")).toBe(false);
  });
});

describe("folderFrom", () => {
  it("allows the empty name, which is the top level", () => {
    expect(folderFrom("")).toBe("");
    expect(folderFrom("/")).toBe("");
    expect(folderFrom(undefined)).toBe("");
  });

  it("refuses the directories that are not folders", () => {
    expect(folderFrom(".anydag")).toBeNull();
    expect(folderFrom(".obsidian/x")).toBeNull();
    expect(folderFrom("plan.assets")).toBeNull();
    expect(folderFrom("a/plan.assets")).toBeNull();
    expect(folderFrom("node_modules")).toBeNull();
    expect(folderFrom("..")).toBeNull();
  });

  it("keeps the person's spelling", () => {
    expect(folderFrom("My Folder")).toBe("My Folder");
    expect(folderFrom("a//b/")).toBe("a/b");
    // `components` is an ordinary folder in a vault: the saved ones live in `.anydag/components`.
    expect(folderFrom("components")).toBe("components");
  });
});

describe("folderMove", () => {
  it("returns both ends made portable", () => {
    expect(folderMove("Work", "Archive//Work 2025")).toEqual(["Work", "Archive/Work 2025"]);
  });

  it("refuses the top level at either end", () => {
    expect(folderMove("", "x")).toBe("the top level is not a folder");
    expect(folderMove("x", "")).toBe("the top level is not a folder");
  });

  it("refuses the ends that are not folders", () => {
    expect(String(folderMove("work", ".anydag"))).toContain("not a folder name");
    expect(String(folderMove("work", "plan.assets"))).toContain("not a folder name");
  });

  it("refuses into itself but not into a sibling that begins the same way", () => {
    expect(folderMove("a", "a/b")).toBe("`a` cannot go inside itself");
    expect(folderMove("a", "ab")).toEqual(["a", "ab"]);
    expect(folderMove("A", "a/b")).toBe("`A` cannot go inside itself");
  });

  it("lets a case-only change through as a move", () => {
    expect(folderMove("work", "Work")).toEqual(["work", "Work"]);
  });
});

describe("unique and uniqueFile", () => {
  it("number a name that is taken, the caller's own included, Obsidian-style", () => {
    const taken = new Set(["plan"]);
    expect(unique("plan", (n) => taken.has(n))).toBe("plan 2");
    expect(unique("other", (n) => taken.has(n))).toBe("other");
  });

  it("keep numbering past the first collision", () => {
    const taken = new Set(["plan", "plan 2", "plan 3"]);
    expect(unique("plan", (n) => taken.has(n))).toBe("plan 4");
  });

  it("number an attachment before its extension", () => {
    const taken = new Set(["q3 report.pdf", "q3 report 2.pdf"]);
    expect(uniqueFile("q3 report.pdf", (n) => taken.has(n))).toBe("q3 report 3.pdf");
    expect(uniqueFile("free.pdf", (n) => taken.has(n))).toBe("free.pdf");
  });
});

describe("assetsPrefix", () => {
  it("sits beside the document, not inside its folder", () => {
    expect(assetsPrefix("plan")).toBe("plan.assets");
    expect(assetsPrefix("reference/erd")).toBe("reference/erd.assets");
  });
});

describe("classify", () => {
  it("reads a text's kind off its suffix, a note being `.md` or `.note.md`", () => {
    expect(classify("a/plan.board.md")).toEqual({ kind: "board", name: "a/plan" });
    expect(classify("Drill.quiz.md")).toEqual({ kind: "quiz", name: "Drill" });
    expect(classify("deals.table.md")).toEqual({ kind: "table", name: "deals" });
    expect(classify("n.note.md")).toEqual({ kind: "note", name: "n" });
    expect(classify("Meeting notes.md")).toEqual({ kind: "note", name: "Meeting notes" });
    expect(classify("PLAN.BOARD.MD")).toEqual({ kind: "board", name: "PLAN" });
  });

  it("reads an attachment by a type the vault lists, keeping the whole name", () => {
    expect(classify("specs/Q3 Report.PDF")).toEqual({ kind: "file", name: "specs/Q3 Report.PDF" });
    expect(classify("memo.html")).toBeNull();
    expect(classify("memo.html", new Set(["html"]))).toEqual({ kind: "file", name: "memo.html" });
    expect(classify("noext")).toBeNull();
    expect(classify(".md")).toBeNull();
  });
});

describe("ignored", () => {
  it("never lists dot entries, picture folders, node_modules or sync debris", () => {
    for (const s of [
      ".anydag",
      ".obsidian",
      ".git",
      ".trash",
      ".stversions",
      "plan.assets",
      "node_modules",
      "a.sync-conflict-2024.md",
      "x.icloud",
    ])
      expect(ignored(s), s).toBe(true);
    for (const s of ["plan", "Meeting notes.md", "assets", "attachments"]) expect(ignored(s), s).toBe(false);
  });
});

describe("attachment names", () => {
  it("keep their extension and make the stem portable", () => {
    expect(fileNameFrom("specs/Q3 Report.PDF")).toBe("specs/Q3 Report.pdf");
    expect(fileNameFrom("a:b.pdf")).toBe("a b.pdf");
  });

  it("refuse what has no extension this vault could list", () => {
    expect(fileNameFrom("no-extension")).toBeNull();
    expect(fileNameFrom("memo.html")).toBeNull();
    expect(fileNameFrom("note.md")).toBeNull();
    expect(fileNameFrom("x.assets")).toBeNull();
  });

  it("keep their own extension whatever a rename ends in", () => {
    expect(fileTarget("report.pdf", "work/final")).toBe("work/final.pdf");
    expect(fileTarget("report.pdf", "work/final.pdf")).toBe("work/final.pdf");
    expect(fileTarget("report.pdf", "report.docx")).toBe("report.docx.pdf");
  });

  it("read the extension in lower case", () => {
    expect(extOf("a/B.PDF")).toBe("pdf");
    expect(extOf("a.b/c")).toBe("");
    expect(extOf(".hidden")).toBe("");
  });
});

describe("kindOf", () => {
  it("defaults to a board and refuses what is not a text kind", () => {
    expect(kindOf(undefined)).toBe("board");
    expect(kindOf("")).toBe("board");
    expect(kindOf("note")).toBe("note");
    expect(kindOf("file")).toBeNull();
    expect(kindOf("nope")).toBeNull();
  });
});
