import { spawn } from "node:child_process";

import { merge3 } from "../../src/note/merge";
import type { QuizDiagnostic } from "../../src/quiz/codes";
import { parseQuiz } from "../../src/quiz/parse";
import type { SearchDoc } from "../../src/search/engine";
import type { TableDiagnostic } from "../../src/table/codes";

import { Conflict, EXIT } from "../api";
import { UsageError, bool, str, type Parsed } from "../args";
import { diagnosticLines, kindQuery, report, type Diagnosed, type Kind } from "../board";
import { editInEditor, emit, keepAside, readText, short, table, type Command, type Ctx } from "../context";

/**
 * The files: boards, notes and folders, and the routes that list, read, write, move and watch them.
 *
 * A board and a note share every operation but one — the notes have no grammar, so `diagnose` is a
 * board's alone — and they share one namespace, because both keep their images in
 * `<name>.assets/` (`CLAUDE.md` → *Notes*). So both groups are made by one function from the kind,
 * which is also what keeps `kind=note` on every route a note reaches and off every one it does not.
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
 * same names. `--json` printed the route's answer whole, so `ls <folder> --json` was the account
 * while the text was the folder; a field the route grows later is cut by its shape, an
 * array of names or a map keyed by one, without a line here.
 */
export function narrowListed<T extends object>(listed: T, under: string | undefined, only: readonly ListKind[]): T {
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

/** One hit as `GET /__board/search` answers it. */
interface SearchHit {
  id: string;
  name: string;
  kind: Kind;
  title: string | null;
  part: string | null;
  what: string;
  score: number;
  terms: string[];
  snippet: string;
}

/** `GET /__board/refs`: one document's references out, and what points at it. */
export interface Refs {
  id: string;
  name: string;
  kind: string;
  title: string | null;
  refs: { id: string; type: "link" | "embed"; text: string; part?: string; target: { id: string; name: string; kind: string; title: string | null } | null }[];
  backlinks: { id: string; name: string; kind: string; title: string | null; type: "link" | "embed" }[];
}

interface IndexDoc {
  id: string;
  name: string;
  kind: Kind;
  title?: string | null;
  refs: { id: string; type: "link" | "embed"; part?: string; text: string }[];
}

/**
 * Where a person opens a document: the app's deep link, `anydag://open?vault=<id>&note=<name>`.
 * The vault is the one this command acts in, else the server's default; with no vault
 * open the link names none and the app asks.
 */
export async function appBase(ctx: Ctx): Promise<string> {
  let id = ctx.vault;
  if (!id) {
    const listed = await ctx.api.get<{ vaults: { id: string; default: boolean }[] }>("/api/vaults").catch(() => null);
    id = listed?.vaults?.find((v) => v.default)?.id;
  }
  return id ? `anydag://open?vault=${encodeURIComponent(id)}` : "anydag://open";
}

export const docUrl = (base: string, name: string, kind: Kind | "file", view = false): string =>
  `${base}${base.includes("?") ? "&" : "?"}${kind}=${encodeURIComponent(name)}${view ? "&view=1" : ""}`;

/** Hand a URL to whatever this machine opens URLs with, and never fail because there is nothing. */
export function launch(url: string): void {
  const [cmd, args] =
    process.platform === "darwin" ? ["open", [url]] : process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : ["xdg-open", [url]];
  try {
    const child = spawn(cmd, args, { stdio: "ignore", detached: true });
    child.on("error", () => {});
    child.unref();
  } catch {
    /* No opener on this machine — the URL is printed either way. */
  }
}

const get = (ctx: Ctx, name: string, kind: Kind) => ctx.api.get<Got>("/__board/get", { name, kind: kindQuery(kind) });

const put = (ctx: Ctx, name: string, kind: Kind, text: string, base: string | undefined) =>
  ctx.api.post<{ base: string; text: string }>("/__board/put", { text, base }, { name, kind: kindQuery(kind) });

const kindFlag = { name: "note", type: "boolean" as const, help: "a note rather than a board" };
const quizFlag = { name: "quiz", type: "boolean" as const, help: "a quiz rather than a board" };
const tableFlag = { name: "table", type: "boolean" as const, help: "a table rather than a board" };
const fileFlag = { name: "file", type: "boolean" as const, help: "an attachment rather than a board" };

/** The kind `--note`, `--quiz` or `--table` names, a board when none does. */
const kindOf = (p: { flags: Record<string, unknown> }): Kind =>
  p.flags.table ? "table" : p.flags.quiz ? "quiz" : p.flags.note ? "note" : "board";

/** What each kind of file is stored under. */
const SUFFIX: Record<Kind, string> = { board: ".board.md", note: ".note.md", quiz: ".quiz.md", table: ".table.md" };

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
export async function checked<T>(ctx: Ctx, p: Parsed, kind: Kind): Promise<T> {
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
export function quizLines(ctx: Ctx, diagnostics: readonly QuizDiagnostic[]): number {
  for (const d of diagnostics) ctx.io.out(`${d.line}:${d.col} ${d.severity} ${d.code} ${d.message}`);
  const errors = diagnostics.filter((d) => d.severity === "error").length;
  if (diagnostics.length) ctx.io.err(`${errors} error${errors === 1 ? "" : "s"}, ${diagnostics.length - errors} warning${diagnostics.length - errors === 1 ? "" : "s"}`);
  return errors > 0 ? EXIT.errors : EXIT.ok;
}

function docCommands(kind: Kind): Command[] {
  const noun = kind;
  const suffix = SUFFIX[kind];
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
      flags: [
        { name: "file", type: "string", value: "<path|->", help: "what to put in it" },
        { name: "open", type: "boolean", help: "open it in the browser afterwards" },
      ],
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
        if (bool(p, "open")) launch(url);
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
          throw new UsageError(`give --base (\`anydag ${noun} cat ${p.pos[0]} --json\` prints it), or --force to write over whatever is there`);
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
      name: [noun, "edit"],
      args: "<name>",
      min: 1,
      summary: `edit a ${noun} in $EDITOR, merging with anything written meanwhile`,
      help:
        `Opens the text in $VISUAL or $EDITOR and writes it back under the base it was read at. If somebody wrote ` +
        `the ${noun} while you were editing, the two are merged line by line — a note's own merge — and when you both ` +
        `changed the same lines nothing is written: your text is kept in a file this prints, and it exits 3.`,
      routes: ["GET /__board/get", "POST /__board/put", "GET /__board/diagnostics"],
      async run(ctx, p) {
        const name = p.pos[0]!;
        const was = await get(ctx, name, kind);
        const mine = editInEditor(ctx, was.text, `${name}${suffix}`);
        if (mine === was.text) {
          ctx.io.err(`${noun} ${name} unchanged`);
          return;
        }
        let after: { base: string };
        try {
          after = await put(ctx, name, kind, mine, was.base);
        } catch (e) {
          if (!(e instanceof Conflict)) throw e;
          const merged = merge3(was.text, mine, e.text);
          if (merged === null) {
            const kept = keepAside(mine, `${name}${suffix}`);
            ctx.io.err(`${name} changed while you were editing, on the same lines — nothing written; your text is in ${kept}`);
            return EXIT.conflict;
          }
          try {
            after = await put(ctx, name, kind, merged, e.base);
          } catch (again) {
            if (!(again instanceof Conflict)) throw again;
            ctx.io.err(`${name} is changing under this edit — nothing written; your text is in ${keepAside(mine, `${name}${suffix}`)}`);
            return EXIT.conflict;
          }
          ctx.io.err(`merged with a change made to ${name} while you were editing`);
        }
        emit(ctx, after, () => ctx.io.err(`wrote ${noun} ${name} — base ${short(after.base)}`));
        if (kind === "board") return (await report(ctx, name)) > 0 ? EXIT.errors : EXIT.ok;
        if (kind === "quiz") return quizReport(ctx, (await get(ctx, name, kind)).text);
        if (kind === "table") return tableReport(ctx, name);
      },
    },
    {
      name: [noun, "mv"],
      args: "<name> <to>",
      min: 2,
      summary: `rename a ${noun}, or move it into a folder with a / — its images go with it`,
      routes: ["POST /__board/rename"],
      async run(ctx, p) {
        const done = await ctx.api.post<{ name: string; id: string }>("/__board/rename", { name: p.pos[0], to: p.pos[1], kind: q });
        emit(ctx, done, () => ctx.io.out(done.name));
      },
    },
    {
      name: [noun, "title"],
      args: "<name> <title>",
      min: 2,
      summary: `call a ${noun} something — the title the sidebar shows and a reference is tagged with`,
      help:
        `Sets the \`title:\` in the ${noun}'s frontmatter, one line of it, and changes nothing else in the file. ` +
        `With --follow the file's name follows the title as well — \`Q3 plan\` is \`q3-plan\`, numbered if taken, ` +
        `in the folder it is already in — which is what the sidebar does; prints the name it has afterwards. ` +
        `Its id does not change either way, so no reference to it notices.`,
      flags: [{ name: "follow", type: "boolean", help: "rename the file to match the title" }],
      routes: ["POST /__board/retitle"],
      async run(ctx, p) {
        const done = await ctx.api.post<{ name: string; id: string; title: string }>("/__board/retitle", {
          name: p.pos[0],
          title: p.pos.slice(1).join(" "),
          kind: q,
          follow: bool(p, "follow"),
        });
        emit(ctx, done, () => {
          ctx.io.out(done.name);
          ctx.io.err(`${noun} ${done.name} is called “${done.title}”${done.name !== p.pos[0] ? ` (it was ${p.pos[0]})` : ""}`);
        });
      },
    },
    {
      name: [noun, "cp"],
      args: "<name> <to>",
      min: 2,
      summary: `copy a ${noun} with its images; the copy is a new document with an id of its own`,
      routes: ["POST /__board/duplicate"],
      async run(ctx, p) {
        const done = await ctx.api.post<{ name: string; id: string }>("/__board/duplicate", { name: p.pos[0], to: p.pos[1], kind: q });
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
        emit(ctx, done, () => ctx.io.err(`moved ${noun} ${p.pos[0]} to the trash — anydag trash restore ${done.trash.id} brings it back`));
      },
    },
    {
      name: [noun, "refs"],
      args: "<name>",
      min: 1,
      summary: `what a ${noun} points at by id, and what points at it`,
      routes: ["GET /__board/refs"],
      async run(ctx, p) {
        const me = await ctx.api.get<Refs>("/__board/refs", { name: p.pos[0]!, kind });
        const out = me.refs.map(({ target, ...r }) => ({ ...r, name: target?.name ?? null, kind: target?.kind ?? null }));
        const back = me.backlinks.map(({ id, name, kind, type }) => ({ id, name, kind, type }));
        emit(ctx, { id: me.id, name: me.name, refs: out, backlinks: back }, () => {
          ctx.io.out(`${me.name}  ${me.id}`);
          ctx.io.out(out.length ? "points at:" : "points at nothing");
          for (const line of table(out.map((r) => ["  " + r.type, r.name ?? `(no document ${r.id})`, r.part ? `#${r.part}` : ""]))) ctx.io.out(line);
          ctx.io.out(back.length ? "pointed at by:" : "pointed at by nothing");
          for (const line of table(back.map((b) => ["  " + b.type, `${b.name}`, b.kind]))) ctx.io.out(line);
        });
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
        for (const line of table(rows.map((r) => (bool(p, "ids") ? [r.name, r.kind, r.id, titled(r.name)] : [r.name, r.kind, titled(r.name)]))))
          ctx.io.out(line);
      });
    },
  },
  {
    name: ["open"],
    group: "files",
    args: "<name>",
    min: 1,
    summary: "open a board, a note, a quiz, a table or a file in the browser, or print where it is",
    flags: [
      kindFlag,
      quizFlag,
      tableFlag,
      fileFlag,
      { name: "view", type: "boolean", help: "the read-only view, which loads no editor" },
      { name: "id", type: "boolean", help: "<name> is a permanent id rather than a name" },
      { name: "print", type: "boolean", help: "print the URL and open nothing" },
    ],
    routes: ["GET /__board/resolve"],
    async run(ctx, p) {
      let name = p.pos[0]!;
      let kind: Kind | "file" = bool(p, "file") ? "file" : kindOf(p);
      if (bool(p, "id")) {
        const found = await ctx.api.get<{ name: string; kind: Kind | "file" }>("/__board/resolve", { id: name });
        name = found.name;
        kind = found.kind;
      }
      const url = docUrl(await appBase(ctx), name, kind, bool(p, "view"));
      emit(ctx, { url }, () => ctx.io.out(url));
      if (!bool(p, "print") && !ctx.json) launch(url);
    },
  },
  {
    name: ["resolve"],
    group: "files",
    args: "<id>",
    min: 1,
    summary: "what a permanent id names now — a reference survives every rename, and this is how",
    routes: ["GET /__board/resolve"],
    async run(ctx, p) {
      const found = await ctx.api.get<{ id: string; name: string; kind: Kind }>("/__board/resolve", { id: p.pos[0] });
      emit(ctx, found, () => ctx.io.out(`${found.name}  ${found.kind}`));
    },
  },
  {
    name: ["index"],
    group: "files",
    args: "",
    summary: "every document with its id, its title and how many references it makes",
    routes: ["GET /__board/index"],
    async run(ctx) {
      const { docs } = await ctx.api.get<{ docs: IndexDoc[] }>("/__board/index");
      emit(ctx, { docs }, () => {
        for (const line of table(docs.map((d) => [d.id, d.kind, d.name, d.title ?? "", d.refs.length ? `${d.refs.length} ref${d.refs.length === 1 ? "" : "s"}` : ""])))
          ctx.io.out(line);
      });
    },
  },
  {
    name: ["search"],
    group: "files",
    args: "<words…>",
    min: 1,
    summary: "every place in every board, note, quiz and table the words appear — the search card's list, ranked",
    help:
      "The page's own search, asked of `/__board/search` — the same engine over the same " +
      "units, so a terminal, an agent and the search card rank a query alike: every word must appear, every word is " +
      "a prefix, and a long word forgives one typo. Each hit is `<name>#<part>`, the part a `dag:` reference or " +
      "`anydag open` goes to: an item id, a `^anchor`, `L<line>`, or a table's `<tab>/<row>`. Matched words are marked with `**`.",
    flags: [{ name: "limit", type: "string", help: "at most this many hits (default 40)" }],
    routes: ["GET /__board/search"],
    async run(ctx, p) {
      const query = p.pos.join(" ");
      const raw = str(p, "limit");
      const limit = raw === undefined ? undefined : Number(raw);
      if (limit !== undefined && !(Number.isInteger(limit) && limit > 0)) throw new UsageError("--limit wants a whole number above zero");
      const got = await ctx.api.get<{ hits: SearchHit[] }>("/__board/search", { q: query, limit: limit === undefined ? undefined : String(limit) });
      const out = got.hits.map((h) => ({
        id: h.id,
        name: h.name,
        kind: h.kind,
        title: h.title,
        part: h.part,
        what: h.what,
        score: h.score,
        terms: h.terms,
        snippet: h.snippet,
      }));
      emit(ctx, { query, hits: out }, () => {
        for (const line of table(out.map((h) => [h.part ? `${h.name}#${h.part}` : h.name, h.what, h.snippet]))) ctx.io.out(line);
        ctx.io.err(out.length ? `${out.length} hit${out.length === 1 ? "" : "s"}` : "no hits");
      });
    },
  },
  {
    name: ["corpus"],
    group: "files",
    args: "[<name>]",
    summary: "the pieces a search is made over: every board item, note block, quiz question and table row, with its words",
    help:
      "What `/__board/corpus` cuts the vault's texts into — the units `search` matches and a result opens onto. " +
      "One line per unit, `<name>#<part>  <what>  <words>`; name a document to see only its own. --json is the " +
      "route's answer.",
    routes: ["GET /__board/corpus"],
    async run(ctx, p) {
      const only = p.pos[0];
      const got = await ctx.api.get<{ docs: SearchDoc[] }>("/__board/corpus");
      const docs = only ? got.docs.filter((d) => d.name === only) : got.docs;
      if (only && docs.length === 0) throw new UsageError(`no board, note, quiz or table \`${only}\``);
      emit(ctx, { docs }, () => {
        const rows = docs.flatMap((d) =>
          d.units.map((u) => [u.part ? `${d.name}#${u.part}` : d.name, u.what, u.text.replace(/\s+/g, " ").slice(0, 100)]),
        );
        for (const line of table(rows)) ctx.io.out(line);
        ctx.io.err(`${rows.length} unit${rows.length === 1 ? "" : "s"} in ${docs.length} document${docs.length === 1 ? "" : "s"}`);
      });
    },
  },
  {
    name: ["watch"],
    group: "files",
    args: "[<name>]",
    summary: "print each change to this vault's boards, notes, quizzes and tables as it happens",
    help:
      "The change feed the page listens to — one line per write, `board <name> <sha1>`, `note <name> <sha1>` (and " +
      "`quiz …`, `table …`), or " +
      "`tree` when a file or folder appeared or went. Name one to hear about that one only. --once exits at the " +
      "first change, which is how a script waits for a person to finish an edit. It reconnects on its own.",
    flags: [{ name: "once", type: "boolean", help: "exit after the first change" }],
    routes: ["GET /__board/events"],
    async run(ctx, p) {
      const only = p.pos[0];
      let wait = 1000;
      for (;;) {
        try {
          const res = await ctx.api.raw("/__board/events", { headers: { accept: "text/event-stream" } });
          wait = 1000;
          for await (const ev of events(res)) {
            let line: string | null = null;
            const data = parseData(ev.data);
            if (ev.event === "dag:boards") line = only ? null : "tree";
            else if (ev.event === "dag:board" || ev.event === "dag:note" || ev.event === "dag:quiz" || ev.event === "dag:table") {
              if (!only || data?.name === only) line = `${ev.event.slice("dag:".length)} ${data?.name} ${short(data?.sha1)}`;
            }
            if (line === null) continue;
            if (ctx.json) ctx.io.out(JSON.stringify({ event: ev.event, ...(data ?? {}) }));
            else ctx.io.out(line);
            if (bool(p, "once")) return;
          }
        } catch (e) {
          if (!(e instanceof Error) || !("exit" in e) || (e as { exit: number }).exit !== EXIT.noServer) throw e;
        }
        ctx.io.err(`the feed closed — reconnecting in ${wait / 1000}s`);
        await new Promise((r) => setTimeout(r, wait));
        wait = Math.min(wait * 2, 15_000);
      }
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
    flags: [{ name: "file", type: "string", value: "<path|->", help: "check this draft instead of a file in the vault; `-` is stdin" }],
    routes: ["GET /__board/diagnostics", "POST /__board/diagnostics"],
    async run(ctx, p) {
      const d = await checked<Diagnosed>(ctx, p, "board");
      emit(ctx, d, () => {
        for (const line of diagnosticLines(d)) ctx.io.out(line);
        ctx.io.err(`${d.errors ?? 0} error${d.errors === 1 ? "" : "s"}, ${d.warnings ?? 0} warning${d.warnings === 1 ? "" : "s"}`);
      });
      return (d.errors ?? 0) > 0 ? EXIT.errors : EXIT.ok;
    },
  },
  ...docCommands("note"),
  ...docCommands("quiz"),
  ...docCommands("table"),
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
        const went = (done.boards?.length ?? 0) + (done.notes?.length ?? 0) + (done.quizzes?.length ?? 0) + (done.tables?.length ?? 0) + (done.files?.length ?? 0);
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

/** An event's `data:` as the object the feed sends, or `null` for `dag:boards`'s bare `null`. */
export function parseData(raw: string): { name?: string; sha1?: string } | null {
  try {
    const v: unknown = JSON.parse(raw);
    return v && typeof v === "object" ? (v as { name?: string; sha1?: string }) : null;
  } catch {
    return null;
  }
}

/** Server-sent events off a response body: `event:` and `data:` lines, a blank line between. */
export async function* events(res: Response): AsyncGenerator<{ event: string; data: string }> {
  if (!res.body) return;
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(chunk, { stream: true });
    for (let cut = buffer.indexOf("\n\n"); cut >= 0; cut = buffer.indexOf("\n\n")) {
      const block = buffer.slice(0, cut);
      buffer = buffer.slice(cut + 2);
      let event = "message";
      const data: string[] = [];
      for (const line of block.split("\n")) {
        if (line.startsWith(":")) continue;
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
      }
      if (data.length) yield { event, data: data.join("\n") };
    }
  }
}
