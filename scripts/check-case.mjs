#!/usr/bin/env node
/**
 * No two tracked files may be one file on a case-insensitive disk — macOS's and Windows' default.
 *
 * Two kinds of pair. `Notes.md` beside `notes.md` cannot both exist there at all. And `trash.ts`
 * beside `Trash.tsx` can, but an import of `./Trash` is resolved by trying `.ts` before `.tsx`, and
 * on such a disk `Trash.ts` *is* `trash.ts` — so the bundler took the wrong module and the desktop
 * build failed on macOS and Windows while Linux, whose disk tells them apart, built clean. So a
 * path is compared lowercased, with a script extension taken off.
 */
import { execFileSync } from "node:child_process";

const SCRIPT = /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/i;
const files = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean);

// Keyed by the lowercased path with its script extension off; a pair is a clash only when the two
// differ by case somewhere — `x.ts` beside `x.mjs`, same spelling, is no problem on any disk.
const groups = new Map();
for (const f of files) {
  const key = f.replace(SCRIPT, "").toLowerCase();
  groups.set(key, [...(groups.get(key) ?? []), f]);
}
const unique = [...groups.values()].filter(
  (l) => new Set(l.map((f) => f.replace(SCRIPT, ""))).size > 1 || new Set(l.map((f) => f.toLowerCase())).size < l.length,
);

if (unique.length) {
  console.error("check:case — these name one file on macOS and Windows:");
  for (const l of unique) console.error(`  ${l.join("  ·  ")}`);
  process.exit(1);
}
console.log(`check:case — ${files.length} files, no two the same on a case-insensitive disk`);
