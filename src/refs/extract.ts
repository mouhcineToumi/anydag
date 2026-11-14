/**
 * What a reference *is*, once.
 *
 * A reference is a Markdown link whose URL is `dag:<id>`: `[Title](dag:k3f9x2m1qa)` links to a note
 * or a board, `![Title](dag:k3f9x2m1qa)` embeds one, and either may name a block or an item after a
 * `#`. The id is the store's permanent one, so a rename or a move changes nothing in any file, and
 * the words in the brackets are only what a viewer with no index would show: every surface here
 * draws the target's *live* title instead.
 *
 * The references table the issue asks for is **derived from this, never written**: the `dsl`
 * service runs it over every text an account has, and the page filters the answer for backlinks.
 * Two stores of one fact is the drift this repository keeps recording.
 *
 * Browser-free and alias-free — the local server imports it, as it imports `src/board/`.
 */
import type { Nodes, Root } from "mdast";
import { parse as parseYaml } from "yaml";

import { QUIET } from "../note/quiet";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";

import { isItemType } from "../board/types";
import { locateItems } from "../board/locate";
import { eventOf, type NoteEvent } from "../note/event";
import { projectOf, type Project } from "../note/project";
import { taskOf, type Task } from "../note/task";
import { parseQuiz } from "../quiz/parse";
import { resolveWiki, wikilinkTree, parseWikiUrl, type WikiCandidate } from "./wikilinks";
import { remarkMath } from "../note/math";

type RefType = "link" | "embed";

export interface Ref {
  /**
   * The target document's permanent id. A wikilink's is `""` as the text says it — it names a
   * document by name — and is filled in by whoever has the vault's list (`resolveWikiRefs`).
   */
  id: string;
  /** A `[[wikilink]]`'s target, as written: what it names, rather than which document. */
  wiki?: string;
  type: RefType;
  /** A block anchor or an item id inside the target, after the `#`. */
  part?: string;
  /** What the brackets said — the fallback title. */
  text: string;
}

const DAG = /^dag:([0-9a-z]{10})(?:#(.+))?$/;

/** The id and the part a `dag:` URL names, or `null` for any other URL. */
export function parseDagUrl(url: string): { id: string; part?: string } | null {
  const m = DAG.exec(url.trim());
  return m ? { id: m[1]!, ...(m[2] ? { part: m[2] } : {}) } : null;
}

export const dagUrl = (id: string, part?: string): string => (part ? `dag:${id}#${part}` : `dag:${id}`);

const parser = unified().use(remarkParse).use(remarkGfm).use(remarkMath);

const textOf = (n: Nodes): string =>
  "value" in n && typeof n.value === "string" ? n.value : "children" in n ? (n.children as Nodes[]).map(textOf).join("") : "";

/** Every reference in a piece of Markdown, in document order. Code is code, and holds none. */
export function refsInMarkdown(md: string): Ref[] {
  const out: Ref[] = [];
  const walk = (n: Nodes) => {
    if (n.type === "code" || n.type === "inlineCode") return;
    if (n.type === "link" || n.type === "image") {
      const text = n.type === "image" ? (n.alt ?? "") : textOf(n);
      const type = n.type === "image" ? "embed" : "link";
      const hit = parseDagUrl(n.url);
      if (hit) out.push({ ...hit, type, text });
      const wiki = parseWikiUrl(n.url);
      if (wiki?.target) out.push({ id: "", wiki: wiki.target, ...(wiki.part ? { part: wiki.part } : {}), type, text });
    }
    if ("children" in n) for (const c of n.children as Nodes[]) walk(c);
  };
  const tree = parser.parse(md) as Root;
  wikilinkTree(tree);
  walk(tree);
  return out;
}

/**
 * Every wikilink's id, from the vault's list: what `[[Plan]]` names now. One that names nothing keeps
 * `id: ""`, which no document has, so it is a backlink of nothing until the note it names exists.
 */
export function resolveWikiRefs<R extends Pick<Ref, "id" | "wiki">>(refs: readonly R[], docs: readonly WikiCandidate[]): R[] {
  return refs.map((r) => (r.wiki === undefined ? r : { ...r, id: resolveWiki(r.wiki, docs)?.id ?? "" }));
}

/**
 * Every reference on a board: in the body of each `md` and `note` item, which is where a board
 * holds Markdown, and the `src` of an image drawn from an attachment. A diagram's DSL has no link
 * syntax, and a fence's body is not Markdown to the board, so a `dag:` URL inside an `arch` fence is
 * text rather than a reference.
 */
export function refsInBoard(text: string): Ref[] {
  const { items } = locateItems(text, isItemType);
  return items.flatMap((it): Ref[] => {
    if (it.type === "md" || it.type === "note") return refsInMarkdown(it.body);
    /* An image drawn from an attachment: `src="dag:<id>"` is the one attribute that names
       another document, and it is an embed — the board uses the file — so its backlinks say so and
       deleting it asks first. The caption is what the brackets would have said. */
    const src = it.type === "image" ? it.attrs.map.src : undefined;
    if (typeof src === "string") {
      const hit = parseDagUrl(src);
      if (hit) return [{ ...hit, type: "embed", text: it.body.trim() }];
    }
    return [];
  });
}

const FRONT = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

/** A board's or a note's `title:` from its frontmatter, when it has one — what a reference shows. */
export function titleOf(text: string): string | undefined {
  const m = FRONT.exec(text);
  if (!m) return undefined;
  try {
    const data = parseYaml(m[1]!, QUIET) as { title?: unknown } | null;
    return typeof data?.title === "string" && data.title.trim() ? data.title.trim() : undefined;
  } catch {
    return undefined;
  }
}

/** One document as the index sees it: what it is called, what it points at, and — for a note — whether it is a task. */
export interface Indexed {
  title?: string;
  /** What makes a note a task. Absent on a board, which never is one, and on a plain note. */
  task?: Task;
  /** What makes a note a project: what a card on a board says under its title. */
  project?: Project;
  /** What makes a note an event: when a card on a board says it is. Never beside `task`. */
  event?: NoteEvent;
  /** How many questions a quiz asks — what its card on a board says. Absent on anything else. */
  questions?: number;
  refs: Ref[];
}

/**
 * What the local server's `/index` answers, over every text an account has. A key ending
 * `.note.md` is a note, one ending `.quiz.md` a quiz and one ending `.table.md` a table — the
 * convention `Store.texts` keys them by — and anything else a board. A quiz is Markdown from end to
 * end, so its references are read the way a note's are: a `dag:` link in a prompt or an
 * explanation is one. A table is too: its tabs are GFM tables, and a link cell holding
 * `[Title](dag:<id>)` is a reference, which is what puts a table in the backlinks of what it names.
 */
export function indexTexts(texts: Record<string, string>): Record<string, Indexed> {
  const out: Record<string, Indexed> = {};
  for (const [key, text] of Object.entries(texts)) {
    const note = key.endsWith(".note.md");
    const quiz = key.endsWith(".quiz.md");
    const table = key.endsWith(".table.md");
    const task = note ? taskOf(text) : undefined;
    const project = note ? projectOf(text) : undefined;
    const event = note ? eventOf(text) : undefined;
    const refs = note || quiz || table ? refsInMarkdown(text.replace(FRONT, "")) : refsInBoard(text);
    out[key] = {
      title: titleOf(text),
      ...(task ? { task } : {}),
      ...(project ? { project } : {}),
      ...(event ? { event } : {}),
      ...(quiz ? { questions: parseQuiz(text).questions.length } : {}),
      refs,
    };
  }
  return out;
}
