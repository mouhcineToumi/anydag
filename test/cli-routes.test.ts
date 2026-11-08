import { describe, expect, it } from "vitest";

import { COMMANDS, GROUPS, OUTSIDE, REFUSED } from "../cli/commands";
import { find } from "../cli/main";
// @ts-expect-error — a plain `.mjs` with no types, as every script beside it
import { apiRoutes as readRoutes } from "../scripts/parity.mjs";

/** The API's routes, read out of its source — one reader, `scripts/parity.mjs`'s, shared with the parity check. */
const apiRoutes = (): string[] => readRoutes();

/**
 * **The admin CLI's routes are a closed set** — held rather than claimed.
 *
 * `anydag` is an admin tool: vaults, files as whole documents, the trash, sync, logs, pictures and
 * exports. It no longer mirrors the app (MCP does, in full), so a route is accounted for one of three
 * ways: some command's `routes` reach it, `REFUSED` refuses it with a reason, or `OUTSIDE` says every
 * feature holding it is outside the admin CLI (`{"admin": false}` in `docs/parity.json`).
 *
 * The API's routes are read out of its own source by regex, the way `check-skill.mjs` reads the MCP
 * tools and `HUE_ORDER`: a list typed here would be the copy nobody updates. So a route added to the
 * API that the manifest does not place is a red test, and so is a command that goes on declaring a
 * route that was renamed. `test/parity.test.ts` is the same argument across all three interfaces.
 */

describe("the CLI accounts for the whole API", () => {
  const routes = apiRoutes();
  const reached = new Set(COMMANDS.flatMap((c) => c.routes));

  it("finds the API's routes at all", () => {
    /* A regex that matched nothing would make every assertion below vacuous. */
    expect(routes.length).toBeGreaterThan(30);
    expect(routes).toContain("POST /__board/patch");
    /* The admin CLI does not edit inside a board: that is the page's and MCP's. */
    expect(OUTSIDE).toContain("POST /__board/patch");
    expect(routes).toContain("POST /api/vaults/open");
  });

  it("reaches every route, refuses it with a reason, or places it outside the admin CLI", () => {
    const missing = routes.filter((r) => !reached.has(r) && !(r in REFUSED) && !OUTSIDE.includes(r));
    expect(missing).toEqual([]);
  });

  it("declares no route the API does not have", () => {
    const phantom = [...reached, ...Object.keys(REFUSED), ...OUTSIDE].filter((r) => !routes.includes(r));
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
    const hit = find(["--vault", "/tmp/v", "board", "cat", "demo", "--json"]);
    expect(hit && "command" in hit && hit.command.name).toEqual(["board", "cat"]);
    expect(hit && "command" in hit && hit.rest).toEqual(["--vault", "/tmp/v", "demo", "--json"]);
    const group = find(["table"]);
    expect(group).toEqual({ group: "table" });
    expect(find(["nonsense"])).toBeNull();
    /* What the admin CLI dropped is no command at all. */
    expect(find(["item", "ls"])).toBeNull();
    expect(find(["node"])).toBeNull();
  });

  it("gives every flag a word of help and a type", () => {
    for (const c of COMMANDS) {
      expect(c.summary.length, c.name.join(" ")).toBeGreaterThan(10);
      for (const f of c.flags ?? []) expect(f.help.length, `${c.name.join(" ")} --${f.name}`).toBeGreaterThan(3);
    }
  });
});
