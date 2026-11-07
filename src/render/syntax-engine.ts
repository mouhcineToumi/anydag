/**
 * The highlighter, imported dynamically by `syntax.ts`: the
 * reading of a Lezer tree's error nodes, and two small tokenizers for the languages people write most
 * here and Lezer has no standalone grammar for — SQL and shell.
 *
 * Every class is `dag-tok-*` (`markdown.css`), never Lezer's `tok-*`: a class the page draws is a name
 * in this app's one namespace, and grepped for like any other.
 */
import type { Tree } from "@lezer/common";
import { highlightTree, tagHighlighter, tags as t } from "@lezer/highlight";
import type { LRParser } from "@lezer/lr";

import type { CodeProblem, CodeRead, CodeToken, Reader } from "./syntax";

const highlighter = tagHighlighter([
  { tag: [t.keyword, t.controlKeyword, t.definitionKeyword, t.moduleKeyword, t.operatorKeyword, t.modifier, t.self], class: "dag-tok-keyword" },
  { tag: [t.string, t.special(t.string), t.character, t.docString, t.attributeValue], class: "dag-tok-string" },
  { tag: [t.regexp, t.escape, t.special(t.brace)], class: "dag-tok-regexp" },
  { tag: [t.number, t.integer, t.float, t.bool, t.null, t.atom, t.unit, t.color], class: "dag-tok-number" },
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], class: "dag-tok-comment" },
  {
    tag: [t.function(t.variableName), t.function(t.propertyName), t.function(t.definition(t.variableName)), t.macroName],
    class: "dag-tok-function",
  },
  { tag: [t.typeName, t.className, t.namespace, t.standard(t.typeName), t.definition(t.typeName)], class: "dag-tok-type" },
  { tag: [t.propertyName, t.attributeName, t.labelName, t.definition(t.propertyName)], class: "dag-tok-property" },
  { tag: [t.tagName, t.meta, t.annotation, t.processingInstruction], class: "dag-tok-tag" },
]);

/** Where an error node is, as something a person can see underlined — never a newline, never nothing. */
function problemAt(code: string, from: number, to: number): CodeProblem {
  let a = from;
  let b = to;
  if (b <= a || /^\s*$/.test(code.slice(a, b))) {
    /* A zero-width error, or one over blanks: the character it stands before, or — at the end of a
       line or the text — the last one written before it. */
    let back = a - 1;
    while (back >= 0 && /\s/.test(code[back])) back -= 1;
    /* Stopped at a closing bracket straight after a comma, the comma is what is wrong: `[1, 2,]`. */
    if (back >= 0 && code[back] === "," && /[)\]}]/.test(code[a] ?? "")) {
      a = back;
      b = back + 1;
    } else if (a < code.length && !/\s/.test(code[a])) b = a + 1;
    else {
      let p = Math.min(a, code.length) - 1;
      while (p > 0 && /\s/.test(code[p])) p -= 1;
      a = Math.max(p, 0);
      b = Math.min(a + 1, code.length);
    }
  }
  const before = code.slice(0, a);
  const line = before.split("\n").length;
  const col = a - (before.lastIndexOf("\n") + 1) + 1;
  return { from: a, to: b, line, col };
}

/** No more than this many problems a block: past the first few, Lezer's recovery is guessing too. */
const PROBLEMS_MAX = 5;

function problemsOf(tree: Tree, code: string): CodeProblem[] {
  const out: CodeProblem[] = [];
  tree.iterate({
    enter: (n) => {
      if (out.length >= PROBLEMS_MAX) return false;
      if (n.type.isError) out.push(problemAt(code, n.from, n.to));
      return undefined;
    },
  });
  return out;
}

/**
 * The text a grammar is handed, **the same length as what was written**, so every offset still
 * names the same character. Python's grammar refuses two things Python accepts — a bare `yield`
 * statement and a float written `20.` — and both are rewritten into something it reads.
 */
function prepare(name: string, code: string): string {
  if (name !== "python") return code;
  return code
    .replace(/^([ \t]*)yield[ \t]*$/gm, (_m, indent: string) => `${indent}pass `.padEnd(_m.length))
    .replace(/(\b\d+)\.(?![\w.])/g, "$1 ");
}

function lezerReader(parser: LRParser, name: string, check: boolean): Reader {
  return (code) => {
    let tree = parser.parse(prepare(name, code));
    let shift = 0;
    let problems = check ? problemsOf(tree, code) : [];
    /* A CSS block is as often the declarations of one rule as a stylesheet: read again inside a rule,
       and taken that way when that is what reads clean. */
    if (name === "css" && problems.length > 0) {
      const wrapped = parser.parse(`*{${code}\n}`);
      const inner = problemsOf(wrapped, `*{${code}\n}`);
      if (inner.length === 0) {
        tree = wrapped;
        shift = 2;
        problems = [];
      }
    }
    const tokens: CodeToken[] = [];
    highlightTree(tree, highlighter, (from, to, cls) => {
      const a = from - shift;
      const b = Math.min(to - shift, code.length);
      if (b > a && a >= 0) tokens.push({ from: a, to: b, cls });
    });
    tokens.sort((x, y) => x.from - y.from);
    return { tokens, problems, checked: check };
  };
}

// -- the two tokenizers of our own ---------------------------------------------

const SQL_WORDS = new Set(
  (
    "select from where and or not in is null as on join left right inner outer full cross natural using group by order " +
    "having limit offset union all distinct insert into values update set delete create table view index drop alter add " +
    "column primary key foreign references unique check default constraint if exists case when then else end with " +
    "recursive returning between like ilike similar asc desc nulls first last true false begin commit rollback grant " +
    "revoke function returns language as declare return trigger before after for each row execute procedure do " +
    "over partition window rows range preceding following current unbounded filter lateral cast interval varchar " +
    "text integer int bigint smallint serial bigserial boolean bool numeric decimal real double precision date time " +
    "timestamp timestamptz uuid jsonb json array any some exists explain analyze vacuum schema sequence type enum " +
    "materialized refresh conflict nothing excluded only escape collate tablespace temporary temp unlogged"
  ).split(" "),
);

const SHELL_WORDS = new Set(
  "if then else elif fi for while until do done case esac in function return export local readonly set unset shift exit source alias sudo".split(" "),
);

type Rule = [RegExp, string | null];

const SQL_RULES: Rule[] = [
  [/--[^\n]*/y, "dag-tok-comment"],
  [/\/\*[\s\S]*?(?:\*\/|$)/y, "dag-tok-comment"],
  [/\$([A-Za-z_]\w*)?\$[\s\S]*?(?:\$\1\$|$)/y, "dag-tok-string"],
  [/'(?:[^']|'')*'?/y, "dag-tok-string"],
  [/"(?:[^"]|"")*"?/y, "dag-tok-property"],
  [/\b\d+(?:\.\d+)?(?:e[+-]?\d+)?\b/iy, "dag-tok-number"],
  [/[A-Za-z_]\w*(?=\s*\()/y, "dag-tok-function"],
  [/[A-Za-z_]\w*/y, "word"],
  [/\s+|./y, null],
];

const SHELL_RULES: Rule[] = [
  [/(?<=^|\s)#[^\n]*/y, "dag-tok-comment"],
  [/'[^']*'?/y, "dag-tok-string"],
  [/"(?:\\.|[^"\\])*"?/y, "dag-tok-string"],
  [/\$\{[^}]*\}?|\$\(|\$[A-Za-z_]\w*|\$[0-9@#?*!$-]/y, "dag-tok-property"],
  [/(?<=^|\s)--?[A-Za-z][\w-]*/y, "dag-tok-type"],
  [/\b\d+\b/y, "dag-tok-number"],
  [/[A-Za-z_][\w.-]*/y, "word"],
  [/\s+|./y, null],
];

function simpleReader(kind: "sql" | "shell"): Reader {
  const rules = kind === "sql" ? SQL_RULES : SHELL_RULES;
  return (code) => {
    const tokens: CodeToken[] = [];
    /* In a shell line the first word is the command, and so is the word after a pipe or `&&`. */
    let commandNext = true;
    let at = 0;
    while (at < code.length) {
      let matched = false;
      for (const [re, cls] of rules) {
        re.lastIndex = at;
        const m = re.exec(code);
        if (!m || m[0].length === 0) continue;
        const text = m[0];
        let c = cls;
        if (c === "word") {
          const lower = text.toLowerCase();
          if (kind === "sql") c = SQL_WORDS.has(lower) ? "dag-tok-keyword" : null;
          else c = SHELL_WORDS.has(text) ? "dag-tok-keyword" : commandNext ? "dag-tok-function" : null;
          if (kind === "shell") commandNext = SHELL_WORDS.has(text) && text !== "in";
        } else if (kind === "shell" && cls === null) {
          if (/[\n;|&]/.test(text)) commandNext = true;
        } else if (kind === "shell") commandNext = false;
        if (c) tokens.push({ from: at, to: at + text.length, cls: c });
        at += text.length;
        matched = true;
        break;
      }
      if (!matched) at += 1;
    }
    return { tokens, problems: [], checked: false };
  };
}

export function readerFor({
  grammar,
  dialect,
  simple,
  check,
  name,
}: {
  grammar: unknown;
  dialect?: string;
  simple?: "sql" | "shell";
  check: boolean;
  name: string;
}): Reader {
  if (simple) return simpleReader(simple);
  let parser = grammar as LRParser;
  if (dialect) parser = parser.configure({ dialect });
  return lezerReader(parser, name, check);
}

export type { CodeRead };
