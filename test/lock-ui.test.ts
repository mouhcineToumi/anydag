import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { BoardTree } from "@/board/useBoard";
import { EmptyBoard, Welcome } from "@/ui/Welcome";

/**
 * The cards a locked app draws before anything is open. They are the places the lock used to be
 * invisible: `Nothing open` offered New board and New note as though they would work, and an empty
 * board hid its card altogether, so a press that did nothing was all a person got.
 *
 * `Welcome` and `EmptyBoard` take `locked` as a prop precisely so this is a render and not a
 * browser: the page owns the state, and the card is one thing to hold to its words.
 */

const HINT = "Read only — unlock (Ctrl+Shift+L)";
const noop = () => {};

/** A vault with one board: *Nothing open*, not *This vault is empty*. */
const LIST: BoardTree = {
  loaded: true,
  fresh: true,
  boards: ["one"],
  folders: [],
  notes: [],
  titles: {},
  tasks: {},
  projects: {},
  events: {},
  created: {},
  ids: {},
  quizzes: [],
  questions: {},
  tables: [],
  files: [],
  sizes: {},
};

/** The opening tag of the element that carries `hook`, which is where its attributes are said. */
function tag(markup: string, hook: string): string {
  const found = markup.match(new RegExp(`<[a-z]+[^>]*${hook}[^>]*>`));
  expect(found, `no element carries ${hook}`).not.toBeNull();
  return found![0];
}

const welcome = (locked: boolean) =>
  renderToStaticMarkup(createElement(Welcome, { locked, list: LIST, onStart: noop, onOpenFile: noop, onOpen: noop }));

const emptyBoard = (locked: boolean) =>
  renderToStaticMarkup(createElement(EmptyBoard, { locked, onNote: noop, onLibrary: noop, onPrompt: noop }));

describe("the read-only cards", () => {
  it("says read-only on Nothing open, offers Unlock in place, and marks both writes unavailable", () => {
    const markup = welcome(true);
    expect(markup).toContain("Read only: nothing here can be changed until you unlock.");
    expect(markup).toContain("data-dag-welcome-unlock");
    expect(tag(markup, "data-dag-welcome-new")).toContain('aria-disabled="true"');
    expect(tag(markup, "data-dag-welcome-new")).toContain(`title="${HINT}"`);
    expect(tag(markup, "data-dag-welcome-new")).toContain("data-dag-readonly-blocked");
    expect(tag(markup, "data-dag-welcome-note")).toContain('aria-disabled="true"');
    expect(tag(markup, "data-dag-welcome-note")).toContain(`title="${HINT}"`);
    /* Search only reads, so it is not wearing the lock. */
    expect(tag(markup, "data-dag-welcome-open")).not.toContain("data-dag-readonly-blocked");
  });

  it("restores Nothing open when unlocked, without an Unlock or a disabled button", () => {
    const markup = welcome(false);
    expect(markup).toContain("Start something new, or open something you have already made.");
    expect(markup).not.toContain("data-dag-welcome-unlock");
    expect(markup).not.toContain("data-dag-readonly-blocked");
    expect(markup).not.toContain('aria-disabled="true"');
  });

  it("keeps the empty board's card and says why nothing can land on it", () => {
    const markup = emptyBoard(true);
    expect(markup).toContain("Read only: unlock to add a note, open the library, or describe a diagram.");
    expect(markup).toContain("data-dag-empty-board-unlock");
    for (const key of ["note", "library", "prompt"]) {
      const act = tag(markup, `data-dag-empty-board-act="${key}"`);
      expect(act).toContain('aria-disabled="true"');
      expect(act).toContain(`title="${HINT}"`);
      expect(act).toContain("data-dag-readonly-blocked");
    }
  });

  it("draws the empty board's three ways again once it is unlocked", () => {
    const markup = emptyBoard(false);
    expect(markup).toContain("An empty board. Double-click anywhere for a note, or start with");
    expect(markup).not.toContain("data-dag-empty-board-unlock");
    expect(markup).not.toContain("data-dag-readonly-blocked");
  });
});
