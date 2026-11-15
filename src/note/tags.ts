/**
 * Tags: the frontmatter's `tags:`, on a note, a task, an event, a board, a quiz or a table.
 *
 * **One parser reads them and one writer changes them**, these — the local server's listing and
 * routes, the page, the CLI and the MCP tools all import this file, held to `test/fixtures/tags.json`.
 *
 * Lenient as Obsidian is, in what is read: a list in flow form (`[a, b]`) or block form (`- a`,
 * indented or at column 0), or a string split on commas and blanks; a leading `#` dropped; case
 * ignored. A tag is letters, digits, `_`, `-` and `/`, with one character at least that is not a
 * digit, and a `/` is a character rather than a level. The singular `tag:` is not read, and an
 * inline `#tag` in a note's text is prose.
 *
 * Exact in what is written: only the `tags:` line and the lines under it change (`withKeys`' rule),
 * a block list stays a block list at its indent, anything else becomes a one-line flow list `merge3`
 * can merge, an entry that is not a tag is kept byte for byte, and nothing a write was not asked to
 * remove is dropped.
 *
 * No browser, no React, no `@/` aliases: the local server and the CLI bundle this.
 */
import { parse as parseYaml } from "yaml";

import { HUE_ORDER, type Hue } from "../dsl/ir";
import { QUIET } from "./quiet";
import { keyEnd } from "./task";

/** What a write asks for: tags to add and tags to take off, each compared ignoring case. */
export interface TagChange {
  add?: readonly string[];
  remove?: readonly string[];
  /** One tag respelled where it stands — a vault-wide rename — or, onto a tag the text carries, merged into it. */
  rename?: { from: string; to: string };
}

const FRONT = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

/** Letters, digits, `_`, `-` and `/` — Obsidian's characters. */
const CHARS = /^[\p{L}\p{M}\p{N}_/-]+$/u;
const DIGITS = /^\p{N}+$/u;

/** The key a tag is compared by: `Pricing` and `pricing` are one tag. */
export const tagKey = (name: string): string => name.toLowerCase();

/** Whether `a` and `b` name one tag. */
export const sameTag = (a: string, b: string): boolean => tagKey(a) === tagKey(b);

/** A tag as written, its `#` dropped, or `undefined` when it is not one. */
export function tagOf(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const s = raw.trim().replace(/^#+/, "");
  return CHARS.test(s) && !DIGITS.test(s) ? s : undefined;
}

/**
 * The tags a document's text carries, in the order the file has them, each once — the first
 * spelling of it — and `[]` for none.
 *
 * Read off the key's own lines rather than through a YAML parse, because what Obsidian writes is not
 * always YAML a parser takes: `tags: [a, #b]` opens a comment inside a flow list, and `- #b` is an
 * item holding nothing. The writer reads the same lines the same way, so what is read is what a
 * write keeps.
 */
export function tagsOf(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const tag of everyTagOf(text)) {
    if (seen.has(tagKey(tag))) continue;
    seen.add(tagKey(tag));
    out.push(tag);
  }
  return out;
}

/** Every tag entry a text's frontmatter holds, in order, each spelling as written — repeats kept. */
export function everyTagOf(text: string): string[] {
  const m = FRONT.exec(text);
  if (!m) return [];
  const lines = m[1]!.split(/\r?\n/);
  const at = lines.findIndex((l) => /^tags\s*:/.test(l));
  if (at < 0) return [];
  return found(lines.slice(at, keyEnd(lines, at)))
    .entries.map((e) => tagOf(unquoted(e)))
    .filter((t): t is string => !!t);
}

/** Whether a document's text carries `tag`. */
export const hasTag = (text: string, tag: string): boolean => tagsOf(text).some((t) => sameTag(t, tag));

/* ---------------------------------------------------------------- writing */

/** A word YAML 1.1 or 1.2 reads as something other than a string, written in quotes. */
const WORDS = new Set(["true", "false", "null", "yes", "no", "on", "off", "y", "n", "~"]);

/** `tag` as an entry of a list: bare when every YAML reads it as itself, double-quoted otherwise. */
export function entryOf(tag: string): string {
  if (WORDS.has(tag.toLowerCase())) return JSON.stringify(tag);
  let read: unknown;
  try {
    read = parseYaml(tag, QUIET);
  } catch {
    return JSON.stringify(tag);
  }
  /* A YAML 1.1 integer may hold `_` (`1_000`), which a 1.2 reader takes for a word. */
  return read === tag && !/^[-+]?[\d_]+$/.test(tag) ? tag : JSON.stringify(tag);
}

/** An entry as written, its quotes taken off, for comparing. */
function unquoted(entry: string): string {
  const s = entry.trim();
  if (s.length >= 2 && ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'")))) {
    try {
      return s.startsWith('"') ? (JSON.parse(s) as string) : s.slice(1, -1).replace(/''/g, "'");
    } catch {
      return s.slice(1, -1);
    }
  }
  return s;
}

/** A flow list's entries as written, split on the commas outside quotes. */
function flowEntries(inner: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quote: string | null = null;
  for (const ch of inner) {
    if (quote) {
      cur += ch;
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      cur += ch;
    } else if (ch === ",") {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  out.push(cur.trim());
  return out.filter((e) => e !== "");
}

/** The `tags:` key as the file has it: its entries as written, and the prefix a block list's items wear. */
interface Found {
  entries: string[];
  /** `"  - "` for a block list, `null` for any other form. */
  item: string | null;
}

function found(lines: readonly string[]): Found {
  const head = lines[0]!.replace(/^tags\s*:/, "").trim();
  /* A comment after the value — but a `#` inside a flow list is Obsidian's way of writing a tag. */
  const value = head.startsWith("[") ? head.replace(/\]\s+#.*$/, "]") : head.replace(/(^|\s+)#.*$/, "").trim();
  if (value === "" && lines.length > 1) {
    const items = lines.slice(1).filter((l) => /^\s*-(\s|$)/.test(l));
    const item = /^(\s*-\s*)/.exec(items[0] ?? "- ")![1]!;
    return {
      entries: items
        .map((l) =>
          l
            .replace(/^\s*-\s*/, "")
            .replace(/\s+#.*$/, "")
            .trim(),
        )
        .filter(Boolean),
      item: item.endsWith(" ") ? item : `${item} `,
    };
  }
  /* Everything after the key, the lines under it joined — a flow list may run over several. */
  const all = [value, ...lines.slice(1).map((l) => l.trim())]
    .join(" ")
    .trim()
    .replace(/\]\s+#.*$/, "]");
  if (all.startsWith("[") && all.endsWith("]")) return { entries: flowEntries(all.slice(1, -1)), item: null };
  if (all.startsWith('"') || all.startsWith("'"))
    return {
      entries: unquoted(all)
        .split(/[\s,]+/)
        .filter(Boolean),
      item: null,
    };
  return { entries: all.split(/[\s,]+/).filter(Boolean), item: null };
}

/**
 * `text` with its frontmatter's tags changed as `change` asks, and every other byte as it was.
 *
 * An added tag the text already carries, in any case, is no change, and one it does not carry goes
 * at the end. A renamed tag keeps its place. A removed tag takes off every entry naming it, before anything is added — so removing
 * `Pricing` and adding `pricing` respells it, and a block list stays one. Taking the last entry off removes the
 * line, and a block that leaves empty goes; a text with no frontmatter grows one, followed by a blank
 * line when `board` is set (`withTitle`'s rule: a board's frontmatter is apart from its body).
 */
export function withTags(text: string, change: TagChange, opts: { board?: boolean } = {}): string {
  const remove = new Set((change.remove ?? []).map(tagKey));
  const m = FRONT.exec(text);
  const block = m ? m[1]! : "";
  const nl = m?.[0].includes("\r\n") ? "\r\n" : "\n";
  const lines = block === "" ? [] : block.split(nl);
  const at = lines.findIndex((l) => /^tags\s*:/.test(l));
  const end = at >= 0 ? keyEnd(lines, at) : at;
  const was = at >= 0 ? found(lines.slice(at, end)) : { entries: [], item: null };

  let entries = was.entries.filter((e) => {
    const tag = tagOf(unquoted(e));
    return !(tag && remove.has(tagKey(tag)));
  });
  if (change.rename) {
    const { from, to } = change.rename;
    const keyOf = (e: string) => tagKey(tagOf(unquoted(e)) ?? "");
    /* The first entry naming `from` becomes `to` where it stands; onto a `to` already there, it goes. */
    let placed = tagKey(to) !== tagKey(from) && entries.some((e) => keyOf(e) === tagKey(to));
    entries = entries.flatMap((e) => {
      if (keyOf(e) !== tagKey(from)) return [e];
      if (placed) return [];
      placed = true;
      return [entryOf(to)];
    });
  }
  const has = new Set(
    entries
      .map((e) => tagOf(unquoted(e)))
      .filter((t): t is string => !!t)
      .map(tagKey),
  );
  for (const raw of change.add ?? []) {
    const tag = tagOf(raw);
    if (!tag || has.has(tagKey(tag))) continue;
    has.add(tagKey(tag));
    entries.push(entryOf(tag));
  }
  if (entries.length === was.entries.length && entries.every((e, i) => e === was.entries[i])) return text;

  const written =
    entries.length === 0
      ? []
      : was.item !== null
        ? ["tags:", ...entries.map((e) => `${was.item}${e}`)]
        : [`tags: [${entries.join(", ")}]`];
  if (at >= 0) lines.splice(at, end - at, ...written);
  else {
    let last = lines.length;
    while (last > 0 && lines[last - 1]!.trim() === "") last--;
    lines.splice(last, 0, ...written);
  }

  if (!m) {
    if (!lines.length) return text;
    const gap = opts.board && text && !text.startsWith("\n") ? "\n" : "";
    return `---\n${lines.join("\n")}\n---\n${gap}${text}`;
  }
  if (lines.every((l) => l.trim() === "")) return text.slice(m[0].length);
  const start = m[0].startsWith("---\r\n") ? 5 : 4;
  return text.slice(0, start) + lines.join(nl) + text.slice(start + block.length);
}

/* ---------------------------------------------------------------- names a person types */

/**
 * What a person typed, as the tag it becomes: blanks as `-`, a leading `#` dropped, and anything
 * that is not a tag's character taken out. A name of digits alone is answered as it is, and
 * `tagProblem` says what to do about it.
 */
export function cleanTag(typed: string): string {
  return typed
    .trim()
    .replace(/^#+/, "")
    .replace(/\s+/g, "-")
    .replace(/[^\p{L}\p{M}\p{N}_/-]/gu, "");
}

/**
 * A field's text as it is being typed: `cleanTag` without the trim, so the space a person types
 * shows as the `-` it will be (`two words` reads `two-words` under their fingers), never later.
 */
export const typedTag = (typed: string): string =>
  typed
    .replace(/^\s+/, "")
    .replace(/^#+/, "")
    .replace(/\s/g, "-")
    .replace(/[^\p{L}\p{M}\p{N}_/-]/gu, "");

/** A pasted list, one tag per item: `a, b c` is three. */
export const pastedTags = (text: string): string[] =>
  text
    .split(/[\s,]+/)
    .map(cleanTag)
    .filter(Boolean);

/**
 * Why a cleaned name is not a tag, with the fix a button fills in: a name of digits alone needs a
 * letter, so `2026` is offered as `q-2026` — the field says the message, and its button `Use q-2026?`.
 */
export function tagProblem(name: string): { message: string; fix: string } | undefined {
  if (name === "" || tagOf(name)) return undefined;
  if (DIGITS.test(name)) return { message: "A tag needs a letter.", fix: `q-${name}` };
  return { message: "A tag is letters, digits, _, - and /.", fix: cleanTag(name) };
}

/* ---------------------------------------------------------------- colours */

/**
 * The hue a tag nobody registered is drawn in: a stable hash of its name, ignoring case, over the
 * ten hues — FNV-1a over UTF-16 units, so the page, the server, the CLI and MCP agree with nothing
 * written anywhere.
 */
export function defaultHue(name: string): Hue {
  let h = 0x811c9dc5;
  for (const ch of tagKey(name)) {
    for (let i = 0; i < ch.length; i++) {
      h ^= ch.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
  }
  return HUE_ORDER[h % HUE_ORDER.length]!;
}
