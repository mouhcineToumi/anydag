import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { BINDINGS, bindingFor, LEADER_CODE, type Command } from "@/edit/bindings";

/**
 * The leader table, held to the three things a table of keys can silently get wrong.
 *
 * None of these is a hypothetical. A duplicate key shadows a command with no error anywhere — the
 * second entry is simply never found. A command with no key is a callback nothing can reach, and
 * the type system is happy either way, because the union and the array are not connected. And a
 * letter that is *also* still bare would mean two things at once, which is the exact defect
 * the leader key exists to close, reintroduced by the fix for it.
 *
 * `useEditor`'s own switch is what maps a command to a callback, and TypeScript's exhaustiveness
 * check on that switch is the other half: a command added here with no case there fails the build.
 */

/** The keys that deliberately did not move under the leader — see `bindings.ts`. */
const STILL_BARE = ["f", "0", "+", "-", "]", "[", "arrowleft", "arrowright", "arrowup", "arrowdown"];

describe("the leader table", () => {
  it("gives each key to exactly one command", () => {
    const keys = BINDINGS.map((b) => b.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("spells every key in the lower case `bindingFor` compares against", () => {
    for (const b of BINDINGS) expect(b.key).toBe(b.key.toLowerCase());
  });

  it("finds a binding whichever case the key arrived in", () => {
    expect(bindingFor("L")?.command).toBe("library");
    expect(bindingFor("l")?.command).toBe("library");
    expect(bindingFor("q")).toBeUndefined();
  });

  it("claims no key that stayed bare", () => {
    for (const b of BINDINGS) expect(STILL_BARE).not.toContain(b.key);
  });

  /*
   * Read out of the source rather than reflected off a value, because a TypeScript union leaves
   * nothing behind at runtime to iterate. The same move `check-theme.mjs` makes for `HUE_ORDER`
   * and `check-skill.mjs` for `FORMS`: the declaration is the list, and a regex is how a test
   * reaches one.
   */
  it("gives every command in the union a key", () => {
    const src = readFileSync(new URL("../src/edit/bindings.ts", import.meta.url), "utf8");
    const union = /export type Command =([^;]+);/.exec(src)?.[1];
    expect(union).toBeTruthy();
    const declared = [...union!.matchAll(/"([a-z]+)"/g)].map((m) => m[1] as Command);
    expect(declared.length).toBeGreaterThan(0);
    expect(new Set(BINDINGS.map((b) => b.command))).toEqual(new Set(declared));
  });

  it("opens on a physical key, so no keyboard layout can move it", () => {
    expect(LEADER_CODE).toBe("Space");
  });
});
