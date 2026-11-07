import { parseAttrs, str, type Attrs, type AttrError } from "./attrs";
import { scanFences, type RawFence } from "./fences";

/**
 * Where every item is in the file, by id.
 *
 * `parseBoard` and `applyPatch` both have to answer "which bytes are item `intro`", and for a long
 * time each answered it on its own: the parser numbered anonymous items as it went, the patcher
 * looked only at fences that carried a `#id`, and any item the parser had named `md-2` was one the
 * patcher could not find. A drag on such an item was refused with "no item `md-2`", which is a
 * strange thing to be told about something you are looking at.
 *
 * So the rule lives here once. Both callers walk this list; the ids agree by construction.
 *
 * **Browser-free** — the Vite plugin imports it through `patch.ts`.
 *
 * Auto ids are assigned in two passes: every explicit `#id` is collected first, and an anonymous
 * item then takes the first `<type>-<n>` nobody wrote. That is what keeps ids stable across the
 * one edit that turns an anonymous item into a named one — pinning it writes its own auto id into
 * the fence, and the next anonymous item of that type still counts from where it did.
 */

export interface Located {
  id: string;
  /** The fence's info word — `note` stays `note` here; `parseBoard` folds it into `md`. */
  type: string;
  /** A run of loose prose, or an unlabelled code block, promoted to an item. */
  prose: boolean;
  /** Span of the whole block in the full text: the fence lines included, or the trimmed prose. */
  start: number;
  end: number;
  /** The fence, with offsets rebased onto the full text. `null` for prose. */
  fence: RawFence | null;
  attrs: Attrs;
  attrErrors: AttrError[];
  body: string;
  /** 1-based line in the full file. */
  line: number;
  /** Set when the written `#id` was already taken and this item was renamed. */
  duplicateOf?: string;
}

export interface Location {
  items: Located[];
  /** Fences whose type is not one the board knows. */
  unknown: { line: number; type: string }[];
  /** Where the frontmatter ends: the body of the document starts here. */
  bodyStart: number;
  /** The frontmatter's YAML, or `null` when the file has none. */
  frontmatter: string | null;
}

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n?/;

export function locateItems(text: string, isType: (t: string) => boolean): Location {
  const m = FRONTMATTER.exec(text);
  const bodyStart = m ? m[0].length : 0;
  const body = text.slice(bodyStart);
  const fences = scanFences(body);

  /* Line numbers, from offsets: one scan rather than a `split("\n")` per item. */
  const starts: number[] = [0];
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) starts.push(i + 1);
  const lineAt = (offset: number): number => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid]! <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };

  /* Pass one: the ids people wrote. */
  const explicit = new Set<string>();
  for (const f of fences) {
    if (!f.type || !isType(f.type)) continue;
    const id = str(parseAttrs(f.attrText), "id");
    if (id) explicit.add(id);
  }

  const counters = new Map<string, number>();
  const seen = new Set<string>();
  const autoId = (type: string): string => {
    let n = counters.get(type) ?? 0;
    let id: string;
    do {
      n++;
      id = `${type}-${n}`;
    } while (explicit.has(id) || seen.has(id));
    counters.set(type, n);
    return id;
  };

  const items: Located[] = [];
  const unknown: Location["unknown"] = [];

  const pushProse = (from: number, to: number) => {
    const raw = body.slice(from, to);
    const trimmed = raw.trim();
    if (!trimmed) return;
    const lead = raw.indexOf(trimmed[0]!);
    const start = bodyStart + from + lead;
    const id = autoId("md");
    seen.add(id);
    items.push({
      id,
      type: "md",
      prose: true,
      start,
      end: start + trimmed.length,
      fence: null,
      attrs: { map: {}, order: [] },
      attrErrors: [],
      body: trimmed,
      line: lineAt(start),
    });
  };

  let cursor = 0;
  for (const f of fences) {
    pushProse(cursor, f.openStart);
    cursor = f.blockEnd + 1;

    if (!f.type) {
      /* An unlabelled fence is a code sample in prose, not an item of its own kind. */
      pushProse(f.openStart, f.blockEnd);
      continue;
    }
    if (!isType(f.type)) {
      unknown.push({ line: lineAt(bodyStart + f.openStart), type: f.type });
      continue;
    }

    const attrErrors: AttrError[] = [];
    const attrs = parseAttrs(f.attrText, attrErrors);
    const written = str(attrs, "id");
    let id = written;
    let duplicateOf: string | undefined;
    if (!id) id = autoId(f.type);
    else if (seen.has(id)) {
      duplicateOf = id;
      id = autoId(f.type);
    }
    seen.add(id);

    items.push({
      id,
      type: f.type,
      prose: false,
      start: bodyStart + f.openStart,
      end: bodyStart + f.blockEnd,
      fence: { ...f, openStart: bodyStart + f.openStart, openEnd: bodyStart + f.openEnd, blockEnd: bodyStart + f.blockEnd },
      attrs,
      attrErrors,
      body: f.body,
      line: lineAt(bodyStart + f.openStart),
      duplicateOf,
    });
  }
  pushProse(cursor, body.length);

  return { items, unknown, bodyStart, frontmatter: m ? m[1]! : null };
}

/**
 * A fence around a body, with a run of backticks long enough that nothing inside closes it.
 *
 * Three is the norm; a markdown item quoting a code sample needs four. The attribute list is the
 * inner text, no braces — `serializeAttrs` produces exactly that.
 */
export function renderFence(type: string, attrText: string, body: string): string {
  let longest = 2;
  for (const m of body.matchAll(/^[ \t]*(`{3,})[ \t]*$/gm)) longest = Math.max(longest, m[1]!.length);
  const ticks = "`".repeat(longest + 1);
  const info = attrText ? `${type} {${attrText}}` : type;
  return body ? `${ticks}${info}\n${body}\n${ticks}` : `${ticks}${info}\n${ticks}`;
}
