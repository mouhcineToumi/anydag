import { CODES, type Code } from "./codes";

import type { Marker } from "./ir";

/**
 * One tokenizer for every dialect.
 *
 * Line-oriented, because that is how people write these and how a diagnostic has to point. The one
 * non-obvious rule: **free text is always a quoted string and a bare word is always an identifier**.
 * Mermaid guesses (`A[Some label]`, `A{Some label}`, `A(Some label)`) and pays for it with a
 * bracket table per shape; one quoting rule means `service api "larkspur-api" "fastapi" external`
 * needs no lookahead at all.
 */

export type TokenKind = "word" | "string" | "arrow" | "punct" | "sep" | "eof";

export interface ArrowSpec {
  dash: boolean;
  head: Marker;
  tail: Marker;
  /** `->>`/`-->>` in a sequence; irrelevant elsewhere. */
  seq?: "call" | "return" | "plain" | "async";
}

export interface Token {
  kind: TokenKind;
  value: string;
  line: number;
  col: number;
  arrow?: ArrowSpec;
  /** The string was written in backticks: it is real data, and the renderer sets it mono. */
  mono?: boolean;
}

/**
 * Arrows, longest match first.
 *
 * The order is the whole correctness argument: `-->` must be tried before `--`, and `..|>` before
 * `..>`, or a realisation parses as a dependency followed by a stray `|`.
 *
 * Exported because the properties panel offers it as a menu (F3). There is exactly one arrow
 * vocabulary and this is it — a second list beside the panel would be a second list to keep in
 * step, and `setEdgeArrow` refuses anything this table does not spell. The ER cardinalities are
 * deliberately not here: they are matched structurally below, and enumerating their sixty
 * spellings is what that comment already refuses to do.
 */
export const ARROWS: [string, ArrowSpec][] = [
  // sequence
  ["-->>", { dash: true, head: "chevron", tail: "none", seq: "return" }],
  ["->>", { dash: false, head: "chevron", tail: "none", seq: "call" }],
  ["--)", { dash: true, head: "open", tail: "none", seq: "async" }],
  ["-)", { dash: false, head: "open", tail: "none", seq: "async" }],
  // class / UML
  ["--|>", { dash: false, head: "triangle", tail: "none" }],
  ["..|>", { dash: true, head: "triangle", tail: "none" }],
  ["<|--", { dash: false, head: "none", tail: "triangle" }],
  ["<|..", { dash: true, head: "none", tail: "triangle" }],
  ["*--", { dash: false, head: "none", tail: "diamond" }],
  ["o--", { dash: false, head: "none", tail: "diamond-hollow" }],
  ["--*", { dash: false, head: "diamond", tail: "none" }],
  ["--o", { dash: false, head: "diamond-hollow", tail: "none" }],
  // general
  ["-.->", { dash: true, head: "chevron", tail: "none" }],
  ["..>", { dash: true, head: "open", tail: "none" }],
  ["-->", { dash: false, head: "chevron", tail: "none" }],
  ["->", { dash: false, head: "chevron", tail: "none", seq: "plain" }],
  ["<->", { dash: false, head: "chevron", tail: "chevron" }],
  ["-.-", { dash: true, head: "none", tail: "none" }],
  ["---", { dash: false, head: "none", tail: "none" }],
  ["--", { dash: false, head: "none", tail: "none" }],
  ["..", { dash: true, head: "none", tail: "none" }],
];

/**
 * ER cardinalities, parsed structurally rather than enumerated — there are 5 × 2 × 6 spellings and
 * a table of sixty would be a table of sixty typos.
 */
const ERD = /^(\|\||\|o|o\||\}o|\}\||\{o|\{\|)(--|\.\.)(\|\||o\||\|o|o\{|\|\{|o\}|\|\})/;

const CROW_LEFT = new Set(["}o", "}|", "{o", "{|"]);
const CROW_RIGHT = new Set(["o{", "|{", "o}", "|}"]);

function matchArrow(src: string, i: number): [string, ArrowSpec] | null {
  const rest = src.slice(i);

  const erd = ERD.exec(rest);
  if (erd) {
    const [all, left, line, right] = erd as unknown as [string, string, string, string];
    return [
      all,
      {
        dash: line === "..",
        tail: CROW_LEFT.has(left) ? "crow" : "one",
        head: CROW_RIGHT.has(right) ? "crow" : "one",
      },
    ];
  }

  for (const [text, spec] of ARROWS) {
    if (rest.startsWith(text)) return [text, spec];
  }
  return null;
}

const WORD = /^[A-Za-z0-9_*+\-][A-Za-z0-9_.\-/+]*/;
const PUNCT = new Set(["{", "}", "(", ")", "[", "]", "&", ":", "=", ","]);

export interface LexError {
  code: Code;
  line: number;
  col: number;
  message: string;
}

export function tokenize(src: string, errors: LexError[] = []): Token[] {
  const out: Token[] = [];
  let i = 0;
  let line = 1;
  let lineStart = 0;
  const col = () => i - lineStart + 1;

  const pushSep = () => {
    /* Collapse runs of separators. A blank line between two statements is not an empty statement,
       and the parser should not have to skip them. */
    if (out.length && out[out.length - 1]!.kind !== "sep") {
      out.push({ kind: "sep", value: "\n", line, col: col() });
    }
  };

  while (i < src.length) {
    const c = src[i]!;

    if (c === "\n") {
      pushSep();
      i++;
      line++;
      lineStart = i;
      continue;
    }
    if (c === " " || c === "\t" || c === "\r") {
      i++;
      continue;
    }
    if (c === ";") {
      pushSep();
      i++;
      continue;
    }

    // comments: `%%` (Mermaid's) and `//`
    if (src.startsWith("%%", i) || src.startsWith("//", i)) {
      while (i < src.length && src[i] !== "\n") i++;
      continue;
    }

    if (c === '"') {
      const startLine = line;
      const startCol = col();
      i++;
      let value = "";
      while (i < src.length && src[i] !== '"') {
        if (src[i] === "\\" && i + 1 < src.length) {
          const e = src[i + 1]!;
          value += e === "n" ? "\n" : e;
          i += 2;
          continue;
        }
        if (src[i] === "\n") {
          line++;
          lineStart = i + 1;
        }
        value += src[i];
        i++;
      }
      if (src[i] !== '"')
        errors.push({ line: startLine, col: startCol, code: CODES.E_UNTERMINATED_STRING, message: "unterminated string" });
      /* A string closed right against a letter or a digit is a quote meant to be inside it: nothing
         in the grammar puts a word against a string's end, and `"s = "aa""` reads as a string, an
         id called `aa` and another string — three errors about an arrow and an id, none of them
         about the quote. Said once here, and `tidy()` drops what follows from it. */ else if (
        /[\p{L}\p{N}_]/u.test(src[i + 1] ?? "")
      )
        errors.push({
          line: startLine,
          col: startCol,
          code: CODES.E_UNESCAPED_QUOTE,
          message: `a \`"\` inside a string ends it. Write \`\\"\` for a quote, as in \`"s = \\"aa\\""\``,
        });
      i++;
      out.push({ kind: "string", value, line: startLine, col: startCol });
      continue;
    }

    /* Backticks mark a run of real data inside a label — `POST /attempt`. The renderer sets it
       mono; the tokenizer keeps the marker so the parser can tell it from prose. */
    if (c === "`") {
      const startCol = col();
      i++;
      let value = "";
      while (i < src.length && src[i] !== "`" && src[i] !== "\n") {
        value += src[i];
        i++;
      }
      i++;
      out.push({ kind: "string", value, mono: true, line, col: startCol });
      continue;
    }

    // `[*]` is the start/end pseudostate — one token, not three
    if (src.startsWith("[*]", i)) {
      out.push({ kind: "word", value: "[*]", line, col: col() });
      i += 3;
      continue;
    }

    const arrow = matchArrow(src, i);
    if (arrow) {
      out.push({ kind: "arrow", value: arrow[0], line, col: col(), arrow: arrow[1] });
      i += arrow[0].length;
      continue;
    }

    if (PUNCT.has(c)) {
      out.push({ kind: "punct", value: c, line, col: col() });
      i++;
      continue;
    }

    const w = WORD.exec(src.slice(i));
    if (w) {
      out.push({ kind: "word", value: w[0], line, col: col() });
      i += w[0].length;
      continue;
    }

    errors.push({ line, col: col(), code: CODES.E_BAD_CHARACTER, message: `unexpected \`${c}\`` });
    i++;
  }

  pushSep();
  out.push({ kind: "eof", value: "", line, col: col() });
  return out;
}

/** A cursor over the token stream, so parsers read rather than index. */
export class Cursor {
  private at = 0;

  constructor(
    readonly tokens: Token[],
    readonly errors: Diagnostics,
  ) {}

  peek(ahead = 0): Token {
    return this.tokens[Math.min(this.at + ahead, this.tokens.length - 1)]!;
  }

  next(): Token {
    const t = this.peek();
    if (t.kind !== "eof") this.at++;
    return t;
  }

  get done(): boolean {
    return this.peek().kind === "eof";
  }

  /** Consume a token when it matches, and say whether it did. */
  eat(kind: TokenKind, value?: string): Token | null {
    const t = this.peek();
    if (t.kind !== kind) return null;
    if (value !== undefined && t.value !== value) return null;
    return this.next();
  }

  eatWord(value: string): boolean {
    return this.eat("word", value) !== null;
  }

  /** Skip to the next statement boundary — how a parser recovers from a bad line. */
  skipStatement(): void {
    let depth = 0;
    while (!this.done) {
      const t = this.peek();
      if (t.kind === "sep" && depth === 0) {
        this.next();
        return;
      }
      if (t.kind === "punct" && t.value === "{") depth++;
      if (t.kind === "punct" && t.value === "}") {
        if (depth === 0) return;
        depth--;
      }
      this.next();
    }
  }

  skipSeps(): void {
    while (this.eat("sep")) {
      /* keep going */
    }
  }
}

export interface Diagnostics {
  push(d: { line: number; col?: number; message: string; code: Code; severity: "error" | "warn" }): void;
}
