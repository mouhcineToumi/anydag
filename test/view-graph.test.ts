import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * "Renders any note or board without loading the editor" — held to the import graph.
 *
 * A browser fetches exactly what a chunk reaches through **static** imports; a dynamic `import()` is
 * a chunk fetched only when that line runs, and `import type` is erased. The entry (`main.tsx`)
 * imports the page the address asks for — the read-only view (`ViewApp`) for `?view=1`, the canvas
 * (`App`) otherwise — dynamically, so walking the static graph from the entry and from `ViewApp`
 * answers what a `?view=1` page downloads before anything is drawn, and none of it may be the editor.
 *
 * A regex over the source rather than a bundler: the question is only which specifiers a file
 * names, and this answers it in milliseconds without a build.
 */
const ROOT = path.resolve(import.meta.dirname, "..");
const SRC = path.join(ROOT, "src");

function resolve(from: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = path.join(SRC, spec.slice(2));
  else if (spec.startsWith(".")) base = path.resolve(path.dirname(from), spec);
  else return null;
  for (const c of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts"), path.join(base, "index.tsx")])
    if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
  return null;
}

/** Every static, value-carrying import or re-export in a file: module paths, and bare packages. */
function staticImports(file: string): string[] {
  const text = fs
    .readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  const out: string[] = [];
  const re = /^\s*(import|export)\s+(type\s+)?([^'";]*?)\s*from\s*["']([^"']+)["']|^\s*import\s+["']([^"']+)["']/gm;
  for (const m of text.matchAll(re)) {
    if (m[5]) {
      out.push(m[5]);
      continue;
    }
    if (m[2]) continue; // `import type` / `export type`
    const clause = m[3] ?? "";
    /* `import { type A, type B }` carries no value either. */
    const named = /^\{([^}]*)\}$/.exec(clause.trim());
    if (named && named[1]!.split(",").every((p) => !p.trim() || p.trim().startsWith("type "))) continue;
    out.push(m[4]!);
  }
  return out;
}

function reach(entry: string): { files: Set<string>; packages: Set<string> } {
  const files = new Set<string>();
  const packages = new Set<string>();
  const stack = [entry];
  while (stack.length) {
    const f = stack.pop()!;
    if (files.has(f)) continue;
    files.add(f);
    if (!/\.tsx?$/.test(f)) continue;
    for (const spec of staticImports(f)) {
      const hit = resolve(f, spec);
      if (hit) stack.push(hit);
      else if (!spec.startsWith(".") && !spec.startsWith("@/")) packages.add(spec);
    }
  }
  return { files, packages };
}

const rel = (f: string) => path.relative(ROOT, f);

/** The specifiers a file asks for with a dynamic `import()`. */
function dynamicImports(file: string): string[] {
  return [...fs.readFileSync(file, "utf8").matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1]!);
}

describe("the read-only view's import graph", () => {
  const main = path.join(SRC, "main.tsx");
  const entry = reach(main);
  const view = reach(path.join(SRC, "view/ViewApp.tsx"));
  const files = new Set([...entry.files, ...view.files]);
  const packages = new Set([...entry.packages, ...view.packages]);
  const reached = [...files].map(rel);

  it("loads the view and the canvas as chunks of their own, so the entry carries neither", () => {
    expect(dynamicImports(main)).toEqual(expect.arrayContaining(["./view/ViewApp", "./App"]));
    const first = [...entry.files].map(rel);
    expect(first).not.toContain("src/view/ViewApp.tsx");
    expect(first).not.toContain("src/view/BoardView.tsx");
    expect(first).not.toContain("src/App.tsx");
  });

  it("reaches the view", () => {
    expect(reached).toContain("src/view/ViewApp.tsx");
    expect(reached).toContain("src/view/BoardView.tsx");
  });

  it("does not reach the canvas, the editor or the block editor", () => {
    expect(reached).not.toContain("src/App.tsx");
    expect(reached.filter((f) => f.startsWith("src/edit/") && f !== "src/edit/bindings.ts")).toEqual([]);
    expect(reached).not.toContain("src/blocks/BlockEditor.tsx");
    expect([...packages].filter((p) => p.startsWith("@blocknote/") || p.startsWith("@mantine/"))).toEqual([]);
  });

  it("finds the editor when it is asked from the canvas, so the walk itself is not blind", () => {
    const canvas = reach(path.join(SRC, "App.tsx")).files;
    expect([...canvas].map(rel)).toContain("src/edit/useEditor.ts");
  });

  it("does not fetch the view from the canvas", () => {
    expect([...reach(path.join(SRC, "App.tsx")).files].map(rel)).not.toContain("src/view/ViewApp.tsx");
  });
});
