/**
 * What a code block's language makes of its text: which runs are keywords, strings, comments, and
 * where the language cannot read it. One reading for everywhere a code block is drawn — the
 * read-only renderer (`CodePre`) and the note editor (`src/blocks/syntax.ts`) both ask here.
 *
 * Four things are load-bearing:
 *
 * - **Nothing here is loaded until a page draws a code block in a language it knows.** The grammars
 *   are Lezer's (CodeMirror's parsers, no DOM in them), each a chunk of its own, and the highlighter
 *   with them (`syntax-engine.ts`) — the KaTeX and emoji pattern. Until a language lands its blocks
 *   are drawn as they always were, in the ink, and redraw once it does.
 * - **A syntax check is said only where the grammar can be trusted to mean it.** Lezer recovers from
 *   anything and marks where it had to; run over real code it agrees with the language for Python, JS,
 *   JSON, YAML and CSS, and not for TypeScript — `x is T` and a few other forms come back as errors —
 *   so TypeScript, and every language read by a small tokenizer of ours (SQL, shell), is coloured and
 *   never checked. A block that says something false about a person's code is worse than one that
 *   says nothing.
 * - **A page is not ready until its code is coloured** (`syntaxSettled`), as for equations: a picture
 *   taken in between is a picture of a page that is about to change.
 * - **The colours are the theme's hues** (`markdown.css`, `dag-tok-*`), so a theme is still a folder:
 *   in `neutral`, whose hues are greys, code is greys.
 */
import { useEffect, useMemo, useSyncExternalStore } from "react";

/** One coloured run of a block's text, as offsets into it. */
export interface CodeToken {
  from: number;
  to: number;
  cls: string;
}

/** Where the language could not read the text: a run to underline, and the line and column it starts at. */
export interface CodeProblem {
  from: number;
  to: number;
  line: number;
  col: number;
}

export interface CodeRead {
  tokens: CodeToken[];
  problems: CodeProblem[];
  /** Whether this language is checked at all — `problems` empty means *clean* only when it is. */
  checked: boolean;
}

/** Reads one block's text. Made by the engine for a language once its grammar has landed. */
export type Reader = (code: string) => CodeRead;

interface Lang {
  /** Checked for syntax as well as coloured. */
  check: boolean;
  /** The grammar, or `null` for a language read by one of the engine's own tokenizers. */
  grammar: () => Promise<unknown>;
  /** The engine's own tokenizer, when there is no grammar. */
  simple?: "sql" | "shell";
  /** Lezer's dialect switch, for the JavaScript family. */
  dialect?: string;
}

const js = () => import("@lezer/javascript").then((m) => m.parser);
const none = () => Promise.resolve(null);

const LANGS: Record<string, Lang> = {
  python: { check: true, grammar: () => import("@lezer/python").then((m) => m.parser) },
  javascript: { check: true, grammar: js },
  jsx: { check: true, grammar: js, dialect: "jsx" },
  typescript: { check: false, grammar: js, dialect: "ts" },
  tsx: { check: false, grammar: js, dialect: "ts jsx" },
  json: { check: true, grammar: () => import("@lezer/json").then((m) => m.parser) },
  jsonc: { check: false, grammar: () => import("@lezer/json").then((m) => m.parser) },
  yaml: { check: true, grammar: () => import("@lezer/yaml").then((m) => m.parser) },
  css: { check: true, grammar: () => import("@lezer/css").then((m) => m.parser) },
  html: { check: false, grammar: () => import("@lezer/html").then((m) => m.parser) },
  java: { check: false, grammar: () => import("@lezer/java").then((m) => m.parser) },
  cpp: { check: false, grammar: () => import("@lezer/cpp").then((m) => m.parser) },
  rust: { check: false, grammar: () => import("@lezer/rust").then((m) => m.parser) },
  go: { check: false, grammar: () => import("@lezer/go").then((m) => m.parser) },
  sql: { check: false, grammar: none, simple: "sql" },
  shell: { check: false, grammar: none, simple: "shell" },
};

/** The words a fence is written with, to the language each means. Lower-cased before it is looked up. */
const ALIASES: Record<string, string> = {
  py: "python",
  python3: "python",
  py3: "python",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  node: "javascript",
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  json5: "jsonc",
  yml: "yaml",
  htm: "html",
  xhtml: "html",
  c: "cpp",
  "c++": "cpp",
  cc: "cpp",
  cxx: "cpp",
  h: "cpp",
  hpp: "cpp",
  rs: "rust",
  golang: "go",
  postgres: "sql",
  postgresql: "sql",
  psql: "sql",
  plpgsql: "sql",
  pgsql: "sql",
  mysql: "sql",
  sqlite: "sql",
  bash: "shell",
  sh: "shell",
  zsh: "shell",
  console: "shell",
  "shell-session": "shell",
  shellscript: "shell",
};

/** The language a fence's word names, or `null` for one nothing here reads (`text` included). */
export function languageOf(word: string | null | undefined): string | null {
  const w = (word ?? "").trim().toLowerCase();
  const name = ALIASES[w] ?? w;
  return name in LANGS ? name : null;
}

/** Whether a fence's language is checked, as well as coloured. */
export const checks = (word: string | null | undefined): boolean => {
  const name = languageOf(word);
  return name !== null && LANGS[name].check;
};

const readers = new Map<string, Reader>();
const loading = new Map<string, Promise<void>>();
const listeners = new Set<() => void>();
let version = 0;

/** Ask for a language's grammar and the engine, once; every later ask is handed the same promise. */
export function loadSyntax(word: string | null | undefined): Promise<void> {
  const name = languageOf(word);
  if (!name) return Promise.resolve();
  let got = loading.get(name);
  if (!got) {
    const lang = LANGS[name];
    got = Promise.all([import("./syntax-engine"), lang.grammar()])
      .then(([engine, grammar]) => {
        readers.set(name, engine.readerFor({ grammar, dialect: lang.dialect, simple: lang.simple, check: lang.check, name }));
        version += 1;
        for (const l of listeners) l();
      })
      /* A chunk that will not load leaves the block as it always was; nothing to report. */
      .catch(() => undefined);
    loading.set(name, got);
  }
  return got;
}

/** Told whenever a language lands — what the note editor redraws its decorations on. */
export function onSyntax(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const cache = new Map<string, CodeRead>();
const CACHE_MAX = 500;
/* And by what it holds, not only by how many: the editor reads a block again on every keystroke,
   each version a new key carrying the whole text, and a read is about thirteen times the size of
   its code — five hundred versions of a 90 KB script was most of a gigabyte. */
const CACHE_CHARS = 1_000_000;
let cached = 0;
/** Past this, a block is drawn as it is: a pasted log file is not worth a parse on every keystroke. */
export const READ_MAX = 100_000;

/** What `word`'s language makes of `code`, or `null` while the language has not landed — or never will. */
export function readCode(code: string, word: string | null | undefined): CodeRead | null {
  const name = languageOf(word);
  if (!name || code.length > READ_MAX) return null;
  const reader = readers.get(name);
  if (!reader) return null;
  const key = `${name}\u0000${code}`;
  let got = cache.get(key);
  if (!got) {
    got = reader(code);
    if (cache.size >= CACHE_MAX || cached + code.length > CACHE_CHARS) {
      cache.clear();
      cached = 0;
    }
    cache.set(key, got);
    cached += code.length;
  }
  return got;
}

const frame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

/** Resolves once every language a page asked for has landed and been drawn. At once when none was. */
export async function syntaxSettled(): Promise<void> {
  if (loading.size === 0) return;
  await Promise.all(loading.values());
  await frame();
  await frame();
}

const subscribe = (l: () => void) => onSyntax(l);
const current = () => version;

/** `readCode`, in a component: `null` until the language lands, and the ask if it has not. */
export function useCodeRead(code: string, word: string | null | undefined): CodeRead | null {
  const v = useSyncExternalStore(subscribe, current, current);
  useEffect(() => {
    if (languageOf(word)) void loadSyntax(word);
  }, [word]);
  return useMemo(() => readCode(code, word), [code, word, v]);
}

/** A run of the text and what it wears: a token's class, a problem, both or neither. */
export interface Segment {
  from: number;
  to: number;
  cls: string | null;
  problem: CodeProblem | null;
}

/**
 * The text cut where any token or problem starts or ends, so each piece wears exactly what covers
 * it. Tokens never overlap one another (the highlighter gives the innermost); a problem may cross
 * several. Pure, and what both renderers draw from.
 */
export function segmentsOf(length: number, read: CodeRead): Segment[] {
  const cuts = new Set<number>([0, length]);
  for (const t of read.tokens) cuts.add(t.from).add(t.to);
  for (const p of read.problems) cuts.add(p.from).add(p.to);
  const at = [...cuts].filter((n) => n >= 0 && n <= length).sort((a, b) => a - b);
  const out: Segment[] = [];
  let ti = 0;
  for (let i = 0; i < at.length - 1; i += 1) {
    const from = at[i];
    const to = at[i + 1];
    while (ti < read.tokens.length && read.tokens[ti].to <= from) ti += 1;
    const token = ti < read.tokens.length && read.tokens[ti].from <= from ? read.tokens[ti] : null;
    const problem = read.problems.find((p) => p.from <= from && p.to >= to) ?? null;
    out.push({ from, to, cls: token ? token.cls : null, problem });
  }
  return out;
}

/** How a block's problems are said beside its language: the lines it could not read, counted. */
export function problemsSaid(read: CodeRead | null): string | null {
  if (!read || read.problems.length === 0) return null;
  const lines = new Set(read.problems.map((p) => p.line)).size;
  return lines === 1 ? "1 syntax error" : `${lines} syntax errors`;
}

/** The tooltip on an underlined run. */
export const problemTitle = (p: CodeProblem): string => `Syntax error, line ${p.line}, column ${p.col}`;
