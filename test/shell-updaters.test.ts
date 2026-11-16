import fs from "node:fs";
import { fileURLToPath } from "node:url";

import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * **Shell's state updaters are pure** (#352). React runs an updater again while it renders — as soon
 * as a second update is waiting on the component — so a preference written inside one is written
 * during `Shell`'s render. `dag:prefs` then wakes the sidebar's own listener, which sets its state
 * from inside another component's render, and React logs *Cannot update a component (`Sidebar`)
 * while rendering a different component (`Shell`)*. Holding the rule needs no browser: no updater
 * handed to a `set…` may call a write of `settings/prefs`.
 */

const SHELL = fileURLToPath(new URL("../src/ui/Shell.tsx", import.meta.url));
const WRITES = new Set(["writePref", "writeFlag", "writeLocal"]);

/** `line: call` for every preference written inside an updater function, in source order. */
function preferenceWritesInUpdaters(file: string): string[] {
  const text = fs.readFileSync(file, "utf8");
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found: string[] = [];
  /* The updater's own body: a function written inside it runs when something calls it, not when
     React runs the updater, so it is not the hazard this holds. */
  const walk = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && WRITES.has(node.expression.text))
      found.push(`${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}: ${node.expression.text}`);
    ts.forEachChild(node, (child) => {
      if (ts.isArrowFunction(child) || ts.isFunctionExpression(child) || ts.isFunctionDeclaration(child)) return;
      walk(child);
    });
  };
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && /^set[A-Z]/.test(node.expression.text)) {
      const [updater] = node.arguments;
      if (updater && (ts.isArrowFunction(updater) || ts.isFunctionExpression(updater))) walk(updater.body ?? updater);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

describe("Shell's state updaters", () => {
  it("write no preference while React runs them", () => {
    expect(preferenceWritesInUpdaters(SHELL)).toEqual([]);
  });
});
