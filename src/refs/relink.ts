/**
 * Keeping `[[wikilinks]]` pointed where they pointed when a document's name changes — Obsidian's
 * *Automatically update internal links*.
 *
 * A wikilink names a document by name (decision 7), and since decision 14 a document's name is its
 * title, so retitling a note, moving it or moving its folder used to leave every `[[Old title]]` in
 * the vault naming nothing — or, worse, naming somebody else. This is the arithmetic that puts them
 * back: given the vault's list **before** the change and **after** it, every wikilink that resolved
 * to a document before and does not resolve to the same document after is rewritten so that it does.
 *
 * Four rules, each Obsidian's:
 *
 * - **Only the target is rewritten.** `[[Plan#Budget|the plan]]` keeps its `#Budget`, its alias, its
 *   spacing and a table's `\|`; the `!` of an embed and the brackets stay where they were. No other
 *   byte of the file moves.
 * - **The author's form is kept.** A link written as a full path is written as the new full path; one
 *   written as a leaf, or a partial path, as the shortest tail of the new name that names the document
 *   alone, never shorter than what was written; one that matched a title, as the new title. A `.md` or
 *   a `.board` written after the name stays after it.
 * - **A link that resolved elsewhere is left resolving there**, which usually means untouched — and
 *   when the moved document now wins a tie it used to lose (`[[Plan]]` naming `a/Plan` until another
 *   `Plan` arrives at the top level), it is rewritten to keep naming `a/Plan`. A link that named
 *   nothing is never touched: a document taking the name a dangling link asks for is the link coming
 *   alive, which is the point of writing one first.
 * - **Code is code.** The places a link is read are exactly `extract.ts`'s: the Markdown of a note, a
 *   quiz and a table outside code, maths and an ordinary link's text, and the `md` and `note` items
 *   of a board. A `[[x]]` in a code span or a diagram's DSL is text, and stays as written.
 *
 * Browser-free and alias-free: the local server imports it, as it imports `extract.ts`. Resolution is
 * `resolveWiki`'s and no one else's, so the page, the index and this cannot disagree about what a
 * link names.
 */
import type { Nodes, Root } from "mdast";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";

import { isItemType } from "../board/types";
import { locateItems } from "../board/locate";
import { remarkMath } from "../note/math";
import { WIKILINK, resolveWiki, type WikiCandidate } from "./wikilinks";

const FRONT = /^---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/;

const parser = unified().use(remarkParse).use(remarkGfm).use(remarkMath);

/** One wikilink as this needs it: where its target sits in the file, and what it says. */
interface Site {
  /** The target's span in the full text, without the spaces around it. */
  from: number;
  to: number;
  target: string;
}

/** Spans of the full text where a `[[…]]` is a link: the text nodes `wikilinkTree` would read. */
function markdownSpans(md: string, offset: number): [number, number][] {
  const out: [number, number][] = [];
  const walk = (n: Nodes) => {
    if (n.type === "link" || n.type === "linkReference") return;
    if (n.type === "text") {
      const s = n.position?.start.offset;
      const e = n.position?.end.offset;
      if (s !== undefined && e !== undefined) out.push([offset + s, offset + e]);
      return;
    }
    if ("children" in n) for (const c of n.children as Nodes[]) walk(c);
  };
  walk(parser.parse(md) as Root);
  return out;
}

/** The kinds of text a wikilink is read in. Anything else — an attachment — holds none. */
export type LinkKind = "board" | "note" | "quiz" | "table";

/** Every span of `text` in which a wikilink counts — `extract.ts`'s places, as offsets into the file. */
function spansOf(text: string, kind: LinkKind): [number, number][] {
  if (kind !== "board") {
    const front = FRONT.exec(text)?.[0].length ?? 0;
    return markdownSpans(text.slice(front), front);
  }
  const out: [number, number][] = [];
  for (const it of locateItems(text, isItemType).items) {
    if (it.type !== "md" && it.type !== "note") continue;
    const at = it.fence ? text.indexOf(it.body, it.fence.openEnd) : it.start;
    if (at < 0 || !text.startsWith(it.body, at)) continue;
    out.push(...markdownSpans(it.body, at));
  }
  return out;
}

/** The target of one `[[…]]` match: the head before the first `|` and `#`, its spaces trimmed off. */
function siteOf(m: RegExpMatchArray): Site | null {
  const inner = m[2]!;
  const innerAt = m.index! + m[1]!.length + 2;
  const bar = inner.search(/\\?\|/);
  const head = bar < 0 ? inner : inner.slice(0, bar);
  const hash = head.indexOf("#");
  const raw = hash < 0 ? head : head.slice(0, hash);
  const target = raw.trim();
  if (!target) return null;
  const from = innerAt + raw.indexOf(target);
  return { from, to: from + target.length, target };
}

/** Every wikilink in `text` that counts as one, in order. */
function sitesOf(text: string, kind: LinkKind): Site[] {
  if (!text.includes("[[")) return [];
  const spans = spansOf(text, kind);
  const out: Site[] = [];
  for (const m of text.matchAll(WIKILINK)) {
    const start = m.index!;
    const end = start + m[0].length;
    if (!spans.some(([s, e]) => s <= start && end <= e)) continue;
    const site = siteOf(m);
    if (site) out.push(site);
  }
  return out;
}

/* -- which documents could be affected ------------------------------------------------------- */

const fold = (s: string): string => s.normalize("NFC").toLowerCase().replace(/\\/g, "/").replace(/^\.?\/+/, "");
const leafOf = (n: string): string => n.slice(n.lastIndexOf("/") + 1);
/** What resolution strips off a target before it compares: `.md`, then a kind's `.board`, `.note`… */
const SUFFIX = /(?:\.(?:note|board|quiz|table))?(?:\.md)?$/i;
const bareOf = (t: string): string => t.replace(/\.md$/, "").replace(/\.(?:note|board|quiz|table)$/, "");

/**
 * What changed between two lists: every key — a folded leaf or a folded title — under which some
 * document that moved, was retitled, arrived or left could be found, before or after. A link none of
 * whose keys is here resolves the same way in both lists, and is never even resolved.
 */
export interface Change {
  before: readonly WikiCandidate[];
  after: readonly WikiCandidate[];
  keys: Set<string>;
}

/** The change from `before` to `after`, or `null` when no document's name or title differs. */
export function changeOf(before: readonly WikiCandidate[], after: readonly WikiCandidate[]): Change | null {
  const was = new Map(before.map((d) => [d.id, d]));
  const now = new Map(after.map((d) => [d.id, d]));
  const keys = new Set<string>();
  const add = (d: WikiCandidate | undefined) => {
    if (!d) return;
    keys.add(leafOf(fold(d.name)));
    if (d.title) keys.add(fold(d.title));
  };
  for (const id of new Set([...was.keys(), ...now.keys()])) {
    const a = was.get(id);
    const b = now.get(id);
    if (a && b && a.name === b.name && (a.title ?? null) === (b.title ?? null)) continue;
    add(a);
    add(b);
  }
  return keys.size ? { before, after, keys } : null;
}

/** Whether a target could resolve differently: one of the keys resolution would look it up by. */
function touches(target: string, keys: Set<string>): boolean {
  const t = fold(target.trim());
  for (const w of [t, bareOf(t)]) if (keys.has(w) || keys.has(leafOf(w))) return true;
  return false;
}

/* -- the new target -------------------------------------------------------------------------- */

/** A target a wikilink cannot hold: these end it, or open its part or its alias. */
const UNSAYABLE = /[[\]|#\n]/;

/**
 * What to write in place of `target` so it names `doc` in `after`, in the form `target` was written
 * in — or `null` when nothing in that form can (a name holding a `#`, say), and the link is left.
 */
function retarget(target: string, was: WikiCandidate, doc: WikiCandidate, after: readonly WikiCandidate[]): string | null {
  const suffix = was.kind === "file" ? "" : (SUFFIX.exec(target)?.[0] ?? "");
  const core = target.slice(0, target.length - suffix.length);
  const c = fold(core);
  const old = fold(was.name);
  const parts = doc.name.split("/");
  const tails = (from: number) => {
    const out: string[] = [];
    for (let k = Math.min(from, parts.length); k <= parts.length; k++) out.push(parts.slice(parts.length - k).join("/"));
    return out;
  };
  let tries: string[];
  /* A path written whole stays whole; a bare leaf — even one that was the whole name, at the top
     level — is a leaf, and becomes the shortest tail that names the document alone. */
  if (c === old && c.includes("/")) tries = [doc.name];
  else if (c === old || old.endsWith(`/${c}`)) tries = tails(c.split("/").length);
  else tries = [...(doc.title ? [doc.title] : []), ...tails(1)];
  for (const t of tries) {
    const next = `${t}${suffix}`;
    if (UNSAYABLE.test(t) || t !== t.trim()) continue;
    if (resolveWiki(next, after)?.id === doc.id) return next;
  }
  return null;
}

/** What `relinkText` did: the text it made, and how many links it rewrote. */
export interface Relinked {
  text: string;
  links: number;
}

/**
 * `text` with every wikilink that `change` would break written back to the document it named. A
 * text with nothing to rewrite comes back as itself, the same string.
 */
export function relinkText(text: string, kind: LinkKind, change: Change): Relinked {
  if (!text.includes("[[")) return { text, links: 0 };
  /* A cheap pass first: nothing in this text names anything that changed, so nothing is parsed. */
  let any = false;
  for (const m of text.matchAll(WIKILINK)) {
    const site = siteOf(m);
    if (site && touches(site.target, change.keys)) {
      any = true;
      break;
    }
  }
  if (!any) return { text, links: 0 };

  const now = new Map(change.after.map((d) => [d.id, d]));
  const edits: { from: number; to: number; text: string }[] = [];
  for (const site of sitesOf(text, kind)) {
    if (!touches(site.target, change.keys)) continue;
    const was = resolveWiki(site.target, change.before);
    if (!was) continue;
    if (resolveWiki(site.target, change.after)?.id === was.id) continue;
    const doc = now.get(was.id);
    if (!doc) continue;
    const next = retarget(site.target, was, doc, change.after);
    if (next !== null && next !== site.target) edits.push({ from: site.from, to: site.to, text: next });
  }
  if (!edits.length) return { text, links: 0 };
  let out = text;
  for (const e of edits.reverse()) out = out.slice(0, e.from) + e.text + out.slice(e.to);
  return { text: out, links: edits.length };
}
