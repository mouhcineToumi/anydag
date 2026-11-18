/**
 * The local server's request and answer schemas start here: the registry its OpenAPI document is
 * generated from, the way a body's field is read, and the answers every route shares — the refusal,
 * the 409 that hands back the text that won. One file per family beside this one holds that family's
 * bodies, answers and rows (`server/openapi.ts` puts the rows together).
 *
 * Load-bearing:
 * - **A field is read by the route's own check, moved here, never by a second one.** `field` pairs
 *   what the document says a field is (`doc`, a zod schema turned into JSON Schema) with the function
 *   the handler used to read it (`read`), which throws the route's own `Http` refusal — so a body
 *   read through its schema (`bodyAs` in `server/http.ts`) is refused with the same status and the
 *   same sentence as before #531, and **in the same order**: zod reads an object's fields in the
 *   order they are declared and a thrown refusal stops it there, so each body declares its fields in
 *   the order its handler checked them.
 * - **Only the checks a handler made before anything else move into the schema.** A check made after
 *   the route read the vault (a 404 for a missing document comes first) stays in the handler, after
 *   that read, and its field is `kept`: described, handed over as it came. So is a field the handler
 *   only coerces (`String(body.name ?? "")`) — the answer of `/__board/delete` echoes `name` as it
 *   was sent, which a coercion here would change.
 * - **A body is an open object**, as every handler read it: a field nobody names is kept, never
 *   refused; a field the document names and the handler does not read is documentation.
 * - **A missing field is not a `null` one.** A field whose handler asked `"status" in body` is
 *   `field(…, "skip")`: absent stays absent and its reader never runs. One whose handler read
 *   `undefined` as a value (`textKind(body.kind)` refuses it) is `field(…, "read")`.
 */

import { z } from "zod";

import { type Answer, type Json, note, registry } from "../../api/openapi/document";

/** The local server's registry: every schema named here is a component of its document. */
export const LOCAL = registry();

export const named = <T extends z.ZodType>(id: string, description: string, s: T): T => note(LOCAL, s, { id, description });
export const about = <T extends z.ZodType>(description: string, s: T): T => note(LOCAL, s, { description });

/** `doc` as the JSON Schema keywords a field carries into the document. */
function keywords(doc: z.ZodType): Json {
  const { $schema: _, ...rest } = z.toJSONSchema(doc, {
    io: "input",
    target: "draft-2020-12",
    unrepresentable: "throw",
  }) as Json;
  return rest;
}

/**
 * A body field read by `read` and described as `doc`. `"skip"`: a missing field stays missing and
 * `read` sees only what was sent (`null` included); `"read"`: `read(undefined)` runs for a missing
 * one, and must answer something other than `undefined`.
 */
export function field<T>(
  doc: z.ZodType,
  description: string,
  read: (raw: unknown) => T,
  absent: "skip",
): z.ZodOptional<z.ZodPipe<z.ZodUnknown, z.ZodTransform<Awaited<T>, unknown>>>;
export function field<T>(
  doc: z.ZodType,
  description: string,
  read: (raw: unknown) => T,
  absent: "read",
): z.ZodPipe<z.ZodOptional<z.ZodUnknown>, z.ZodTransform<Awaited<T>, unknown>>;
export function field<T>(doc: z.ZodType, description: string, read: (raw: unknown) => T, absent: "skip" | "read"): z.ZodType {
  const meta = { ...keywords(doc), description };
  /* zod refuses an absent key whose schema does not take `undefined` in ("nonoptional"), whatever
     the schema would make of it: `.optional()` before the reader lets `read(undefined)` run, after
     it skips the reader. */
  const field =
    absent === "skip"
      ? z
          .unknown()
          .transform((raw) => read(raw))
          .optional()
      : z
          .unknown()
          .optional()
          .transform((raw) => read(raw));
  return note(LOCAL, field, meta);
}

/** A body field the handler reads itself, after something else: described, and handed over as it came. */
export const kept = (doc: z.ZodType, description: string): z.ZodOptional<z.ZodUnknown> =>
  note(LOCAL, z.unknown().optional(), { ...keywords(doc), description });

/**
 * A request body: its fields, declared in the order the handler checks them, and the ones a request
 * must send to be answered with anything but a refusal.
 */
export function body<S extends Record<string, z.ZodType>>(
  id: string,
  description: string,
  shape: S,
  required: (keyof S & string)[] = [],
) {
  return note(LOCAL, z.looseObject(shape), { id, description, ...(required.length ? { required } : {}) });
}

/**
 * `body`, then `then` over what its fields read: the handler's checks of two fields together, or of
 * fields whose order against another field's a field alone cannot keep. It throws the handler's own
 * refusal, as a field's `read` does.
 */
export function bodyThen<S extends Record<string, z.ZodType>, R>(
  id: string,
  description: string,
  shape: S,
  required: (keyof S & string)[],
  then: (read: z.output<z.ZodObject<S, z.core.$loose>>) => R,
) {
  const piped = z.looseObject(shape).transform((read) => then(read));
  return note(LOCAL, piped, { id, description, ...(required.length ? { required } : {}) });
}

/** A query or header parameter's schema, with its description. */
export const param = <T extends z.ZodType>(description: string, s: T): T => about(description, s);

/** A JSON answer. */
export const json = (description: string, schema: z.ZodType): Answer => ({ description, schema });

// -- what every answer may be -------------------------------------------------------------------

export const Refusal = named(
  "Refusal",
  "Every refusal: `error` is a sentence for a person. `code`, where there is one, is what a client branches on; `reason` says why a model could not be reached.",
  z.object({
    error: z.string(),
    code: z.string().optional(),
    reason: about(
      "Why a model provider could not be used: `code` is the provider's state (`not-installed`, `needs-key`, `busy`, `timeout`, …).",
      z.object({ code: z.string(), provider: z.string() }).optional(),
    ),
  }),
);

const Conflict = named(
  "Conflict",
  "A write whose `base` is not the file's sha1 any more: nothing was written. `base` and `text` are the file as it is now — rebase the edit on them and send it again with that `base`.",
  z.object({
    error: z.string(),
    base: about("The sha1 of the text that won.", z.string()),
    text: about("The text that won.", z.string()),
  }),
);

/** What may be in a 409 of a route that writes under a `base`: the text that won, or a refusal. */
export const ConflictOrRefusal = named(
  "ConflictOrRefusal",
  "The text that won (`Conflict`), or a refusal with no text: the file kept changing, or a chat has no turn running.",
  z.union([Conflict, Refusal]),
);
