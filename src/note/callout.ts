/**
 * Callouts: a quote whose first line names a kind, as GitHub and Obsidian write them.
 *
 *     > [!warning] Breaking change
 *     > The `/api/boards` route is gone in 0.6.
 *
 * `[!kind]` opens the quote's first line; `-` or `+` straight after the bracket makes it foldable,
 * folded or open; anything after that on the line is its title. The rest of the quote is its body.
 *
 * This module is the grammar, and both halves read it: `markdown.ts` turns such a quote into a
 * `callout` block and back, and `remarkCallouts` hands every read-only renderer the same quote
 * marked as one. Neither may decide differently what a callout is, so the decision — `splitCallout`
 * — is made once, here, on the parsed tree. What a kind looks like (its hue, its icon) is
 * presentation, and is `src/render/Callout.tsx`'s.
 *
 * No browser, no React, no `@/` aliases: the server and the CLI bundle `src/note/`.
 */
import type { Blockquote, BlockContent, DefinitionContent, Nodes, PhrasingContent, Root } from "mdast";

/**
 * The kinds drawn as themselves: GitHub's five and Obsidian's set. `important` and `caution` are
 * GitHub's own and drawn its way, although Obsidian folds them into `tip` and `warning`: a file
 * that says `[!CAUTION]` was written for GitHub, where it is the red one.
 */
export const CALLOUT_KINDS = [
  "note",
  "tip",
  "important",
  "warning",
  "caution",
  "abstract",
  "info",
  "todo",
  "success",
  "question",
  "failure",
  "danger",
  "bug",
  "example",
  "quote",
] as const;
export type CalloutKind = (typeof CALLOUT_KINDS)[number];

/** Obsidian's other names for a kind. */
const ALIASES: Record<string, CalloutKind> = {
  summary: "abstract",
  tldr: "abstract",
  hint: "tip",
  check: "success",
  done: "success",
  help: "question",
  faq: "question",
  attention: "warning",
  fail: "failure",
  missing: "failure",
  error: "danger",
  cite: "quote",
};

/** `-` folded, `+` foldable and open, nothing for a callout that does not fold. */
type CalloutFold = "" | "-" | "+";

/** The kind a word is drawn as: its own, an alias's, or `note` for a word nobody knows. */
export function calloutKind(word: string): CalloutKind {
  const w = word.toLowerCase();
  return (CALLOUT_KINDS as readonly string[]).includes(w) ? (w as CalloutKind) : (ALIASES[w] ?? "note");
}

/** What a callout with no title is headed with: its word, as written, capitalised — so an unknown kind says its own word. */
export function calloutLabel(word: string): string {
  const w = word.toLowerCase();
  return w ? w[0]!.toUpperCase() + w.slice(1) : "Note";
}

/**
 * The opening of the first line: `[!` a word `]`, then `-` or `+`, then a space or the line's end.
 * The word is a letter and then letters, digits, `_` or `-` — Obsidian takes any word, and this is
 * every one anybody writes, without reading `[!x] y` with a space inside the brackets as a kind.
 */
const HEAD = /^\[!([A-Za-z][\w-]*)\]([+-]?)(?=[ \t\n]|$)/;

/** The line a callout opens with, as the house form writes it. */
export function calloutLine(word: string, fold: string, title: string): string {
  const f = fold === "-" || fold === "+" ? fold : "";
  const t = title.replace(/\s+/g, " ").trim();
  return `[!${word || "note"}]${f}${t ? ` ${t}` : ""}`;
}

export interface CalloutParts {
  /** The kind as written — `NOTE`, `hint`, `aside` — which is what the file keeps. */
  word: string;
  fold: CalloutFold;
  /** What follows the marker on the first line, parsed. */
  title: PhrasingContent[];
  /** The rest of the first paragraph, after its first line. */
  body: PhrasingContent[];
  /** The quote's other blocks. */
  rest: (BlockContent | DefinitionContent)[];
}

/** Whether a phrasing node runs past the line it starts on — which no title may. */
function crossesLine(n: PhrasingContent): boolean {
  const p = n.position;
  if (p) return p.end.line > p.start.line;
  if (n.type === "break") return true;
  if ("value" in n) return n.value.includes("\n");
  if ("children" in n) return (n.children as PhrasingContent[]).some(crossesLine);
  return false;
}

/**
 * A quote's callout, or `null` when it is a plain quote.
 *
 * The first line is found on the tree, not in the bytes, so the bridge and the read-only drawing
 * cannot disagree: a soft line break is a `\n` inside a text node, and the title is everything
 * before the first one. A first line that does not end inside text — a hard break, a link or a
 * code span running onto the next line — is not a callout, and the quote stays a quote.
 */
export function splitCallout(bq: Blockquote): CalloutParts | null {
  const [first, ...rest] = bq.children;
  if (first?.type !== "paragraph") return null;
  const lead = first.children[0];
  if (lead?.type !== "text") return null;
  const m = HEAD.exec(lead.value);
  if (!m) return null;
  const word = m[1]!;
  const fold = m[2] as CalloutFold;
  const title: PhrasingContent[] = [];
  const body: PhrasingContent[] = [];
  let open = true;
  for (const [i, n] of first.children.entries()) {
    if (!open) {
      body.push(n);
      continue;
    }
    if (n.type === "text") {
      const v = i === 0 ? n.value.slice(m[0].length).replace(/^[ \t]+/, "") : n.value;
      const at = v.indexOf("\n");
      const before = at < 0 ? v : v.slice(0, at);
      if (before) title.push({ type: "text", value: before });
      if (at >= 0) {
        open = false;
        const after = v.slice(at + 1).replace(/^[ \t]+/, "");
        if (after) body.push({ type: "text", value: after });
      }
      continue;
    }
    /* A line break inside something that is not text — a hard break, a link or a code span running
       onto the next line — leaves no first line to be a title: a plain quote. */
    if (crossesLine(n)) return null;
    title.push(n);
  }
  /* Trailing spaces are the title's edge, not its words. */
  const tail = title[title.length - 1];
  if (tail?.type === "text") {
    tail.value = tail.value.replace(/[ \t]+$/, "");
    if (!tail.value) title.pop();
  }
  return { word, fold, title, body, rest };
}

/* ------------------------------------------------------------------------------------------------ */
/* The read-only drawing                                                                             */

/** The plain words of some phrasing, for a title. */
const wordsOf = (ns: PhrasingContent[]): string =>
  ns.map((n) => ("value" in n ? n.value : "children" in n ? wordsOf(n.children as PhrasingContent[]) : "")).join("");

/**
 * Every callout in a tree, marked for `react-markdown`: the quote becomes an `aside` carrying its
 * kind, word and fold, holding its title (a `span`) and its body (a `div`). `src/render/Callout.tsx`
 * is the `aside` that draws them — the icon, the tint, `<details>` for one that folds.
 *
 * Run after `remarkAnchors`: a block's `^id` on the first paragraph is the callout's.
 */
export function remarkCallouts() {
  return (tree: Root) => {
    const walk = (n: Nodes) => {
      if ("children" in n) for (const c of n.children as Nodes[]) walk(c);
      if (n.type !== "blockquote") return;
      const parts = splitCallout(n);
      if (!parts) return;
      const kind = calloutKind(parts.word);
      const first = n.children[0];
      const id = (first?.data as { hProperties?: { id?: string } } | undefined)?.hProperties?.id;
      const title: PhrasingContent[] = parts.title.length ? parts.title : [{ type: "text", value: calloutLabel(parts.word) }];
      const body: (BlockContent | DefinitionContent)[] = [
        ...(parts.body.length ? [{ type: "paragraph" as const, children: parts.body }] : []),
        ...parts.rest,
      ];
      n.data = {
        ...n.data,
        hName: "aside",
        hProperties: {
          className: ["dag-callout"],
          dataDagCallout: kind,
          dataDagCalloutWord: parts.word,
          dataDagCalloutTitle: wordsOf(title),
          ...(parts.fold ? { dataDagCalloutFold: parts.fold } : {}),
          ...(id ? { id } : {}),
        },
      };
      n.children = [
        { type: "paragraph", data: { hName: "span", hProperties: { className: ["dag-callout__title"] } }, children: title },
        ...(body.length
          ? [
              {
                type: "blockquote" as const,
                data: { hName: "div", hProperties: { className: ["dag-callout__body"] } },
                children: body,
              },
            ]
          : []),
      ];
    };
    walk(tree);
  };
}
