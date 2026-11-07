/**
 * What a search can find, cut into the pieces a result can point at.
 *
 * **Derived from the texts, never stored beside them**, which is the references index's argument
 * (`src/refs/extract.ts`) made a second time: every word a search could match is already in a file,
 * so a second copy is one a write could leave behind. The local server runs this over every text
 * the vault has (`POST /corpus`) and the page builds its index from the answer, in the browser.
 *
 * A **unit** is the smallest thing a result can open onto, and it has to be something with a stable
 * name, because the result is a link:
 *
 * - **On a board, an item** — its `#id`, which every item carries in the file. A
 *   diagram is one unit holding every title, label and note its parse reads, because the item is
 *   what the canvas can select and zoom to; a card inside it has an id only the dialect knows.
 *   Hidden items and `edges` fences are left out: neither draws anything a result could show.
 * - **In a note, a block** — its `^anchor` when something has already pointed at it, and its line
 *   (`L12`) when nothing has. A search is a read, and minting an anchor would turn it into a write
 *   into a file somebody may be typing in; a line is the pointer a block has before anybody asked
 *   for a better one, and it is fresh because the corpus is re-read whenever the note changes.
 * - **The document itself**, for its title — a unit with no part, which opens the document.
 *
 * Browser-free and alias-free, for the reason `src/board/` is: the local server imports it.
 */
import type { Nodes, Root, RootContent } from "mdast";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";

import { parseBoard } from "../board/parseBoard";
import { parseItem } from "../dsl/diagnose";
import type { Graph } from "../dsl/ir";
import { hasDialect } from "../dsl/parse";
import type { SequenceModel, SeqEvent } from "../dsl/sequence";
import type { ChartModel } from "../dsl/chart";
import { anchorsOf } from "../note/anchors";
import { splitNote } from "../note/format";
import { parseQuiz } from "../quiz/parse";
import { parseTable } from "../table/parse";
import { remarkMath } from "../note/math";

export interface Unit {
  /**
   * Where inside the document: an item id on a board, `^anchor` or `L<line>` in a note — the part
   * after the `#` of a reference. Absent is the document itself.
   */
  part?: string;
  /** What kind of thing matched — `title`, an item type (`md`, `arch`, `image`…), or a note block (`heading`, `paragraph`, `list`…). */
  what: string;
  /** The words, as plain text with the whitespace collapsed. */
  text: string;
}

export interface CorpusDoc {
  title?: string;
  units: Unit[];
}

const parser = unified().use(remarkParse).use(remarkGfm).use(remarkMath);

/** One line between two blocks of text, none inside a run of inline text. */
const BLOCKS = new Set(["root", "blockquote", "list", "listItem", "footnoteDefinition"]);

/**
 * A Markdown node as the words a person reads: code included (it is content somebody may look for),
 * an image as its alt text, a table a cell at a time, and a reference as the words in its brackets.
 */
function plain(n: Nodes): string {
  switch (n.type) {
    case "text":
    case "inlineCode":
    case "code":
    /* An equation's TeX, which is what somebody who remembers one types into a search. */
    case "inlineMath":
    case "math":
      return n.value;
    case "image":
      return n.alt ?? "";
    case "break":
    case "thematicBreak":
      return " ";
    case "html":
    case "yaml":
    case "definition":
      return "";
    case "table":
      return n.children.map((row) => row.children.map(plain).join(" · ")).join("\n");
    default:
      if (!("children" in n)) return "";
      return (n.children as Nodes[]).map(plain).join(BLOCKS.has(n.type) ? "\n" : "");
  }
}

/** An anchor at the end of a line is a name for the block, not a word in it. */
const ANCHOR_AT_END = /[ \t]\^[a-z0-9]+(?:-[a-z0-9]+)*[ \t]*(?=\n|$)/g;

const squash = (s: string): string => s.replace(ANCHOR_AT_END, "").replace(/\s+/g, " ").trim();

/** Every string a diagram's parse draws: titles, metas, notes, labels, rows, legends and categories. */
function diagramWords(model: Graph | SequenceModel | ChartModel): string[] {
  const out: string[] = [];
  const add = (...s: (string | undefined)[]) => {
    for (const v of s) if (v && v.trim()) out.push(v.trim());
  };
  if (model.kind === "graph") {
    for (const g of model.groups) add(g.label, g.sublabel);
    for (const l of model.lanes) add(l.label);
    for (const n of model.nodes) {
      /* An ink stroke has no words, and a node the parser titled with its own id says nothing new. */
      if (n.kind === "ink") continue;
      add(n.title, n.meta, n.desc, n.stereotype);
      for (const r of [...n.rows, ...(n.compartments ?? []).flat()]) add(r.name, r.detail);
    }
    for (const e of model.edges) add(e.label);
  } else if (model.kind === "sequence") {
    for (const p of model.participants) add(p.title, p.meta);
    const walk = (events: SeqEvent[]) => {
      for (const e of events) {
        if (e.t === "msg" || e.t === "note") add(e.text);
        else if (e.t === "fragment")
          for (const b of e.branches) {
            add(b.label);
            walk(b.events);
          }
      }
    };
    walk(model.events);
  } else {
    add(...model.categories);
    for (const s of model.series) add(s.title);
    for (const s of model.slices) add(s.title);
    add(model.unit, model.hero?.label);
  }
  for (const l of model.legend) add(l.text);
  /* A word said twice in one diagram is one hit, not two. */
  return [...new Set(out)];
}

/** A board: its title, then one unit per item a result could open onto. */
export function boardCorpus(text: string): CorpusDoc {
  const board = parseBoard("", text);
  const units: Unit[] = [];
  if (board.title) units.push({ what: "title", text: board.title });
  for (const it of board.items) {
    if (it.hidden || it.type === "edges") continue;
    let words: string[];
    if (it.type === "md" || it.type === "note") words = [plain(parser.parse(it.body) as Root)];
    else if (it.type === "image" || it.type === "prompt") words = [it.body];
    else if (hasDialect(it.type)) {
      const model = parseItem(it);
      words = model ? diagramWords(model as Graph | SequenceModel | ChartModel) : [];
    } else words = [];
    const all = squash([it.title, it.subtitle, ...words].filter(Boolean).join(" · "));
    if (all) units.push({ part: it.id, what: it.type, text: all });
  }
  return { title: board.title, units };
}

const BLOCK_NAMES: Partial<Record<RootContent["type"], string>> = {
  heading: "heading",
  paragraph: "paragraph",
  list: "list",
  blockquote: "quote",
  code: "code",
  table: "table",
  /* An equation on lines of its own, found by its TeX. */
  math: "equation",
};

/**
 * A note: its title, then one unit per top-level block — and one per item of a list, which is what
 * the editor holds as a block of its own, so a hit in the ninth item of a long list opens there.
 *
 * Lines are the **file's**, frontmatter included, because that is what a person would count and
 * what an agent reading the file sees; the editor takes the frontmatter back off.
 */
export function noteCorpus(text: string): CorpusDoc {
  const { front, body, title } = splitNote(text);
  const lead = front.split("\n").length - 1;
  const anchors = anchorsOf(body);
  const units: Unit[] = [];
  if (title) units.push({ what: "title", text: title });

  const push = (n: Nodes, what: string) => {
    const start = n.position?.start.offset ?? 0;
    const end = n.position?.end.offset ?? start;
    const words = squash(plain(n));
    if (!words) return;
    const anchor = anchors.find((a) => a.start >= start && a.end <= end);
    units.push({ part: anchor ? `^${anchor.id}` : `L${(n.position?.start.line ?? 1) + lead}`, what, text: words });
  };

  for (const n of (parser.parse(body) as Root).children) {
    const what = BLOCK_NAMES[n.type];
    if (!what) continue;
    if (n.type === "list") for (const item of n.children) push(item, "list");
    else push(n, what);
  }
  return { title, units };
}

/**
 * A quiz: its title, its description, and **one unit per question** — the prompt, the
 * rest of it, every option and the explanation, as the words a person reads. The part is the
 * question's `{#id}`, which the quiz page opens its editor onto; a question with no id yet is
 * named by its heading's line, a note's rule for a block nothing has anchored, because a search
 * is a read and minting an id would be a write.
 */
function quizCorpus(text: string): CorpusDoc {
  const quiz = parseQuiz(text);
  const { title } = splitNote(text);
  const units: Unit[] = [];
  if (title) units.push({ what: "title", text: title });
  const words = (md: string): string => (md.trim() ? squash(plain(parser.parse(md) as Root)) : "");
  const description = words(quiz.description);
  if (description) units.push({ what: "paragraph", text: description });
  for (const q of quiz.questions) {
    const text = [q.prompt, words(q.body), ...q.options.map((o) => words(o.text)), words(q.why)].filter(Boolean).join(" ");
    if (text) units.push({ part: q.id ?? `L${q.line}`, what: "question", text: squash(text) });
  }
  return title ? { title, units } : { units };
}

/**
 * A table: its title, its description, **one unit per tab** — its name and its columns',
 * so a search for a column finds the tab it is in — and **one unit per row**, every cell's words.
 * A row's part is `<tab>/<row>`, which the table page opens on and marks; a row with no id yet is
 * `<tab>/L<line>`, the note's rule for a block nothing has anchored, because a search is a read and
 * minting an id would be a write.
 */
function tableCorpus(text: string): CorpusDoc {
  const table = parseTable(text);
  const { title } = splitNote(text);
  const units: Unit[] = [];
  if (title) units.push({ what: "title", text: title });
  const words = (md: string): string => (md.trim() ? squash(plain(parser.parse(md) as Root)) : "");
  const description = words(table.description);
  if (description) units.push({ what: "paragraph", text: description });
  for (const tab of table.tabs) {
    const at = tab.id ?? `L${tab.line}`;
    const heading = squash([tab.name, ...tab.columns.map((c) => c.name)].join(" "));
    if (heading) units.push({ part: at, what: "tab", text: heading });
    for (const row of tab.rows) {
      const cells = squash(row.cells.map((c) => words(c.replace(/\n/g, " "))).filter(Boolean).join(" "));
      if (cells) units.push({ part: tab.id ? `${tab.id}/${row.id ?? `L${row.line}`}` : `L${row.line}`, what: "row", text: cells });
    }
  }
  return title ? { title, units } : { units };
}

/**
 * What the local server's `/corpus` answers, over every text the vault has — keyed the way
 * `Store.texts` keys them: a key ending `.note.md` is a note, `.quiz.md` a quiz, `.table.md` a
 * table, and anything else a board.
 */
export function corpusTexts(texts: Record<string, string>): Record<string, CorpusDoc> {
  const out: Record<string, CorpusDoc> = {};
  for (const [key, text] of Object.entries(texts))
    out[key] = key.endsWith(".note.md")
      ? noteCorpus(text)
      : key.endsWith(".quiz.md")
        ? quizCorpus(text)
        : key.endsWith(".table.md")
          ? tableCorpus(text)
          : boardCorpus(text);
  return out;
}
