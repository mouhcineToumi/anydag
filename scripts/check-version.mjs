#!/usr/bin/env node
/**
 * The version is said in two files, and they must agree.
 *
 * `VERSION` is what the builds read (the server, the CLI, the shell, the page's About tab), and
 * `package.json`'s `version` is what electron-builder names a release by. Both are plain semver —
 * `MAJOR.MINOR.PATCH`, with an optional pre-release such as `0.2.0-beta.1` — and a release tag is
 * `v` and the same string (`.github/workflows/release.yml` refuses any other).
 *
 * With a tag as its argument (`node scripts/check-version.mjs v0.1.0`) it checks that too.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const file = fs.readFileSync(path.join(root, "VERSION"), "utf8").trim();
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version;
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

const problems = [];
if (!SEMVER.test(file)) problems.push(`VERSION is "${file}", which is not MAJOR.MINOR.PATCH`);
if (pkg !== file) problems.push(`package.json says ${pkg} and VERSION says ${file}`);
const tag = process.argv[2];
if (tag !== undefined && tag !== `v${file}`) problems.push(`the tag is ${tag} and VERSION says v${file}`);

if (problems.length) {
  for (const p of problems) console.error(`check:version — ${p}`);
  process.exit(1);
}
console.log(`check:version — ${file}${tag ? `, tagged ${tag}` : ""}`);
