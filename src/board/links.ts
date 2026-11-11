import { CODES, type Code } from "../dsl/codes";
import { HUE_ORDER } from "../dsl/ir";
import { suggestHue } from "../dsl/suggest";
import { Cursor, tokenize, type LexError, type Token } from "../dsl/tokenizer";
import type { BoardLink, LinkEnd } from "./types";

/**
 * The `edges` fence: the grammar of a link between two items on the board.
 *
 * A diagram's edges belong to a dialect and are routed inside that diagram's frame. A link belongs
 * to the board, because its two ends may be in different families — an actor and a service — and no
 * parser owns two families at once. So it gets a fence of its own and this parser, which reads the
 * same statement every dialect reads:
 *
 *     usecase-1.actor1 --> api "signs in"
 *     api -.-> db & cache
 *     web --> api --> db          a chain: two links
 *     a & b --> c                 two links, and no bus — a board link has no trunk to draw
 *
 * It is a separate parser rather than a call into `parseEdge()` because `parseEdge` is bound to a
 * `Ctx` holding a `Graph`: it declares refs to be resolved against that graph's nodes, and pushes
 * what it makes into `ctx.graph.edges`. Neither exists here. The grammar is deliberately kept
 * line-for-line recognisable against it, so the two read alike and drift is visible in a diff.
 *
 * **What it does not do is decide what an endpoint means.** `arch1.db` might be a node inside item
 * `arch1`, or an item somebody called `arch1.db`; only `parseBoard` knows which items are on the
 * page. So this splits on the last `.` — the plausible reading — and `parseBoard` puts the two
 * halves back together (`endText()`) and tries the whole string as an item id first. That is how
 * `resolveRefs()` reads a row ref, for the same reason.
 *
 * **Browser-free, and no `@/` aliases** — `src/board/` is imported by the Vite plugin.
 */

/** Same shape as `BoardDiagnostic`; the caller pushes these straight into `board.errors`. */
interface LinkDiagnostic {
  line: number;
  col?: number;
  code: Code;
  message: string;
  severity: "error" | "warn";
}

export interface ParsedLinks {
  links: BoardLink[];
  diagnostics: LinkDiagnostic[];
}

/** An endpoint as it was written, so a resolver can try the whole string before trusting the split. */
export const endText = (end: LinkEnd): string => (end.node === undefined ? end.item : `${end.item}.${end.node}`);

/** Anchored at both ends: the whole value is one pair, or it is not a point at all. */
const POINT = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/;

/**
 * `via="320,180"` → the point, or `null`.
 *
 * A **quoted string**, and it has to be: `,` is punctuation to the tokenizer, so a bare
 * `via=320,180` arrives as three tokens and the parser would be reading a comma as the end of the
 * value. `ink`'s `pts="0,0 14,9 …"` settled the same question the same way, and this is deliberately
 * the same spelling one pair long.
 *
 * Exactly one pair. A second would be a polyline, and a polyline through points somebody placed by
 * hand is a drawing rather than a link — which is what `sketch` is for. Taking the first pair and
 * saying nothing about the rest would be the silent drop this grammar has a warning code to avoid.
 */
function pointOf(raw: string): { x: number; y: number } | null {
  const m = POINT.exec(raw);
  return m ? { x: Number(m[1]), y: Number(m[2]) } : null;
}

/** `arch1.db` → item `arch1`, node `db`. The last dot, so an item id may itself contain one. */
function endOf(raw: string): LinkEnd {
  const cut = raw.lastIndexOf(".");
  if (cut > 0 && cut < raw.length - 1) return { item: raw.slice(0, cut), node: raw.slice(cut + 1) };
  return { item: raw };
}

/**
 * Read one `edges` body.
 *
 * `baseLine` is the 1-based line of the opening fence and `line` inside the body is 1-based, so
 * `baseLine + line` lands on the board file's own line — the same arithmetic `DiagramItem` does to
 * rebase a dialect's diagnostics. `idPrefix` is the fence's item id, which makes a link id unique
 * across several `edges` fences on one board without anybody having to coordinate.
 */
export function parseLinks(body: string, baseLine: number, idPrefix: string): ParsedLinks {
  const links: BoardLink[] = [];
  const diagnostics: LinkDiagnostic[] = [];

  /* A lexer error is an `E_` code from the diagram DSL, but the grammar that failed here is the
     board's — the reader is looking at a board file, not at a diagram. */
  const lex: LexError[] = [];
  const tokens = tokenize(body, lex);
  for (const e of lex)
    diagnostics.push({ line: baseLine + e.line, col: e.col, code: CODES.EB_LINK_SYNTAX, message: e.message, severity: "error" });

  /* Nothing here reports through the cursor. A bad statement costs exactly one diagnostic, raised
     where the trouble is; a running commentary from inside the cursor is the cascade this avoids. */
  const cur = new Cursor(tokens, { push: () => {} });

  /** Set once per statement: the first complaint is the cause, and the rest are its consequences. */
  let spoiled = false;

  const bad = (t: Token, message: string): void => {
    if (!spoiled)
      diagnostics.push({ line: baseLine + t.line, col: t.col, code: CODES.EB_LINK_SYNTAX, message, severity: "error" });
    spoiled = true;
  };

  /** `a & b & c` — several items on one side of the arrow. */
  const ends = (): LinkEnd[] | null => {
    const out: LinkEnd[] = [];
    for (;;) {
      const t = cur.peek();
      if (t.kind !== "word") {
        bad(t, out.length ? "expected an item after `&`" : "expected an item id, like `api` or `arch1.db`");
        return null;
      }
      cur.next();
      out.push(endOf(t.value));
      if (!cur.eat("punct", "&")) return out;
    }
  };

  /** A trailing `hue=teal` or `quiet`, or a `key=value` nobody here has heard of. */
  const modifierNext = (): boolean => {
    const t = cur.peek();
    if (t.kind !== "word") return false;
    return t.value === "quiet" || (cur.peek(1).kind === "punct" && cur.peek(1).value === "=");
  };

  /**
   * The label: ours is the next string, Mermaid's follows a colon.
   *
   * Bare words after the colon are joined, because `a --> b: signs in` is the shape a pasted Mermaid
   * line arrives in and refusing it would be pedantry. The join stops at the first modifier-shaped
   * token, so `a --> b: signs in hue=teal` reads the way it looks.
   */
  const label = (): string | undefined => {
    const s = cur.eat("string");
    if (s) return s.value;
    if (!cur.eat("punct", ":")) return undefined;
    const q = cur.eat("string");
    if (q) return q.value;
    const words: string[] = [];
    while (cur.peek().kind === "word" && !modifierNext()) words.push(cur.next().value);
    if (words.length === 0) {
      bad(cur.peek(), "expected a label after `:`");
      return undefined;
    }
    return words.join(" ");
  };

  /* An unknown key is kept quiet about rather than refused: a fence line preserves attributes it
     has never heard of, and a link statement disagreeing with that would be a trap. `hue` and
     `via` are the two keys read here, so they are the two checked — the same drop-and-warn
     `modifiers()` in `common.ts` does inside a diagram, because a link is drawn from the theme's
     own hue tokens too. */
  const modifiers = (): { hue?: string; quiet?: boolean; via?: { x: number; y: number } } => {
    const out: { hue?: string; quiet?: boolean; via?: { x: number; y: number } } = {};
    while (modifierNext()) {
      const t = cur.next();
      if (t.value === "quiet") {
        out.quiet = true;
        continue;
      }
      cur.next(); // the `=`
      const v = cur.peek();
      if (v.kind !== "word" && v.kind !== "string") {
        bad(v, `expected a value after \`${t.value}=\``);
        return out;
      }
      cur.next();
      if (t.value === "via") {
        const at = pointOf(v.value);
        if (at) out.via = at;
        else
          diagnostics.push({
            line: baseLine + t.line,
            col: t.col,
            code: CODES.WB_BAD_VIA,
            message: `\`via=\` is one point the line is bent through, written \`via="320,180"\` — got \`${v.value}\``,
            severity: "warn",
          });
      } else if (t.value === "hue") {
        if ((HUE_ORDER as readonly string[]).includes(v.value)) out.hue = v.value;
        else {
          const guess = suggestHue(v.value, HUE_ORDER);
          diagnostics.push({
            line: baseLine + t.line,
            col: t.col,
            code: CODES.W_UNKNOWN_HUE,
            message: guess
              ? `no hue named \`${v.value}\`. Did you mean \`${guess}\`? (${HUE_ORDER.join(", ")})`
              : `no hue named \`${v.value}\`: expected one of ${HUE_ORDER.join(", ")}`,
            severity: "warn",
          });
        }
      }
    }
    return out;
  };

  let n = 0;

  const statement = (): void => {
    let left = ends();
    if (!left) return;
    if (cur.peek().kind !== "arrow") {
      bad(cur.peek(), "expected an arrow, like `-->` or `-.->`");
      return;
    }
    while (cur.peek().kind === "arrow") {
      const arrowTok = cur.next();
      const spec = arrowTok.arrow!;
      const right = ends();
      if (!right) return;
      /* Label and modifiers belong to the hop just read, not to the statement — which is what makes
         `a --> b "one" --> c "two"` mean what it says. `parseEdge` reads them in the same place. */
      const text = label();
      /* The second string, C4's technology chip: `a --> b "Uses" "HTTPS"`. Only after a label, as in
         a diagram, where it is positional — the empty label that holds its place is `""`. */
      const text2 = text === undefined ? undefined : cur.eat("string")?.value;
      const mods = modifiers();
      if (spoiled) return;
      for (const from of left) {
        for (const to of right) {
          links.push({
            id: `${idPrefix}-${++n}`,
            fence: idPrefix,
            from,
            to,
            dash: spec.dash,
            head: spec.head,
            tail: spec.tail,
            label: text,
            label2: text2,
            hue: mods.hue,
            quiet: mods.quiet,
            via: mods.via,
            line: baseLine + arrowTok.line,
          });
        }
      }
      left = right;
    }
    const t = cur.peek();
    if (t.kind !== "sep" && t.kind !== "eof") bad(t, `expected the end of the statement, got \`${t.value}\``);
  };

  cur.skipSeps();
  while (!cur.done) {
    const before = cur.peek();
    spoiled = false;
    const mark = links.length;

    statement();

    /* A statement is all or nothing. Half of `a --> b --> ?` is a link the author did not write,
       and dropping it costs nothing — the diagnostic is the report. */
    if (spoiled) links.length = mark;

    cur.skipStatement();
    /* `skipStatement` stops in front of a stray `}` without consuming it, and a parser that does not
       move is a parser that never returns. */
    if (cur.peek() === before) cur.next();
    cur.skipSeps();
  }

  /* By line, because a lexer error is found in one pass and a statement error in the next, and a
     list that jumps back up the file reads as two lists. */
  diagnostics.sort((a, b) => a.line - b.line);

  return { links, diagnostics };
}
