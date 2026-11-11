import fs from "node:fs";
import path from "node:path";

import { ICON_MODES, iconVocabulary } from "../plugins/icons";
import { scanFences } from "../src/board/fences";
import { libraryOne, libraryServed } from "../src/board/library/serve";
import { parseBoard } from "../src/board/parseBoard";
import { readInserts } from "../src/board/clipboard";
import { applyPatch, type PatchOp } from "../src/board/patch";
import { stampItems } from "../src/board/stamp";
import { indexTexts } from "../src/refs/extract";
import { corpusTexts } from "../src/search/corpus";
import { buildEngine, search, snippet, type Engine, type SearchDoc } from "../src/search/engine";
import { parseQuiz, pinned } from "../src/quiz/parse";
import { applyQuizOps } from "../src/quiz/ops";
import { stampIds } from "../src/quiz/write";
import { tableData } from "../src/table/data";
import { applyTableOps, type Minted } from "../src/table/ops";
import { parseTable } from "../src/table/parse";
import { tableDiagnostics } from "../src/table/values";
import { stampTable } from "../src/table/write";
import { isDiagramType, type DiagramType } from "../src/board/types";
import { CODES, type Code } from "../src/dsl/codes";
import { diagnoseBoard } from "../src/dsl/diagnose";
import type { Diagnostic } from "../src/dsl/ir";
import { check, extract, feedback, type Draft } from "../plugins/generate/generate";
import { cardsSystemPrompt, systemPrompt } from "../plugins/generate/system";

/**
 * The grammar layer: every route under `/__dsl`, implemented as function calls.
 *
 * It is the one implementation of one grammar — the same `src/board/` and `src/dsl/` that the
 * **browser already runs** to draw the canvas. Two implementations of one grammar is the failure
 * `check:skill` exists because of, one layer down, so there is exactly one and it is here.
 *
 * Three properties make that cheap, and all three are load-bearing:
 *
 * - **It imports those two directories verbatim.** Neither has a `node:` import or a `@/` alias
 *   between them, because `vite.config.ts` loads the plugin before Vite's aliases exist. Nothing
 *   was moved, wrapped or re-exported to get them here.
 * - **It holds no state.** No store, no keys, no filesystem but the cheat sheets it ships with.
 *   Every route is a function of its arguments, which is what makes it cheap to call and this
 *   file testable without a socket.
 * - **The text comes in; the file never does.** The caller has already read it — reading is the
 *   server's job, and where a board lives is precisely what this layer must not know.
 *
 * So every signature below is the server's with the `fs` taken out, and the sha1/`base`/409 dance
 * stays with the server where the storage is: `applyPatch` is grammar, a compare-and-swap is not.
 */

/** A request, already parsed: the method, the route under `/__dsl`, its query, and a JSON body. */
export interface DslRequest {
  method: string;
  route: string;
  query: URLSearchParams;
  body?: unknown;
}

export interface DslResponse {
  status: number;
  body: unknown;
}

const ok = (body: unknown): DslResponse => ({ status: 200, body });
const bad = (status: number, error: string): DslResponse => ({ status, body: { error } });

/**
 * Where the cheat sheets are.
 *
 * They ship in this image rather than `api`'s because they are the grammar's own documentation —
 * written beside the parsers they describe, and symlinked into the skill so they cannot drift from
 * them. Serving them from anywhere else would be a third copy.
 *
 * Two layouts, in order: `docs/` beside the bundle, which is what the Dockerfile builds, and
 * `docs/dsl/` up in the repository, which is where they are when this runs from a checkout. The
 * first that exists wins and `ANYDAG_DOCS_DIR` beats both. Resolved once at import, because a
 * directory does not appear halfway through a process's life — and picked by what is *there*
 * rather than by an env var the tests would have to remember to set, which is the kind of default
 * that silently serves an empty list.
 */
const docsRoot = (): string => {
  if (process.env.ANYDAG_DOCS_DIR) return process.env.ANYDAG_DOCS_DIR;
  const beside = path.resolve(import.meta.dirname, "docs");
  if (fs.existsSync(beside)) return beside;
  return path.resolve(import.meta.dirname, "../docs");
};
/** `docs/` — holds `dsl/` and `generate/guide.md`, which is the shape `systemPrompt` expects. */
const DOCS_ROOT = docsRoot();
/** The cheat sheets themselves, which is what `/dsl` serves. */
const DOCS = path.join(DOCS_ROOT, "dsl");

/**
 * The validator: a
 * `body` that is not a string and a `move` that is not one of its four shapes would otherwise pass
 * here and throw inside `applyPatch`, which reaches a caller as a 500 naming nothing.
 *
 * An insert written as text is not checked here: `readInserts` has already read it into the object
 * form by the time this runs, or refused it with a reason of its own.
 */
const isOp = (o: unknown): o is PatchOp => {
  if (!o || typeof o !== "object" || Array.isArray(o)) return false;
  const op = o as Record<string, unknown>;
  if ("meta" in op) return typeof op.meta === "object" && op.meta !== null && !Array.isArray(op.meta);
  if ("insert" in op) {
    const ins = op.insert as Record<string, unknown> | null;
    return (
      !!ins &&
      typeof ins === "object" &&
      typeof ins.type === "string" &&
      typeof ins.attrs === "object" &&
      ins.attrs !== null &&
      typeof ins.body === "string" &&
      (op.after === undefined || typeof op.after === "string")
    );
  }
  if ("remove" in op) return typeof op.id === "string";
  if (typeof op.id !== "string") return false;
  if ("move" in op) {
    const to = op.move as Record<string, unknown> | string | null;
    if (to === "front" || to === "back") return true;
    return !!to && typeof to === "object" && (typeof to.before === "string" || typeof to.after === "string");
  }
  if (op.body !== undefined && typeof op.body !== "string") return false;
  if (op.type !== undefined && typeof op.type !== "string") return false;
  return op.attrs === undefined || (typeof op.attrs === "object" && op.attrs !== null && !Array.isArray(op.attrs));
};

/**
 * What a refused op is told — every shape, and the insert's two spellings. The `/__board/patch`
 * route refuses an `ops` that is not a list before calling here, with this same constant, so a caller
 * is told one thing whichever of the two refused it.
 */
export const OPS_SHAPE =
  "expected `ops: [{ id, attrs?, body?, type? } | { id, remove: true } | { id, move } | " +
  '{ insert: "<fenced item text>" | { type, attrs, body }, after? } | { meta }]`';

/**
 * Warnings the generator should spend another round trip on — the plugin's set, by reference rather
 * than by copy, so a code added there is honoured here without anybody remembering to.
 */
const FIXABLE: ReadonlySet<Code> = new Set<Code>([
  CODES.W_UNKNOWN_ICON,
  CODES.W_UNKNOWN_HUE,
  CODES.W_UNKNOWN_ATTR,
  CODES.W_RETIRED_FLAG,
  CODES.W_MISSING_ROW,
  CODES.W_CHART_LENGTH,
  CODES.W_CHART_EMPTY,
]);

const asString = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

/** The search engines last built for corpora that named a version, newest last — a few, one per vault being searched. */
const engines = new Map<string, Engine>();
const ENGINES = 4;

export async function handle(req: DslRequest): Promise<DslResponse> {
  const { method, route, query } = req;
  const body = (req.body ?? {}) as Record<string, unknown>;

  /* Liveness for the container, and the one route that says which build is answering. */
  if (method === "GET" && route === "/health") {
    return ok({ ok: true, service: "dsl", version: process.env.APP_VERSION ?? "dev" });
  }

  /*
   * One patch applied to one text.
   *
   * No `base`, no sha1, no write: `api` reads the board, compares versions, calls this, and writes
   * what comes back. A refusal here is about the *ops* — an id nothing declares — and is 404 for
   * the reason the plugin's is, because it is the same `result.error`.
   */
  if (method === "POST" && route === "/patch") {
    const text = asString(body.text);
    if (text === undefined) return bad(400, "expected `text: string`");
    const given = body.ops ?? [];
    if (!Array.isArray(given)) return bad(400, OPS_SHAPE);
    /* An insert may be the fence an agent would write in the file: read here, against the
       board it lands on, so a minted id is one nothing on it uses. */
    const read = readInserts(text, given);
    if (!read.ok) return bad(400, read.error);
    const ops = read.ops;
    const wrong = ops.findIndex((op) => !isOp(op));
    if (wrong >= 0) return bad(400, `op ${wrong} is not an op: ${OPS_SHAPE}`);
    const result = applyPatch(text, ops as PatchOp[]);
    if (!result.ok) return bad(404, result.error);
    /* Every item a patch leaves behind carries its id in the file. A board that is
       stamped already stamps to itself, so this costs a scan and never a diff. */
    const out = stampItems(result.text);
    /* `changed` is what tells `api` whether to write. An op that changes nothing still succeeds,
       and a no-op write would wake the watcher and push a re-render for nothing. */
    return ok({ text: out, changed: out !== text });
  }

  /*
   * Every document's title and the references it makes.
   *
   * The references table the issue asks for, derived rather than stored: `api` hands over every text
   * an account has, keyed the way `Store.texts` keys them, and this reads each one. What a reference
   * *is* lives in `src/refs/extract.ts`, beside the page that draws one, and nowhere else.
   */
  if (method === "POST" && route === "/index") {
    const texts = body.texts;
    if (!texts || typeof texts !== "object" || Array.isArray(texts) || !Object.values(texts).every((t) => typeof t === "string"))
      return bad(400, "expected `texts: { [key]: string }`");
    return ok({ docs: indexTexts(texts as Record<string, string>) });
  }

  /*
   * Every document's words, cut into the pieces a search result can open onto.
   *
   * `/index`'s shape and `/index`'s argument: derived from the texts rather than stored beside them,
   * keyed the way `Store.texts` keys them. What a unit *is* lives in `src/search/corpus.ts`. Its own
   * route rather than more fields on `/index`, because the index is read by every page that shows a
   * backlink and this is read only while somebody is searching — and it is the heavier of the two.
   */
  if (method === "POST" && route === "/corpus") {
    const texts = body.texts;
    if (!texts || typeof texts !== "object" || Array.isArray(texts) || !Object.values(texts).every((t) => typeof t === "string"))
      return bad(400, "expected `texts: { [key]: string }`");
    return ok({ docs: corpusTexts(texts as Record<string, string>) });
  }

  /*
   * A board's text with every item's id written onto its fence, and nothing else changed.
   *
   * What `api` runs over a board it stores whole — a new one, and an agent's `board_write` — so an
   * item is never without the id a reference to it would name. See `src/board/stamp.ts`.
   */
  if (method === "POST" && route === "/stamp") {
    const text = asString(body.text);
    if (text === undefined) return bad(400, "expected `text: string`");
    const out = stampItems(text);
    return ok({ text: out, changed: out !== text });
  }

  /*
   * What is wrong with a board, in the board's own line numbers.
   *
   * `diagnoseBoard` is the page's question too — the problems dock asks it after every write — so
   * what an agent is told and what a person is shown cannot drift apart.
   */
  if (method === "POST" && route === "/diagnose") {
    const text = asString(body.text);
    if (text === undefined) return bad(400, "expected `text: string`");
    /* A quiz is Markdown with a grammar of its own, and its answer has its own shape: how
       many questions a run could ask, and the `EQ_`/`WQ_` codes — the same answer
       `anydag quiz check` prints. */
    if (body.kind === "quiz") {
      const quiz = parseQuiz(text);
      return ok({ questions: quiz.questions.length, diagnostics: quiz.diagnostics });
    }
    /* And a table: how many tabs and rows it holds, and the `ET_`/`WT_` codes — the cells'
       too, which only a checker asks for. */
    if (body.kind === "table") {
      const table = parseTable(text);
      return ok({
        tabs: table.tabs.length,
        rows: table.tabs.reduce((n, t) => n + t.rows.length, 0),
        diagnostics: tableDiagnostics(table),
      });
    }
    const name = asString(body.name) ?? "board";
    return ok(diagnoseBoard(parseBoard(name, text)));
  }

  /*
   * A quiz's questions as data, for somebody running it without the page.
   *
   * The page parses a quiz itself and, before a run starts, gives every question the id its answers
   * are recorded under (`stampIds`). An agent over MCP has neither parser nor writer, so this does
   * both: with `stamp`, the text comes back with every id written in, and `api` writes it under the
   * base it read — exactly the write the page makes on Practice.
   */
  if (method === "POST" && route === "/quiz") {
    let text = asString(body.text);
    if (text === undefined) return bad(400, "expected `text: string`");
    const before = text;
    /* With `ops`, one question at a time by id (`src/quiz/ops.ts`): what the route writes
       under the version it read, every other byte of the quiz kept. */
    let ids: string[] | undefined;
    if (body.ops !== undefined) {
      if (!Array.isArray(body.ops)) return bad(400, "expected `ops: [{op, …}]`");
      const applied = applyQuizOps(text, body.ops);
      if (!applied.ok) return bad(applied.status, applied.error);
      text = applied.text;
      ids = applied.ids;
    } else if (body.stamp === true) text = stampIds(text).text;
    const quiz = parseQuiz(text);
    return ok({
      text,
      changed: text !== before,
      ...(ids ? { ids } : {}),
      description: quiz.description,
      /* Shown in an order of the asker's own each run, `pinned` options where they are. */
      shuffle: quiz.shuffle,
      questions: quiz.questions.map((q) => ({
        id: q.id ?? null,
        prompt: q.prompt,
        body: q.body,
        options: q.options.map((o) => ({ text: o.text, correct: o.correct, pinned: pinned(o) })),
        why: q.why,
        /* No options: answered in words, `why` its model answer. */
        open: q.open,
        /* `card` on its heading: a flashcard — show the prompt, then `why` as the back, with nothing typed. */
        card: q.card,
        multi: q.multi,
        line: q.line,
      })),
      diagnostics: quiz.diagnostics,
    });
  }

  /*
   * A table as data, and the edits somebody without a parser asks for.
   *
   * The page edits a table with `src/table/`'s writers and saves the text. The CLI and an agent
   * over MCP send ops instead (`src/table/ops.ts`), addressed by id, and this applies them: `api`
   * reads the text, calls this, and writes what comes back under the version it read, re-applying
   * the same list to whatever beat it. `stamp` gives every tab, column and row with no id one, which
   * is what a caller reading a hand-written table needs before it can address anything in it.
   */
  if (method === "POST" && route === "/table") {
    const text = asString(body.text);
    if (text === undefined) return bad(400, "expected `text: string`");
    let out = text;
    let minted: Minted | undefined;
    if (body.ops !== undefined) {
      if (!Array.isArray(body.ops)) return bad(400, "expected `ops: [{op, …}]`");
      const applied = applyTableOps(text, body.ops);
      if (!applied.ok) return bad(applied.status, applied.error);
      out = applied.text;
      minted = applied.minted;
    } else if (body.stamp === true) out = stampTable(text);
    const tab = asString(body.tab);
    return ok({
      text: out,
      changed: out !== text,
      ...(minted ? { minted } : {}),
      table: tableData(out, { view: body.view === true, ...(tab ? { tab } : {}) }),
    });
  }

  /*
   * A query matched against a corpus.
   *
   * The page matches every keystroke in the browser over `/corpus`, and that stays. A
   * caller with no browser — the CLI, an agent over MCP, a script — asks this instead, which runs the
   * page's own engine (`src/search/engine.ts`) over the same units. So the three rank one query the
   * same way and mark the same words, which a second implementation could only promise.
   */
  if (method === "POST" && route === "/search") {
    const docs = body.docs;
    const q = asString(body.q);
    const version = asString(body.version);
    if (q === undefined) return bad(400, "expected `q: string`");
    if (docs !== undefined && !Array.isArray(docs)) return bad(400, "expected `docs: [{id, name, kind, title?, units}]`");
    const limit = body.limit === undefined ? undefined : Number(body.limit);
    if (limit !== undefined && !(Number.isInteger(limit) && limit > 0)) return bad(400, "`limit` is a whole number above zero");
    /* Building the engine is the cost — three seconds over 5,000 notes — and the query is not, so a
       corpus named by a `version` keeps its engine for the next query naming the same one. Sent the
       version alone, an engine this process does not hold is asked for with the docs (412). */
    let engine: Engine;
    const held = version === undefined ? undefined : engines.get(version);
    if (held) engine = held;
    else if (Array.isArray(docs)) {
      engine = buildEngine(docs as SearchDoc[]);
      if (version !== undefined) {
        engines.set(version, engine);
        for (const old of engines.keys()) if (engines.size > ENGINES) engines.delete(old);
      }
    } else return { status: 412, body: { error: "send `docs`: no engine is held for this version", code: "docs" } };
    const hits = search(engine, q, limit).map((h) => {
      const runs = snippet(h.unit.text, h.terms);
      return {
        id: h.doc.id,
        name: h.doc.name,
        kind: h.doc.kind,
        title: h.doc.title ?? null,
        part: h.unit.part ?? null,
        what: h.unit.what,
        score: h.score,
        terms: h.terms,
        /* Marked with `**`, which is how the CLI prints it — and `runs` beside it
           for a caller that draws its own marks. */
        snippet: runs.map((r) => (r.hit ? `**${r.text}**` : r.text)).join(""),
        runs,
      };
    });
    return ok({ query: q, hits });
  }

  /* What the parser thinks the fences are. A disagreement with the client's list is the first
     thing to look at when a rewrite hits the wrong line. */
  if (method === "POST" && route === "/fences") {
    const text = asString(body.text);
    if (text === undefined) return bad(400, "expected `text: string`");
    return ok({ fences: scanFences(text) });
  }

  /*
   * One attempt of the generator's fix loop, judged.
   *
   * The loop itself stays in `api`: it holds the keys, the timeout, the concurrency limit and the
   * per-user quota, and it is the route that spends money. What cannot live there is *reading the
   * model's answer* — finding the fence, parsing it with the real parser, and knowing which
   * warnings are a typo worth another round trip and which are a judgement to leave alone.
   *
   * So this answers everything the loop needs to decide without knowing any grammar: the draft, its
   * diagnostics, the three counts it scores on, and the exact next user turn to send.
   */
  if (method === "POST" && route === "/check") {
    const reply = asString(body.reply);
    if (reply === undefined) return bad(400, "expected `reply: string`");
    const source = asString(body.source);
    const wanted = asString(body.as);
    if (wanted !== undefined && !isDiagramType(wanted)) return bad(400, `not a diagram type \`${wanted}\``);
    const as = wanted as DiagramType | undefined;

    const found = extract(reply, as, source);
    /* No diagram in the reply at all: `none` is already written as the thing to say back. */
    if ("none" in found) return ok({ found: false, none: found.none });

    const draft: Draft = found.draft;
    const diagnostics = check(draft);
    const wrongType = as && draft.type !== as ? { want: as, got: draft.type } : undefined;
    /* A diagram of the wrong type is still a diagram and may be the best one there is; it counts
       as an error so it never wins over a draft that is what was asked for. */
    const scored: Diagnostic[] = wrongType
      ? [
          {
            line: 0,
            code: CODES.EG_WRONG_TYPE,
            message: `asked for \`${as}\`, drew \`${draft.type}\``,
            severity: "error" as const,
          },
          ...diagnostics,
        ]
      : diagnostics;

    return ok({
      found: true,
      draft,
      diagnostics: scored,
      errors: scored.filter((d) => d.severity === "error").length,
      warnings: scored.filter((d) => d.severity === "warn").length,
      /* The loop stops on `errors === 0 && fixable === 0`. Which warnings count is grammar
         knowledge, which is why the count travels rather than the rule. */
      fixable: scored.filter((d) => d.severity === "warn" && FIXABLE.has(d.code)).length,
      wrongType,
      feedback: feedback(diagnostics, wrongType),
    });
  }

  /*
   * What a model is told before it is asked for a diagram.
   *
   * It lives here and not in `api` because every one of its inputs does: the cheat sheets, the
   * guide, and the library **rendered by the same code that parses it**. None of it is a string in
   * any source file, which is the point — the grammar changes in the commit that changes the
   * parser, and a prompt that restated it would be the one copy nobody updates.
   *
   * `api` holds the keys, the timeout, the concurrency limit and the quota; it fetches this and
   * sends it. Spending money is its business; saying what the grammar is, is not.
   */
  if (method === "GET" && route === "/system") {
    const wanted = query.get("as") ?? undefined;
    if (wanted !== undefined && !isDiagramType(wanted)) return bad(400, `not a diagram type \`${wanted}\``);
    const mode = query.get("mode") === "rewrite" ? "rewrite" : "draw";
    /* Flashcards (#140) are told how to write a card, and nothing about any diagram. */
    if (query.get("mode") === "flashcards") return ok({ system: cardsSystemPrompt({ docsRoot: DOCS_ROOT }) });
    return ok({
      system: systemPrompt({ docsRoot: DOCS_ROOT, as: wanted as DiagramType | undefined, mode }),
    });
  }

  /*
   * The library — every blueprint's rendered text, the way `/dsl` serves the grammar as implemented
   * rather than as remembered.
   *
   * The plugin's version also returns the components a person has saved; those are board files, so
   * they are `api`'s to read and merge in. This half is the part that has to be rendered by the
   * same code that parses it.
   */
  if (method === "GET" && route === "/library") {
    const id = query.get("id");
    if (id) {
      const one = libraryOne(id);
      if (!one) return bad(404, `no blueprint \`${id}\``);
      return ok(one);
    }
    return ok(libraryServed({ type: query.get("type") ?? undefined, q: query.get("q") ?? undefined }));
  }

  /* Which icon names exist, and which of the three ways of drawing each one takes — the thing an
     agent about to write `icon=` cannot invent. */
  if (method === "GET" && route === "/icons") {
    const mode = query.get("mode") ?? undefined;
    if (mode && !(ICON_MODES as readonly string[]).includes(mode)) {
      return bad(400, `\`mode\` must be one of ${ICON_MODES.join(", ")}`);
    }
    return ok(iconVocabulary({ q: query.get("q") ?? undefined, mode }));
  }

  /* The cheat sheets, from the running server, so an agent need not know where the skill is
     installed or whether it is installed at all. */
  if (method === "GET" && route === "/dsl") {
    const type = query.get("type");
    if (!type) {
      const types = fs.existsSync(DOCS)
        ? fs
            .readdirSync(DOCS)
            .filter((f) => f.endsWith(".md"))
            .map((f) => f.slice(0, -3))
            .sort()
        : [];
      return ok({ types });
    }
    const file = path.resolve(DOCS, `${type}.md`);
    /* The same containment rule the board root has: a name off the wire must not escape its root. */
    const rel = path.relative(DOCS, file);
    if (rel.startsWith("..") || path.isAbsolute(rel)) return bad(403, "outside the cheat sheets");
    if (!fs.existsSync(file)) return bad(404, `no cheat sheet \`${type}\``);
    return ok({ type, text: fs.readFileSync(file, "utf8") });
  }

  return bad(404, `no route \`${method} ${route}\``);
}
