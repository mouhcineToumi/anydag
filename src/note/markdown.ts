/**
 * Markdown ↔ BlockNote blocks, through remark in both directions.
 *
 * **BlockNote never parses or writes a byte of a note.** Its own converter changed how 107 of the
 * 149 Markdown bodies in `boards/local/` draw after one open-and-save, and 22 changed again on the
 * second: it reads every soft line break as a hard one, splits bold around inline code into literal
 * asterisks, and breaks list continuation lines out into paragraphs (measured
 * when it landed). remark is the parser `MarkdownItem` already draws board text
 * with, so what a note opens as is what the same Markdown draws as everywhere else here.
 *
 * Three things live here:
 *
 * - `mdToBlocks` / `blocksToMd` — the two conversions, over a structural subset of BlockNote's
 *   block JSON (`NoteBlock`). No BlockNote import: this module is arithmetic over text and runs in
 *   Node, in the local server if it ever needs to, and under vitest's `node` environment.
 * - `load` / `settle` / `save` — the span map. **An edit rewrites only the blocks it touched.** Each
 *   top-level Markdown node remembers its source bytes and the ids of the blocks it became; a group
 *   of blocks that still serialises exactly as it did when the note was opened writes those bytes
 *   back, and so does the whitespace between two such groups. So an agent's wrapping, its `_` or
 *   `*`, a table's padding, all survive every edit that does not reach them — `applyPatch`'s rule
 *   ("a drag must not show up in a diff as a rewrite of the whole thing") for prose.
 * - `plan` — what an outside write means for the blocks already open, so the caret survives an
 *   agent editing some other paragraph.
 *
 * No browser, no React, no `@/` aliases.
 */
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkStringify from "remark-stringify";

import { keepWikilinks, parseWikiUrl, wikiUrl, wikilinksIn } from "../refs/wikilinks";
import type { InlineMath } from "mdast-util-math";
import type {
  AlignType,
  BlockContent,
  Blockquote,
  Definition,
  Html,
  ListItem,
  Nodes,
  PhrasingContent,
  Root,
  RootContent,
  Table,
  TableCell as MdCell,
  TableRow,
} from "mdast";

import { calloutLine, splitCallout } from "./callout";
import { blockTex, inlineMathNode, inlineTex, isDisplay, MATH_WRITE, remarkEscapeDollars, remarkMath } from "./math";

/* ------------------------------------------------------------------------------------------------ */
/* The block shape — the part of BlockNote's JSON this module reads and writes.                      */

/** A text run's marks. BlockNote may hand back others (it never should: the schema holds four); they are ignored. */
interface Styles {
  bold?: boolean;
  italic?: boolean;
  strike?: boolean;
  code?: boolean;
  [other: string]: unknown;
}
interface TextRun {
  type: "text";
  text: string;
  styles: Styles;
}
interface LinkRun {
  type: "link";
  href: string;
  content: TextRun[];
}
/**
 * A reference to another note or board — `[Title](dag:<id>)`. Not a link to the editor:
 * it draws the target's live title and follows the id, so it is inline content of its own. `href`
 * is the URL as written (with any `#part`), `title` the words in the brackets.
 */
interface RefRun {
  type: "ref";
  props: { href: string; title: string };
}
/**
 * An equation in a line. `$tex$`, or `$$tex$$` written mid-line, which draws as display
 * (`math.ts`). Not text with a mark: its TeX is not words, and a mark could not stop the editor
 * spell-checking, wrapping and breaking it.
 */
interface MathRun {
  type: "math";
  props: { tex: string; display: boolean };
}
type Inline = TextRun | LinkRun | RefRun | MathRun;
interface Cell {
  type: "tableCell";
  content: Inline[];
  props?: { textAlignment?: string; [other: string]: unknown };
}
interface TableContent {
  type: "tableContent";
  headerRows?: number;
  rows: { cells: (Cell | Inline[])[] }[];
  [other: string]: unknown;
}
export interface NoteBlock {
  id?: string;
  type: string;
  props?: Record<string, unknown>;
  content?: Inline[] | TableContent | string;
  children?: NoteBlock[];
}

/** The block types a note holds, which is exactly what Markdown can say. `schema.ts` builds the editor from the same list. */
export const NOTE_BLOCKS = [
  "paragraph",
  "heading",
  "bulletListItem",
  "numberedListItem",
  "checkListItem",
  "quote",
  "codeBlock",
  "divider",
  "table",
  "image",
  /* `![Title](dag:<id>)` on a line of its own: a board drawn inside the note, or a note as a card. */
  "embed",
  /* An equation on lines of its own — `$$`, or a ```math fence. */
  "equation",
  /* A quote whose first line names a kind, `> [!tip] Title` — GitHub's and Obsidian's (`callout.ts`). */
  "callout",
] as const;
export type NoteBlockType = (typeof NOTE_BLOCKS)[number];

/** The marks a note holds. `underline` has no Markdown, and a text colour is one the theme does not own. */
export const NOTE_STYLES = ["bold", "italic", "strike", "code"] as const;

const LISTS = new Set(["bulletListItem", "numberedListItem", "checkListItem"]);

/* ------------------------------------------------------------------------------------------------ */
/* Markdown → blocks                                                                                 */

const parser = unified().use(remarkParse).use(remarkGfm).use(remarkMath);

interface Ctx {
  md: string;
  defs: Map<string, { url: string; title?: string | null }>;
}

const src = (ctx: Ctx, n: Nodes): string =>
  n.position?.start.offset !== undefined && n.position.end.offset !== undefined
    ? ctx.md.slice(n.position.start.offset, n.position.end.offset)
    : "";

function run(text: string, styles: Styles): TextRun {
  return { type: "text", text, styles: { ...styles } };
}

function inline(nodes: PhrasingContent[], ctx: Ctx, styles: Styles = {}, out: Inline[] = []): Inline[] {
  for (const n of nodes) {
    switch (n.type) {
      /* A soft line break is a space. That one line is the defect this module exists for. */
      case "text":
        textWithWikilinks(n.value.replace(/[ \t]*\r?\n[ \t]*/g, " "), styles, out);
        break;
      case "break":
        out.push(run("\n", styles));
        break;
      case "inlineCode":
        out.push(run(n.value, { ...styles, code: true }));
        break;
      /* A mark around an equation is dropped: KaTeX draws in its own faces whatever is around it. */
      case "inlineMath":
        out.push({ type: "math", props: { tex: n.value, display: isDisplay(n) } });
        break;
      case "strong":
        inline(n.children, ctx, { ...styles, bold: true }, out);
        break;
      case "emphasis":
        inline(n.children, ctx, { ...styles, italic: true }, out);
        break;
      case "delete":
        inline(n.children, ctx, { ...styles, strike: true }, out);
        break;
      case "link":
        if (isDag(n.url))
          out.push({ type: "ref", props: { href: n.url, title: plainOf(textOnly(inline(n.children, ctx, {}, []))) } });
        else out.push({ type: "link", href: n.url, content: textOnly(inline(n.children, ctx, styles, [])) });
        break;
      case "linkReference": {
        const def = ctx.defs.get(n.identifier.toLowerCase());
        if (def) out.push({ type: "link", href: def.url, content: textOnly(inline(n.children, ctx, styles, [])) });
        else out.push(run(src(ctx, n), styles));
        break;
      }
      /* Everything else is kept as the text that was written: an inline image, raw HTML, a footnote
         reference. Untouched, the span map writes the original bytes back; touched, it is text. */
      default:
        out.push(run(src(ctx, n), styles));
    }
  }
  return out;
}

/**
 * Text, with each `[[wikilink]]` in it as a reference the editor draws as one (decision 7). The
 * reference's `title` is the wikilink exactly as written, so it goes back to the file byte for byte —
 * never as `dag:`, and never escaped. Inside bold or italic it stays text, for the same end.
 */
function textWithWikilinks(value: string, styles: Styles, out: Inline[]): void {
  /* A reference is atomic and wears no marks, so `**[[Plan]]**` held as one would come back unbold.
     Marked, it stays text — which `keepWikilinks` writes back unescaped — and the read view draws it. */
  if (Object.values(styles).some(Boolean)) {
    out.push(run(value, styles));
    return;
  }
  let at = 0;
  for (const w of wikilinksIn(value)) {
    if (w.index > at) out.push(run(value.slice(at, w.index), styles));
    out.push({ type: "ref", props: { href: wikiUrl(w.target, w.part), title: w.raw } });
    at = w.index + w.raw.length;
  }
  if (at < value.length || !at) out.push(run(value.slice(at), styles));
}

/** A link holds text; a link inside a link (which remark cannot produce) would flatten to its words. */
function textOnly(xs: Inline[]): TextRun[] {
  return xs.flatMap((x) =>
    x.type === "text"
      ? [x]
      : x.type === "ref"
        ? [run(x.props.title, {})]
        : x.type === "math"
          ? [run(mathSource(x), {})]
          : x.content,
  );
}

/** An inline equation as it is written. */
const mathSource = (m: MathRun): string => (m.props.display ? `$$${m.props.tex}$$` : `$${m.props.tex}$`);

const plainOf = (runs: TextRun[]): string => runs.map((r) => r.text).join("");

/** A `dag:<id>` URL — a reference, drawn by the editor as one. `src/refs/extract.ts` owns the grammar; this only asks. */
const isDag = (url: string): boolean => /^dag:[0-9a-z]{10}(?:#|$)/.test(url.trim());

function listItemBlock(li: ListItem, ordered: boolean, ctx: Ctx): NoteBlock {
  const [first, ...rest] = li.children;
  const lead = first?.type === "paragraph";
  const type = li.checked != null ? "checkListItem" : ordered ? "numberedListItem" : "bulletListItem";
  return {
    type,
    ...(li.checked != null ? { props: { checked: li.checked } } : {}),
    content: lead ? inline(first.children, ctx) : [],
    children: toBlocks(lead ? rest : li.children, ctx),
  };
}

function toBlocks(nodes: (RootContent | BlockContent)[], ctx: Ctx): NoteBlock[] {
  const out: NoteBlock[] = [];
  for (const n of nodes) out.push(...nodeBlocks(n, ctx));
  return out;
}

function alignOf(a: AlignType | undefined): string {
  return a === "center" || a === "right" ? a : "left";
}

function nodeBlocks(n: RootContent | BlockContent, ctx: Ctx): NoteBlock[] {
  switch (n.type) {
    case "heading":
      return [{ type: "heading", props: { level: n.depth }, content: inline(n.children, ctx) }];
    case "paragraph": {
      const kids = n.children.filter((c) => !(c.type === "text" && !c.value.trim()));
      if (kids.length === 1 && kids[0].type === "image" && isDag(kids[0].url)) {
        return [{ type: "embed", props: { href: kids[0].url, title: kids[0].alt ?? "" } }];
      }
      /* `![[Plan]]` alone on its line: an embed, as `![Plan](dag:…)` is, keeping what was written. */
      if (kids.length === 1 && kids[0].type === "text") {
        const said = kids[0].value.trim();
        const [w] = wikilinksIn(said);
        if (w?.embed && w.raw === said) return [{ type: "embed", props: { href: wikiUrl(w.target, w.part), title: w.raw } }];
      }
      if (kids.length === 1 && kids[0].type === "image") {
        const img = kids[0];
        return [{ type: "image", props: { url: img.url, name: img.alt ?? "", caption: img.title ?? "" } }];
      }
      return [{ type: "paragraph", content: inline(n.children, ctx) }];
    }
    case "list": {
      const items = n.children.map((li) => listItemBlock(li, !!n.ordered, ctx));
      if (n.ordered && typeof n.start === "number" && n.start !== 1 && items[0]?.type === "numberedListItem") {
        items[0].props = { ...items[0].props, start: n.start };
      }
      return items;
    }
    case "blockquote": {
      const callout = calloutBlock(n, ctx);
      if (callout) return [callout];
      const [first, ...rest] = n.children;
      const lead = first?.type === "paragraph";
      return [
        {
          type: "quote",
          content: lead ? inline(first.children, ctx) : [],
          children: toBlocks(lead ? rest : n.children, ctx),
        },
      ];
    }
    /* An equation on its own lines, whichever way it was written — and the way is kept, so a
       ```math fence somebody edits is still one. */
    case "math":
      return [{ type: "equation", props: { tex: n.value, fenced: false } }];
    case "code":
      if (n.lang === "math") return [{ type: "equation", props: { tex: n.value, fenced: true } }];
      return [{ type: "codeBlock", props: { language: n.lang || "text" }, content: n.value }];
    case "thematicBreak":
      return [{ type: "divider" }];
    case "table":
      return [tableBlock(n, ctx)];
    /* A definition is how a reference link finds its URL; it is kept as written, and drawn as the
       line it is, because BlockNote has nowhere else to hold it. */
    default:
      return [{ type: "paragraph", content: [run(src(ctx, n), {})] }];
  }
}

/**
 * A quote that opens with `[!kind]`, as a `callout` block: the kind as written (so `[!NOTE]` stays
 * upper case and an unknown word stays itself), the fold, and the title **as the bytes it was
 * written in** — a title is one line, and whatever Markdown is in it is written back exactly. The
 * rest of the first paragraph is the block's text, and so is the quote's next paragraph when the
 * first line stood alone (`> [!note]`, `>`, `> words`), which is the same callout.
 */
function calloutBlock(n: Blockquote, ctx: Ctx): NoteBlock | null {
  const parts = splitCallout(n);
  const first = n.children[0];
  const start = first?.position?.start.offset;
  if (!parts || start === undefined) return null;
  const end = ctx.md.indexOf("\n", start);
  const line = ctx.md.slice(start, end < 0 ? first.position?.end.offset : end);
  const title = line.replace(/^\[![^\]]*\][+-]?/, "").trim();
  let content = parts.body;
  let rest = parts.rest;
  if (!content.length && rest[0]?.type === "paragraph") {
    content = rest[0].children;
    rest = rest.slice(1);
  }
  return {
    type: "callout",
    props: { kind: parts.word, title, fold: parts.fold },
    content: inline(content, ctx),
    children: toBlocks(rest, ctx),
  };
}

function tableBlock(t: Table, ctx: Ctx): NoteBlock {
  return {
    type: "table",
    content: {
      type: "tableContent",
      headerRows: 1,
      rows: t.children.map((r: TableRow) => ({
        cells: r.children.map((c: MdCell, i: number) => ({
          type: "tableCell" as const,
          content: inline(c.children, ctx),
          props: { textAlignment: alignOf(t.align?.[i]) },
        })),
      })),
    },
  };
}

function definitions(root: Root): Ctx["defs"] {
  const defs: Ctx["defs"] = new Map();
  const walk = (n: Nodes) => {
    if (n.type === "definition") {
      const d = n as Definition;
      defs.set(d.identifier.toLowerCase(), { url: d.url, title: d.title });
    }
    if ("children" in n) for (const c of n.children as Nodes[]) walk(c);
  };
  walk(root);
  return defs;
}

export function mdToBlocks(md: string): NoteBlock[] {
  const root = parser.parse(md) as Root;
  return toBlocks(root.children, { md, defs: definitions(root) });
}

/* ------------------------------------------------------------------------------------------------ */
/* blocks → Markdown                                                                                 */

/**
 * The house form, which is what a block a person touched is written as: `-` bullets, `*` emphasis,
 * `**` strong, fenced code, `---` rules. Fixed, because the same blocks must always come out as the
 * same bytes or the span map cannot tell "unchanged" from "changed".
 */
const HOUSE = {
  bullet: "-",
  bulletOther: "*",
  emphasis: "*",
  strong: "*",
  fence: "`",
  fences: true,
  rule: "-",
  listItemIndent: "one",
  incrementListMarker: true,
} as const;

const writer = unified()
  .use(remarkGfm)
  .use(remarkStringify, { ...HOUSE, ...MATH_WRITE });

/**
 * The same writer escaping every dollar in text, for a group whose literal `$` would otherwise be
 * read back as an equation. Only then: escaping them always would rewrite every price in a paragraph
 * somebody edited as `\$1.2M`.
 */
const escaping = unified()
  .use(remarkGfm)
  .use(remarkEscapeDollars)
  .use(remarkStringify, { ...HOUSE, ...MATH_WRITE });

type Mark = readonly ["strong" | "emphasis" | "delete", "bold" | "italic" | "strike"];
const MARKS: readonly Mark[] = [
  ["strong", "bold"],
  ["emphasis", "italic"],
  ["delete", "strike"],
];

/** A run or a link, with the marks every part of it carries — which is what lets `**a [b](u) c**` stay one strong. */
type Piece =
  | { kind: "text"; text: string; styles: Styles }
  | { kind: "link"; href: string; runs: TextRun[]; styles: Styles }
  /** Written exactly as it stands — a wikilink, which `remark-stringify` would otherwise escape. */
  | { kind: "raw"; text: string; styles: Styles }
  | { kind: "math"; tex: string; display: boolean; styles: Styles };

const lengthOf = (p: Piece): number =>
  p.kind === "text" || p.kind === "raw"
    ? p.text.length
    : p.kind === "math"
      ? p.tex.length
      : p.runs.reduce((n, r) => n + r.text.length, 0);

function piecesOf(content: Inline[], table: boolean): Piece[] {
  const out: Piece[] = [];
  for (const c of content) {
    if (c.type === "math") {
      /* An equation with no TeX is one somebody emptied: it writes nothing, as an empty paragraph does. */
      const tex = inlineTex(c.props.tex);
      if (tex) out.push({ kind: "math", tex: table ? tex.replace(/\n/g, " ") : tex, display: !!c.props.display, styles: {} });
    } else if (c.type === "ref" && parseWikiUrl(c.props.href)) {
      out.push({ kind: "raw", text: c.props.title, styles: {} });
    } else if (c.type === "ref") {
      /* Written back with the words it was given; every surface draws the live title instead. */
      out.push({ kind: "link", href: c.props.href, runs: [{ type: "text", text: c.props.title, styles: {} }], styles: {} });
    } else if (c.type === "link") {
      const runs = c.content.map((r) => ({ ...r, text: table ? r.text.replace(/\n/g, " ") : r.text }));
      const styles: Styles = {};
      for (const [, st] of MARKS) if (runs.length && runs.every((r) => r.styles[st])) styles[st] = true;
      out.push({ kind: "link", href: c.href, runs, styles });
    } else if (c.text) {
      /* A hard break cannot live in a table cell: GFM ends the row there. */
      out.push({ kind: "text", text: table ? c.text.replace(/\n/g, " ") : c.text, styles: c.styles ?? {} });
    }
  }
  return out;
}

function without(p: Piece, style: string): Piece {
  if (p.kind !== "link") return { ...p, styles: { ...p.styles, [style]: false } };
  return {
    ...p,
    styles: { ...p.styles, [style]: false },
    runs: p.runs.map((r) => ({ ...r, styles: { ...r.styles, [style]: false } })),
  };
}

function leaves(pieces: Piece[]): PhrasingContent[] {
  const out: PhrasingContent[] = [];
  for (const p of pieces) {
    if (p.kind === "math") {
      out.push(inlineMathNode(p.tex, p.display) as InlineMath as PhrasingContent);
    } else if (p.kind === "link") {
      out.push({
        type: "link",
        url: p.href,
        children: phrasing(
          p.runs.map((r) => ({ kind: "text", text: r.text, styles: r.styles })),
          MARKS,
        ),
      });
    } else if (p.kind === "raw") {
      out.push({ type: "html", value: p.text });
    } else if (p.styles.code) {
      out.push({ type: "inlineCode", value: p.text });
    } else {
      p.text.split("\n").forEach((t, i) => {
        if (i) out.push({ type: "break" });
        if (t) out.push(...keepWikilinks(t));
      });
    }
  }
  return out;
}

/**
 * Marked text as nested mdast, outermost mark first — and the outermost is the mark with the
 * longest unbroken stretch, not a fixed order, so `*a **b** c*` stays emphasis-outside. A fixed
 * order wrote it as three runs, and the prototype's one unstable body was exactly that.
 */
function phrasing(pieces: Piece[], marks: readonly Mark[]): PhrasingContent[] {
  if (!marks.length) return leaves(pieces);
  const stretch = ([, st]: Mark): number => {
    let best = 0;
    let cur = 0;
    for (const p of pieces) {
      cur = p.styles[st] ? cur + lengthOf(p) : 0;
      best = Math.max(best, cur);
    }
    return best;
  };
  const pick = marks.reduce((a, m) => (stretch(m) > stretch(a) ? m : a), marks[0]);
  const rest = marks.filter((m) => m !== pick);
  const [node, style] = pick;
  const out: PhrasingContent[] = [];
  let group: Piece[] = [];
  let on: boolean | null = null;
  const flush = () => {
    if (!group.length) return;
    if (!on) out.push(...phrasing(group, rest));
    else
      wrap(
        group.map((p) => without(p, style)),
        node,
        rest,
        out,
      );
    group = [];
  };
  for (const p of pieces) {
    const has = !!p.styles[style];
    if (on !== null && has !== on) flush();
    on = has;
    group.push(p);
  }
  flush();
  return out;
}

/**
 * One marked group, with the whitespace at either end moved outside the mark. `**foo **bar` is not
 * strong in CommonMark, and the writer's only way to say it is `**foo&#x20;**bar` — correct, and
 * nothing anybody wants to find in a file.
 */
function wrap(group: Piece[], node: Mark[0], rest: readonly Mark[], out: PhrasingContent[]) {
  const first = group[0];
  const last = group[group.length - 1];
  let before = "";
  let after = "";
  if (first.kind === "text" && !first.styles.code) {
    const m = /^\s+/.exec(first.text);
    if (m) {
      before = m[0];
      group[0] = { ...first, text: first.text.slice(before.length) };
    }
  }
  const tail = group[group.length - 1];
  if (tail.kind === "text" && !tail.styles.code && last === tail) {
    const m = /\s+$/.exec(tail.text);
    if (m) {
      after = m[0];
      group[group.length - 1] = { ...tail, text: tail.text.slice(0, tail.text.length - after.length) };
    }
  }
  const kept = group.filter((p) => p.kind !== "text" || p.text);
  if (before) out.push({ type: "text", value: before });
  if (kept.length) out.push({ type: node, children: phrasing(kept, rest) } as PhrasingContent);
  if (after) out.push({ type: "text", value: after });
}

function inlineMd(content: NoteBlock["content"], table = false): PhrasingContent[] {
  if (!Array.isArray(content)) return typeof content === "string" && content ? [{ type: "text", value: content }] : [];
  return phrasing(piecesOf(content, table), MARKS);
}

const plain = (content: NoteBlock["content"]): string =>
  typeof content === "string"
    ? content
    : Array.isArray(content)
      ? content
          .map((c) =>
            c.type === "text"
              ? c.text
              : c.type === "ref"
                ? c.props.title
                : c.type === "math"
                  ? mathSource(c)
                  : c.content.map((r) => r.text).join(""),
          )
          .join("")
      : "";

function cellsOf(row: { cells: (Cell | Inline[])[] }): Cell[] {
  return row.cells.map((c) => (Array.isArray(c) ? { type: "tableCell", content: c } : c));
}

function tableMd(b: NoteBlock): Table | null {
  const t = b.content as TableContent | undefined;
  if (!t || !Array.isArray(t.rows) || !t.rows.length) return null;
  const rows = t.rows.map(cellsOf);
  const width = Math.max(...rows.map((r) => r.length));
  return {
    type: "table",
    align: rows[0].map((c) => {
      const a = c.props?.textAlignment;
      return a === "center" || a === "right" ? a : null;
    }),
    children: rows.map((r) => ({
      type: "tableRow",
      children: Array.from({ length: width }, (_, i) => ({
        type: "tableCell" as const,
        children: r[i] ? inlineMd(r[i].content, true) : [],
      })),
    })),
  };
}

function toMdast(blocks: NoteBlock[]): RootContent[] {
  const out: RootContent[] = [];
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (LISTS.has(b.type)) {
      let j = i;
      const items: ListItem[] = [];
      for (; j < blocks.length && blocks[j].type === b.type; j++) {
        const it = blocks[j];
        const para = inlineMd(it.content);
        items.push({
          type: "listItem",
          spread: false,
          checked: it.type === "checkListItem" ? !!it.props?.checked : null,
          children: [
            ...(para.length ? [{ type: "paragraph" as const, children: para }] : []),
            ...(toMdast(it.children ?? []) as BlockContent[]),
          ],
        });
      }
      const start = typeof b.props?.start === "number" ? (b.props.start as number) : 1;
      out.push({ type: "list", ordered: b.type === "numberedListItem", start, spread: false, children: items });
      i = j - 1;
      continue;
    }
    switch (b.type) {
      case "heading": {
        const level = Math.min(6, Math.max(1, Number(b.props?.level) || 1)) as 1 | 2 | 3 | 4 | 5 | 6;
        out.push({ type: "heading", depth: level, children: inlineMd(b.content) });
        break;
      }
      case "quote": {
        const para = inlineMd(b.content);
        out.push({
          type: "blockquote",
          children: [
            ...(para.length ? [{ type: "paragraph" as const, children: para }] : []),
            ...(toMdast(b.children ?? []) as BlockContent[]),
          ],
        });
        continue; /* its children are inside it, not after it */
      }
      case "callout":
        out.push(calloutMd(b));
        continue; /* its children are inside it, not after it */
      case "codeBlock": {
        const lang = typeof b.props?.language === "string" && b.props.language !== "text" ? b.props.language : null;
        out.push({ type: "code", lang, value: plain(b.content) });
        break;
      }
      case "divider":
        out.push({ type: "thematicBreak" });
        break;
      case "equation": {
        const tex = blockTex(typeof b.props?.tex === "string" ? b.props.tex : "");
        out.push(b.props?.fenced ? { type: "code", lang: "math", value: tex } : { type: "math", value: tex });
        break;
      }
      case "embed": {
        const href = typeof b.props?.href === "string" ? b.props.href : "";
        const title = typeof b.props?.title === "string" ? b.props.title : "";
        if (href && parseWikiUrl(href)) out.push({ type: "paragraph", children: [{ type: "html", value: title }] });
        else if (href) out.push({ type: "paragraph", children: [{ type: "image", url: href, alt: title, title: null }] });
        break;
      }
      case "image": {
        const url = typeof b.props?.url === "string" ? b.props.url : "";
        /* An image block nobody has given a file yet is nothing a file can say. */
        if (url) {
          const alt = typeof b.props?.name === "string" ? b.props.name : "";
          const caption = typeof b.props?.caption === "string" && b.props.caption ? b.props.caption : null;
          out.push({ type: "paragraph", children: [{ type: "image", url, alt, title: caption }] });
        }
        break;
      }
      case "table": {
        const t = tableMd(b);
        if (t) out.push(t);
        break;
      }
      default: {
        /* A paragraph, and anything the schema should never have held, as its words. Markdown has
           no empty paragraph, so a blank line somebody left between two blocks writes nothing. */
        const para = inlineMd(b.content);
        if (para.length) out.push({ type: "paragraph", children: para });
      }
    }
    /* Markdown cannot nest a block under a paragraph or a heading; BlockNote can. Un-nested, in order. */
    if (b.children?.length) out.push(...toMdast(b.children));
  }
  return out;
}

/**
 * A callout in the house form: its line, then its text and blocks as a quote under it —
 *
 *     > [!tip] Title
 *     > The text.
 *
 * — which is how GitHub and Obsidian are written. The quote under the line is the writer's own, so
 * everything in it is escaped as any quote's is; the line is written as it was given, because the
 * title is the bytes it was read as (`calloutBlock`). Where the first line would run into what
 * follows it — a body that opens with something that would continue it, or underline it into a
 * heading — a blank `>` line goes between them, which is the same callout. Which is decided by
 * reading the two back, not by guessing at Markdown's rules.
 *
 * A raw node, so the writer puts it where it belongs and indents it in a list or a quote; its
 * equations are found by parsing it (`equationsOf`).
 */
function calloutMd(b: NoteBlock): RootContent {
  const p = b.props ?? {};
  const head = `> ${calloutLine(String(p.kind ?? "note"), String(p.fold ?? ""), String(p.title ?? ""))}`;
  const para = inlineMd(b.content);
  const kids: BlockContent[] = [
    ...(para.length ? [{ type: "paragraph" as const, children: para }] : []),
    ...(toMdast(b.children ?? []) as BlockContent[]),
  ];
  let value = head;
  if (kids.length) {
    const quoted = stringify([{ type: "blockquote", children: kids }]);
    const compact = `${head}\n${quoted}`;
    const apart = `${head}\n>\n${quoted}`;
    value = JSON.stringify(mdToBlocks(compact)) === JSON.stringify(mdToBlocks(apart)) ? compact : apart;
  }
  return { type: "html", value, data: { callout: true } } as RootContent;
}

/** Some mdast in the house form, with no trailing newline. */
function stringify(children: RootContent[]): string {
  if (!children.length) return "";
  const root: Root = { type: "root", children };
  let out = String(writer.stringify(root));
  /* A dollar is written as it is, and then the writing is read back: if the equations in it are not
     exactly the ones written — a literal `$x$` somebody typed as text, a `$` next to an equation that
     pairs with it — the group is written again with every dollar in its text escaped. */
  if (out.includes("$") && equationsOf(parser.parse(out) as Root) !== equationsOf(root)) out = String(escaping.stringify(root));
  return out.replace(/\n+$/, "");
}

/** The blocks in the house form, with no trailing newline. */
export function blocksToMd(blocks: NoteBlock[]): string {
  return stringify(toMdast(blocks));
}

/** Every equation in a tree, in order, as one string to compare. */
function equationsOf(root: Root): string {
  return equationsIn(root).join("\u0000");
}

/** A callout `calloutMd` wrote: raw Markdown in the tree, whose equations are found by reading it. */
const isCallout = (n: Nodes): n is Html => n.type === "html" && !!(n.data as { callout?: boolean } | undefined)?.callout;

/* A callout is written before the rest, already settled, so its equations are the ones it says. */
function equationsIn(root: Nodes): string[] {
  const out: string[] = [];
  const walk = (n: Nodes) => {
    if (n.type === "inlineMath") out.push(`${isDisplay(n) ? "$$" : "$"}${n.value}`);
    else if (n.type === "math") out.push(`B${n.value}`);
    else if (isCallout(n)) out.push(...equationsIn(parser.parse(n.value)));
    if ("children" in n) for (const c of n.children as Nodes[]) walk(c);
  };
  walk(root);
  return out;
}

/* ------------------------------------------------------------------------------------------------ */
/* The span map                                                                                      */

/** One top-level Markdown node: the bytes it was written as, and the top-level blocks it became. */
interface Unit {
  ids: string[];
  source: string;
  /** What sat between the previous unit and this one — `\n\n` as often as not, and exactly that. */
  gap: string;
  /** What these blocks serialise to *as the editor holds them*, filled by `settle`. */
  canon?: string;
  /**
   * The blocks themselves, as JSON, from the same moment. Equal JSON is equal Markdown, and
   * comparing JSON is a fraction of what serialising is — so a save only re-serialises the groups
   * whose data changed. Serialising every group on every save cost 50 ms of main thread per save on
   * a 90 KB note, once every quarter-second while somebody typed.
   */
  json?: string;
}

export interface Loaded {
  units: Unit[];
  /** Before the first unit. */
  lead: string;
  /** After the last one. */
  tail: string;
}

let loads = 0;

/**
 * The body as blocks, each top-level block carrying an id the span map can find again. The ids are
 * this module's, `n<load>-<index>`; BlockNote keeps an id it is given, and invents its own for
 * nested blocks and for anything a person types.
 */
export function load(body: string): { blocks: NoteBlock[]; loaded: Loaded } {
  const root = parser.parse(body) as Root;
  const ctx: Ctx = { md: body, defs: definitions(root) };
  const tag = `n${(++loads).toString(36)}`;
  const blocks: NoteBlock[] = [];
  const units: Unit[] = [];
  let prevEnd = 0;
  let k = 0;
  for (const n of root.children) {
    const start = n.position?.start.offset ?? prevEnd;
    const end = n.position?.end.offset ?? start;
    const made = nodeBlocks(n, ctx);
    const ids = made.map(() => `${tag}-${k++}`);
    made.forEach((b, i) => (b.id = ids[i]));
    blocks.push(...made);
    if (made.length) {
      units.push({ ids, source: body.slice(start, end), gap: body.slice(prevEnd, start) });
      prevEnd = end;
    }
  }
  if (!units.length) return { blocks, loaded: { units, lead: body, tail: "" } };
  return { blocks, loaded: { units, lead: units[0].gap, tail: body.slice(prevEnd) } };
}

/**
 * The top-level block a line of the body falls in — what a search result naming `L12` or a
 * `^anchor` opens onto. `null` for a note with no blocks at all.
 *
 * Read off the span map rather than off the editor, because the map is the one thing that knows
 * which bytes became which block: every unit is its gap and its source, back to back, so the lines
 * add up without parsing the note again. A list is one unit and one block per item, and the item is
 * found by its own line — a hit in the ninth item of a long list opens there, not on the first. A
 * line in the blank space between two blocks belongs to the one after it; a line past the end, to
 * the last.
 */
export function blockAt(loaded: Loaded, line: number): string | null {
  const lines = (s: string) => s.split("\n").length - 1;
  let at = 1;
  let last: string | null = null;
  for (const u of loaded.units) {
    at += lines(u.gap);
    const start = at;
    const end = start + lines(u.source);
    if (line <= end) {
      if (u.ids.length > 1 && line >= start) {
        const list = (parser.parse(u.source) as Root).children[0];
        if (list?.type === "list") {
          let pick = u.ids[0];
          list.children.forEach((item, i) => {
            if (u.ids[i] && start + (item.position?.start.line ?? 1) - 1 <= line) pick = u.ids[i];
          });
          return pick ?? null;
        }
      }
      return u.ids[0] ?? null;
    }
    at = end;
    last = u.ids[u.ids.length - 1] ?? last;
  }
  return last;
}

/**
 * Record what each unit serialises to once the editor holds it. BlockNote normalises what it is
 * given — a default prop filled in, a language it does not know — so "unchanged" has to be measured
 * against the editor's own blocks, not against the ones `load` handed it; measured against the
 * latter, the first keystroke anywhere would rewrite every block BlockNote had tidied.
 */
export function settle(loaded: Loaded, doc: NoteBlock[]): Loaded {
  const byId = new Map(doc.map((b) => [b.id, b]));
  return {
    ...loaded,
    units: loaded.units.map((u) => {
      const blocks = u.ids.map((id) => byId.get(id));
      if (!blocks.every(Boolean)) return { ...u, canon: undefined, json: undefined };
      return { ...u, canon: blocksToMd(blocks as NoteBlock[]), json: JSON.stringify(blocks) };
    }),
  };
}

interface Group {
  blocks: NoteBlock[];
  /** The unit these blocks were loaded as, when they still are exactly those blocks. */
  unit?: number;
}

/**
 * The document's top-level blocks cut into the groups `save` writes: a loaded unit's blocks where
 * they still stand together, otherwise one block — or one run of list items of one kind, because
 * items written one group each would be separate lists, and a list somebody added to is a list
 * somebody touched.
 */
function groups(doc: NoteBlock[], loaded: Loaded): Group[] {
  const starts = new Map(loaded.units.map((u, i) => [u.ids[0], i]));
  const whole = (i: number): number | undefined => {
    const u = starts.get(doc[i]?.id ?? "");
    if (u === undefined) return undefined;
    const ids = loaded.units[u].ids;
    if (!ids.every((id, k) => doc[i + k]?.id === id)) return undefined;
    /* A list that grew an item at its end is one list, and a touched one. */
    const next = doc[i + ids.length];
    const last = doc[i + ids.length - 1];
    if (next && LISTS.has(last.type) && next.type === last.type && !starts.has(next.id ?? "")) return undefined;
    return u;
  };
  const out: Group[] = [];
  let i = 0;
  while (i < doc.length) {
    const u = whole(i);
    if (u !== undefined) {
      const n = loaded.units[u].ids.length;
      out.push({ blocks: doc.slice(i, i + n), unit: u });
      i += n;
      continue;
    }
    let j = i + 1;
    if (LISTS.has(doc[i].type)) while (j < doc.length && doc[j].type === doc[i].type && whole(j) === undefined) j++;
    out.push({ blocks: doc.slice(i, j) });
    i = j;
  }
  return out;
}

/**
 * The body for these blocks: the loaded bytes wherever a group is untouched, the house form
 * wherever it is not. With nothing touched this is the body that was loaded, byte for byte — which
 * `test/note-markdown.test.ts` holds over every Markdown body in the repository.
 */
export function save(loaded: Loaded, doc: NoteBlock[]): string {
  return saved(loaded, doc).body;
}

/**
 * `save`, and the span map for the body it wrote.
 *
 * **Once a save lands, it is the file** — so the map a later save, merge or outside write is
 * measured against has to be this one, not the one the note was opened with. Measured against the
 * opening, every block a person has edited and saved still looks edited, and an outside write
 * replaces it rather than keeping it: the caret in it goes with it. Each group becomes a unit whose
 * source is exactly the bytes just written for it.
 */
export function saved(loaded: Loaded, doc: NoteBlock[]): { body: string; loaded: Loaded } {
  const parts: { text: string; canon: string; json: string; ids: string[]; unit?: number }[] = [];
  for (const g of groups(doc, loaded)) {
    const json = JSON.stringify(g.blocks);
    const ids = g.blocks.map((b) => b.id ?? "");
    const unit = g.unit === undefined ? undefined : loaded.units[g.unit];
    /* Unchanged data is unchanged Markdown: the loaded bytes, with no serialising at all. */
    if (unit && unit.canon !== undefined && unit.json === json) {
      parts.push({ text: unit.source, canon: unit.canon, json, ids, unit: g.unit });
      continue;
    }
    const canon = blocksToMd(g.blocks);
    if (unit && unit.canon !== undefined && unit.canon === canon) {
      parts.push({ text: unit.source, canon, json, ids, unit: g.unit });
    } else if (canon) {
      parts.push({ text: canon, canon, json, ids });
    }
  }
  if (!parts.length) {
    const body = loaded.units.length ? "" : loaded.lead;
    return { body, loaded: { units: [], lead: body, tail: "" } };
  }
  const units: Unit[] = [];
  let body = "";
  parts.forEach((p, i) => {
    const prev = parts[i - 1];
    let gap: string;
    if (i === 0) gap = p.unit === 0 ? loaded.lead : "";
    else if (p.unit !== undefined && prev.unit !== undefined && p.unit === prev.unit + 1) gap = loaded.units[p.unit].gap;
    else gap = "\n\n";
    body += gap + p.text;
    units.push({ ids: p.ids, source: p.text, gap, canon: p.canon, json: p.json });
  });
  const last = parts[parts.length - 1];
  const tail = last.unit !== undefined && last.unit === loaded.units.length - 1 ? loaded.tail : "\n";
  body += tail;
  return { body, loaded: { units, lead: units[0].gap, tail } };
}

/* ------------------------------------------------------------------------------------------------ */
/* An outside write, while the note is open                                                          */

export type Step =
  /** Keep these blocks where they are; nothing about them changed. */
  | { kind: "keep"; ids: string[] }
  /** Take these blocks away. */
  | { kind: "remove"; ids: string[] }
  /** Put these blocks in, after the block with this id (or first, with none). */
  | { kind: "insert"; after: string | null; blocks: NoteBlock[] };

/**
 * What an outside write means for a note that is open with nothing pending: the units whose bytes
 * did not change keep their blocks — and so the caret, and the selection, and ProseMirror's idea of
 * where everything is — and only the rest are taken out and put in. `doc` is the editor's top level;
 * a unit counts as kept only if the editor still holds it unchanged, so a stale `settle` can never
 * keep a block somebody has since typed into.
 *
 * Units are matched by an LCS over their source bytes, so a paragraph an agent inserted between two
 * others inserts one block rather than replacing everything after it.
 */
export function plan(loaded: Loaded, doc: NoteBlock[], body: string): { steps: Step[]; loaded: Loaded } {
  const next = load(body);
  const intact = new Set(
    groups(doc, loaded)
      .filter((g) => {
        if (g.unit === undefined) return false;
        const u = loaded.units[g.unit];
        return (u.json !== undefined && u.json === JSON.stringify(g.blocks)) || blocksToMd(g.blocks) === u.canon;
      })
      .map((g) => g.unit as number),
  );
  const a = loaded.units.map((u, i) => (intact.has(i) ? u.source : `\u0000${i}`));
  const b = next.loaded.units.map((u) => u.source);
  const pairs = lcs(a, b);

  /* The new document's blocks, grouped by unit, so a kept unit can hand its ids over. */
  const byUnit: NoteBlock[][] = [];
  let at = 0;
  for (const u of next.loaded.units) {
    byUnit.push(next.blocks.slice(at, at + u.ids.length));
    at += u.ids.length;
  }

  const steps: Step[] = [];
  const units: Unit[] = [];
  const oldTop = doc.map((d) => d.id as string);
  /* Every block the editor holds that is not a kept unit goes, including anything no unit claims. */
  const keptIds = new Set(pairs.flatMap(([i]) => loaded.units[i].ids));
  const gone = oldTop.filter((id) => !keptIds.has(id));
  if (gone.length) steps.push({ kind: "remove", ids: gone });

  let after: string | null = null;
  let p = 0;
  for (let j = 0; j < next.loaded.units.length; j++) {
    const nu = next.loaded.units[j];
    if (p < pairs.length && pairs[p][1] === j) {
      const old = loaded.units[pairs[p][0]];
      steps.push({ kind: "keep", ids: old.ids });
      units.push({ ...nu, ids: old.ids, canon: old.canon, json: old.json });
      after = old.ids[old.ids.length - 1];
      p++;
    } else {
      steps.push({ kind: "insert", after, blocks: byUnit[j] });
      units.push({ ...nu, canon: undefined });
      after = nu.ids[nu.ids.length - 1];
    }
  }
  return { steps, loaded: { units, lead: next.loaded.lead, tail: next.loaded.tail } };
}

/** The three things `applySteps` asks of an editor — BlockNote's own calls, named here so the order
    they are made in can be held by a test without a browser. */
export interface StepTarget {
  remove(ids: string[]): void;
  insert(blocks: NoteBlock[], at: string, where: "before" | "after"): void;
  replace(ids: string[], blocks: NoteBlock[]): void;
}

/**
 * `plan`'s steps made on an editor holding the top-level blocks `top`.
 *
 * Every anchor is decided from `top` and the steps, **never read back off the editor between them**:
 * inside one transaction BlockNote's `document` still answers with the blocks as they were, so an
 * insert at the top of a note whose first block had just been removed was told to go before a block
 * that no longer existed — *Block with ID … not found*, the outside write lost, and the stale text
 * saved back over it when the page was left. An insert with no `after` goes before the first block
 * the plan keeps; and when it keeps none — a note of one paragraph, edited elsewhere — the whole
 * document is replaced in one call, because there is no block left to anchor anything to.
 */
export function applySteps(top: string[], steps: Step[], ed: StepTarget): void {
  const removed = new Set(steps.flatMap((s) => (s.kind === "remove" ? s.ids : [])));
  const first = top.find((id) => !removed.has(id));
  if (first === undefined) {
    const blocks = steps.flatMap((s) => (s.kind === "insert" ? s.blocks : []));
    if (top.length && blocks.length) ed.replace(top, blocks);
    else if (top.length) ed.remove(top);
    return;
  }
  for (const s of steps) {
    if (s.kind === "remove" && s.ids.length) ed.remove(s.ids);
    if (s.kind === "insert" && s.blocks.length) {
      if (s.after) ed.insert(s.blocks, s.after, "after");
      else ed.insert(s.blocks, first, "before");
    }
  }
}

/** Longest common subsequence of two string lists, as index pairs in order. */
export function lcs(a: string[], b: string[]): [number, number][] {
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: [number, number][] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push([i, j]);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  return out;
}
