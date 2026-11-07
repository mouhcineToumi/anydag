import { serializeAttrs, str, type Attrs } from "./attrs";
import { locateItems, renderFence } from "./locate";
import type { InsertOp, NewItem } from "./patch";
import { isItemType, type BoardItem } from "./types";

/**
 * What a copied item is, on the clipboard: its own source.
 *
 * A board is a file, so the natural clipboard flavour for an item is the bytes that item occupies
 * in the file — the fence line with its attributes, the body, the closing fence. That is what a
 * person can paste into an editor, what Claude can read back, and what a second board can take in
 * whole. There is no private format to keep in step with the parser, because the parser *is* the
 * reader: `textToItems` locates fences in the pasted text exactly as `parseBoard` would.
 *
 * Text that carries no fence at all is a note — a paragraph copied from anywhere becomes an `md`
 * item, which is the other half of what a paste should do on an AnyDag board.
 *
 * **Browser-free**, like the rest of `src/board/`.
 */

/** The fence source of each item, in board order, one blank line apart. */
export function itemsToText(items: BoardItem[]): string {
  return items
    .map((it) => {
      const attrs: Attrs = { map: { ...it.attrs.map }, order: [...it.attrs.order] };
      if (!("id" in attrs.map)) {
        attrs.map.id = it.id;
        attrs.order.unshift("id");
      }
      /* A `note` fence and an `md` fence with the `note` flag are the same item; the copy says it
         the second way so the type word is always the one `parseBoard` stores. */
      if (it.note && !("note" in attrs.map)) {
        attrs.map.note = true;
        attrs.order.push("note");
      }
      return renderFence(it.type, serializeAttrs(attrs), it.body);
    })
    .join("\n\n");
}

/**
 * The items in a pasted text.
 *
 * Every fence the board format would accept becomes one item, its attributes intact — the id too,
 * so a cut-and-paste keeps its name when nothing else on the board has taken it; the caller decides
 * that. Anything else — prose, a code sample, a paragraph from a web page — is one `md` item.
 */
export function textToItems(text: string): NewItem[] {
  const trimmed = text.replace(/\r\n/g, "\n").trim();
  if (!trimmed) return [];
  const located = locateItems(trimmed, isItemType);
  const fences = located.items.filter((it) => !it.prose);
  if (fences.length === 0) return [{ type: "md", attrs: {}, body: trimmed }];
  return fences.map((it) => ({
    type: it.type === "note" ? "md" : it.type,
    attrs: it.type === "note" ? { ...it.attrs.map, note: true } : { ...it.attrs.map },
    body: it.body,
  }));
}

/**
 * A fresh item id in the page's own shape — `md-k3f9` — that nothing in `taken` uses.
 *
 * Never a counter's `md-3`, so it cannot collide with an auto id, now or later; and the last four
 * characters always carry a letter, so the id never reads as a number to anybody looking at it. The
 * page, the CLI and an insert written as text all mint with this one.
 */
export function freshId(stem: string, taken: ReadonlySet<string>): string {
  for (;;) {
    const tail = Math.random().toString(36).slice(2, 6);
    const id = `${stem}-${tail}`;
    if (tail.length === 4 && /[a-z]/.test(tail) && !taken.has(id)) return id;
  }
}

type Read<T> = ({ ok: true } & T) | { ok: false; error: string };

/**
 * The items an insert written as text means, read the way the board file would read it.
 *
 * `{insert: "```md {#intro page=k3s}\n## With k3s\n```", after: "baseline"}` is what an agent
 * writes, because a fence is the one thing it has just read a whole board of; the op `applyPatch`
 * takes is `{insert: {type, attrs, body}}`. So the text is located exactly as `parseBoard` locates
 * a file — every fence an item with its attributes, and loose prose an `md` item, which is what it
 * would be on the board — and nothing in it is dropped quietly, which is where this parts from
 * `textToItems`: a paste is a person's guess at what they meant, and an op is a statement. Anything
 * the board would have reported rather than drawn is refused here, by name:
 *
 * - frontmatter, which is not an item — a `{meta}` op is how a page or a title is written;
 * - a fence of a type the board does not know, which `locateItems` leaves out of the items;
 * - an attribute that does not parse, which re-rendering the fence would otherwise lose;
 * - one id written twice, which the board would number and the agent would not know about.
 *
 * An item with no `#id` gets a fresh one (`freshId`) rather than the board's positional `md-3`,
 * which is what every other way an item arrives does; one whose id is taken is left for
 * `applyPatch` to refuse, as it refuses the object form.
 */
function readInsert(text: string, taken: ReadonlySet<string>): Read<{ items: NewItem[] }> {
  const trimmed = text.replace(/\r\n/g, "\n").trim();
  if (!trimmed) return { ok: false, error: "an insert's text holds no item" };
  const located = locateItems(trimmed, isItemType);
  if (located.frontmatter !== null)
    return { ok: false, error: "an insert is items, not a board: frontmatter is written with a `{meta: {...}}` op" };
  const where = (line: number) => (located.items.length + located.unknown.length > 1 ? ` (line ${line} of the insert)` : "");
  const strange = located.unknown[0];
  if (strange) return { ok: false, error: `unknown item type \`${strange.type}\`${where(strange.line)}` };
  if (located.items.length === 0) return { ok: false, error: "an insert's text holds no item" };

  const mine = new Set(taken);
  const items: NewItem[] = [];
  for (const it of located.items) {
    const wrong = it.attrErrors[0];
    if (wrong) return { ok: false, error: `${wrong.code} ${wrong.message}${where(it.line)}` };
    if (it.duplicateOf !== undefined) return { ok: false, error: `the id \`${it.duplicateOf}\` is written twice in one insert` };
    const attrs: NewItem["attrs"] = { ...it.attrs.map };
    if (!str(it.attrs, "id")) attrs.id = freshId(it.type === "note" ? "md" : it.type, mine);
    mine.add(attrs.id as string);
    if (it.type === "note") attrs.note = true;
    items.push({ type: it.type === "note" ? "md" : it.type, attrs, body: it.body });
  }
  return { ok: true, items };
}

/**
 * `ops` with every insert written as text read into the `InsertOp`s it means, in place and in order
 * — so an insert of three fences after `baseline` lands as those three, in that order, after it.
 * Every other op passes through untouched for the caller to check; this only reads text.
 */
export function readInserts(board: string, ops: unknown[]): Read<{ ops: unknown[] }> {
  const taken = new Set(locateItems(board, isItemType).items.map((it) => it.id));
  /* An id another op inserts by name is spoken for too, or a minted one could land on it. */
  for (const op of ops) {
    const ins = (op as { insert?: { attrs?: { id?: unknown } } } | null)?.insert;
    if (ins && typeof ins === "object" && typeof ins.attrs?.id === "string") taken.add(ins.attrs.id);
  }
  const out: unknown[] = [];
  for (const [i, op] of ops.entries()) {
    const o = op as Record<string, unknown> | null;
    if (!o || typeof o !== "object" || typeof o.insert !== "string") {
      out.push(op);
      continue;
    }
    if (o.after !== undefined && typeof o.after !== "string") return { ok: false, error: `op ${i}: \`after\` is an item id` };
    const read = readInsert(o.insert, taken);
    if (!read.ok) return { ok: false, error: `op ${i}: ${read.error}` };
    for (const it of read.items) {
      taken.add(it.attrs.id as string);
      out.push(o.after === undefined ? { insert: it } : ({ insert: it, after: o.after } satisfies InsertOp));
    }
  }
  return { ok: true, ops: out };
}
