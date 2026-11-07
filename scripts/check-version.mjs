#!/usr/bin/env node
/**
 * The version is said in two files, and they must agree.
 *
 * `VERSION` is what the builds read (the server, the CLI, the shell, the page's About tab), and
 * `package.json`'s `version` is what electron-builder names a release by. Both are plain semver —
 * `MAJOR.MINOR.PATCH`, with an optional pre-release: `0.2.0-beta.1`, or a nightly,
 * `0.2.0-nightly.202611070230` (`scripts/lib/version.mjs` is the one list of the forms). A release
 * tag is `v` and the same string (`.github/workflows/release.yml` and `nightly.yml` refuse any other).
 *
 * With a tag as its argument (`node scripts/check-version.mjs v0.1.0`) it checks that too.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseVersion } from "./lib/version.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const file = fs.readFileSync(path.join(root, "VERSION"), "utf8").trim();
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version;

const problems = [];
const parsed = parseVersion(file);
if (!parsed)
  problems.push(`VERSION is "${file}", which is not MAJOR.MINOR.PATCH (with at most -beta.N or -nightly.YYYYMMDDHHmm after it)`);
if (pkg !== file) problems.push(`package.json says ${pkg} and VERSION says ${file}`);
const tag = process.argv[2];
if (tag !== undefined && tag !== `v${file}`) problems.push(`the tag is ${tag} and VERSION says v${file}`);

if (problems.length) {
  for (const p of problems) console.error(`check:version — ${p}`);
  process.exit(1);
}
console.log(`check:version — ${file} (${parsed.kind})${tag ? `, tagged ${tag}` : ""}`);
