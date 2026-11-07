#!/usr/bin/env node
/**
 * Say a version in every file that carries it: `VERSION`, `package.json` and the root entry of
 * `package-lock.json`. What a release branch's version commit, the bump after a release and the
 * nightly's stamped commit all run, so none of them can forget the third file.
 *
 *   node scripts/set-version.mjs 0.3.0
 *   node scripts/set-version.mjs 0.2.0-beta.1
 *   node scripts/set-version.mjs 0.2.0-nightly.202611070230
 *
 * It writes only the version lines and refuses anything `scripts/lib/version.mjs` does
 * not call a version, so `check:version` passes on whatever it wrote.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseVersion } from "./lib/version.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const version = process.argv[2]?.replace(/^v/, "");
if (!version || !parseVersion(version)) {
  console.error(`set-version — "${process.argv[2] ?? ""}" is not a version (0.2.0, 0.2.0-beta.1 or 0.2.0-nightly.YYYYMMDDHHmm)`);
  process.exit(2);
}

function json(name, edit) {
  const file = path.join(root, name);
  const text = fs.readFileSync(file, "utf8");
  const data = JSON.parse(text);
  edit(data);
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
}

fs.writeFileSync(path.join(root, "VERSION"), `${version}\n`);
json("package.json", (p) => {
  p.version = version;
});
/* The lockfile is edited as text, never parsed and written back: `JSON.stringify` spells `\u2764`
   as the character, and a version bump would then rewrite lines that have nothing to do with it. */
const lock = path.join(root, "package-lock.json");
if (fs.existsSync(lock)) {
  const text = fs.readFileSync(lock, "utf8");
  const top = /^(  "version": ")[^"]*(",)$/m;
  const entry = /^(    "": \{\n(?:      .*\n)*?      "version": ")[^"]*(",)$/m;
  if (!top.test(text) || !entry.test(text)) {
    console.error("set-version — package-lock.json has no root version to set");
    process.exit(1);
  }
  fs.writeFileSync(lock, text.replace(top, `$1${version}$2`).replace(entry, `$1${version}$2`));
}
console.log(`set-version — ${version}`);
