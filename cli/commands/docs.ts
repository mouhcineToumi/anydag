import type { QuizDiagnostic } from "../../src/quiz/codes";
import { parseQuiz } from "../../src/quiz/parse";
import type { TableDiagnostic } from "../../src/table/codes";

import { EXIT } from "../api";
import { UsageError, bool, str, type Parsed } from "../args";
import { diagnosticLines, kindQuery, report, type Diagnosed, type Kind } from "../board";
import { emit, readText, short, table, type Command, type Ctx } from "../context";

/**
 * The files, as an admin reaches them: list, make, read, replace, move and delete a board, a note, a
 * quiz or a table — and check one for problems. Everything finer than the whole file (an item, a
 * card, a question, a cell, a task's status) is the page's and MCP's, never this command's.
 *
 * Every kind has the same five commands, made by one function from the kind, which is also what
 * keeps `kind=…` on every route a quiz, a note or a table reaches and off every one a board does.
 */

interface Listed {
  boards: string[];
  folders: string[];
  notes: string[];
  /** Every quiz, and how many questions each asks. */
  quizzes?: string[];
  questions?: Record<string, number>;
  /** Every table. */
  tables?: string[];
  /** Every attachment, by a name that carries its extension. */
  files?: string[];
  ids: Record<string, string>;
  /** What each document is called, when its frontmatter says. */
  titles?: Record<string, string>;
}

type ListKind = "boards" | "notes" | "quizzes" | "tables" | "files";
const LIST_KINDS: readonly ListKind[] = ["boards", "notes", "quizzes", "tables", "files"];

/**
 * The listing narrowed to what `ls` prints: the names under `under` and the kinds in `only` (every
 * kind when it is empty), with every per-name map — `ids`, `titles`, `tasks`, `shared` — cut to the
 * same names. `--json` printed the route's answer whole, so `ls <folder> --json` was the vault
 * while the text was the folder; a field the route grows later is cut by its shape, an
 * array of names or a map keyed by one, without a line here.
 */
function narrowListed<T extends object>(listed: T, under: string | undefined, only: readonly ListKind[]): T {
  const inside = (n: string) => !under || n === under || n.startsWith(`${under}/`);
  const wants = (k: ListKind) => !only.length || only.includes(k);
  const record = listed as Record<string, unknown>;
  const kept = new Set<string>();
  const out: Record<string, unknown> = { ...record };
  for (const k of LIST_KINDS) {
    const names = record[k];
    if (!Array.isArray(names)) continue;
    out[k] = wants(k) ? names.filter((n: string) => inside(n)) : [];
    for (const n of out[k] as string[]) kept.add(n);
  }
  if (Array.isArray(record.folders)) out.folders = only.length ? [] : record.folders.filter((n: string) => inside(n));
  for (const [k, v] of Object.entries(record)) {
    if (k === "folders" || (LIST_KINDS as readonly string[]).includes(k)) continue;
    if (Array.isArray(v)) out[k] = v.filter((n) => typeof n !== "string" || kept.has(n));
    else if (v && typeof v === "object") out[k] = Object.fromEntries(Object.entries(v).filter(([n]) => kept.has(n)));
  }
  return out as T;
}

interface Got {
  name: string;
  id?: string;
  text: string;
  base: string;
}

/** `GET /__board/refs`: one document's references out, and what points at it. */
export interface Refs {
  id: string;
  name: string;
  kind: string;
  title: string | null;
  refs: {
    id: string;
    type: "link" | "embed";
    text: string;
    part?: string;
    target: { id: string; name: string; kind: string; title: string | null } | null;
  }[];
  backlinks: { id: string; name: string; kind: string; title: string | null; type: "link" | "embed" }[];
}

/**
 * Where a person opens a document: the app's deep link, `anydag://open?vault=<id>&note=<name>`.
 * The vault is the one this command acts in, else the server's default; with no vault
 * open the link names none and the app asks.
 */
async function appBase(ctx: Ctx): Promise<string> {
  let id = ctx.vault;
  if (!id) {
    const listed = await ctx.api.get<{ vaults: { id: string; default: boolean }[] }>("/api/vaults").catch(() => null);
    id = listed?.vaults?.find((v) => v.default)?.id;
  }
  return id ? `anydag://open?vault=${encodeURIComponent(id)}` : "anydag://open";
}

const docUrl = (base: string, name: string, kind: Kind | "file", view = false): string =>
  `${base}${base.includes("?") ? "&" : "?"}${kind}=${encodeURIComponent(name)}${view ? "&view=1" : ""}`;

const get = (ctx: Ctx, name: string, kind: Kind) => ctx.api.get<Got>("/__board/get", { name, kind: kindQuery(kind) });

const put = (ctx: Ctx, name: string, kind: Kind, text: string, base: string | undefined) =>
  ctx.api.post<{ base: string; text: string }>("/__board/put", { text, base }, { name, kind: kindQuery(kind) });

/** A table's problems after a write, off the route every interface asks, and exit 4 on an error. */
async function tableReport(ctx: Ctx, name: string): Promise<number> {
  const got = await ctx.api.get<{ diagnostics: TableDiagnostic[] }>("/__board/diagnostics", { name, kind: "table" });
  for (const d of got.diagnostics) ctx.io.err(`${d.line}:${d.col} ${d.severity} ${d.code} ${d.message}`);
  return got.diagnostics.some((d) => d.severity === "error") ? EXIT.errors : EXIT.ok;
}

/**
 * A quiz's problems, read off the text just written with the page's own parser, and exit 4 when one
 * is an error — what `report` does for a board through `/__board/diagnostics`, with no route to ask:
 * the grammar is `src/quiz/`, which this bundle carries.
 */
function quizReport(ctx: Ctx, text: string): number {
  return quizLines(ctx, parseQuiz(text).diagnostics);
}

/**
 * What the parser says about a file in the vault, or with `--file` about a draft that is not
 *: the same route either way, so the two answers are one answer. A name beside `--file`
 * only labels it.
 */
async function checked<T>(ctx: Ctx, p: Parsed, kind: Kind): Promise<T> {
  const file = str(p, "file");
  const name = p.pos[0];
  if (file !== undefined) {
    const text = await readText(ctx, file, "the draft");
    return ctx.api.post<T>("/__board/diagnostics", { text, kind, ...(name ? { name } : {}) });
  }
  if (!name) throw new UsageError("say which: a name, or --file <path|-> for a draft");
  return ctx.api.get<T>("/__board/diagnostics", { name, ...(kind === "board" ? {} : { kind }) });
}

/** A quiz's diagnostics printed one a line, and the exit code they make — however they were found. */
function quizLines(ctx: Ctx, diagnostics: readonly QuizDiagnostic[]): number {
  for (const d of diagnostics) ctx.io.out(`${d.line}:${d.col} ${d.severity} ${d.code} ${d.message}`);
  const errors = diagnostics.filter((d) => d.severity === "error").length;
  if (diagnostics.length)
    ctx.io.err(
      `${errors} error${errors === 1 ? "" : "s"}, ${diagnostics.length - errors} warning${diagnostics.length - errors === 1 ? "" : "s"}`,
    );
  return errors > 0 ? EXIT.errors : EXIT.ok;
}

/** A table's diagnostics printed one a line, and the exit code they make. */
function tableLines(ctx: Ctx, diagnostics: readonly TableDiagnostic[]): number {
  for (const d of diagnostics) ctx.io.out(`${d.line}:${d.col} ${d.severity} ${d.code}${d.tab ? ` [${d.tab}]` : ""} ${d.message}`);
  const errors = diagnostics.filter((d) => d.severity === "error").length;
  if (diagnostics.length)
    ctx.io.err(
      `${errors} error${errors === 1 ? "" : "s"}, ${diagnostics.length - errors} warning${diagnostics.length - errors === 1 ? "" : "s"}`,
    );
  return errors > 0 ? EXIT.errors : EXIT.ok;
}

function docCommands(kind: Kind): Command[] {
  const noun = kind;
  const q = kindQuery(kind);
  return [
    {
      name: [noun, "new"],
      args: "<name>",
      min: 1,
      summary: `make a ${noun}; the name that comes back may be numbered`,
      help:
        `A name already taken is numbered rather than refused — \`plan\` becomes \`plan-2\` — so use the name this ` +
        `prints. A \`/\` puts the ${noun} in that folder, making it. The text comes from --file (\`-\` is stdin); ` +
        `without one the ${noun} starts empty.` +
        (kind === "board" ? " Every item in it is given an id if it has none." : ""),
      flags: [{ name: "file", type: "string", value: "<path|->", help: "what to put in it" }],
      routes: ["POST /__board/create"],
      async run(ctx, p) {
        const file = str(p, "file");
        const text = file ? await readText(ctx, file) : "";
        const made = await ctx.api.post<{ name: string; id: string; base: string }>("/__board/create", {
          name: p.pos[0],
          text,
          kind: q,
        });
        const url = docUrl(await appBase(ctx), made.name, kind, false);
        emit(ctx, { ...made, url }, () => {
          ctx.io.out(made.name);
          ctx.io.err(`made ${noun} ${made.name}${made.name !== p.pos[0] ? ` (\`${p.pos[0]}\` was taken)` : ""} — ${url}`);
        });
      },
    },
    {
      name: [noun, "cat"],
      args: "<name>",
      min: 1,
      summary: `print a ${noun}'s text; --json adds its id and the base a write must carry`,
      routes: ["GET /__board/get"],
      async run(ctx, p) {
        const got = await get(ctx, p.pos[0]!, kind);
        if (ctx.json) ctx.io.out(JSON.stringify(got, null, 2));
        else ctx.io.write(got.text);
      },
    },
    {
      name: [noun, "write"],
      args: "<name>",
      min: 1,
      summary: `replace a ${noun}'s whole text, under the base you read`,
      help:
        `Pass the base \`anydag ${noun} cat ${"<name>"} --json\` printed. A ${noun} has two writers — you and a person ` +
        `in the browser — and a write against a version that moved is refused (exit 3) rather than silently ` +
        `winning; --force writes regardless, which is how an edit somebody made meanwhile is lost.` +
        (kind === "note" ? "" : ` The ${noun}'s diagnostics are printed after, and exit 4 means it has errors.`),
      flags: [
        { name: "file", type: "string", value: "<path|->", help: "the new text; `-` reads stdin" },
        { name: "base", type: "string", value: "<sha1>", help: "the base the text was edited from" },
        { name: "force", type: "boolean", help: "write without a base, over whatever is there" },
      ],
      routes: ["POST /__board/put", "GET /__board/diagnostics"],
      async run(ctx, p) {
        const base = str(p, "base");
        if (!base && !bool(p, "force")) {
          throw new UsageError(
            `give --base (\`anydag ${noun} cat ${p.pos[0]} --json\` prints it), or --force to write over whatever is there`,
          );
        }
        const text = await readText(ctx, str(p, "file"));
        const after = await put(ctx, p.pos[0]!, kind, text, base);
        emit(ctx, after, () => ctx.io.err(`wrote ${noun} ${p.pos[0]} — base ${short(after.base)}`));
        if (kind === "board") return (await report(ctx, p.pos[0]!)) > 0 ? EXIT.errors : EXIT.ok;
        if (kind === "quiz") return quizReport(ctx, after.text);
        if (kind === "table") return tableReport(ctx, p.pos[0]!);
      },
    },
    {
      name: [noun, "mv"],
      args: "<name> <to>",
      min: 2,
      summary: `rename a ${noun}, or move it into a folder with a / — its images go with it`,
      routes: ["POST /__board/rename"],
      async run(ctx, p) {
        const done = await ctx.api.post<{ name: string; id: string }>("/__board/rename", {
          name: p.pos[0],
          to: p.pos[1],
          kind: q,
        });
        emit(ctx, done, () => ctx.io.out(done.name));
      },
    },
    {
      name: [noun, "rm"],
      args: "<name>",
      min: 1,
      summary: `move a ${noun} and its images to the trash — \`anydag trash restore\` brings it back`,
      help: "--yes is accepted and does nothing: a delete can be taken back now, so nothing is asked.",
      flags: [{ name: "yes", short: "y", type: "boolean", help: "accepted, and not needed" }],
      routes: ["POST /__board/delete"],
      async run(ctx, p) {
        const done = await ctx.api.post<{ trash: { id: string } }>("/__board/delete", { name: p.pos[0], kind: q });
        emit(ctx, done, () =>
          ctx.io.err(`moved ${noun} ${p.pos[0]} to the trash — anydag trash restore ${done.trash.id} brings it back`),
        );
      },
    },
  ];
}

export const DOCS: Command[] = [
  {
    name: ["ls"],
    group: "files",
    args: "[<folder>]",
    summary: "every board, note, quiz, table, file and folder — the empty folders too",
    flags: [
      { name: "ids", type: "boolean", help: "show each document's permanent id" },
      { name: "boards", type: "boolean", help: "boards only" },
      { name: "notes", type: "boolean", help: "notes only" },
      { name: "quizzes", type: "boolean", help: "quizzes only" },
      { name: "tables", type: "boolean", help: "tables only" },
      { name: "files", type: "boolean", help: "attachments only" },
    ],
    routes: ["GET /__board/list"],
    async run(ctx, p) {
      const listed = await ctx.api.get<Listed>("/__board/list");
      const under = p.pos[0]?.replace(/\/+$/, "");
      const inside = (n: string) => !under || n === under || n.startsWith(`${under}/`);
      const only = (["boards", "notes", "quizzes", "tables", "files"] as const).filter((k) => bool(p, k));
      const wants = (k: "boards" | "notes" | "quizzes" | "tables" | "files") => !only.length || only.includes(k);
      const rows = [
        ...(only.length ? [] : listed.folders.map((n) => ({ name: `${n}/`, kind: "folder", id: "" }))),
        ...(wants("boards") ? listed.boards.map((n) => ({ name: n, kind: "board", id: listed.ids[n] ?? "" })) : []),
        ...(wants("notes") ? (listed.notes ?? []).map((n) => ({ name: n, kind: "note", id: listed.ids[n] ?? "" })) : []),
        ...(wants("quizzes") ? (listed.quizzes ?? []).map((n) => ({ name: n, kind: "quiz", id: listed.ids[n] ?? "" })) : []),
        ...(wants("tables") ? (listed.tables ?? []).map((n) => ({ name: n, kind: "table", id: listed.ids[n] ?? "" })) : []),
        ...(wants("files") ? (listed.files ?? []).map((n) => ({ name: n, kind: "file", id: listed.ids[n] ?? "" })) : []),
      ]
        .filter((r) => inside(r.name.replace(/\/$/, "")))
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
      /* The title last: it is what the person calls the file, and it has spaces in it. */
      const titled = (n: string) => listed.titles?.[n] ?? "";
      emit(ctx, narrowListed(listed, under, only), () => {
        for (const line of table(
          rows.map((r) => (bool(p, "ids") ? [r.name, r.kind, r.id, titled(r.name)] : [r.name, r.kind, titled(r.name)])),
        ))
          ctx.io.out(line);
      });
    },
  },
  ...docCommands("board"),
  {
    name: ["board", "diagnose"],
    args: "[name]",
    min: 0,
    summary: "what is wrong with a board's text, as stable codes with lines; exit 4 on an error",
    help:
      "`E_*` stops a diagram drawing and `W_*` does not; `EB_*` is the board file rather than the DSL in it. Branch " +
      "on the code — the message is for a person. What is wrong with the drawing rather than the text needs the " +
      "laid-out page: `anydag snapshot`. --file checks a draft that is not in the vault, writing nothing.",
    flags: [
      {
        name: "file",
        type: "string",
        value: "<path|->",
        help: "check this draft instead of a file in the vault; `-` is stdin",
      },
    ],
    routes: ["GET /__board/diagnostics", "POST /__board/diagnostics"],
    async run(ctx, p) {
      const d = await checked<Diagnosed>(ctx, p, "board");
      emit(ctx, d, () => {
        for (const line of diagnosticLines(d)) ctx.io.out(line);
        ctx.io.err(
          `${d.errors ?? 0} error${d.errors === 1 ? "" : "s"}, ${d.warnings ?? 0} warning${d.warnings === 1 ? "" : "s"}`,
        );
      });
      return (d.errors ?? 0) > 0 ? EXIT.errors : EXIT.ok;
    },
  },
  ...docCommands("note"),
  ...docCommands("quiz"),
  {
    name: ["quiz", "check"],
    args: "[name]",
    min: 0,
    summary: "what the parser says about a quiz, without writing it; exit 4 on an error",
    help:
      "Every problem with its line and its code — EQ_ for a question a run cannot ask, WQ_ for one that still " +
      "works — read with the page's own parser. `quiz write` prints the same after writing. " +
      "--file checks a draft that is not in the vault, writing nothing.",
    flags: [
      { name: "file", type: "string", value: "<path|->", help: "check this draft instead of a file in the vault; `-` is stdin" },
    ],
    routes: ["GET /__board/diagnostics", "POST /__board/diagnostics"],
    async run(ctx, p) {
      /* The route's answer, which is the page's parser run by the grammar service — so this,
         `quiz_check` over MCP and the quiz's own page cannot disagree about a quiz. */
      const got = await checked<{ questions: number; diagnostics: QuizDiagnostic[] }>(ctx, p, "quiz");
      if (ctx.json) {
        ctx.io.out(JSON.stringify(got, null, 2));
        return got.diagnostics.some((d) => d.severity === "error") ? EXIT.errors : EXIT.ok;
      }
      const code = quizLines(ctx, got.diagnostics);
      if (code === 0) ctx.io.err(`${p.pos[0] ?? str(p, "file")}: ${got.questions} question(s), nothing wrong`);
      return code;
    },
  },
  ...docCommands("table"),
  {
    name: ["table", "check"],
    args: "[name]",
    min: 0,
    summary: "what the parser says about a table, without writing it; exit 4 on an error",
    help:
      "Every problem with its line and its code — ET_ for two things claiming one id, WT_ for everything that " +
      "still works: a cell its column cannot read, a row with no id yet, a sort naming a column that went. " +
      "--file checks a draft that is not in the vault, writing nothing.",
    flags: [
      { name: "file", type: "string", value: "<path|->", help: "check this draft instead of a file in the vault; `-` is stdin" },
    ],
    routes: ["GET /__board/diagnostics", "POST /__board/diagnostics"],
    async run(ctx, p) {
      const got = await checked<{ tabs: number; rows: number; diagnostics: TableDiagnostic[] }>(ctx, p, "table");
      if (ctx.json) {
        ctx.io.out(JSON.stringify(got, null, 2));
        return got.diagnostics.some((d) => d.severity === "error") ? EXIT.errors : EXIT.ok;
      }
      const code = tableLines(ctx, got.diagnostics);
      if (!got.diagnostics.length)
        ctx.io.err(`${p.pos[0] ?? str(p, "file")}: ${got.tabs} tab(s), ${got.rows} row(s), nothing wrong`);
      return code;
    },
  },
  {
    name: ["folder", "new"],
    args: "<name>",
    min: 1,
    summary: "make a folder — only needed for one with nothing in it yet",
    routes: ["POST /__board/mkdir"],
    async run(ctx, p) {
      const done = await ctx.api.post<{ folder: string }>("/__board/mkdir", { name: p.pos[0] });
      emit(ctx, done, () => ctx.io.out(done.folder));
    },
  },
  {
    name: ["folder", "rm"],
    args: "<name>",
    min: 1,
    summary: "move a folder to the trash — an empty one as asked, one with anything in it only with --recursive",
    help:
      "Without --recursive a folder with anything in it is refused, which is what the route has always " +
      "answered. With it, every board, note, quiz, table and attachment under the folder goes to the trash " +
      "with it, as one entry that `anydag trash restore` puts back whole. --yes is accepted and does nothing.",
    flags: [
      { name: "recursive", short: "r", type: "boolean", help: "take everything inside with it" },
      { name: "yes", short: "y", type: "boolean", help: "accepted, and not needed" },
    ],
    routes: ["POST /__board/rmdir"],
    async run(ctx, p) {
      const name = p.pos[0]!.replace(/\/+$/, "");
      const recursive = bool(p, "recursive");
      const done = await ctx.api.post<{
        folder: string;
        boards?: string[];
        notes?: string[];
        quizzes?: string[];
        tables?: string[];
        files?: string[];
        folders?: string[];
        trash: { id: string };
      }>("/__board/rmdir", {
        name,
        ...(recursive ? { recursive: true } : {}),
      });
      emit(ctx, done, () => {
        const went =
          (done.boards?.length ?? 0) +
          (done.notes?.length ?? 0) +
          (done.quizzes?.length ?? 0) +
          (done.tables?.length ?? 0) +
          (done.files?.length ?? 0);
        ctx.io.err(
          `moved ${done.folder}/${went ? ` and ${plural(went, "file")} in it` : ""} to the trash — anydag trash restore ${done.trash.id} brings it back`,
        );
      });
    },
  },
  {
    name: ["folder", "mv"],
    args: "<name> <to>",
    min: 2,
    summary: "rename or move a folder with everything in it; a destination that exists is refused",
    routes: ["POST /__board/mvdir"],
    async run(ctx, p) {
      const done = await ctx.api.post<{ folder: string }>("/__board/mvdir", { name: p.pos[0], to: p.pos[1] });
      emit(ctx, done, () => ctx.io.out(done.folder));
    },
  },
];

/** `3 boards`, `1 note`, or nothing for none — what the recursive delete's question lists. */
const plural = (n: number, what: string, many = `${what}s`): string => (n ? `${n} ${n === 1 ? what : many}` : "");
