#!/usr/bin/env node
/**
 * The skill's checkable claims, checked.
 *
 * `SKILL.md` is the file an agent reads before it draws anything, and it is the one document about
 * this repo that nothing verifies. The cheat sheets cannot drift because they are symlinks — the
 * skill serves the very files the parsers are written beside. `SKILL.md` is not a symlink, and it
 * drifted: it told every reader "a dark theme (none exists yet)" for as long as `paper-dark`
 * had existed, so an agent that was asked for a dark diagram said there was no such thing. Nothing
 * failed. Nothing could have.
 *
 * What this checks is the part of a prose document that is not prose: the closed sets it names.
 * Themes are a directory listing. Diagram types are a union in `ir.ts` and a file per type in
 * `docs/dsl/`. A sentence about *why* a diagram reads badly is beyond this and always will be; a
 * list of what exists is not, and a list is what goes stale.
 *
 * **A missing skill is a failure not an exemption.** Absent, this printed why it did nothing and
 * exited clean — which would be a *silent pass*, the exact failure mode this file was written to
 * end. The skill is `skills/anydag/` at the root of this repository; a checkout that does not have
 * it is broken, and a git worktree is a full checkout.
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const at = (...p) => path.join(root, ...p);

/**
 * Where the skill is: here, at a path this repository owns.
 *
 * `~/.claude/skills/anydag` points at this directory rather than the other way round, which is
 * what makes one path enough — the skill an agent loads and the skill this checks are the same
 * bytes, and nothing has to guess which of two copies is the authoritative one.
 */
const skillPath = at("skills/anydag/SKILL.md");
if (!fs.existsSync(skillPath)) {
  console.error("skills/anydag/SKILL.md is missing — it is the document an agent reads before it draws anything");
  process.exit(1);
}

const skill = fs.readFileSync(skillPath, "utf8");
const problems = [];
const note = (what, detail) => problems.push({ what, detail });

/* ---- 1. Themes ---- */

const themes = fs
  .readdirSync(at("themes"), { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .sort();

for (const name of themes) {
  if (!skill.includes(`\`${name}\``)) note("theme exists but the skill never names it", name);
}

/* The other direction: a `--theme x` or `?theme=x` naming something that was renamed or removed. */
for (const m of skill.matchAll(/(?:--theme |\?theme=)`?([a-z][\w-]*)`?/g)) {
  const named = m[1];
  if (named !== "name" && !themes.includes(named)) note("the skill names a theme that does not exist", named);
}

/* ---- 2. Diagram types ---- */

/* `sequence` and `chart` are deliberately outside `DiagramType`: their models are a `SequenceModel`
   and a `ChartModel`, not a `Graph`, so they are not among the types that share an IR. They are
   still types a board can fence, and the skill's table is a list of what you can draw, not of what
   shares a data structure. Both lists are read out of `ir.ts` — the second used to be the literal
   `"sequence"` appended here, which is exactly the shape of drift this file exists to catch. */
const ir = fs.readFileSync(at("src/dsl/ir.ts"), "utf8");
const union = /export type DiagramType =([\s\S]*?);/.exec(ir);
const own = /export const OWN_MODEL_TYPES =([\s\S]*?);/.exec(ir);
if (!union || !own) {
  console.error("could not find `DiagramType` / `OWN_MODEL_TYPES` in src/dsl/ir.ts — this check needs updating");
  process.exit(1);
}
const quoted = (text) => [...text.matchAll(/"([a-z0-9]+)"/g)].map((m) => m[1]);
const codeTypes = new Set([...quoted(union[1]), ...quoted(own[1])]);

/* Sheets that describe something other than a diagram type: the grammar every dialect shares, and
   the board-level `edges` fence, which is a family of its own and deliberately absent from
   `DiagramType`. Neither has a type to agree with, and both are still documents an author reads. */
const NOT_A_TYPE = new Set(["common.md", "edges.md"]);

const sheetTypes = new Set(
  fs
    .readdirSync(at("docs/dsl"))
    .filter((f) => f.endsWith(".md") && !NOT_A_TYPE.has(f))
    .map((f) => f.replace(/\.md$/, "")),
);

/* The last cell of every row in the "Which type" table. */
const tableTypes = new Set([...skill.matchAll(/^\|.*\|\s*`([a-z0-9]+)`\s*\|\s*$/gm)].map((m) => m[1]));

for (const t of codeTypes) {
  if (!sheetTypes.has(t)) note("type has no cheat sheet in docs/dsl/", t);
  if (!tableTypes.has(t)) note("type is missing from the skill's `Which type` table", t);
}
for (const t of sheetTypes) {
  if (!codeTypes.has(t)) note("cheat sheet for a type the code does not have", t);
}
for (const t of tableTypes) {
  if (!codeTypes.has(t)) note("the skill offers a type the code does not have", t);
}

/* ---- 3. The library ---- */

/*
 * The same shape of check as the theme and the type: a closed set a prose document can still get
 * wrong by omission. `test/library.test.ts` already proves the five layers exist in the code and
 * behave the way the docstring in `library/types.ts` says; this proves the one document an agent
 * reads before it draws anything still says so, and still names the endpoint that serves them.
 */
const libSection = /##\s*The library\b([\s\S]*?)(?:\n##\s|$)/.exec(skill);
if (!libSection) {
  note("no `## The library` section", "");
} else {
  const body = libSection[1];
  for (const n of [0, 1, 2, 3, 4]) {
    if (!new RegExp(`\\|\\s*${n}\\s*\\|`).test(body)) note("the library section never names layer", String(n));
  }
  if (!body.includes("/__board/library")) note("the library section never names the endpoint", "/__board/library");
}

/* ---- 4. The chart vocabulary ---- */

/*
 * The fifth closed set, and the first one about a cheat sheet rather than about `SKILL.md`.
 *
 * The sheets cannot drift from *this* repository — they are the files the skill symlinks to — but
 * nothing held one to the parser it describes. `chart`'s whole grammar is twelve words at the head
 * of a line, four of which are the form, and the four are also the panel's Form select and
 * `E_UNKNOWN_KIND`'s suggestion list. A form the sheet does not name is a shape an agent never
 * draws; a word the sheet names and the parser has not is a line an agent writes and gets an error
 * for. Both are silent, which is the whole argument for this file.
 *
 * It rides here rather than in `check-theme.mjs` because it is the same question those three ask:
 * does the document an agent reads still list what exists.
 */
const chartSrc = fs.readFileSync(at("src/dsl/chart.ts"), "utf8");
const forms = quoted(/export const FORMS =([\s\S]*?);/.exec(chartSrc)?.[1] ?? "");
const chartWords = quoted(/export const CHART_WORDS[^=]*=([\s\S]*?);/.exec(chartSrc)?.[1] ?? "");
if (forms.length === 0 || chartWords.length === 0) {
  console.error("could not read `FORMS` / `CHART_WORDS` out of src/dsl/chart.ts — this check needs updating");
  process.exit(1);
}
/* `CHART_WORDS` is `[...FORMS, "x", …]`, so the spread has to be added back by hand. */
const vocabulary = new Set([...forms, ...chartWords]);

const sheet = fs.readFileSync(at("docs/dsl/chart.md"), "utf8");
const vocabSection = /##\s*The vocabulary\b([\s\S]*?)(?:\n##\s|$)/.exec(sheet);
if (!vocabSection) {
  note("docs/dsl/chart.md has no `## The vocabulary` section", "");
} else {
  /* The first cell of every row: one backticked word, which is what the statement is called. */
  const named = new Set([...vocabSection[1].matchAll(/^\|\s*`([a-z]+)`\s*\|/gm)].map((m) => m[1]));
  for (const word of vocabulary) {
    if (named.has(word)) continue;
    const what = forms.includes(word)
      ? "chart form the cheat sheet's vocabulary table never names"
      : "chart statement the cheat sheet's vocabulary table never names";
    note(what, word);
  }
  for (const word of named) {
    if (!vocabulary.has(word)) note("the cheat sheet names a chart statement the parser has not", word);
  }
}

/* ---- 5. What a note holds ---- */

/*
 * The sixth closed set. A note's editor holds exactly the blocks Markdown can
 * say, and that list is `NOTE_BLOCKS` in `src/note/markdown.ts` — which the schema, the slash menu
 * and `test/note-menu.test.ts` all agree with. The skill's *Writing a note* table is what an agent
 * reads to know what it may write and have survive an edit; a block it names that the editor cannot
 * hold is text an agent writes and a person's first keystroke turns into something else.
 */
const noteSrc = fs.readFileSync(at("src/note/markdown.ts"), "utf8");
const noteBlocks = [.../export const NOTE_BLOCKS = \[([\s\S]*?)\] as const;/.exec(noteSrc)?.[1]?.matchAll(/"([A-Za-z]+)"/g) ?? []].map(
  (m) => m[1],
);
if (noteBlocks.length === 0) {
  console.error("could not read `NOTE_BLOCKS` out of src/note/markdown.ts — this check needs updating");
  process.exit(1);
}
const noteSection = /##\s*Writing a note\b([\s\S]*?)(?:\n##\s|$)/.exec(skill);
if (!noteSection) {
  note("no `## Writing a note` section", "");
} else {
  const named = new Set([...noteSection[1].matchAll(/^\|\s*`([A-Za-z]+)`\s*\|/gm)].map((m) => m[1]));
  for (const b of noteBlocks) if (!named.has(b)) note("a block a note holds that the skill's table never names", b);
  for (const b of named) if (!noteBlocks.includes(b)) note("the skill names a note block the editor does not hold", b);
}

/* ---- 6. The MCP tools ---- */

/*
 * The seventh closed set, and the one this repository is now most likely to get wrong.
 *
 * The skill describes a surface that lives in a different directory, behind a decorator, with its
 * names the server's own words. A tool renamed on the server is a tool the skill goes on telling
 * an agent to call — and the failure is not an error anybody
 * sees, it is a model reaching for something that is not there and falling back to whatever it can
 * think of. That is the same shape as "a dark theme (none exists yet)", which is why this file
 * exists at all.
 *
 * The names are read out of the server the way `HUE_ORDER` and `FORMS` are read out of theirs: a
 * regular expression over the source, rather than a list appended here by hand, which would be the
 * third copy and the one nobody updates.
 */
/* The tools are `TOOLS` in `server/mcp/tools.ts`, several of them made by a function (`note_rename`
   and `quiz_rename` are one definition), so they are read off the module rather than by regex: it
   is bundled once into the cache with its packages left outside, and imported. */
const tools = await (async () => {
  const { build } = await import("esbuild");
  const out = path.join(at("node_modules"), ".cache", "check-skill", "tools.mjs");
  await build({
    absWorkingDir: at("."),
    stdin: { contents: 'export { TOOLS } from "./server/mcp/tools";', resolveDir: at("."), loader: "ts" },
    bundle: true,
    platform: "node",
    format: "esm",
    packages: "external",
    outfile: out,
    logLevel: "silent",
  });
  const { TOOLS } = await import(`${pathToFileURL(out).href}?t=${Date.now()}`);
  return TOOLS.map((t) => t.name);
})();
if (tools.length === 0) {
  console.error("could not find any tool in server/mcp/tools.ts — this check needs updating");
  process.exit(1);
}

const mcpSection = /###\s*Through MCP\b([\s\S]*?)(?:\n###?\s|$)/.exec(skill);
if (!mcpSection) {
  note("no `### Through MCP` section", "");
} else {
  const body = mcpSection[1];
  /* Every backticked word in the section that looks like a tool name. The table lists most of them
     one per row and the last row lists five in one cell, so this reads the words rather than the
     rows — the table's shape is prose and may change; the names are the closed set. */
  const named = new Set([...body.matchAll(/`([a-z][a-z_]*)`/g)].map((m) => m[1]));
  for (const tool of tools) {
    if (!named.has(tool)) note("the server has a tool the skill never names", tool);
  }
  for (const word of named) {
    /* `common` and `base` are prose in that section, not tools. Anything shaped like a tool name
       and not one is the interesting direction: a tool that was renamed or removed. */
    if (!word.includes("_")) continue;
    if (!tools.includes(word)) note("the skill names a tool the server has not", word);
  }
}

/* ---- 8. The CLI's commands ---- */

/*
 * The eighth closed set, and the same argument as the seventh one surface over: the skill tells an
 * agent to type `anydag node set …`, and a command renamed in `cli/commands/` is one it goes on
 * typing — a usage error the agent then has to reason its way out of, with nothing to say the skill
 * was the thing that was wrong.
 *
 * The table is read from the CLI itself, `anydag help --json`, rather than by regex over the
 * source: half the names are made by a function (`board cat` and `note cat` are one definition
 * with the kind passed in), and a regex would see neither. The launcher rebuilds the bundle when a
 * source is newer, so this is always the table the sources describe.
 *
 * Two directions, as for the MCP tools, but not the same two. Every `anydag …` the section writes
 * has to be a command that exists — the drift that bites. And every *group* has to be named at
 * least once, so a whole capability cannot go missing from the one document an agent reads; the
 * ninety individual commands are `anydag help`'s to list, not the skill's.
 */
const { spawnSync } = await import("node:child_process");
const helped = spawnSync(process.execPath, [at("cli/anydag.mjs"), "help", "--json"], { encoding: "utf8" });
let cli = [];
try {
  cli = JSON.parse(helped.stdout).map((c) => c.name);
} catch {
  console.error(`could not read the CLI's command table (\`node cli/anydag.mjs help --json\`):\n${helped.stderr || helped.stdout}`);
  process.exit(1);
}
const cliGroups = [...new Set(cli.filter((n) => n.includes(" ")).map((n) => n.split(" ")[0]))];
const cliCount = cli.length;
/* Answered by `cli/main.ts` itself rather than by the table: the help, and the version. */
cli.push("help", "version");

const cliSection = /###\s*Through the CLI\b([\s\S]*?)(?:\n###?\s|$)/.exec(skill);
if (!cliSection) {
  note("no `### Through the CLI` section", "");
} else {
  const body = cliSection[1];
  /* `anydag` then its words, up to the first thing that is an argument rather than a name. */
  const said = [...body.matchAll(/(?:^|[`\s])anydag((?: [a-z][a-z-]*)+)/gm)].map((m) => m[1].trim().split(" "));
  for (const words of said) {
    const two = words.slice(0, 2).join(" ");
    /* Three words — `table row add` — where every command before was one or two. */
    const three = words.slice(0, 3).join(" ");
    if (cli.includes(three) || cli.includes(two) || cli.includes(words[0]) || (words.length === 1 && cliGroups.includes(words[0]))) continue;
    /* A group followed by a word that is not one of its commands is the rename this exists to catch. */
    note("the skill names a command the CLI has not", `anydag ${words.join(" ")}`);
  }
  const named = new Set(said.map((w) => w[0]));
  for (const g of cliGroups) if (!named.has(g)) note("the CLI has a group of commands the skill never names", `anydag ${g}`);
}

/* ---- 8. The sketch vocabulary ---- */

/*
 * The ninth closed set, and the same argument as the chart's: `sketch` is the one dialect
 * whose vocabulary keeps growing — the wireframe's six, the sixteen shapes, the pen, the picture —
 * and each word arrived in a commit that had to remember two documents as well as the parser. A kind
 * the cheat sheet never spells is a shape an agent never draws; a kind the skill's own list leaves
 * out is one it is told does not exist. The pen's `ink` is held to the sheet and not to the skill:
 * the skill tells an agent not to write strokes, and listing the word there would say otherwise.
 */
const sketchSrc = fs.readFileSync(at("src/dsl/graph/sketch.ts"), "utf8");
const irSrc = fs.readFileSync(at("src/dsl/ir.ts"), "utf8");
const sketchOwn = /kinds:\s*\{([\s\S]*?)\.\.\./.exec(sketchSrc)?.[1] ?? "";
const sketchKinds = [
  ...[...sketchOwn.matchAll(/^\s*([a-z]+):/gm)].map((m) => m[1]),
  ...quoted(/export const SHAPE_KINDS = \[([\s\S]*?)\]/.exec(irSrc)?.[1] ?? ""),
];
if (sketchKinds.length < 20) {
  console.error("could not read the sketch kinds out of src/dsl/graph/sketch.ts and ir.ts — this check needs updating");
  process.exit(1);
}
const sketchSheet = fs.readFileSync(at("docs/dsl/sketch.md"), "utf8");
for (const kind of sketchKinds) {
  /* A grammar line in the sheet: four spaces, the word, and its id. */
  if (!new RegExp(`^ {4}${kind}\\s+<id>`, "m").test(sketchSheet)) note("sketch kind docs/dsl/sketch.md never spells out", kind);
  if (kind !== "ink" && !skill.includes(`\`${kind}\``)) note("sketch kind the skill never names", kind);
}

/* ---- 9. What a quiz can be told it got wrong ---- */

/*
 * The ninth closed set. A quiz's parser names every way a quiz can be
 * wrong with a stable code, and an agent writing one branches on the code rather than on the
 * sentence — so the skill's *Writing a quiz* table is the list an agent learns them from. A code the
 * table never names is one an agent meets without being told what it means; a code the table names
 * that the parser has retired is one it waits for and never sees. `QUIZ_CODES` is read by regex, for
 * `HUE_ORDER`'s reason.
 */
const quizSrc = fs.readFileSync(at("src/quiz/codes.ts"), "utf8");
const quizCodes = [...(/export const QUIZ_CODES = \{([\s\S]*?)\} as const;/.exec(quizSrc)?.[1] ?? "").matchAll(/^\s*([EW]Q_[A-Z_]+):/gm)].map(
  (m) => m[1],
);
if (quizCodes.length === 0) {
  console.error("could not read `QUIZ_CODES` out of src/quiz/codes.ts — this check needs updating");
  process.exit(1);
}
const quizSection = /##\s*Writing a quiz\b([\s\S]*?)(?:\n##\s|$)/.exec(skill);
if (!quizSection) {
  note("no `## Writing a quiz` section", "");
} else {
  const named = new Set([...quizSection[1].matchAll(/^\|\s*`([EW]Q_[A-Z_]+)`\s*\|/gm)].map((m) => m[1]));
  for (const c of quizCodes) if (!named.has(c)) note("a quiz code the skill's table never names", c);
  for (const c of named) if (!quizCodes.includes(c)) note("the skill names a quiz code the parser does not have", c);
}

/* ---- 10. What a table can be told it got wrong ---- */

/*
 * The tenth closed set, the ninth's argument one kind over: the skill's
 * *Writing a table* table is the list an agent learns the `ET_`/`WT_` codes from, held to
 * `TABLE_CODES` both ways.
 */
const tableSrc = fs.readFileSync(at("src/table/codes.ts"), "utf8");
const tableCodes = [...(/export const TABLE_CODES = \{([\s\S]*?)\} as const;/.exec(tableSrc)?.[1] ?? "").matchAll(/^\s*([EW]T_[A-Z_]+):/gm)].map(
  (m) => m[1],
);
if (tableCodes.length === 0) {
  console.error("could not read `TABLE_CODES` out of src/table/codes.ts — this check needs updating");
  process.exit(1);
}
const tableSection = /##\s*Writing a table\b([\s\S]*?)(?:\n##\s|$)/.exec(skill);
if (!tableSection) {
  note("no `## Writing a table` section", "");
} else {
  const named = new Set([...tableSection[1].matchAll(/^\|\s*`([EW]T_[A-Z_]+)`\s*\|/gm)].map((m) => m[1]));
  for (const c of tableCodes) if (!named.has(c)) note("a table code the skill's table never names", c);
  for (const c of named) if (!tableCodes.includes(c)) note("the skill names a table code the parser does not have", c);
}

/* ---- */

const where = path.relative(root, skillPath);

if (problems.length) {
  console.error(`${problems.length} problem(s) in ${where}:\n`);
  for (const p of problems) console.error(`  ${p.what.padEnd(48)} ${p.detail}`);
  console.error("\nThe skill is a document an agent trusts. Fix it there, not here.");
  process.exit(1);
}

console.log(
  `ok: ${where} agrees with ${themes.length} theme(s), ${codeTypes.size} diagram type(s), ${noteBlocks.length} note block(s) and ` +
    `${tools.length} MCP tool(s), ${cliCount} CLI command(s), docs/dsl/chart.md with ${vocabulary.size} chart statement(s)` +
    `, docs/dsl/sketch.md with ${sketchKinds.length} sketch kind(s), ${quizCodes.length} quiz code(s) and ${tableCodes.length} table code(s)`,
);
