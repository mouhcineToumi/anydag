import { parseBoard } from "../src/board/parseBoard";
import type { PatchOp } from "../src/board/patch";
import type { Board, BoardItem } from "../src/board/types";
import { nearest } from "../src/dsl/suggest";

import { Conflict } from "./api";
import { UsageError } from "./args";
import type { Ctx } from "./context";

/**
 * A board as a command holds it: the text, the base any write of it carries, and the parse.
 *
 * Parsed here, in the CLI, with the page's own `parseBoard` — which is what lets a command name an
 * item, a page or a link the way the canvas does, and compute an edit the way the canvas does,
 * without asking the server a question per word.
 */
export interface Loaded {
  name: string;
  id?: string;
  text: string;
  base: string;
  board: Board;
}

export type Kind = "board" | "note" | "quiz" | "table";

/**
 * `kind=note`, `kind=quiz` or `kind=table` on the wire, and nothing for a board — which is what every board route
 * expects. Written as "anything but a board" since the quiz: the first version said
 * `kind === "note" ? "note" : undefined`, and a third kind sent through it went out as a board.
 */
export const kindQuery = (kind: Kind): string | undefined => (kind === "board" ? undefined : kind);

export async function load(ctx: Ctx, name: string): Promise<Loaded> {
  const got = await ctx.api.get<{ id?: string; text: string; base: string }>("/__board/get", { name });
  return { name, id: got.id, text: got.text, base: got.base, board: parseBoard(name, got.text) };
}

/** One item by id, or a usage error that names the nearest one and says where to list them. */
export function itemOf(l: Loaded, id: string): BoardItem {
  const it = l.board.items.find((i) => i.id === id);
  if (it) return it;
  const close = nearest(
    id,
    l.board.items.map((i) => i.id),
  );
  throw new UsageError(
    `no item \`${id}\` on ${l.name}${close ? ` — did you mean \`${close}\`?` : ""} (\`anydag item ls ${l.name}\` lists them)`,
  );
}

export interface Written {
  base: string;
  text: string;
}

/**
 * Read the board, work out an edit, and write it under the base that was read.
 *
 * **The edit is a function of the text, so a conflict recomputes it.** A 409 means somebody wrote
 * the board between the read and the write; the right answer is the one the MCP tools tell an agent
 * to give — read it again and redo the change against what is there. So `compute` runs again over
 * the text the 409 carried, once. That is stricter than the page, which retries the *same* ops: an
 * op carrying a body written from the old text would overwrite the other writer's change to that
 * item, and here it cannot, because the body is written again from the new one.
 *
 * `compute` answering an empty list is "nothing to do", and nothing is sent.
 */
export async function mutate(
  ctx: Ctx,
  name: string,
  compute: (l: Loaded) => PatchOp[],
): Promise<{ written: Written | null; loaded: Loaded; ops: PatchOp[] }> {
  let loaded = await load(ctx, name);
  for (let attempt = 0; ; attempt++) {
    const ops = compute(loaded);
    if (ops.length === 0) return { written: null, loaded, ops };
    try {
      const written = await ctx.api.post<Written>("/__board/patch", { base: loaded.base, ops }, { name });
      return { written, loaded, ops };
    } catch (e) {
      if (!(e instanceof Conflict) || attempt > 0) throw e;
      loaded = { ...loaded, text: e.text, base: e.base, board: parseBoard(name, e.text) };
    }
  }
}

/** The same, for an edit that has to replace the whole text — renaming an item id is one. */
export async function rewrite(
  ctx: Ctx,
  name: string,
  compute: (l: Loaded) => string,
): Promise<{ written: Written | null; loaded: Loaded }> {
  let loaded = await load(ctx, name);
  for (let attempt = 0; ; attempt++) {
    const text = compute(loaded);
    if (text === loaded.text) return { written: null, loaded };
    try {
      const written = await ctx.api.post<Written>("/__board/put", { base: loaded.base, text }, { name });
      return { written, loaded };
    } catch (e) {
      if (!(e instanceof Conflict) || attempt > 0) throw e;
      loaded = { ...loaded, text: e.text, base: e.base, board: parseBoard(name, e.text) };
    }
  }
}

/** A fresh item id in the page's own shape — `arch-k3f9` — that nothing on the board uses. */
export { freshId } from "../src/board/clipboard";

export const idsOf = (l: Loaded): Set<string> => new Set(l.board.items.map((i) => i.id));

/**
 * The page an item goes on, as the file writes it: `page-1` is written as nothing, which is the
 * rule every add path on the canvas follows. A page the board does not have is refused here,
 * because on the canvas there is no way to name one.
 */
export function pageAttr(l: Loaded, page: string | undefined): string | undefined {
  if (!page) return undefined;
  const found = l.board.pages.find((p) => p.id === page || p.name === page);
  if (!found) {
    throw new UsageError(
      `no page \`${page}\` on ${l.name} — it has ${l.board.pages.map((p) => `\`${p.id}\` (${p.name})`).join(", ")}`,
    );
  }
  return found.id === "page-1" ? undefined : found.id;
}

/**
 * Say so when a position is about to make other items move.
 *
 * `flow.ts` places every item with no `x`/`y` in rows *below the lowest one that has one*, so
 * positioning the first item on a page re-flows everything else on it. The page avoids that by
 * pinning every other item where it is drawn — from sizes only a browser has measured, which is
 * why this says it rather than doing it.
 */
export function warnUnpinned(ctx: Ctx, l: Loaded, page: string, except: ReadonlySet<string>): void {
  const loose = l.board.items.filter(
    (i) => i.page === page && !i.hidden && i.type !== "edges" && !except.has(i.id) && (i.x === undefined || i.y === undefined),
  );
  if (loose.length === 0) return;
  ctx.io.err(
    `note: ${loose.length} item${loose.length === 1 ? " has" : "s have"} no position on this page and will flow below the ` +
      `lowest positioned one (${loose.map((i) => i.id).join(", ")}) — \`anydag tidy ${l.name}\` straightens them`,
  );
}

/** What a board's diagnostics say, printed one per line, and how many were errors. */
export async function report(ctx: Ctx, name: string): Promise<number> {
  const d = await ctx.api.get<Diagnosed>("/__board/diagnostics", { name });
  for (const line of diagnosticLines(d)) ctx.io.err(line);
  return d.errors ?? 0;
}

export interface Diagnosed {
  board?: { code: string; line?: number; col?: number; message: string; severity: string }[];
  items?: { id: string; type: string; diagnostics: { code: string; line?: number; col?: number; message: string; severity: string }[] }[];
  errors?: number;
  warnings?: number;
}

/** `CODE  where line:col  message` — the snapshot script's shape, so a fix loop reads one format. */
export function diagnosticLines(d: Diagnosed): string[] {
  const out: string[] = [];
  const at = (line?: number, col?: number) => (line ? ` ${line}${col ? `:${col}` : ""}` : "");
  for (const x of d.board ?? []) out.push(`${x.code}  board${at(x.line, x.col)}  ${x.message}`);
  for (const it of d.items ?? []) for (const x of it.diagnostics) out.push(`${x.code}  ${it.id}${at(x.line, x.col)}  ${x.message}`);
  return out;
}
