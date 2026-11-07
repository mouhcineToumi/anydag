/**
 * A document and the files it names, as one zip.
 *
 * A `.board.md` or a `.note.md` saved to disk used to be the text alone: its pasted pictures stayed
 * in the account, and a reference to an attachment was `dag:<id>`, which means nothing anywhere else.
 * *Included in export (files exported next to the Markdown)* is the issue's sentence, and a browser
 * saves several files as one download only as an archive — so a document that names anything exports
 * as a zip: the Markdown at the top, every attachment beside it under its own name, and every pasted
 * picture at the path the text already gives it.
 *
 * **The Markdown in the zip is rewritten, and only there**: each `dag:<id>` that names an attachment
 * becomes the attachment's path in the zip, so the file opens with its pictures and its links in any
 * Markdown editor. A `dag:` naming a board or a note is left as it is — there is nothing to put beside
 * it. The document in the account is not touched.
 *
 * Pure, and free of the DOM: the page and the CLI both call it, each with its own way of fetching.
 */
import { zipSync } from "fflate";

/** Every `dag:<id>` in a text — a link, an embed, an image's `src` — in order, each once. */
export function namedIds(text: string): string[] {
  return [...new Set([...text.matchAll(/dag:([0-9a-z]{10})(?![0-9a-z])/g)].map((m) => m[1]!))];
}

/**
 * Every pasted picture a text names, by the path it names it by: anything inside some
 * `<name>.assets/` — a Markdown image's URL, or a board image fence's `src` — each once.
 */
export function namedAssets(text: string): string[] {
  const out = new Set<string>();
  /* A board fence's unquoted `src=` ends at the `}` that closes its attributes, so neither brace is in a path. */
  for (const m of text.matchAll(/(?:\]\(|src=["']?)([^\s)"'<>{}]*?\.assets\/[^\s)"'<>{}]+)/g)) {
    const path = m[1]!;
    if (!path.includes("..") && !/^[a-z][a-z0-9+.-]*:/i.test(path) && !path.startsWith("/")) out.add(path);
  }
  return [...out];
}

/** `dag:<id>` replaced by `paths.get(id)` wherever the map has one — a `#part` after it goes too. */
export function rewriteIds(text: string, paths: ReadonlyMap<string, string>): string {
  return text.replace(/dag:([0-9a-z]{10})(?![0-9a-z])(#[^\s)"']*)?/g, (whole, id: string) => paths.get(id) ?? whole);
}

/** `want`, or `want` numbered before its extension, whichever the zip does not have yet. */
export function freePath(taken: Set<string>, want: string): string {
  let path = want;
  const dot = want.lastIndexOf(".");
  for (let n = 2; taken.has(path); n++) path = dot > 0 ? `${want.slice(0, dot)}-${n}${want.slice(dot)}` : `${want}-${n}`;
  taken.add(path);
  return path;
}

/** What `bundle` is told of an attachment it asked about: its name, and its bytes. */
export interface Fetched {
  name: string;
  data: Uint8Array;
}

export interface Bundle {
  /** The Markdown as the zip holds it, every attachment's `dag:` rewritten to its path. */
  text: string;
  /** Everything beside it, by path in the zip. Empty when the document names nothing. */
  files: { path: string; data: Uint8Array }[];
}

/**
 * The document at `mdPath` and everything it names. `attachment(id)` answers for an attachment and
 * `null` for any other id — a board, a note, or nothing any more — which is left as a `dag:`. `asset`
 * answers for a pasted picture by its path. A file that cannot be fetched is left out rather than
 * failing the export: the Markdown is what somebody asked for, and it is still whole.
 */
export async function bundle(
  mdPath: string,
  text: string,
  attachment: (id: string) => Promise<Fetched | null>,
  asset: (path: string) => Promise<Uint8Array | null>,
): Promise<Bundle> {
  const taken = new Set<string>([mdPath]);
  const files: Bundle["files"] = [];
  const paths = new Map<string, string>();
  for (const path of namedAssets(text)) {
    const data = await asset(path);
    if (!data) continue;
    taken.add(path);
    files.push({ path, data });
  }
  for (const id of namedIds(text)) {
    const got = await attachment(id);
    if (!got) continue;
    const path = freePath(taken, got.name.slice(got.name.lastIndexOf("/") + 1));
    paths.set(id, path);
    files.push({ path, data: got.data });
  }
  return { text: paths.size ? rewriteIds(text, paths) : text, files };
}

/** The zip itself: the Markdown first, then the rest. Stored, not deflated, for what is already compressed. */
export function zipBundle(mdPath: string, b: Bundle): Uint8Array {
  const entries: Record<string, [Uint8Array, { level: 0 | 6 }]> = {
    [mdPath]: [new TextEncoder().encode(b.text), { level: 6 }],
  };
  for (const f of b.files) entries[f.path] = [f.data, { level: /\.(png|jpe?g|gif|webp|avif|pdf|zip|gz|tgz|7z|rar|mp3|mp4|m4a|mov|webm|docx|xlsx|pptx)$/i.test(f.path) ? 0 : 6 }];
  return zipSync(entries);
}
