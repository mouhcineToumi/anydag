/**
 * What every route shares: the one shape a failure has, a JSON body read once, and the guards that
 * open almost every route — `main.py`'s `err`, `body_of`, `must_read`, `kind_or_400`, ported.
 *
 * A route throws `Http` and `app.ts`'s error handler sends it; the store's own errors (`Conflict`,
 * `NotFound`, `Refused`) are turned into the same bodies there, so a route that has nothing to add
 * to a refusal lets it through.
 */

import type { Context } from "hono";

import { anyKindOf, kindOf, type Kind, type TextKind } from "./names";
import { Conflict, NotFound, Refused, type Vault, type Version } from "./vault";

/** A failure with its status and its body — `{error}`, and whatever else the route says. */
export class Http extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export const err = (status: number, message: string, extra: Record<string, unknown> = {}): Http => new Http(status, message, extra);

/** The response for anything a route threw: its own `Http`, or the store's three errors. */
export function failure(c: Context, e: unknown): Response {
  if (e instanceof Http) return c.json({ error: e.message, ...e.extra }, e.status as 400);
  if (e instanceof Conflict) return c.json({ error: "the file changed underneath this edit", base: e.base, text: e.text }, 409);
  if (e instanceof NotFound) return c.json({ error: e.message }, 404);
  if (e instanceof Refused) return c.json({ error: e.message }, 400);
  throw e;
}

/** The JSON body, which is an object or a 400. */
export async function bodyOf(c: Context): Promise<Record<string, unknown>> {
  const raw = await c.req.text();
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw err(400, "expected a JSON body");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw err(400, "expected a JSON body");
  return parsed as Record<string, unknown>;
}

export function textKind(raw: unknown): TextKind {
  const kind = kindOf(raw);
  if (!kind) throw err(400, `\`${String(raw)}\` is not a kind of file: board, note, quiz, table`);
  return kind;
}

export function anyKind(raw: unknown): Kind {
  const kind = anyKindOf(raw);
  if (!kind) throw err(400, `\`${String(raw)}\` is not a kind of file: board, note, quiz, table, file`);
  return kind;
}

/** The document, or the 404 for it. */
export async function mustRead(vault: Vault, name: string, kind: TextKind = "board"): Promise<Version> {
  let got: Version | null = null;
  try {
    got = await vault.read(name, kind);
  } catch (e) {
    if (!(e instanceof Refused)) throw e;
  }
  if (!got) throw err(404, `no ${kind} \`${name}\``);
  return got;
}

/** `mustRead` for a route that does not want the text — an attachment included. */
export async function mustExist(vault: Vault, name: string, kind: Kind): Promise<void> {
  if (kind !== "file") {
    await mustRead(vault, name, kind);
    return;
  }
  if (!(await vault.fileInfo(name))) throw err(404, `no file \`${name}\``);
}

/** Only a board lives under `components/`: everything that reads that name takes it for one. */
export function outsideComponents(kind: Kind, name: unknown): void {
  if (kind !== "board" && String(name ?? "").startsWith("components/")) throw err(400, `a ${kind} cannot live in components/`);
}

/**
 * Write `edit(text)` over the current text, **recomputed** from the text that beat it on a conflict
 * rather than refused — `/retitle`'s, `/task`'s and `/table`'s loop: what they change is a line or
 * two nobody else is likely to be writing, so the other writer's edit and this one compose.
 */
export async function recompute(
  vault: Vault,
  name: string,
  kind: TextKind,
  edit: (text: string) => string,
  what = "the edit",
): Promise<string> {
  for (let i = 0; i < 4; i++) {
    const current = await mustRead(vault, name, kind);
    const text = edit(current.text);
    if (text === current.text) return text;
    try {
      await vault.write(name, kind, text, current.base);
      return text;
    } catch (e) {
      if (!(e instanceof Conflict)) throw e;
    }
  }
  throw err(409, `\`${name}\` kept changing underneath ${what}; try again`);
}
