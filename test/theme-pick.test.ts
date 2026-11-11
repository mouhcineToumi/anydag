import { describe, expect, it } from "vitest";

import { pickTheme } from "@/theme/pick";

/**
 * Which theme a window is drawn in: the address, then the reader's own theme *if they asked for it
 * everywhere*, then the board's, then the reader's, then the default. The rule is a pure function so
 * the order is held without a browser; `useTheme` only feeds it.
 */

const INSTALLED = new Set(["paper", "paper-dark", "neutral"]);
const known = (n: string | null | undefined) => (n && INSTALLED.has(n) ? n : null);
const pick = (inputs: Parameters<typeof pickTheme>[0]) => pickTheme(inputs, known, "paper");

describe("pickTheme", () => {
  it("draws a board in its own theme over the reader's, by default", () => {
    expect(pick({ board: "neutral", chosen: "paper-dark" })).toEqual({ name: "neutral", source: "board" });
    expect(pick({ board: "neutral", chosen: "paper-dark", mine: false })).toEqual({ name: "neutral", source: "board" });
  });

  it("draws the reader's theme on every board once they ask for it", () => {
    expect(pick({ board: "neutral", chosen: "paper-dark", mine: true })).toEqual({ name: "paper-dark", source: "mine" });
  });

  it("has nothing of the reader's to draw when the switch is on and no theme was ever picked", () => {
    expect(pick({ board: "neutral", mine: true })).toEqual({ name: "neutral", source: "board" });
    expect(pick({ mine: true })).toEqual({ name: "paper", source: "default" });
  });

  it("draws the reader's theme on a board that asks for none, switch or not", () => {
    expect(pick({ chosen: "paper-dark" })).toEqual({ name: "paper-dark", source: "own" });
    expect(pick({ chosen: "paper-dark", mine: true })).toEqual({ name: "paper-dark", source: "mine" });
  });

  it("lets the address beat everything", () => {
    for (const mine of [false, true]) {
      expect(pick({ explicit: "paper", board: "neutral", chosen: "paper-dark", mine })).toEqual({
        name: "paper",
        source: "address",
      });
    }
  });

  it("skips a name no theme folder has, and falls to the next source", () => {
    expect(pick({ explicit: "gone", board: "neutral", chosen: "paper-dark" })).toEqual({ name: "neutral", source: "board" });
    expect(pick({ board: "gone", chosen: "paper-dark" })).toEqual({ name: "paper-dark", source: "own" });
    expect(pick({ board: "gone", chosen: "gone", mine: true })).toEqual({ name: "paper", source: "default" });
  });

  it("draws the default when nothing asks for anything", () => {
    expect(pick({})).toEqual({ name: "paper", source: "default" });
  });
});
