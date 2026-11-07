import fs from "node:fs";
import { describe, expect, it } from "vitest";

import { COMMANDS, REFUSED } from "../cli/commands";
import { TOOLS } from "../server/mcp/tools";
// @ts-expect-error — a plain `.mjs` with no types, as every script beside it
import { MATRIX, apiRoutes, check, cliRefused, readManifest, render, shapeOf } from "../scripts/parity.mjs";

/**
 * **One feature surface, three interfaces**, held rather than claimed.
 *
 * `docs/parity.json` names every feature with the REST routes, CLI commands and MCP tools that reach
 * it. The three real surfaces are read here from the code rather than from a copy of it — the routes
 * out of `server/routes/` by regex, the tools off `TOOLS`, the commands off `COMMANDS` with the routes
 * each declares — and `check` holds the manifest to them both ways.
 */

const manifest = readManifest();
const surface = {
  rest: apiRoutes() as string[],
  cli: new Map(COMMANDS.map((c) => [c.name.join(" "), c.routes] as const)),
  mcp: TOOLS.map((t) => t.name),
};

describe("the manifest holds against the three surfaces", () => {
  it("finds all three at all", () => {
    /* A regex that matched nothing would make every assertion below vacuous. */
    expect(surface.rest.length).toBeGreaterThan(50);
    expect(surface.rest).toContain("GET /__board/search");
    expect(surface.mcp.length).toBeGreaterThan(70);
    expect(surface.mcp).toContain("note_read");
    expect(surface.cli.size).toBeGreaterThan(120);
  });

  it("has no problem: every route, command and tool is in a feature, every feature answers for all three", () => {
    expect(check(manifest, surface)).toEqual([]);
  });

  it("has no gap", () => {
    const gaps = (manifest.features as Record<string, unknown>[]).flatMap((f) =>
      (["rest", "cli", "mcp"] as const).filter((i) => shapeOf(f[i]).kind === "gap").map((i) => `${f.id} ${i}`),
    );
    expect(gaps).toEqual([]);
  });

  it("draws docs/PARITY.md, and the committed one is current", () => {
    expect(fs.readFileSync(MATRIX, "utf8")).toBe(render(manifest));
  });

  it("is what the CLI's REFUSED is read from", () => {
    expect(REFUSED).toEqual(cliRefused(manifest));
  });
});

/**
 * The rules themselves, on a manifest small enough to read — so a rule that stopped firing is a red
 * test here rather than a manifest that quietly stopped being checked.
 */
describe("check", () => {
  const small = (over: Record<string, unknown> = {}) => ({
    features: [{ id: "a.read", area: "A", what: "Read an a", rest: ["GET /a"], cli: ["a cat"], mcp: ["a_read"], ...over }],
  });
  const real = { rest: ["GET /a"], cli: new Map([["a cat", ["GET /a"]]]), mcp: ["a_read"] };

  it("passes a manifest that says exactly what there is", () => {
    expect(check(small(), real)).toEqual([]);
  });

  it("calls a missing interface a gap", () => {
    expect(check({ features: [{ id: "a.read", area: "A", what: "x", rest: ["GET /a"], cli: ["a cat"] }] }, { ...real, mcp: [] })).toEqual([
      expect.stringMatching(/`a.read` says nothing for MCP/),
    ]);
  });

  it("refuses a name that does not exist, and a real one no feature names", () => {
    expect(check(small({ mcp: ["a_reed"] }), real)).toEqual([
      expect.stringMatching(/names MCP `a_reed`, which does not exist/),
      expect.stringMatching(/MCP tool `a_read` is in no feature/),
    ]);
  });

  it("wants a reason for a refusal and for a `via`", () => {
    expect(check(small({ mcp: { refused: "no" } }), { ...real, mcp: [] })).toEqual([expect.stringMatching(/refusal needs a reason/)]);
    expect(check(small({ mcp: { via: ["a_read"] } }), real)).toEqual([expect.stringMatching(/`via` needs a `why`/)]);
  });

  it("ties a feature's commands to its routes", () => {
    const cli = new Map([["a cat", ["GET /b"]]]);
    expect(check(small(), { rest: ["GET /a", "GET /b"], cli, mcp: ["a_read"] })).toEqual([
      expect.stringMatching(/none of its commands \(a cat\) declares `GET \/a`/),
      expect.stringMatching(/REST route `GET \/b` is in no feature/),
      expect.stringMatching(/no command reaches `GET \/a`/),
    ]);
  });

  it("counts a route no command reaches as fine only where the CLI refuses it", () => {
    const refusing = { features: [{ id: "a.x", area: "A", what: "x", rest: ["GET /a"], cli: { refused: "a reason long enough to count" }, mcp: ["a_read"] }] };
    expect(check(refusing, { rest: ["GET /a"], cli: new Map(), mcp: ["a_read"] })).toEqual([]);
    expect(cliRefused(refusing)).toEqual({ "GET /a": "a reason long enough to count" });
  });
});

describe("render", () => {
  it("draws one table per area, and numbers every reason once", () => {
    const md = render({
      features: [
        { id: "a", area: "One", what: "First", rest: ["GET /a"], cli: ["a"], mcp: { refused: "the same reason, twice over" } },
        { id: "b", area: "Two", what: "Second", rest: ["GET /b"], cli: { refused: "the same reason, twice over" }, mcp: { via: ["x"], why: "something else entirely" } },
      ],
    });
    expect(md).toContain("**2 features, 0 gaps.**");
    expect(md).toContain("## One\n\n| Feature | REST | CLI | MCP |");
    expect(md).toContain("| First | `GET /a` | `a` | ✗ [1] |");
    expect(md).toContain("| Second | `GET /b` | ✗ [1] | ↳ `x` [2] |");
    expect(md).toContain("1. the same reason, twice over\n2. something else entirely\n");
  });
});
