#!/usr/bin/env node
/**
 * The feature surface, checked and drawn.
 *
 * `docs/parity.json` names every feature once, with what reaches it through each of the three ways
 * in: the REST routes the page calls, the `anydag` commands, and the MCP tools. **The REST and MCP
 * columns are complete — every feature has routes and tools, or says why not — and the CLI column is
 * not:** `anydag` is an admin tool (vaults, files as whole documents, the trash, sync, logs, pictures and
 * exports), so a feature the CLI does not carry says `{"admin": false}` there. That marker is valid for
 * the CLI alone; on a route or a tool it is an error. This file is the
 * rules that manifest is held to (`check`) and the matrix drawn from it (`render`); the tests are
 * what gather the three real surfaces and hand them over — `test/parity.test.ts` reads the routes out of
 * `server/routes/` by regex and the tools off `TOOLS` and the commands off `COMMANDS`.
 *
 *     node scripts/parity.mjs           write docs/PARITY.md
 *     node scripts/parity.mjs --check   exit 1 if docs/PARITY.md is not what the manifest draws
 *
 * Plain Node with no dependency, like every script beside it, so the matrix can be drawn from a
 * checkout with nothing installed.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const MANIFEST = path.join(ROOT, "docs/parity.json");
export const MATRIX = path.join(ROOT, "docs/PARITY.md");

/** The three ways in, in the order the matrix draws them. */
export const INTERFACES = /** @type {const} */ (["rest", "cli", "mcp"]);
const LABEL = { rest: "REST", cli: "CLI", mcp: "MCP" };

export function readManifest() {
  return JSON.parse(fs.readFileSync(MANIFEST, "utf8"));
}

/**
 * Every route the local server declares, as `METHOD /path` — the Hono `app.get("/…"`/`app.post(` calls
 * in `server/routes/*.ts`. A route file left off the directory is a whole file of routes nothing is
 * held to, which is why the list is read from the directory here once rather than in each test.
 *
 * Three readings that are not a plain literal: the page's catch-all (`*`) is not an API route; a
 * trailing `/*` is the Python-era `{path:path}` the manifest has always spelled it; and the two
 * preference pairs are declared in a loop (`prefs("app")`), so they are named here.
 */
export function apiRoutes() {
  const dir = path.join(ROOT, "server/routes");
  const out = [];
  for (const file of fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".ts"))
    .sort()) {
    const src = fs.readFileSync(path.join(dir, file), "utf8");
    for (const m of src.matchAll(/\bapp\.(get|post|put|delete|patch)\(\s*"(\/[^"]*)"/g)) {
      out.push(`${m[1].toUpperCase()} ${m[2].replace(/\/\*$/, "/{path:path}")}`);
    }
    if (/\bprefs\("app"\)/.test(src)) {
      for (const at of ["/api/settings", "/api/vault/settings"]) out.push(`GET ${at}`, `PUT ${at}`);
    }
  }
  return out;
}

/**
 * What an interface's value is: names that do it, names that cover it, a refusal, or — for the CLI
 * only — `{"admin": false}`, "this feature is outside the admin CLI" (it is reached by the page and by
 * MCP, and nothing here is missing).
 */
export function shapeOf(value) {
  if (Array.isArray(value)) return { kind: "done", names: value };
  if (value && typeof value === "object" && value.admin === false && Object.keys(value).length === 1)
    return { kind: "outside", names: [] };
  if (value && typeof value === "object" && Array.isArray(value.via)) return { kind: "via", names: value.via, why: value.why };
  if (value && typeof value === "object" && typeof value.refused === "string")
    return { kind: "refused", names: [], why: value.refused };
  return { kind: "gap", names: [] };
}

/**
 * Everything wrong with the manifest against the three real surfaces, as sentences — `[]` when it
 * holds. `surface` is `{rest: string[], cli: Map<command, routes[]>, mcp: string[]}`.
 *
 * The rules, each because of a way the three have drifted before:
 * - every feature says something for every interface — a gap is a missing answer, not a quiet one;
 * - the REST and MCP columns are complete, so `{"admin": false}` is the CLI's alone: a feature the
 *   page and the tools reach may be outside the admin CLI, and nothing else may be outside anything;
 * - every route, command and tool is named by some feature, and every name a feature gives exists;
 * - a feature's CLI commands between them declare its routes, which ties the matrix to what the CLI
 *   actually calls rather than to what somebody wrote down;
 * - a route no command declares is one every feature holding it marks refused or outside for the CLI.
 */
export function check(manifest, surface) {
  const problems = [];
  const known = { rest: new Set(surface.rest), cli: new Set(surface.cli.keys()), mcp: new Set(surface.mcp) };
  const named = { rest: new Set(), cli: new Set(), mcp: new Set() };
  const ids = new Set();

  for (const f of manifest.features ?? []) {
    const where = `\`${f.id}\``;
    if (!f.id || ids.has(f.id)) problems.push(`feature ${where} has no id, or one used twice`);
    ids.add(f.id);
    if (!f.area || !f.what) problems.push(`${where} needs an \`area\` and a \`what\``);
    for (const i of INTERFACES) {
      const s = shapeOf(f[i]);
      if (s.kind === "gap") problems.push(`${where} says nothing for ${LABEL[i]} — a list of names, {via, why} or {refused}`);
      if (s.kind === "outside" && i !== "cli")
        problems.push(
          `${where}'s ${LABEL[i]} says \`{"admin": false}\`, which only the CLI column may — ${LABEL[i]} is complete`,
        );
      if (s.kind !== "refused" && s.kind !== "outside" && s.names.length === 0 && s.kind !== "gap")
        problems.push(`${where}'s ${LABEL[i]} names nothing`);
      if ((s.kind === "via" || s.kind === "refused") && !(typeof s.why === "string" && s.why.length >= 20))
        problems.push(`${where}'s ${LABEL[i]} ${s.kind === "via" ? "`via` needs a `why`" : "refusal needs a reason"}`);
      for (const n of s.names) {
        if (!known[i].has(n)) problems.push(`${where} names ${LABEL[i]} \`${n}\`, which does not exist`);
        named[i].add(n);
      }
    }
    /* The tie: the feature's commands declare its routes. */
    const rest = shapeOf(f.rest);
    const cli = shapeOf(f.cli);
    if (rest.kind === "done" && cli.kind === "done") {
      const declared = new Set(cli.names.flatMap((c) => surface.cli.get(c) ?? []));
      for (const route of rest.names)
        if (!declared.has(route)) problems.push(`${where}: none of its commands (${cli.names.join(", ")}) declares \`${route}\``);
    }
  }

  const labels = { rest: "route", cli: "command", mcp: "tool" };
  for (const i of INTERFACES)
    for (const n of known[i])
      if (!named[i].has(n)) problems.push(`${LABEL[i]} ${labels[i]} \`${n}\` is in no feature — add it to docs/parity.json`);

  /* A route no command declares must be refused or outside, for the CLI, by every feature that holds it. */
  const reached = new Set([...surface.cli.values()].flat());
  for (const route of surface.rest) {
    if (reached.has(route)) continue;
    const holding = (manifest.features ?? []).filter((f) => shapeOf(f.rest).names.includes(route));
    const open = holding.filter((f) => !["refused", "outside"].includes(shapeOf(f.cli).kind)).map((f) => f.id);
    if (open.length)
      problems.push(
        `no command reaches \`${route}\`, yet ${open.join(", ")} neither refuses it for the CLI nor marks it \`{"admin": false}\``,
      );
  }
  return problems;
}

/** `{route: reason}` for every route the CLI refuses — what `cli/commands/index.ts` exports as `REFUSED`. */
export function cliRefused(manifest) {
  const out = {};
  for (const f of manifest.features ?? []) {
    const cli = shapeOf(f.cli);
    if (cli.kind !== "refused") continue;
    for (const route of shapeOf(f.rest).names) out[route] = cli.why;
  }
  return out;
}

/** The routes only the page and MCP reach: every route a feature holds that is outside the admin CLI. */
export function cliOutside(manifest) {
  const out = new Set();
  for (const f of manifest.features ?? []) {
    if (shapeOf(f.cli).kind !== "outside") continue;
    for (const route of shapeOf(f.rest).names) out.add(route);
  }
  return [...out];
}

const code = (s) => `\`${s.replace(/\|/g, "\\|")}\``;

/** The matrix, as Markdown. Every refusal and every `via` is numbered once and explained under it. */
export function render(manifest) {
  const features = manifest.features ?? [];
  const notes = [];
  const noteOf = (text) => {
    let n = notes.indexOf(text);
    if (n === -1) n = notes.push(text) - 1;
    return n + 1;
  };
  const cell = (value) => {
    const s = shapeOf(value);
    if (s.kind === "done") return s.names.map(code).join(" ");
    if (s.kind === "via") return `↳ ${s.names.map(code).join(" ")} [${noteOf(s.why)}]`;
    if (s.kind === "refused") return `✗ [${noteOf(s.why)}]`;
    if (s.kind === "outside") return "·";
    return "**gap**";
  };
  const count = (kind) => features.reduce((n, f) => n + INTERFACES.filter((i) => shapeOf(f[i]).kind === kind).length, 0);
  const lines = [
    "# Parity: REST · CLI · MCP",
    "",
    "Generated from `docs/parity.json` by `npm run parity` — edit that file, never this one.",
    "",
    `**${features.length} features, ${count("gap")} gaps, ${count("outside")} outside the admin CLI.** Each row is one thing the backend can do, and what reaches it`,
    "through each of the three ways in: a route the page calls, an `anydag` command, an MCP tool. A name is",
    "done; ↳ is covered by something more general in that interface; ✗ is refused on purpose; · is outside the",
    "admin CLI — `anydag` administers vaults, files as whole documents, the trash, sync, logs, pictures and",
    "exports, and everything finer is the page's and MCP's, whose columns are complete. The reason for every ↳",
    "and ✗ is numbered under the tables.",
  ];
  const areas = [...new Set(features.map((f) => f.area))];
  for (const area of areas) {
    lines.push("", `## ${area}`, "", "| Feature | REST | CLI | MCP |", "|---|---|---|---|");
    for (const f of features.filter((x) => x.area === area))
      lines.push(`| ${f.what} | ${cell(f.rest)} | ${cell(f.cli)} | ${cell(f.mcp)} |`);
  }
  if (notes.length) {
    lines.push("", "## Why", "");
    notes.forEach((text, i) => lines.push(`${i + 1}. ${text}`));
  }
  return `${lines.join("\n")}\n`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const drawn = render(readManifest());
  if (process.argv.includes("--check")) {
    const now = fs.existsSync(MATRIX) ? fs.readFileSync(MATRIX, "utf8") : "";
    if (now !== drawn) {
      console.error("docs/PARITY.md is not what docs/parity.json draws — run `npm run parity`");
      process.exit(1);
    }
    console.log("parity: docs/PARITY.md is current");
  } else {
    fs.writeFileSync(MATRIX, drawn);
    console.log(`parity: wrote ${path.relative(ROOT, MATRIX)}`);
  }
}
