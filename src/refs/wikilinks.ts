/**
 * `[[wikilinks]]` and `![[embeds]]` — a vault is somebody's Obsidian folder,
 * and its notes link the way Obsidian's do. `[[Meeting notes]]`, `[[Projects/Plan]]`,
 * `[[Plan#Budget]]`, `[[Plan|the plan]]` and `![[diagram.png]]` are drawn and followed **by name**,
 * and never rewritten to `dag:` — the file is the person's, and a second editor that changed their
 * links under them would be a reason not to open it here at all.
 *
 * So a wikilink holds a name and not an id. What it points at is decided by whoever has the vault's
 * list — the server for the index (and so the backlinks), the page for drawing — through one
 * function, `resolveWiki`, so the two cannot come to disagree about what `[[Plan]]` means.
 *
 * Browser-free and alias-free: `extract.ts` imports it, and the grammar runs that.
 */
import type { Nodes, Parent, PhrasingContent, Root } from "mdast";

/** One `[[…]]` in a text: what it names, the heading or block after `#`, and the words after `|`. */
export interface Wikilink {
  embed: boolean;
  target: string;
  part?: string;
  alias?: string;
  /** Exactly what was written, brackets and `!` included. */
  raw: string;
  index: number;
}

/** `!?[[…]]`, on one line, holding no bracket. The inside is split by `parseInner`. */
export const WIKILINK = /(!?)\[\[([^[\]\n]+?)\]\]/g;

/** `target#part|alias` — the alias at the first `|` (or `\|`, a table's spelling), the part at the first `#`. */
function parseInner(inner: string): { target: string; part?: string; alias?: string } {
  const bar = inner.search(/\\?\|/);
  const head = bar < 0 ? inner : inner.slice(0, bar);
  const alias = bar < 0 ? undefined : inner.slice(bar).replace(/^\\?\|/, "").trim();
  const hash = head.indexOf("#");
  const target = (hash < 0 ? head : head.slice(0, hash)).trim();
  const part = hash < 0 ? undefined : head.slice(hash + 1).trim();
  return { target, ...(part ? { part } : {}), ...(alias ? { alias } : {}) };
}

/** Every wikilink in a run of plain text, in order. `[[#Heading]]` names this note, and has no target. */
export function wikilinksIn(text: string): Wikilink[] {
  const out: Wikilink[] = [];
  for (const m of text.matchAll(WIKILINK)) {
    const inner = parseInner(m[2]!);
    if (!inner.target && !inner.part) continue;
    out.push({ embed: m[1] === "!", ...inner, raw: m[0], index: m.index! });
  }
  return out;
}

/* -- the URL a drawn wikilink carries ---------------------------------------------------------- */

const PROTOCOL = "wiki:";

/** What the remark plugin puts on the link it makes: the target, and the part after a `#`. */
export const wikiUrl = (target: string, part?: string): string =>
  `${PROTOCOL}${encodeURIComponent(target)}${part ? `#${encodeURIComponent(part)}` : ""}`;

export function parseWikiUrl(url: string): { target: string; part?: string } | null {
  if (!url.startsWith(PROTOCOL)) return null;
  const rest = url.slice(PROTOCOL.length);
  const hash = rest.indexOf("#");
  try {
    const target = decodeURIComponent(hash < 0 ? rest : rest.slice(0, hash));
    const part = hash < 0 ? undefined : decodeURIComponent(rest.slice(hash + 1));
    return { target, ...(part ? { part } : {}) };
  } catch {
    return null;
  }
}

/* -- the remark plugin --------------------------------------------------------------------------- */

/** The text of a link: its alias, else what it names — `Plan › Budget` for `[[Plan#Budget]]`. */
export const wikiLabel = (w: Pick<Wikilink, "target" | "part" | "alias">): string =>
  w.alias ?? (w.part ? (w.target ? `${w.target} › ${w.part}` : w.part) : w.target);

/** One text node's value as the phrasing it stands for: text, and a link or an image per wikilink. */
function split(value: string): PhrasingContent[] | null {
  const found = wikilinksIn(value);
  if (!found.length) return null;
  const out: PhrasingContent[] = [];
  let at = 0;
  for (const w of found) {
    if (w.index > at) out.push({ type: "text", value: value.slice(at, w.index) });
    const url = wikiUrl(w.target, w.part);
    out.push(
      w.embed
        ? { type: "image", url, alt: w.alias ?? w.target, data: { hProperties: { "data-dag-wiki": w.raw } } }
        : { type: "link", url, children: [{ type: "text", value: wikiLabel(w) }], data: { hProperties: { "data-dag-wiki": w.raw } } },
    );
    at = w.index + w.raw.length;
  }
  if (at < value.length) out.push({ type: "text", value: value.slice(at) });
  return out;
}

/**
 * Turns every `[[…]]` in text into a link, and every `![[…]]` into an image, both with a `wiki:` URL.
 * Code is code: an inline code span or a fenced block is a different node and is never looked in. A
 * link's own text is not either — `[see [[x]]](https://…)` is one link, not two.
 */
export function wikilinkTree(tree: Root): void {
  const walk = (n: Nodes) => {
    if (n.type === "link" || n.type === "linkReference") return;
    if (!("children" in n)) return;
    const parent = n as Parent;
    for (let i = 0; i < parent.children.length; i++) {
      const c = parent.children[i] as Nodes;
      if (c.type === "text") {
        const parts = split(c.value);
        if (parts) {
          parent.children.splice(i, 1, ...(parts as Parent["children"]));
          i += parts.length - 1;
        }
      } else walk(c);
    }
  };
  walk(tree);
}

/** The plugin, for `remarkPlugins={[remarkGfm, remarkWikilinks]}`. */
export function remarkWikilinks() {
  return (tree: Root) => wikilinkTree(tree);
}

/* -- what a wikilink names ----------------------------------------------------------------------- */

/** A document as resolution needs it: its vault path (a note's without `.md`), its kind and its title. */
export interface WikiCandidate {
  id: string;
  name: string;
  kind: string;
  title?: string | null;
}

const fold = (s: string): string => s.normalize("NFC").toLowerCase().replace(/\\/g, "/").replace(/^\.?\/+/, "");

/** What resolution reads off one document, folded once. */
interface Entry<D> {
  doc: D;
  at: number;
}

/**
 * The vault's list arranged for resolution: each document under its folded name, under every tail
 * of its path that starts after a `/` (its leaf among them), and under its title. Built once per list
 * and kept beside it (`indexOf`), so resolving a link is a few map lookups — it used to be three
 * passes over every document per link, and a 5,000-note vault with 150,000 links took five minutes
 * of the server's only thread to answer `/__board/index`.
 */
export interface WikiIndex<D extends WikiCandidate> {
  resolve(target: string): D | undefined;
}

const push = <D>(m: Map<string, Entry<D>[]>, k: string, e: Entry<D>) => {
  const had = m.get(k);
  if (had) had.push(e);
  else m.set(k, [e]);
};

export function wikiIndex<D extends WikiCandidate>(docs: readonly D[]): WikiIndex<D> {
  const names = new Map<string, Entry<D>[]>();
  const tails = new Map<string, Entry<D>[]>();
  const titles = new Map<string, Entry<D>[]>();
  docs.forEach((doc, at) => {
    const e = { doc, at };
    const n = fold(doc.name);
    push(names, n, e);
    for (let i = n.indexOf("/"); i >= 0; i = n.indexOf("/", i + 1)) push(tails, n.slice(i + 1), e);
    if (doc.title) push(titles, fold(doc.title), e);
  });
  /* The shortest path wins a tie, then the first by name, then the first in the list. */
  const pick = (m: Map<string, Entry<D>[]>, wants: Set<string>): D | undefined => {
    let best: Entry<D> | undefined;
    for (const w of wants) {
      for (const e of m.get(w) ?? []) {
        if (!best) best = e;
        else {
          const a = e.doc.name, b = best.doc.name;
          if (a.length < b.length || (a.length === b.length && (a < b || (a === b && e.at < best.at)))) best = e;
        }
      }
    }
    return best?.doc;
  };
  return {
    resolve(target) {
      const t = fold(target.trim());
      if (!t) return undefined;
      const bare = t.replace(/\.md$/, "").replace(/\.(?:note|board|quiz|table)$/, "");
      const wants = new Set([t, bare]);
      return pick(names, wants) ?? pick(tails, wants) ?? pick(titles, wants);
    },
  };
}

/* One index per list, for as long as the list lives: the page's index and the server's list are
   replaced, never changed in place, so a list seen before is the same documents. */
const built = new WeakMap<readonly WikiCandidate[], WikiIndex<WikiCandidate>>();

function indexOf<D extends WikiCandidate>(docs: readonly D[]): WikiIndex<D> {
  let ix = built.get(docs) as WikiIndex<D> | undefined;
  if (!ix) {
    ix = wikiIndex(docs);
    built.set(docs, ix as unknown as WikiIndex<WikiCandidate>);
  }
  return ix;
}

/**
 * The document `[[target]]` names, Obsidian's way. A path matches a document's name exactly, or as
 * its tail (`[[Plan]]` finds `Projects/Plan`), case aside; the shortest path wins a tie, then the
 * first in order. A note may be named with its `.md` and a board with its suffix's `.board`; an
 * attachment always with its extension, which is part of its name. Failing a name, a title.
 *
 * `docs` must not be changed after it is first asked about: the index built for it is kept.
 */
export function resolveWiki<D extends WikiCandidate>(target: string, docs: readonly D[]): D | undefined {
  return indexOf(docs).resolve(target);
}

/* -- writing them back --------------------------------------------------------------------------- */

/**
 * A run of text as mdast that keeps every wikilink exactly as written. `remark-stringify` escapes a
 * `[` in text, so a block somebody edited in the note editor came back `\[\[Plan]]` — a link nobody
 * else can follow any more. An `html` node is printed verbatim, which is what a wikilink needs.
 */
export function keepWikilinks(value: string): PhrasingContent[] {
  const found = wikilinksIn(value);
  if (!found.length) return [{ type: "text", value }];
  const out: PhrasingContent[] = [];
  let at = 0;
  for (const w of found) {
    if (w.index > at) out.push({ type: "text", value: value.slice(at, w.index) });
    out.push({ type: "html", value: w.raw });
    at = w.index + w.raw.length;
  }
  if (at < value.length) out.push({ type: "text", value: value.slice(at) });
  return out;
}
