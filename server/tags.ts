/**
 * The vault's tags: what its documents carry, off the listing, and what `.anydag/tags.json` — the tag
 * list — registers, with each tag's colour.
 *
 * **A tag is in the file, and only there** (`src/note/tags.ts`): the listing reads every text's
 * `tags:`, so nothing here keeps a second copy. The tag list adds two things a file cannot say: a
 * tag's colour, and that a tag somebody created stays listed after the last document drops it. A tag
 * nobody registered is drawn in the default hue its name hashes to, and nothing is written for it —
 * so **opening a vault writes nothing**.
 *
 * The file is `{"<name>": {"hue": "<hue>"}}`, keyed by the spelling the tag was registered with and
 * read ignoring case; it syncs, and merges by key (`server/sync/merge.ts`).
 */

import type { Hue } from "../src/dsl/ir";
import { collation } from "../src/locale";
import { hueOf } from "../src/note/project";
import { defaultHue, tagKey, tagOf } from "../src/note/tags";
import { leafOf, type TextKind } from "./names";
import { byKind, TAGS_FILE, type Tree } from "./vault";

/** One registered tag: the spelling it was registered with, and its hue — `null` for the default. */
interface Registered {
  name: string;
  hue: Hue | null;
}

/** The tag list, by `tagKey`. */
export type Registry = Map<string, Registered>;

/**
 * The tag list a file's bytes hold. Lenient: a key that is not a tag, or a hue the theme does not
 * own, is passed over rather than refused, because the file is also written by hand and by sync; the
 * first spelling of a tag wins when two keys differ only in case.
 */
export function registryOf(text: string | null | undefined): Registry {
  const out: Registry = new Map();
  if (!text) return out;
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return out;
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) return out;
  for (const [raw, value] of Object.entries(data as Record<string, unknown>)) {
    const name = tagOf(raw);
    if (!name || out.has(tagKey(name))) continue;
    const hue = value && typeof value === "object" ? hueOf((value as { hue?: unknown }).hue) : undefined;
    out.set(tagKey(name), { name, hue: hue ?? null });
  }
  return out;
}

/** The tag list of a vault, read as it is now: nothing there is an empty list. */
export function readRegistry(vault: { readRaw(rel: string): Buffer | null }): Registry {
  return registryOf(vault.readRaw(TAGS_FILE)?.toString("utf8"));
}

/** What `GET /__board/tags` says of one tag. */
export interface TagInfo {
  /** The registered spelling, else the one most documents use. */
  name: string;
  hue: Hue;
  /** Whether the tag list holds it; `false` means `hue` is the default its name hashes to. */
  registered: boolean;
  /** How many documents carry it — templates left out; `0` is *Unused*. */
  count: number;
  /** The kinds of document that carry it, in the sidebar's order. */
  kinds: TextKind[];
}

const KINDS: readonly TextKind[] = ["board", "note", "quiz", "table"];

/** Every listed text's kind, by name. */
function kindsOf(tree: Tree): Map<string, TextKind> {
  const lists = byKind(tree);
  const out = new Map<string, TextKind>();
  for (const kind of KINDS) for (const name of lists[kind]) out.set(name, kind);
  return out;
}

/**
 * Every tag a document carries and every registered one: the registered spelling and hue where the
 * tag list has them, else the most common spelling and the default hue. Sorted by name, the unused
 * last.
 */
export function tagList(tree: Tree, reg: Registry): TagInfo[] {
  const kinds = kindsOf(tree);
  const seen = new Map<string, { spellings: Map<string, number>; count: number; kinds: Set<TextKind> }>();
  for (const [doc, tags] of Object.entries(tree.tags)) {
    const kind = kinds.get(doc);
    if (!kind) continue;
    for (const tag of tags) {
      const key = tagKey(tag);
      let s = seen.get(key);
      if (!s) seen.set(key, (s = { spellings: new Map(), count: 0, kinds: new Set() }));
      s.count++;
      s.kinds.add(kind);
      s.spellings.set(tag, (s.spellings.get(tag) ?? 0) + 1);
    }
  }
  const out: TagInfo[] = [];
  for (const key of new Set([...seen.keys(), ...reg.keys()])) {
    const s = seen.get(key);
    const r = reg.get(key);
    const common = s ? [...s.spellings].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]![0] : undefined;
    const name = r?.name ?? common!;
    out.push({
      name,
      hue: r?.hue ?? defaultHue(name),
      registered: !!r,
      count: s?.count ?? 0,
      kinds: s ? KINDS.filter((k) => s.kinds.has(k)) : [],
    });
  }
  const order = collation({ numeric: true });
  return out.sort((a, b) => Number(a.count === 0) - Number(b.count === 0) || order.compare(a.name, b.name));
}

/** One document carrying a tag, as `tag_list` and search name it. */
export interface Carrier {
  name: string;
  kind: TextKind;
  title: string;
}

/** Every listed document carrying `tag`, templates left out, by title. */
export function carrying(tree: Tree, tag: string): Carrier[] {
  const key = tagKey(tag);
  const kinds = kindsOf(tree);
  const out: Carrier[] = [];
  for (const [name, tags] of Object.entries(tree.tags)) {
    const kind = kinds.get(name);
    if (kind && tags.some((t) => tagKey(t) === key)) out.push({ name, kind, title: tree.titles[name] ?? leafOf(name) });
  }
  const order = collation({ numeric: true });
  return out.sort((a, b) => order.compare(a.title, b.title) || (a.name < b.name ? -1 : 1));
}
