import { describe, expect, it } from "vitest";

import { COMMANDS, GROUPS, REFUSED } from "../cli/commands";
import { find } from "../cli/main";
// @ts-expect-error — a plain `.mjs` with no types, as every script beside it
import { apiRoutes as readRoutes } from "../scripts/parity.mjs";

/** The API's routes, read out of its source — one reader, `scripts/parity.mjs`'s, shared with the parity check. */
const apiRoutes = (): string[] => readRoutes();

/**
 * **Everything a person can do, a terminal can** — held as a closed set rather than as a claim.
 *
 * The API's routes are read out of its own source by regex, the way `check-skill.mjs` reads the MCP
 * tools and `HUE_ORDER`: a list typed here would be the copy nobody updates. Every one of them is
 * reached by some command's `routes` or named in `REFUSED` with a reason — which is read out of
 * `docs/parity.json` — and every route a command claims to reach exists. So a route
 * added to the API with no way to it from here is a red test, and so is a command that goes on
 * declaring a route that was renamed. `test/parity.test.ts` is the same argument across all three
 * interfaces.
 */

describe("the CLI reaches the whole API", () => {
  const routes = apiRoutes();
  const reached = new Set(COMMANDS.flatMap((c) => c.routes));

  it("finds the API's routes at all", () => {
    /* A regex that matched nothing would make every assertion below vacuous. */
    expect(routes.length).toBeGreaterThan(30);
    expect(routes).toContain("POST /__board/patch");
    expect(routes).toContain("POST /api/vaults/open");
  });

  it("reaches every route, or refuses it with a reason", () => {
    const missing = routes.filter((r) => !reached.has(r) && !(r in REFUSED));
    expect(missing).toEqual([]);
  });

  it("declares no route the API does not have", () => {
    const phantom = [...reached, ...Object.keys(REFUSED)].filter((r) => !routes.includes(r));
    expect(phantom).toEqual([]);
  });

  it("refuses nothing it also reaches", () => {
    expect(Object.keys(REFUSED).filter((r) => reached.has(r))).toEqual([]);
  });
});

describe("the command table", () => {
  it("names every command once", () => {
    const names = COMMANDS.map((c) => c.name.join(" "));
    expect(names.filter((n, i) => names.indexOf(n) !== i)).toEqual([]);
  });

  it("files every command under a heading `anydag help` prints", () => {
    const headings = new Set(GROUPS.map((g) => g.name));
    expect(COMMANDS.filter((c) => !headings.has(c.group ?? c.name[0]!)).map((c) => c.name.join(" "))).toEqual([]);
  });

  it("finds the longest name, wherever the global flags are", () => {
    const hit = find(["--vault", "/tmp/v", "item", "ls", "demo", "--json"]);
    expect(hit && "command" in hit && hit.command.name).toEqual(["item", "ls"]);
    expect(hit && "command" in hit && hit.rest).toEqual(["--vault", "/tmp/v", "demo", "--json"]);
    const group = find(["node"]);
    expect(group).toEqual({ group: "node" });
    expect(find(["nonsense"])).toBeNull();
  });

  it("gives every flag a word of help and a type", () => {
    for (const c of COMMANDS) {
      expect(c.summary.length, c.name.join(" ")).toBeGreaterThan(10);
      for (const f of c.flags ?? []) expect(f.help.length, `${c.name.join(" ")} --${f.name}`).toBeGreaterThan(3);
    }
  });
});
