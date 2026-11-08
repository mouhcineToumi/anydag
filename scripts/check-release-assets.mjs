#!/usr/bin/env node
/**
 * Everything a release must hold before it is published, checked against the version it claims:
 *
 *   node scripts/check-release-assets.mjs <dir> <version>
 *
 * The six installers (AppImage; the NSIS setup; a dmg and a zip for each macOS architecture), and
 * the three files the app's updater reads — named for the **channel** the version belongs to
 * (`scripts/lib/version.mjs`): `latest.yml`, `latest-linux.yml` and `latest-mac.yml` for a stable
 * release, `beta*.yml` for a beta, `nightly*.yml` for a nightly. Each update file must name this
 * version, and a prerelease must carry no `latest*.yml` at all: that is the file a stable build asks
 * for, and a stable user must never be offered a beta or a nightly.
 *
 * The names are the updater's URLs and electron-builder derives them (`desktop/electron-builder.yml`),
 * so this is also what notices a build that stopped producing one.
 */
import fs from "node:fs";
import path from "node:path";
import { parseVersion } from "./lib/version.mjs";

const [dir, raw] = process.argv.slice(2);
const version = raw?.replace(/^v/, "");
const parsed = version ? parseVersion(version) : null;
if (!dir || !parsed) {
  console.error("usage: check-release-assets.mjs <dir> <version>");
  process.exit(2);
}

const have = new Set(fs.readdirSync(dir));
const ch = parsed.channel;
const installers = [
  `AnyDag-${version}.AppImage`,
  `AnyDag-Setup-${version}.exe`,
  `AnyDag-${version}-arm64.dmg`,
  `AnyDag-${version}-x64.dmg`,
  `AnyDag-${version}-arm64.zip`,
  `AnyDag-${version}-x64.zip`,
];
const feeds = [`${ch}.yml`, `${ch}-linux.yml`, `${ch}-mac.yml`];

const problems = [];
for (const f of [...installers, ...feeds]) if (!have.has(f)) problems.push(`${f} is missing`);
for (const f of feeds) {
  if (!have.has(f)) continue;
  const said = /^version:\s*['"]?([^'"\s]+)['"]?\s*$/m.exec(fs.readFileSync(path.join(dir, f), "utf8"))?.[1];
  if (said !== version) problems.push(`${f} says version ${said ?? "(none)"}, not ${version}`);
}
if (ch !== "latest") {
  for (const f of have)
    if (/^latest.*\.yml$/.test(f)) problems.push(`${f} is in a ${parsed.kind} release — a stable build would be offered it`);
}

if (problems.length) {
  for (const p of problems) console.error(`::error::release assets — ${p}`);
  process.exit(1);
}
console.log(
  `release assets — ${version} (${parsed.kind}, channel ${ch}): ${installers.length} installers and ${feeds.join(", ")}`,
);
