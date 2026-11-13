import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { FileProblem, fileProblemCopy, type FileProblemKind } from "@/ui/FileProblem";
import type { LoadProblem } from "@/board/useBoard";

/**
 * The card a page draws instead of a file it could not open.
 *
 * The reason is the whole vocabulary (`missing`, `unreachable`, `unreadable`) and the copy is a
 * pure function of it, so the words and the actions are checked here without a browser. The one
 * thing the markup is allowed to say about a code is under *Details for a bug report*: a person
 * reading the page is given a next step, not `EB_UNREADABLE`.
 */

const noop = () => {};

const missing = (): LoadProblem => ({ reason: "missing" });
const unreachable = (): LoadProblem => ({ reason: "unreachable", message: "Failed to fetch" });
const unreadable = (text?: string): LoadProblem => ({
  reason: "unreadable",
  code: "EB_UNREADABLE",
  message: "the server answered 500",
  ...(text === undefined ? {} : { text }),
});

describe("the reason to copy mapping", () => {
  it("names the kind and the file, and offers the three ways on, when there is no such file", () => {
    expect(fileProblemCopy("board", "Roadmap", missing())).toEqual({
      title: "There's no board called \u201cRoadmap\u201d",
      body: "It may have been renamed, moved or trashed.",
      actions: ["search", "trash", "home"],
    });
    expect(fileProblemCopy("note", "Plan", missing()).title).toBe("There's no note called \u201cPlan\u201d");
  });

  it("says the server is not answering and offers only Try again when it could not be reached", () => {
    expect(fileProblemCopy("table", "Q3", unreachable())).toEqual({
      title: "Couldn't open \u201cQ3\u201d",
      body: "AnyDag's server isn't answering. The file is safe on disk.",
      actions: ["retry"],
    });
  });

  it("offers Open as text only when there are bytes to show, and Go home either way", () => {
    expect(fileProblemCopy("quiz", "Cells", unreadable()).actions).toEqual(["home"]);
    expect(fileProblemCopy("quiz", "Cells", unreadable("---\n# a quiz")).actions).toEqual(["text", "home"]);
  });

  it("does not let a kind fall through the noun table", () => {
    const kinds: FileProblemKind[] = ["board", "note", "quiz", "table"];
    expect(kinds.map((kind) => fileProblemCopy(kind, "X", missing()).title)).toEqual([
      "There's no board called \u201cX\u201d",
      "There's no note called \u201cX\u201d",
      "There's no quiz called \u201cX\u201d",
      "There's no table called \u201cX\u201d",
    ]);
  });
});

const card = (problem: LoadProblem, handlers = true) =>
  renderToStaticMarkup(
    createElement(FileProblem, {
      kind: "board",
      name: "Roadmap",
      problem,
      ...(handlers ? { onSearch: noop, onTrash: noop, onHome: noop, onRetry: noop } : {}),
    }),
  );

describe("the card", () => {
  it("draws the missing copy and its three actions", () => {
    const markup = card(missing());
    expect(markup).toContain("no board called \u201cRoadmap\u201d");
    expect(markup).toContain("It may have been renamed, moved or trashed.");
    for (const action of ["search", "trash", "home"]) expect(markup).toContain(`data-dag-file-problem-act="${action}"`);
    expect(markup).toContain("Search for it");
    expect(markup).toContain("Look in the trash");
    expect(markup).toContain("Go home");
  });

  it("keeps the code and the server's message inside a closed disclosure", () => {
    const markup = card(unreadable());
    expect(markup).toContain("Details for a bug report");
    const details = markup.indexOf("<details");
    expect(details).toBeGreaterThan(-1);
    expect(markup.slice(0, details)).not.toContain("EB_UNREADABLE");
    expect(markup.slice(0, details)).not.toContain("the server answered 500");
    /* Closed: the disclosure has no `open` attribute. */
    expect(markup.slice(details, markup.indexOf(">", details))).not.toContain("open");
    expect(markup).toContain("EB_UNREADABLE");
  });

  it("shows the file's text only when Open as text is offered", () => {
    expect(card(unreadable())).not.toContain("data-dag-file-problem-text");
    expect(card(unreadable("# the file"))).toContain('data-dag-file-problem-act="text"');
    /* The text itself is behind the button, which has not been pressed in a static render. */
    expect(card(unreadable("# the file"))).not.toContain("data-dag-file-problem-text");
  });

  it("draws no action where the page gave it none, as a snapshot has no buttons", () => {
    const markup = card(missing(), false);
    expect(markup).not.toContain("data-dag-file-problem-act");
  });
});
