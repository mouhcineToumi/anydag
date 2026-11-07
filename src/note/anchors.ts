/**
 * A block's id inside a note.
 *
 * Markdown has no block id, and a note is Markdown an agent writes and a person edits, so the id is
 * Obsidian's: ` ^k3f9x2` at the end of the block's last line, **written only when something first
 * points at the block**. A note nobody links into carries none, which is what keeps every note on
 * disk the Markdown it was, and keeps the span map's promise — an edit rewrites only the blocks it
 * touched — true with no new case in it: an anchor is text at the end of a paragraph, the editor
 * holds it as text, and the house form writes it back as it found it.
 *
 * A paragraph and a heading carry one, and so does a list item or a quote, whose words are a
 * paragraph. A code block cannot (an anchor inside one is code) and neither can a table, whose last
 * line is a row; both are refused rather than half-supported.
 *
 * The editor shows the anchor as the text it is. The read-only view (`remarkAnchors`) takes it off
 * the words and puts it on the element instead, so `#^k3f9x2` scrolls to the block.
 *
 * No browser, no React, no `@/` aliases: `src/board/`'s rule, for the reason it gives.
 */
import type { Heading, Nodes, Paragraph, Root, Text } from "mdast";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { remarkMath } from "./math";

const parser = unified().use(remarkParse).use(remarkGfm).use(remarkMath);

/** Lower-case letters, digits and inner hyphens — Obsidian's shape, and a valid fragment as written. */
const NAME = "[a-z0-9]+(?:-[a-z0-9]+)*";
/** At the very end of a block, after a space: `words ^name`. */
const TRAILING = new RegExp(`[ \\t]\\^(${NAME})[ \\t]*$`);

export interface Anchor {
  id: string;
  /** The block's span in the note, anchor included. */
  start: number;
  end: number;
  /** 1-based line the block starts on. */
  line: number;
  /** The block's words without the anchor — what a reference to it shows. */
  text: string;
}

type Carrier = Paragraph | Heading;

function carriers(md: string): Carrier[] {
  const out: Carrier[] = [];
  const walk = (n: Nodes) => {
    if (n.type === "paragraph" || n.type === "heading") {
      out.push(n);
      return;
    }
    /* A code block's text is code and a table's last line is a row: neither can hold an anchor. */
    if (n.type === "code" || n.type === "table") return;
    if ("children" in n) for (const c of n.children as Nodes[]) walk(c);
  };
  walk(parser.parse(md) as Root);
  return out;
}

const spanOf = (n: Carrier) => ({ start: n.position?.start.offset ?? 0, end: n.position?.end.offset ?? 0 });

/** Every anchored block in a note, in order. A second block claiming an anchor already seen is ignored. */
export function anchorsOf(md: string): Anchor[] {
  const out: Anchor[] = [];
  const seen = new Set<string>();
  for (const n of carriers(md)) {
    const { start, end } = spanOf(n);
    const source = md.slice(start, end);
    const m = TRAILING.exec(source);
    if (!m || seen.has(m[1]!)) continue;
    seen.add(m[1]!);
    out.push({
      id: m[1]!,
      start,
      end,
      line: n.position?.start.line ?? 1,
      text: source
        .slice(0, m.index)
        .replace(/^#{1,6}[ \t]+/, "")
        .trim(),
    });
  }
  return out;
}

const ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";

/** Six characters nobody in this note has — thirty bits, which within one note is plenty. */
export function freshAnchor(taken: ReadonlySet<string>, random: () => number = Math.random): string {
  for (;;) {
    let id = "";
    for (let i = 0; i < 6; i++) id += ALPHABET[Math.floor(random() * ALPHABET.length)];
    if (!taken.has(id)) return id;
  }
}

/**
 * The anchor of the block at `offset`, writing one if it has none — the lazy half.
 *
 * A span edit: the anchor goes on the end of the block's last line and nothing else in the note is
 * touched. `null` when there is no block there that can carry one.
 */
export function anchorBlock(md: string, offset: number, random?: () => number): { md: string; id: string } | null {
  const block = carriers(md).find((n) => {
    const { start, end } = spanOf(n);
    return offset >= start && offset <= end;
  });
  if (!block) return null;
  const { end } = spanOf(block);
  const source = md.slice(spanOf(block).start, end);
  const had = TRAILING.exec(source);
  if (had) return { md, id: had[1]! };
  const id = freshAnchor(new Set(anchorsOf(md).map((a) => a.id)), random);
  return { md: `${md.slice(0, end)} ^${id}${md.slice(end)}`, id };
}

/**
 * A remark plugin for the read-only view: an anchor leaves the words and becomes the element's `id`,
 * `^name`, so the block draws as what was written and `#^name` scrolls to it.
 */
export function remarkAnchors() {
  return (tree: Root) => {
    const walk = (n: Nodes) => {
      if (n.type === "paragraph" || n.type === "heading") {
        const last = n.children[n.children.length - 1];
        if (last?.type === "text") {
          const m = TRAILING.exec(last.value);
          if (m) {
            (last as Text).value = last.value.slice(0, m.index);
            n.data = { ...n.data, hProperties: { ...(n.data?.hProperties ?? {}), id: `^${m[1]}` } };
          }
        }
        return;
      }
      if ("children" in n) for (const c of n.children as Nodes[]) walk(c);
    };
    walk(tree);
  };
}
