import type { Ctx } from "./context";

/**
 * What the document commands share: which kinds a file can be, how a kind goes on the wire, and how a
 * board's diagnostics are read back and printed.
 */

export type Kind = "board" | "note" | "quiz" | "table";

/**
 * `kind=note`, `kind=quiz` or `kind=table` on the wire, and nothing for a board — which is what every board route
 * expects. Written as "anything but a board" since the quiz: the first version said
 * `kind === "note" ? "note" : undefined`, and a third kind sent through it went out as a board.
 */
export const kindQuery = (kind: Kind): string | undefined => (kind === "board" ? undefined : kind);

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
