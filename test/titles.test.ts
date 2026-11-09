import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { parseBoard } from "@/board/parseBoard";
import { blankBoardText, blankNoteText, UNTITLED } from "@/board/useBoard";
import { cleanTitle, pageTitle, splitNote } from "@/note/format";
import { titleOf } from "@/refs/extract";

import { withTitle } from "../server/frontmatter";

/**
 * What a document is called.
 *
 * The sidebar, a reference, the toolbar and the search all read it through `titleOf`, held here to
 * `test/fixtures/titles.json`, so a document cannot be called one thing in its row and another in
 * the link that names it.
 */
const FIXTURE = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "titles.json"), "utf8")) as {
  read: { why: string; text: string; title: string | null }[];
  write: { why: string; text: string; title: string; kind: "board" | "note"; out: string }[];
  clean: { raw: string; title: string | null }[];
};
const CASES = FIXTURE.read;

describe("a document's title", () => {
  it.each(CASES.map((c) => [c.why, c] as const))("%s", (_, c) => {
    expect(titleOf(c.text) ?? null).toBe(c.title);
    /* A note reads it the same way, and so does a board — the toolbar's copy of the rule. */
    expect(splitNote(c.text).title ?? null).toBe(c.title);
    if (!c.text.startsWith("\n")) expect(parseBoard("x", c.text).title ?? null).toBe(c.title);
  });

  it("a new board and a new note are called Untitled, and nothing else in them says so", () => {
    expect(titleOf(blankBoardText())).toBe(UNTITLED);
    expect(titleOf(blankNoteText())).toBe(UNTITLED);
    /* No heading: a second copy of the title is one nothing rewrites when the title changes. */
    expect(blankBoardText()).not.toMatch(/# Untitled/);
    expect(splitNote(blankNoteText()).body).toBe("");
    expect(parseBoard("untitled", blankBoardText()).errors).toEqual([]);
  });
});

/*
 * The page's copy of the rule. `/create` keeps a title once, in the file's name, and drops the
 * `title:` line when the two agree — so an event made from the calendar, a task typed into the
 * Tasks page and a note made from the sidebar with a title are read back off their names.
 */
describe("what a note's own page calls it", () => {
  it("falls back to the leaf of its name when the frontmatter names no title", () => {
    expect(pageTitle("khansi nkfet", undefined)).toBe("khansi nkfet");
    expect(pageTitle("work/khansi nkfet", undefined)).toBe("khansi nkfet");
  });

  it("still shows the placeholder for a file nobody has named", () => {
    expect(pageTitle("Untitled", undefined)).toBeUndefined();
    expect(pageTitle("work/untitled", undefined)).toBeUndefined();
    /* `unique()` numbers the same word, and one of those is as nameless as the first. */
    expect(pageTitle("Untitled 2", undefined)).toBeUndefined();
    /* An explicit *Untitled* is the placeholder too, whatever the file is called. */
    expect(pageTitle("Untitled 2", UNTITLED)).toBeUndefined();
  });

  it("prefers the frontmatter, and an edit that starts from the name writes a title", () => {
    expect(pageTitle("file-name", "A real title")).toBe("A real title");
    /* What the field starts from on a file with no `title:` line, then what committing it writes. */
    const start = pageTitle("khansi nkfet", splitNote("---\nid: 0000000000\n---\n").title);
    expect(start).toBe("khansi nkfet");
    const edited = withTitle("---\nid: 0000000000\n---\n", `${start} lunch`, "note");
    expect(edited).toBe("---\ntitle: khansi nkfet lunch\nid: 0000000000\n---\n");
    expect(titleOf(edited)).toBe("khansi nkfet lunch");
  });
});

/*
 * A title is written by `/retitle` (`withTitle` in `server/frontmatter.ts`, held to the `write`
 * cases below), from the sidebar and from the top of a note's page alike.
 * What it writes, the page must read back as the title it was asked to write; and the page cleans
 * what is typed the way the api does before it asks.
 */
describe("writing a document's title", () => {
  it.each(FIXTURE.write.map((c) => [c.why, c] as const))("%s", (_, c) => {
    expect(withTitle(c.text, c.title, c.kind)).toBe(c.out);
    expect(titleOf(c.out)).toBe(c.title);
  });

  it.each(FIXTURE.clean.map((c) => [JSON.stringify(c.raw.slice(0, 20)), c] as const))("cleans %s as the api does", (_, c) => {
    expect(cleanTitle(c.raw)).toBe(c.title);
  });
});
