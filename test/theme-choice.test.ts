import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { parseBoard } from "@/board/parseBoard";
import { THEMES, THEME_NAMES, useTheme } from "@/theme/useTheme";

/**
 * A theme is the reader's preference, not a board's property.
 *
 * The rule has two halves that cannot be seen from one file: the board parser must not carry a
 * `theme:` into the object the app draws from, and the theme hook must not offer it a way in. A
 * snapshot is the one place no preference is read, so it is the default unless the URL names one.
 *
 * Rendered as markup rather than through a browser: `useTheme` decides its name in the render, and
 * `applyTheme` — the effect that would touch the document — is not what these checks are about.
 */

const DEFAULT = THEMES.paper ? "paper" : THEME_NAMES[0]!;

const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

function Probe({ explicit, snapshot }: { explicit?: string; snapshot?: boolean }) {
  const { name } = useTheme(explicit, snapshot);
  return createElement("span", { "data-theme-name": name });
}

function nameOf(props: { explicit?: string; snapshot?: boolean } = {}): string | undefined {
  const markup = renderToStaticMarkup(createElement(Probe, props));
  return /data-theme-name="([^"]+)"/.exec(markup)?.[1];
}

describe("a board has no theme of its own", () => {
  it("does not carry a frontmatter theme:, and says nothing about it", () => {
    const board = parseBoard(
      "plan",
      ["---", "title: Plan", "theme: paper-dark", "---", "", "```md {#a}", "hi", "```", ""].join("\n"),
    );
    expect(board.title).toBe("Plan");
    expect(board).not.toHaveProperty("theme");
    /* A value no theme has is still just frontmatter: no error, no warning, and the board draws. */
    expect(board.errors).toEqual([]);
    expect(parseBoard("plan", "---\ntheme: not-a-theme\n---\n\n```md {#a}\nhi\n```\n").errors).toEqual([]);
  });

  it("draws in what the reader picked", () => {
    store.set("dag:theme", "neutral");
    expect(nameOf()).toBe("neutral");
  });

  it("draws a snapshot in the default, whatever this browser picked", () => {
    store.set("dag:theme", "neutral");
    expect(nameOf({ snapshot: true })).toBe(DEFAULT);
  });

  it("still lets an explicit ?theme= name one in a snapshot", () => {
    store.set("dag:theme", "neutral");
    expect(nameOf({ explicit: "paper-dark", snapshot: true })).toBe("paper-dark");
  });

  it("falls back to the default for a stored name no folder carries", () => {
    store.set("dag:theme", "gone");
    expect(nameOf()).toBe(DEFAULT);
  });
});
