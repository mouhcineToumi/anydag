// @vitest-environment jsdom
import { act, createElement, Fragment } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EmbedBoundary } from "@/refs/Ref";

/**
 * An embed draws another document inside the page holding it, and a throw from anything it draws
 * used to reach the app's one boundary and take the whole page — the note, the sidebar, the open
 * chat (#123). `EmbedBoundary` keeps it to the embed: a card with the author's words, and everything
 * around it drawn as it was.
 */

const g = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
let host: HTMLElement;
let root: Root;
let wasAct: boolean | undefined;

beforeEach(() => {
  wasAct = g.IS_REACT_ACT_ENVIRONMENT;
  g.IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  g.IS_REACT_ACT_ENVIRONMENT = wasAct;
  vi.restoreAllMocks();
});

function Throws(): never {
  throw new Error("the board would not draw");
}

describe("an embed that throws", () => {
  it("is a card saying so, and the note around it is still drawn", () => {
    /* React says what was caught on the console; that is what is being tested, not a failure. */
    vi.spyOn(console, "error").mockImplementation(() => {});
    act(() =>
      root.render(
        createElement(
          Fragment,
          null,
          createElement("p", { "data-before": "" }, "Before the embed."),
          createElement(EmbedBoundary, { id: "hw99804ts0", fallback: "Merge queue flow", children: createElement(Throws) }),
          createElement(EmbedBoundary, {
            id: "aaaaaaaaaa",
            fallback: "Another",
            children: createElement("div", { "data-fine": "" }, "drawn"),
          }),
          createElement("p", { "data-after": "" }, "After the embed."),
        ),
      ),
    );
    const failed = host.querySelector('[data-dag-embed="hw99804ts0"][data-dag-embed-failed]');
    expect(failed?.textContent).toBe("Merge queue flow could not be drawn");
    expect(host.querySelector("[data-before]")?.textContent).toBe("Before the embed.");
    expect(host.querySelector("[data-after]")?.textContent).toBe("After the embed.");
    expect(host.querySelector("[data-fine]")?.textContent).toBe("drawn");
  });
});
