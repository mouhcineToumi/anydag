/**
 * Equations in Markdown. What `$…$`, `$$…$$` and a `$$` block *are*, read
 * the same way by every parser here: the note bridge, the anchors, the references extractor, the
 * search corpus and every `react-markdown`.
 *
 * **A single `$` follows Pandoc's rule**, which is what keeps a board that says "between
 * $5 and $10" saying that: `$x$` is math only when the dollars hug the formula — no space just inside the opening
 * one, none just inside the closing one, and no digit straight after the closing one. A `\$` is
 * always a dollar. `$$…$$` has no such rule; nobody writes two dollars for money.
 *
 * micromark's own math reads `$…$` the way a code span reads backticks — the first `$` pairs with the
 * next, whatever surrounds them — so its text tokenizer is forked here with the rule *inside* it, as
 * Pandoc applies it: the first single `$` after the opening one is the only closing candidate, and if
 * the rule refuses it, the opening `$` is a dollar and reading goes on after it. So "costs $5 and the
 * formula $x$" is a price and an equation, and inside one a `\$` does not close it. Doing it
 * afterwards, by turning a parsed pair back into its source, would lose whatever Markdown sat between
 * two prices — `$5 and **really** $10` — because a formula's insides are never parsed. The block half
 * (`$$` on lines of their own) is the package's, untouched.
 *
 * **An inline equation written with `$$` is display**: models write their display
 * formulas mid-sentence, and GitHub and Obsidian centre them. That is recorded on the node as the
 * class its HTML wears — `math-display` where `mdast-util-math` writes `math-inline` — by wrapping the
 * package's `exit`, because `parser.parse()` runs no transformers and the note bridge reads the tree
 * straight off it.
 *
 * No browser, no React, no `@/` aliases: the `dsl` service bundles the parsers that import this.
 */
import { math as mathSyntax } from "micromark-extension-math";
import { mathFromMarkdown, mathToMarkdown } from "mdast-util-math";
import type { InlineMath, Math as MathBlock } from "mdast-util-math";
import type { CompileContext, Extension as FromMarkdownExtension } from "mdast-util-from-markdown";
import type { Options as ToMarkdownOptions } from "mdast-util-to-markdown";
import type { Code, Construct, Event, Previous, Resolver, State, Token, TokenizeContext, Tokenizer } from "micromark-util-types";
import type { Processor } from "unified";

/* ------------------------------------------------------------------------------------------------ */
/* Reading                                                                                           */

const DOLLAR = 36;
const SPACE = 32;

/** micromark's codes for a line ending: CR, LF, CRLF. */
const lineEnding = (code: Code): boolean => code !== null && code < -2;
/** Whitespace in the rule's sense: a space, a tab (which micromark also hands over as a virtual space), a line ending. */
const blank = (code: Code): boolean => code === null || code === SPACE || code < 0;
const digit = (code: Code): boolean => code !== null && code >= 48 && code <= 57;
const BACKSLASH = 92;

/**
 * `micromark-extension-math`'s `mathText`, with Pandoc's rule for a single dollar. Everything that
 * is not about the rule is the package's own, line for line; the four places that are say so.
 */
function tokenizeMathText(this: TokenizeContext, effects: Parameters<Tokenizer>[0], ok: State, nok: State): State {
  let sizeOpen = 0;
  let size = 0;
  let token: Token;
  /* What was consumed last, so a closing dollar knows what is before it. */
  let last: Code = null;

  const start: State = (code) => {
    effects.enter("mathText");
    effects.enter("mathTextSequence");
    return sequenceOpen(code);
  };

  const sequenceOpen: State = (code) => {
    if (code === DOLLAR) {
      effects.consume(code);
      sizeOpen++;
      return sequenceOpen;
    }
    /* The rule, 1: a single dollar followed by a space opens nothing. */
    if (sizeOpen === 1 && blank(code)) return nok(code);
    effects.exit("mathTextSequence");
    return between(code);
  };

  const between: State = (code) => {
    if (code === null) return nok(code);
    if (code === DOLLAR) {
      token = effects.enter("mathTextSequence");
      size = 0;
      return sequenceClose(code);
    }
    if (code === SPACE) {
      effects.enter("space");
      effects.consume(code);
      effects.exit("space");
      last = code;
      return between;
    }
    if (lineEnding(code)) {
      effects.enter("lineEnding");
      effects.consume(code);
      effects.exit("lineEnding");
      last = code;
      return between;
    }
    effects.enter("mathTextData");
    return data(code);
  };

  const data: State = (code) => {
    if (code === null || code === SPACE || code === DOLLAR || lineEnding(code)) {
      effects.exit("mathTextData");
      return between(code);
    }
    effects.consume(code);
    last = code;
    /* The rule, 4: in a single-dollar formula a backslash takes the character after it, so `\$` is
       TeX's dollar rather than the end — and `\\` is TeX's line break, after which a `$` does end it. */
    return sizeOpen === 1 && code === BACKSLASH ? escaped : data;
  };

  const escaped: State = (code) => {
    if (code === null || lineEnding(code)) return data(code);
    effects.consume(code);
    last = code;
    return data;
  };

  const sequenceClose: State = (code) => {
    if (code === DOLLAR) {
      effects.consume(code);
      size++;
      return sequenceClose;
    }
    if (size === sizeOpen) {
      /* The rule, 2 and 3: a single closing dollar with a space before it, or a digit after it,
         closes nothing — and the opening one was a dollar. */
      if (sizeOpen === 1 && (blank(last) || digit(code))) return nok(code);
      effects.exit("mathTextSequence");
      effects.exit("mathText");
      return ok(code);
    }
    /* A run of another length is part of the formula, as in a code span. */
    token.type = "mathTextData";
    last = DOLLAR;
    return data(code);
  };

  return start;
}

/** The package's resolver, unchanged: padding taken off a formula that both starts and ends with a space, and adjacent data merged. */
const resolveMathText: Resolver = (events: Event[]) => {
  let tailExitIndex = events.length - 4;
  let headEnterIndex = 3;
  let index: number;
  let enter: number | undefined;
  if (
    (events[headEnterIndex][1].type === "lineEnding" || events[headEnterIndex][1].type === "space") &&
    (events[tailExitIndex][1].type === "lineEnding" || events[tailExitIndex][1].type === "space")
  ) {
    index = headEnterIndex;
    while (++index < tailExitIndex) {
      if (events[index][1].type === "mathTextData") {
        events[tailExitIndex][1].type = "mathTextPadding";
        events[headEnterIndex][1].type = "mathTextPadding";
        headEnterIndex += 2;
        tailExitIndex -= 2;
        break;
      }
    }
  }
  index = headEnterIndex - 1;
  tailExitIndex++;
  while (++index <= tailExitIndex) {
    if (enter === undefined) {
      if (index !== tailExitIndex && events[index][1].type !== "lineEnding") enter = index;
    } else if (index === tailExitIndex || events[index][1].type === "lineEnding") {
      events[enter][1].type = "mathTextData";
      if (index !== enter + 2) {
        events[enter][1].end = events[index - 1][1].end;
        events.splice(enter + 2, index - enter - 2);
        tailExitIndex -= index - enter - 2;
        index = enter + 2;
      }
      enter = undefined;
    }
  }
  return events;
};

/** A dollar right after a dollar starts nothing — it is the same run — unless the first was escaped. */
const previous: Previous = function (this: TokenizeContext, code) {
  return code !== DOLLAR || this.events[this.events.length - 1][1].type === "characterEscape";
};

const mathText: Construct = { name: "mathText", tokenize: tokenizeMathText, resolve: resolveMathText, previous };

/** The block half is the package's; the text half is ours. */
const syntax = { flow: mathSyntax().flow, text: { [DOLLAR]: mathText } };

/** What an inline equation's `<code>` wears when it is display — `$$` mid-line. */
const DISPLAY_CLASSES = ["language-math", "math-display"];

function fromMarkdown(): FromMarkdownExtension {
  const base = mathFromMarkdown();
  const exit = base.exit?.mathText;
  return {
    ...base,
    exit: {
      ...base.exit,
      mathText(this: CompileContext, token: Token) {
        const display = this.sliceSerialize(token).startsWith("$$");
        exit?.call(this, token);
        /* Exited, the node is the last child of whatever is open now. */
        const parent = this.stack[this.stack.length - 1];
        const node = parent && "children" in parent ? parent.children[parent.children.length - 1] : undefined;
        if (display && node?.type === "inlineMath") {
          node.data = { ...node.data, hProperties: { ...node.data?.hProperties, className: DISPLAY_CLASSES } };
        }
      },
    },
  };
}

/**
 * The plugin: `$` math with Pandoc's rule, `$$` blocks, and display marked on the node. Reading
 * only; the note bridge writes with `MATH_WRITE` below.
 */
export function remarkMath(this: Processor): void {
  const data = this.data();
  (data.micromarkExtensions ??= []).push(syntax);
  (data.fromMarkdownExtensions ??= []).push(fromMarkdown());
}

/** Whether an inline equation is drawn as display — written `$$…$$` in the middle of a line. */
export function isDisplay(node: InlineMath): boolean {
  const classes = node.data?.hProperties?.className;
  return Array.isArray(classes) && classes.includes("math-display");
}

/** An inline equation node, display or not, as the reader makes one — what the writer is handed. */
export function inlineMathNode(tex: string, display: boolean): InlineMath {
  return {
    type: "inlineMath",
    value: tex,
    data: { hName: "code", hProperties: { className: display ? DISPLAY_CLASSES : ["language-math", "math-inline"] }, hChildren: [] },
  };
}

/* ------------------------------------------------------------------------------------------------ */
/* Writing                                                                                           */

/**
 * An inline equation's TeX as a file can hold it: no space at either end (TeX ignores it, and the
 * rule would not read the equation back), and no blank line (that would end the paragraph).
 */
export function inlineTex(tex: string): string {
  return tex.replace(/\n[ \t]*(?:\n[ \t]*)+/g, "\n").trim();
}

/** A display equation's TeX: no blank line at either end, which the `$$` lines would read back without. */
export function blockTex(tex: string): string {
  return tex.replace(/^(?:[ \t]*\n)+/, "").replace(/(?:\n[ \t]*)+$/, "").replace(/\s+$/, "");
}

function inlineMath(node: InlineMath): string {
  const fence = isDisplay(node) ? "$$" : "$";
  return fence + node.value + fence;
}
inlineMath.peek = () => "$";

function math(node: MathBlock): string {
  let fence = "$$";
  while (node.value.includes(fence)) fence += "$";
  return `${fence}\n${node.value ? `${node.value}\n` : ""}${fence}`;
}

/**
 * The writer's handlers, which write an equation the way it was read: `$tex$`, `$$tex$$` mid-line,
 * or `$$` lines. With nothing else — so a dollar in text is written as the dollar it is, and the
 * note bridge checks by parsing what it wrote (`blocksToMd`).
 */
export const MATH_WRITE: ToMarkdownOptions = { handlers: { inlineMath, math } };

/**
 * A plugin for the writer that escapes every dollar in text: what a group is written as when a
 * literal `$` would otherwise come back as an equation. `mathToMarkdown`'s escaping, through the
 * processor's data because `remark-stringify` replaces an `extensions` option with that list — and
 * `MATH_WRITE`'s handlers over its own, which would write a `$$`-display equation as `$…$`.
 */
export function remarkEscapeDollars(this: Processor): void {
  const data = this.data();
  (data.toMarkdownExtensions ??= []).push({ unsafe: mathToMarkdown().unsafe });
}
