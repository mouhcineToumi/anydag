import { describe, expect, it } from "vitest";

import { UsageError, pairs, parseArgs, point, type FlagSpec } from "../cli/args";

const SPECS: FlagSpec[] = [
  { name: "at", type: "string", help: "where" },
  { name: "yes", short: "y", type: "boolean", help: "do not ask" },
  { name: "item", type: "list", help: "repeatable" },
];

describe("reading a command line", () => {
  it("reads a negative coordinate as a coordinate", () => {
    /* The reason this is not `node:util`'s parseArgs, which refuses both of these. */
    expect(parseArgs(["demo", "--at", "-40,80"], SPECS)).toEqual({ pos: ["demo"], flags: { at: "-40,80" } });
    expect(parseArgs(["demo", "-40"], SPECS).pos).toEqual(["demo", "-40"]);
    expect(parseArgs(["demo", "x=-3"], SPECS).pos).toEqual(["demo", "x=-3"]);
  });

  it("takes --name=value, a short boolean, a repeated list and a lone dash", () => {
    expect(parseArgs(["--at=1,2", "-y", "--item", "a", "--item", "b", "-"], SPECS)).toEqual({
      pos: ["-"],
      flags: { at: "1,2", yes: true, item: ["a", "b"] },
    });
  });

  it("stops at --", () => {
    expect(parseArgs(["--", "--at", "-y"], SPECS).pos).toEqual(["--at", "-y"]);
  });

  it("names the nearest flag when one is misspelt", () => {
    expect(() => parseArgs(["--itme", "x"], SPECS)).toThrow(/did you mean --item/);
    expect(() => parseArgs(["--at"], SPECS)).toThrow(UsageError);
    expect(() => parseArgs(["--yes=1"], SPECS)).toThrow(/takes no value/);
  });
});

describe("key=value, the way a fence line writes it", () => {
  it("reads numbers, flags, strings and a removal", () => {
    expect(pairs(["x=240", "y=-8", "hidden", "title=Payments API", "hue="])).toEqual({
      x: 240,
      y: -8,
      hidden: true,
      title: "Payments API",
      hue: null,
    });
  });

  it("refuses a pair with no key", () => {
    expect(() => pairs(["=3"])).toThrow(UsageError);
  });

  it("reads a point, and nothing that is not one", () => {
    expect(point("-40, 80.4")).toEqual({ x: -40, y: 80 });
    expect(() => point("40")).toThrow(/x,y/);
  });
});
