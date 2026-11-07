import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

import { parseBoard } from "@/board/parseBoard";
import { isDiagramType } from "@/board/types";
import { parseChart } from "@/dsl/chart";
import { CODES } from "@/dsl/codes";
import { diagnoseBoard, parseItem } from "@/dsl/diagnose";
import { parseDiagram } from "@/dsl/parse";
import { parseSequence } from "@/dsl/sequence";

/**
 * `diagnoseBoard` replaced a loop that lived inside the `/__board/diagnostics` route, and the route's
 * JSON is a contract — `snapshot.mjs`, `anydag snapshot` and the skill's fix loop all read it. So the
 * old loop is kept here, verbatim in what it computed, and the new function has to agree with it
 * byte for byte on every board in the repository.
 */
function before(name: string, text: string) {
  const board = parseBoard(name, text);
  const items = board.items
    .filter((it) => isDiagramType(it.type))
    .map((it) => {
      const model =
        it.type === "sequence"
          ? parseSequence(it.body)
          : it.type === "chart"
            ? parseChart(it.body)
            : parseDiagram(it.type, it.body, it.dir, it.aspect, it.layout);
      return {
        id: it.id,
        type: it.type,
        diagnostics: (model?.diagnostics ?? []).map((d) => ({ ...d, line: it.line + d.line })),
      };
    })
    .filter((x) => x.diagnostics.length > 0);
  const all = [...board.errors, ...items.flatMap((i) => i.diagnostics)];
  return {
    board: board.errors,
    items,
    errors: all.filter((d) => d.severity === "error").length,
    warnings: all.filter((d) => d.severity === "warn").length,
  };
}

const ROOT = path.resolve(__dirname, "../boards/local");
function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name.endsWith(".assets") ? [] : walk(p);
    return e.name.endsWith(".board.md") ? [p] : [];
  });
}

describe("diagnoseBoard", () => {
  it("says exactly what the route used to, on every board in the repository", () => {
    const files = walk(ROOT);
    expect(files.length).toBeGreaterThan(10);
    for (const file of files) {
      const name = path.relative(ROOT, file).replace(/\.board\.md$/, "");
      const text = fs.readFileSync(file, "utf8");
      expect(JSON.stringify(diagnoseBoard(parseBoard(name, text))), name).toBe(JSON.stringify(before(name, text)));
    }
  });

  it("reports a stray word in an `edges` fence against the board, at its line", () => {
    const text = [
      "---",
      'title: "test"',
      "---",
      "",
      "```edges {#links}",
      "y",
      "a --> b",
      "```",
      "",
      "```arch {#a x=0 y=0}",
      'store db "A"',
      "```",
      "",
      "```arch {#b x=400 y=0}",
      'store db "B"',
      "```",
      "",
    ].join("\n");
    const d = diagnoseBoard(parseBoard("t", text));
    expect(d.board.map((x) => [x.code, x.line])).toEqual([[CODES.EB_LINK_SYNTAX, 6]]);
    expect(d.items).toEqual([]);
    expect(d.errors).toBe(1);
  });

  it("rebases a diagram's lines onto the board file", () => {
    const text = ["```arch {#a}", 'service api "API"', "api --> ghost", "```", ""].join("\n");
    const d = diagnoseBoard(parseBoard("t", text));
    expect(d.items).toHaveLength(1);
    expect(d.items[0]!.diagnostics.map((x) => [x.code, x.line])).toEqual([[CODES.E_UNKNOWN_ID, 3]]);
  });

  it("hands the item to the callback it is given, so the page can answer from a cache", () => {
    const text = ["```arch {#a}", 'service api "API"', "```", "", "```md", "prose", "```", ""].join("\n");
    const asked: string[] = [];
    diagnoseBoard(parseBoard("t", text), (it) => (asked.push(it.id), []));
    /* Prose has no parser, so it is never asked about. */
    expect(asked).toEqual(["a"]);
  });
});

describe("parseItem", () => {
  it("dispatches by type and passes the fence's layout through", () => {
    expect(parseItem({ type: "md", body: "hello" })).toBeNull();
    expect(parseItem({ type: "sequence", body: "a -> b: hi" })?.kind).toBe("sequence");
    expect(parseItem({ type: "chart", body: "bar\nseries a 1 2" })?.kind).toBe("chart");
    /* `x=` is geometry in a fixed fence and a warning outside one: the argument has to arrive. */
    const loose = parseItem({ type: "arch", body: 'service a "A" x=8' })!;
    const fixed = parseItem({ type: "arch", body: 'service a "A" x=8', layout: "fixed" })!;
    expect(loose.diagnostics.map((d) => d.code)).toContain(CODES.W_UNKNOWN_ATTR);
    expect(fixed.diagnostics.map((d) => d.code)).not.toContain(CODES.W_UNKNOWN_ATTR);
  });
});
