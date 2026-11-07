#!/usr/bin/env node
/**
 * Converts the official AWS, Azure and GCP icon packs into one normalized, IconifyJSON-shaped
 * bundle: `icons/data/vendor.json`, plus `icons/vendor-slugs.json` — a human-reviewable map of
 * "which source file did this slug come from, and why" that a person can hand-correct and that
 * survives a rebuild (see loadSlugMap/resolveNaming below).
 *
 * Run with `node scripts/icons/vendor.mjs [--packs <dir>]`. Consumed by `scripts/icons/build.mjs`,
 * which merges `icons` into its `color` bucket for any name a CC0 source (`logos`/`simple-icons`)
 * doesn't already cover — see that file's own header. This script only produces the long tail; it
 * has no opinion about which of its icons actually ship.
 *
 * Why full colour, unmodified: these are the vendors' own trademarked artwork, licensed for
 * "reference use" / "no derivatives", not ours to recolour. `check-literals.mjs` bans colour under
 * `src/` for the opposite reason — a colour a theme cannot reach is a colour the design system
 * doesn't own — so this data deliberately lives in `icons/`, outside that rule's scan, and
 * `Icon.tsx` draws it on a neutral tile rather than tinting it. Never add a recolour/reshape step
 * here; see "The constraint that shapes the code" in `icons/README.md`.
 *
 * Deliberately does NOT run svgo's `prefixIds` plugin, despite gradient/mask ids being a real
 * collision risk when several icons land in one document (Azure ships `<linearGradient id=…>` per
 * icon). `Icon.tsx` already solves this, and more completely: it calls `replaceIDs()` per mounted
 * *instance*, not per icon, which is the only thing that also covers the same icon appearing twice
 * on one board — a build-time, per-slug prefix cannot, since both instances would still share it.
 * Its own header spells this out: "Rewriting the ids once at build time would not help — every
 * instance would still share them." Prefixing here as well would cost nothing at runtime (whatever
 * id ships gets replaced anyway) but would contradict that comment for no benefit, so it's skipped.
 */
import { optimize } from "svgo";
import { parseSVGContent, convertParsedSVG } from "@iconify/utils";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/* The four vendor zips, which are NOT committed — they are large, and their terms are about use in
 * diagrams rather than redistribution, so the repo carries the normalized output and not the packs.
 * `icons/.packs/` is gitignored; `icons/README.md` lists the four download URLs. Anyone refreshing
 * the packs (AWS ships quarterly) drops the zips there and re-runs, or passes --packs elsewhere. */
const DEFAULT_PACKS = path.join(root, "icons", ".packs");

function parseArgs(argv) {
  let packs = DEFAULT_PACKS;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--packs") packs = argv[++i];
  }
  return { packs };
}

/* -------------------------------------------------------------------------------------------- *
 * Generic name -> slug helpers.
 *
 * Deliberately no camelCase splitting anywhere. GCP's own folder names ("Cloud Run", "BigQuery",
 * "Security Command Center") already carry the word boundaries a splitter would otherwise have to
 * guess at — and guessing is exactly how "BigQuery" would come out as "big-query" while "Cloud Run"
 * needs the opposite treatment. There is no single splitting rule that gets both right, so the rule
 * here is: never split, and read boundary information from wherever the pack already states it
 * (see buildGcp below, which reads the folder name rather than the squashed filename).
 * -------------------------------------------------------------------------------------------- */
function slugify(text) {
  return text
    .replace(/[^A-Za-z0-9]+/g, "-")
    .toLowerCase()
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

const titleFromHyphenated = (text) => text.replace(/-/g, " ").trim();
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/* AWS ships two icon families with the size/variant tokens in opposite orders:
 *   service icons: <Name>_<Dark|Light>_<size>   e.g. AWS-Marketplace_Dark_48
 *   group icons:   <Name>_<size>_<Dark|Light>   e.g. AWS-Cloud_32_Dark
 * so rather than assume one order, try both explicitly and fall back to "just a size suffix". A
 * light/dark variant is real information (it's a different piece of art), not noise to discard —
 * it becomes a `-dark`/`-light` slug suffix rather than being stripped, which is also what stops
 * "AWS-Cloud" and "AWS-Cloud_Dark" from colliding on the same slug (see resolveCollisions). */
function stripSizeAndVariant(name) {
  let m = name.match(/^(.*)[_-](dark|light)[_-]\d+$/i);
  if (m) return { base: m[1], variant: m[2].toLowerCase() };
  m = name.match(/^(.*)[_-]\d+[_-](dark|light)$/i);
  if (m) return { base: m[1], variant: m[2].toLowerCase() };
  m = name.match(/^(.*)[_-]\d+$/);
  if (m) return { base: m[1], variant: null };
  return { base: name, variant: null };
}

function stripVendorPrefix(name, prefixes) {
  for (const prefix of prefixes) {
    if (name.startsWith(prefix)) return { rest: name.slice(prefix.length), word: prefix.replace(/-$/, "").toLowerCase() };
  }
  return { rest: name, word: null };
}

/*
 * Abbreviations judged "genuinely well-known" — by what a diagram author would actually type, not
 * by string length. Everything not listed here keeps its full descriptive slug, which is the safer
 * default when a shortening isn't obviously correct.
 *
 * Cross-checked against `icons/manifest.json`'s existing `cloud` entries (built separately, from
 * the CC0 `logos` set, by the process that also wrote `scripts/icons/build.mjs`): where that list
 * already treats an AWS service as NOT worth abbreviating (`certificate-manager`, `systems-manager`
 * ship there under their full names, not `acm`/`ssm`), this dictionary follows suit — a different
 * shortening for the same service would not break anything (`build.mjs` prefers the CC0 entry by
 * exact name match either way), but it would leave two near-duplicate names for one concept for no
 * reason. Conversely `s3`, `eks`, `ecs`, `iam`, `kms`, `sns`, `sqs`, `ses`, `vpc`, `elb` and `msk`
 * below were each independently derived here and then found to already match that list exactly —
 * good evidence the "well-known" test is doing its job rather than being a personal guess. `s3`,
 * `route53` and `xray` matter regardless of that cross-check: they are how the services are
 * actually written everywhere outside a filename.
 */
const AWS_ABBR = {
  "simple-storage-service": "s3",
  "simple-storage-service-glacier": "s3-glacier",
  "elastic-kubernetes-service": "eks",
  "elastic-container-service": "ecs",
  "elastic-container-registry": "ecr",
  "elastic-block-store": "ebs",
  "identity-and-access-management": "iam",
  "key-management-service": "kms",
  "simple-notification-service": "sns",
  "simple-queue-service": "sqs",
  "simple-email-service": "ses",
  "virtual-private-cloud": "vpc",
  "elastic-load-balancing": "elb",
  "database-migration-service": "dms",
  "managed-streaming-for-apache-kafka": "msk",
  "cloud-development-kit": "cdk",
  "command-line-interface": "cli",
  "managed-workflows-for-apache-airflow": "mwaa",
  "elastic-disaster-recovery": "drs",
  "elastic-fabric-adapter": "efa",
  "opensearch-service": "opensearch",
  "route-53": "route53",
  "x-ray": "xray",
};

/* Azure has no equivalent precedent in manifest.json yet (its `cloud` list carries zero `azure:`
 * entries today — the CC0 sets this codebase uses have weak Azure coverage), so every one of these
 * is this script's own call, not a cross-check. */
const AZURE_ABBR = {
  "function-apps": "functions",
  "kubernetes-services": "aks",
  "storage-accounts": "storage",
  "virtual-machine": "vm",
  "key-vaults": "key-vault",
  "app-services": "app-service",
  "api-management-services": "api-management",
  "container-instances": "aci",
};

function abbreviate(dict, descriptiveSlug, vendorWord) {
  const short = dict[descriptiveSlug];
  if (!short) return { slug: descriptiveSlug, aliases: [] };
  const aliases = [descriptiveSlug];
  if (vendorWord) aliases.push(`${vendorWord}-${short}`);
  return { slug: short, aliases };
}

/* -------------------------------------------------------------------------------------------- *
 * Zip extraction.
 *
 * Node has no built-in zip reader and this build adds no dependency for one (svgo and
 * @iconify/utils are the only additions it came with). `unzip` is on every machine that could plausibly run this —
 * someone had to look inside these packs to write the rules above in the first place. Extracted
 * into the OS temp dir, never the repo and never the packs dir itself, and removed in `main`'s
 * `finally` so a re-run doesn't accumulate copies.
 * -------------------------------------------------------------------------------------------- */
function extractZip(zipPath, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  try {
    execFileSync("unzip", ["-o", "-q", zipPath, "-d", destDir]);
  } catch (err) {
    if (err.code === "ENOENT") {
      throw new Error("`unzip` is not on PATH — install it and re-run.");
    }
    throw err;
  }
}

const JUNK_BASENAMES = new Set([".DS_Store", "Thumbs.db"]);
function isJunk(absPath) {
  const parts = absPath.split(path.sep);
  if (parts.includes("__MACOSX")) return true;
  const base = parts[parts.length - 1];
  return JUNK_BASENAMES.has(base) || base.startsWith("._");
}

function walkSvgs(dir) {
  const out = [];
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop();
    for (const entry of fs.readdirSync(cur, { withFileTypes: true })) {
      const full = path.join(cur, entry.name);
      if (isJunk(full)) continue;
      if (entry.isDirectory()) stack.push(full);
      else if (/\.svg$/i.test(entry.name)) out.push(full);
    }
  }
  return out;
}

function hashFile(absPath) {
  return crypto.createHash("sha1").update(fs.readFileSync(absPath)).digest("hex");
}

function relSlashes(from, to) {
  return path.relative(from, to).split(path.sep).join("/");
}

/* -------------------------------------------------------------------------------------------- *
 * Hand corrections. `icons/vendor-slugs.json` is keyed by the FINAL slug and records which source
 * file it came from; this builds the reverse index (file -> slug/title/aliases) so a rebuild can
 * look a freshly-scanned file up by identity and keep whatever a person already corrected, rather
 * than recomputing and clobbering it. A file this map doesn't know about (new in the pack, or
 * never hand-corrected) falls through to fresh derivation below.
 * -------------------------------------------------------------------------------------------- */
function loadSlugMap(mapPath) {
  const reverse = new Map();
  if (!fs.existsSync(mapPath)) return reverse;
  const data = JSON.parse(fs.readFileSync(mapPath, "utf8"));
  for (const [slug, entry] of Object.entries(data)) {
    if (entry?.file) reverse.set(entry.file, { slug, title: entry.title, aliases: entry.aliases });
  }
  return reverse;
}

function resolveNaming(reverseMap, fileTag, fresh) {
  const hand = reverseMap.get(fileTag);
  if (!hand) return fresh;
  const colon = hand.slug.indexOf(":");
  const slugBody = colon >= 0 ? hand.slug.slice(colon + 1) : hand.slug;
  return { slugBody, title: hand.title ?? fresh.title, aliases: hand.aliases ?? fresh.aliases };
}

/* -------------------------------------------------------------------------------------------- *
 * Per-vendor entry builders. Each returns entries shaped
 *   { packTag, fileTag, relPath, absPath, category, slugBody, title, aliases }
 * with slugBody not yet vendor-prefixed or collision-resolved — resolveCollisions (below) does
 * that once, uniformly, across all five sources.
 * -------------------------------------------------------------------------------------------- */

function buildAwsService(awsRoot, reverseMap) {
  /* The zip's top level has one directory per icon family (services, groups, resource icons,
     category icons); find the services one by name rather than assuming it's the only entry, since
     `awsRoot` also holds Resource-Icons and Category-Icons — the two families this build skips
     (too many, low value). One level below that is a directory per AWS category
     (`Arch_Compute`, `Arch_Analytics`, …), each holding a `48/` folder of the actual icons. */
  const familyDir = fs
    .readdirSync(awsRoot, { withFileTypes: true })
    .find((e) => e.isDirectory() && /^Architecture-Service-Icons/.test(e.name));
  if (!familyDir) throw new Error(`no Architecture-Service-Icons* directory under ${awsRoot}`);
  const familyPath = path.join(awsRoot, familyDir.name);
  const catDirs = fs
    .readdirSync(familyPath, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();

  /* Group by basename first: two services in this pack (Kinesis Video Streams, Compute Optimizer)
     are filed under two categories each with genuinely different artwork (a different background
     tint per category) behind the same filename — see the report this script prints. Grouping
     before assigning names is what lets resolveCollisions notice and suffix them deterministically
     instead of silently keeping whichever one the filesystem happened to list last. */
  const grouped = new Map();
  for (const cat of catDirs) {
    const dir48 = path.join(familyPath, cat, "48");
    if (!fs.existsSync(dir48)) continue;
    for (const f of fs.readdirSync(dir48).filter((f) => /\.svg$/i.test(f)).sort()) {
      if (!grouped.has(f)) grouped.set(f, []);
      grouped.get(f).push({ category: cat, absPath: path.join(dir48, f) });
    }
  }

  const entries = [];
  for (const basename of [...grouped.keys()].sort()) {
    const occurrences = grouped.get(basename).sort((a, b) => a.category.localeCompare(b.category));
    for (const occ of occurrences) {
      const relPath = `${occ.category}/48/${basename}`;
      const fileTag = `aws-service:${relPath}`;
      const stem = basename.replace(/\.svg$/i, "").replace(/^Arch_/, "");
      const { base, variant } = stripSizeAndVariant(stem);
      const { rest, word } = stripVendorPrefix(base, ["Amazon-", "AWS-"]);
      const descriptive = slugify(rest);
      const { slug: shortSlug, aliases } = abbreviate(AWS_ABBR, descriptive, word);
      const fresh = {
        slugBody: variant ? `${shortSlug}-${variant}` : shortSlug,
        title: titleFromHyphenated(base) + (variant ? ` (${cap(variant)})` : ""),
        aliases,
      };
      entries.push({
        packTag: "aws-service",
        fileTag,
        relPath,
        absPath: occ.absPath,
        /* Strip "Arch_" here too — it's the same vendor noise as on the filenames, and this value
           only ever surfaces as a collision-suffix (see resolveCollisions), where a reader wants
           "management-tools", not "arch-management-tools". */
        category: occ.category.replace(/^Arch_/, ""),
        ...resolveNaming(reverseMap, fileTag, fresh),
      });
    }
  }
  return entries;
}

function buildAwsGroup(awsRoot, reverseMap) {
  const dirs = fs
    .readdirSync(awsRoot, { withFileTypes: true })
    .filter((e) => e.isDirectory() && /^Architecture-Group-Icons/.test(e.name))
    .map((e) => e.name);

  const entries = [];
  for (const dirName of dirs) {
    for (const absPath of walkSvgs(path.join(awsRoot, dirName)).sort()) {
      const relPath = relSlashes(awsRoot, absPath);
      const fileTag = `aws-group:${relPath}`;
      const stem = path.basename(absPath).replace(/\.svg$/i, "");
      const { base, variant } = stripSizeAndVariant(stem);
      const { rest } = stripVendorPrefix(base, ["AWS-", "Amazon-"]);
      const descriptive = slugify(rest);
      /* Group icons are boundary/backdrop art (a VPC outline, a region box, an account frame) —
         AWS doesn't have well-known short names for these the way it does for services, so no
         abbreviation dictionary applies here; the descriptive slug is already what it should be. */
      const fresh = {
        slugBody: variant ? `${descriptive}-${variant}` : descriptive,
        title: titleFromHyphenated(base) + (variant ? ` (${cap(variant)})` : ""),
        aliases: [],
      };
      entries.push({
        packTag: "aws-group",
        fileTag,
        relPath,
        absPath,
        category: null,
        ...resolveNaming(reverseMap, fileTag, fresh),
      });
    }
  }
  return entries;
}

function makeAzureEntry(occ, reverseMap) {
  const relPath = occ.relPath;
  const fileTag = `azure:${relPath}`;
  const stem = path.basename(occ.absPath).replace(/\.svg$/i, "").replace(/^\d+-icon-service-/i, "");
  const { rest, word } = stripVendorPrefix(stem, ["Azure-"]);
  const descriptive = slugify(rest);
  const { slug: shortSlug, aliases } = abbreviate(AZURE_ABBR, descriptive, word);
  const fresh = { slugBody: shortSlug, title: titleFromHyphenated(stem), aliases };
  return {
    packTag: "azure",
    fileTag,
    relPath,
    absPath: occ.absPath,
    category: occ.category,
    ...resolveNaming(reverseMap, fileTag, fresh),
  };
}

function buildAzure(azureRoot, reverseMap) {
  const groups = new Map();
  for (const absPath of walkSvgs(azureRoot)) {
    const basename = path.basename(absPath);
    const occ = { absPath, relPath: relSlashes(azureRoot, absPath), category: path.basename(path.dirname(absPath)) };
    if (!groups.has(basename)) groups.set(basename, []);
    groups.get(basename).push(occ);
  }

  const entries = [];
  const duplicates = [];
  for (const basename of [...groups.keys()].sort()) {
    const occurrences = groups.get(basename).sort((a, b) => a.category.localeCompare(b.category));
    if (occurrences.length > 1) {
      const hashes = occurrences.map((o) => hashFile(o.absPath));
      const allIdentical = hashes.every((h) => h === hashes[0]);
      if (allIdentical) {
        /* Azure genuinely files the same SVG under every category it belongs to — Cosmos DB is
           filed under both "iot" and "databases" verbatim, byte for byte. Keeping every copy would
           mean a slug collision with zero new information (it's not "two icons that happen to
           share a name", it's one icon with two addresses), so this keeps exactly the
           alphabetically-first category's copy and reports the rest as duplicates rather than
           collisions. */
        duplicates.push({ basename, categories: occurrences.map((o) => o.category) });
        entries.push(makeAzureEntry(occurrences[0], reverseMap));
        continue;
      }
      /* Same filename, different artwork under it — a real collision, not a duplicate. Every
         occurrence becomes its own entry and resolveCollisions gives the later ones a
         category-derived suffix. (Not observed in this pack; AWS has this case, Azure doesn't —
         handled the same way regardless, since a future refresh of either pack could produce it.) */
      for (const occ of occurrences) entries.push(makeAzureEntry(occ, reverseMap));
      continue;
    }
    entries.push(makeAzureEntry(occurrences[0], reverseMap));
  }
  return { entries, duplicates };
}

/*
 * GCP's `<Product>/SVG/<Name>-512-color[-rgb].svg` layout repeats for both packs (19 core products,
 * 26 categories); `categoryPrefix` is the only difference, so one function builds both.
 */
function buildGcp(gcpRoot, packTag, categoryPrefix, reverseMap) {
  const entries = [];
  for (const absPath of walkSvgs(gcpRoot)) {
    const relPath = relSlashes(gcpRoot, absPath);
    const parts = relPath.split("/");
    const svgIdx = parts.lastIndexOf("SVG");
    const productFolder = svgIdx > 0 ? parts[svgIdx - 1] : path.basename(path.dirname(absPath));
    const fileTag = `${packTag}:${relPath}`;

    /* This pack mangled "&" into "_" in exactly one folder name ("AI _ Machine Learning"); every
       other "&" category ("Hybrid & Multicloud", "Maps & Geospatial", "Web & Mobile") kept the real
       character. Restoring it only for a lone underscore between spaces fixes the one mangled case
       without guessing at any other folder. */
    const title = productFolder.replace(/\s+_\s+/g, " & ");
    const descriptive = slugify(title);
    const slugBody = categoryPrefix ? `${categoryPrefix}${descriptive}` : descriptive;

    /* A secondary alias: the vendor's own squashed filename (CloudRun, SecOps, AIHypercomputer),
       stripped of the "-512-color[-rgb]" suffix and every remaining separator. Worth keeping
       because it's a second string some author might genuinely type (GCP itself abbreviates
       "Security Operations" to "SecOps" in the filename, which this alias captures for free), and
       cheap to add: only kept when it actually differs from the slug we already chose. */
    const squashed = path
      .basename(absPath)
      .replace(/\.svg$/i, "")
      .replace(/-512-color(-rgb)?$/i, "")
      .replace(/[^A-Za-z0-9]+/g, "")
      .toLowerCase();
    const aliases = squashed && squashed !== slugBody ? [squashed] : [];

    const fresh = { slugBody, title, aliases };
    entries.push({
      packTag,
      fileTag,
      relPath,
      absPath,
      category: null,
      ...resolveNaming(reverseMap, fileTag, fresh),
    });
  }
  return entries;
}

/* -------------------------------------------------------------------------------------------- *
 * Collision resolution, uniform across every source.
 *
 * Two failure modes land here: a real AWS variant/category duplicate (see buildAwsService), or —
 * in principle, not observed in these four packs — a fresh-derivation collision where two
 * differently-named files abbreviate to the same slug. Both get a category-derived suffix first
 * (the only distinguishing information actually on hand), falling back to a numeric one if that
 * still collides or isn't available.
 * -------------------------------------------------------------------------------------------- */
function vendorOf(packTag) {
  if (packTag.startsWith("aws")) return "aws";
  if (packTag === "azure") return "azure";
  if (packTag.startsWith("gcp")) return "gcp";
  throw new Error(`unknown pack tag: ${packTag}`);
}

function assignSlug(registry, vendor, wantedBody, sourceKey, collisions, fallbackSuffix) {
  const key = (body) => `${vendor}:${body}`;
  if (!registry.has(key(wantedBody))) {
    registry.set(key(wantedBody), sourceKey);
    return wantedBody;
  }
  const attempts = [];
  if (fallbackSuffix) attempts.push(`${wantedBody}-${fallbackSuffix}`);
  for (let n = 2; attempts.length < 6; n++) attempts.push(`${wantedBody}-${n}`);
  for (const candidate of attempts) {
    if (!registry.has(key(candidate))) {
      registry.set(key(candidate), sourceKey);
      collisions.push({ vendor, wanted: wantedBody, resolved: candidate, file: sourceKey });
      return candidate;
    }
  }
  throw new Error(`could not find a free slug for ${vendor}:${wantedBody} (${sourceKey})`);
}

function resolveCollisions(allEntries) {
  const registry = new Map();
  const collisions = [];
  const finalized = allEntries.map((e) => {
    const vendor = vendorOf(e.packTag);
    const fallbackSuffix = e.category ? slugify(e.category) : null;
    const body = assignSlug(registry, vendor, e.slugBody, e.fileTag, collisions, fallbackSuffix);
    return { ...e, vendor, slug: `${vendor}:${body}` };
  });
  return { finalized, collisions };
}

/* -------------------------------------------------------------------------------------------- *
 * SVG normalization.
 * -------------------------------------------------------------------------------------------- */
function processSvg(absPath, slug) {
  let raw = fs.readFileSync(absPath, "utf8");

  /* One Azure file — "Foundry Control Plane", evidently a very recent addition — ships with
     `xviewBox="…"` instead of `viewBox="…"`, a typo in Microsoft's own file (verified: the only
     occurrence across all four packs). Left alone it has no viewBox at all and nothing downstream
     can size it. This restores the attribute name the file clearly meant to have; it doesn't touch
     any drawn geometry, so it isn't the kind of redraw the vendor terms forbid. */
  if (!/\sviewBox="/.test(raw) && /\sxviewBox="/.test(raw)) {
    raw = raw.replace(/\sxviewBox="/, ' viewBox="');
  }

  const result = optimize(raw, {
    multipass: true,
    /* `preset-default` no longer includes `removeViewBox` as of svgo v4 (a viewBox now always
       survives), so there is nothing to override there any more; passing that override anyway
       just makes svgo warn on every single file. `cleanupIds: false` is kept: it stops the preset
       from shortening every id to `a`/`b`/`c`, which matters because ids are meaningful for
       debugging ("which `<g>` is the background tint") even though nothing downstream reads them
       by name — `Icon.tsx` replaces every id at render time anyway (see the file header). */
    plugins: [{ name: "preset-default", params: { overrides: { cleanupIds: false } } }],
  });

  const parsed = parseSVGContent(result.data);
  if (!parsed) throw new Error(`svgo output didn't parse as SVG for ${slug} (${absPath})`);
  const icon = convertParsedSVG(parsed);
  if (!icon) throw new Error(`no usable viewBox for ${slug} (${absPath})`);

  const out = { body: icon.body, width: icon.width, height: icon.height };
  if (icon.left) out.left = icon.left;
  if (icon.top) out.top = icon.top;
  return out;
}

/* -------------------------------------------------------------------------------------------- */

function report({ awsServiceEntries, awsGroupEntries, azureEntries, azureDuplicates, gcpCoreEntries, gcpCatEntries, collisions, outPath }) {
  const size = fs.statSync(outPath).size;
  const kib = (n) => `${(n / 1024).toFixed(1)} KiB`;

  console.log(`aws:   ${awsServiceEntries.length} service + ${awsGroupEntries.length} group = ${awsServiceEntries.length + awsGroupEntries.length}`);
  console.log(
    `azure: ${azureEntries.length} unique icons` +
      (azureDuplicates.length ? ` (${azureDuplicates.length} filenames cross-listed under multiple categories with identical artwork, deduped)` : ""),
  );
  console.log(`gcp:   ${gcpCoreEntries.length} core + ${gcpCatEntries.length} category = ${gcpCoreEntries.length + gcpCatEntries.length}`);
  console.log(`total: ${awsServiceEntries.length + awsGroupEntries.length + azureEntries.length + gcpCoreEntries.length + gcpCatEntries.length} icons`);
  console.log(`output: ${outPath} (${kib(size)})`);

  if (collisions.length) {
    console.log(`\n${collisions.length} slug collision(s), resolved with a distinguishing suffix:`);
    for (const c of collisions) console.log(`  ${c.vendor}:${c.wanted}  ->  ${c.vendor}:${c.resolved}   (${c.file})`);
  } else {
    console.log("\nno slug collisions.");
  }
}

function main() {
  const { packs } = parseArgs(process.argv.slice(2));
  const zips = {
    aws: path.join(packs, "aws.zip"),
    azure: path.join(packs, "azure.zip"),
    "gcp-core": path.join(packs, "gcp-core.zip"),
    "gcp-cat": path.join(packs, "gcp-cat.zip"),
  };
  /*
   * No packs is the normal case, not an error.
   *
   * `icons/data/vendor.json` is committed and the zips are not, so a fresh clone has everything it
   * needs to build and boot — this step only has work to do when someone is actually refreshing the
   * artwork. Failing here would break `npm run icons:build` for everyone who merely wanted to add a
   * CC0 brand, which is the common reason to run it. Missing packs *and* no previous output is the
   * one case that is genuinely wrong.
   */
  const missing = Object.values(zips).filter((p) => !fs.existsSync(p));
  if (missing.length) {
    const out = path.join(root, "icons", "data", "vendor.json");
    if (fs.existsSync(out)) {
      console.log(`vendor: no packs in ${path.relative(root, packs)}/ — keeping the committed vendor.json`);
      console.log(`        (to refresh, put the four zips there; the URLs are in icons/README.md)`);
      return;
    }
    console.error(`missing pack(s):\n${missing.map((p) => `  ${p}`).join("\n")}`);
    console.error(`\nDownload the four zips into ${path.relative(root, packs)}/ — URLs in icons/README.md`);
    console.error(`or point elsewhere with --packs <dir>.`);
    process.exit(1);
  }

  const slugMapPath = path.join(root, "icons", "vendor-slugs.json");
  const reverseMap = loadSlugMap(slugMapPath);

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "dag-icons-"));
  try {
    const awsRoot = path.join(workDir, "aws");
    const azureRoot = path.join(workDir, "azure");
    const gcpCoreRoot = path.join(workDir, "gcp-core");
    const gcpCatRoot = path.join(workDir, "gcp-cat");
    extractZip(zips.aws, awsRoot);
    extractZip(zips.azure, azureRoot);
    extractZip(zips["gcp-core"], gcpCoreRoot);
    extractZip(zips["gcp-cat"], gcpCatRoot);

    const awsServiceEntries = buildAwsService(awsRoot, reverseMap);
    const awsGroupEntries = buildAwsGroup(awsRoot, reverseMap);
    const { entries: azureEntries, duplicates: azureDuplicates } = buildAzure(azureRoot, reverseMap);
    const gcpCoreEntries = buildGcp(gcpCoreRoot, "gcp-core", "", reverseMap);
    const gcpCatEntries = buildGcp(gcpCatRoot, "gcp-cat", "cat-", reverseMap);

    const allEntries = [...awsServiceEntries, ...awsGroupEntries, ...azureEntries, ...gcpCoreEntries, ...gcpCatEntries];
    const { finalized, collisions } = resolveCollisions(allEntries);

    const icons = {};
    const slugMapOut = {};
    for (const e of finalized) {
      icons[e.slug] = processSvg(e.absPath, e.slug);
      slugMapOut[e.slug] = { file: e.fileTag, title: e.title, aliases: e.aliases ?? [] };
    }

    /* Stable key order so a rebuild's diff is the actual change, not a re-shuffled object. */
    const sortedIcons = Object.fromEntries(Object.keys(icons).sort().map((k) => [k, icons[k]]));
    const sortedSlugMap = Object.fromEntries(Object.keys(slugMapOut).sort().map((k) => [k, slugMapOut[k]]));

    const bundle = {
      generated: new Date().toISOString(),
      sources: {
        aws: {
          pack: "Architecture-Service-Icons_07312026 + Architecture-Group-Icons_07312026",
          count: awsServiceEntries.length + awsGroupEntries.length,
        },
        azure: { pack: "Azure_Public_Service_Icons", count: azureEntries.length },
        gcp: { pack: "Unique Icons + Category Icons", count: gcpCoreEntries.length + gcpCatEntries.length },
      },
      icons: sortedIcons,
    };

    fs.mkdirSync(path.join(root, "icons", "data"), { recursive: true });
    const outPath = path.join(root, "icons", "data", "vendor.json");
    fs.writeFileSync(outPath, JSON.stringify(bundle, null, 2) + "\n");
    fs.writeFileSync(slugMapPath, JSON.stringify(sortedSlugMap, null, 2) + "\n");

    report({ awsServiceEntries, awsGroupEntries, azureEntries, azureDuplicates, gcpCoreEntries, gcpCatEntries, collisions, outPath });
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

main();
