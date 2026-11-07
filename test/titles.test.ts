import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { parseBoard } from "@/board/parseBoard";
import { blankBoardText, blankNoteText, UNTITLED } from "@/board/useBoard";
import { cleanTitle, splitNote } from "@/note/format";
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
