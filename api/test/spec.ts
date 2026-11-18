/**
 * An answer held to the OpenAPI document: what `helpers.ts`' harness does to every answer the api
 * suites record, and what `openapi.test.ts` tests directly.
 *
 * Load-bearing:
 * - **The document is the generated one, for the switches the harness runs with** — never the
 *   committed copy, which `check:openapi` holds to the code — so a test of a server with logs off
 *   finds no `/v1/logs` row, as a client of it would.
 * - **Closed where the document is open.** The document leaves objects open so a client may meet a
 *   field it does not know (`api/openapi/document.ts`); an answer recorded here may not carry one the
 *   document does not name, so every object of every component is closed before it is compiled.
 * - **A stream is not read**: the poke stream never ends, and bytes have no schema. Their status and
 *   media type are held all the same.
 */

import { Ajv2020, type ValidateFunction } from "ajv/dist/2020.js";

import type { Json } from "../openapi/document";
import { type Features, syncDocument } from "../server/openapi";

interface Held {
  doc: Json;
  ajv: Ajv2020;
  compiled: Map<string, ValidateFunction>;
}

const docs = new Map<string, Held>();

/** Every object schema with fields, closed — but an `allOf`'s parts, which another part may add to. */
function close(v: unknown, inAllOf = false): void {
  if (Array.isArray(v)) {
    for (const x of v) close(x, inAllOf);
    return;
  }
  if (typeof v !== "object" || v === null) return;
  const s = v as Json;
  if (s.properties && s.additionalProperties === undefined && !inAllOf) s.unevaluatedProperties = false;
  for (const [k, x] of Object.entries(s)) close(x, k === "allOf");
}

function documentFor(features: Features): Held {
  const key = JSON.stringify(features);
  let got = docs.get(key);
  if (!got) {
    const doc = structuredClone(syncDocument(features));
    close((doc.components as Json).schemas);
    const ajv = new Ajv2020({ strict: false, allErrors: true });
    ajv.addSchema(doc, "doc");
    got = { doc, ajv, compiled: new Map() };
    docs.set(key, got);
  }
  return got;
}

const pointer = (...parts: string[]): string => parts.map((p) => p.replace(/~/g, "~0").replace(/\//g, "~1")).join("/");

/** The document's path that `path` is, and its template. */
function rowOf(doc: Json, method: string, path: string): { template: string; op: Json; method: string } | null {
  const paths = doc.paths as Record<string, Record<string, Json>>;
  for (const [template, methods] of Object.entries(paths)) {
    const re = new RegExp(`^${template.replace(/\{[^}]+\}/g, "[^/]+")}$`);
    if (!re.test(path)) continue;
    const m = method.toLowerCase();
    const op = methods[m] ?? (m === "head" ? methods.get : undefined);
    if (op) return { template, op, method: methods[m] ? m : "get" };
  }
  return null;
}

/**
 * What is wrong with `res` as the answer to `method path`, or `null`. `res` is read through a clone,
 * so the caller's copy is untouched.
 */
export async function answerProblem(features: Features, method: string, path: string, res: Response): Promise<string | null> {
  const { doc, ajv, compiled } = documentFor(features);
  const where = `${method} ${path} → ${res.status}`;
  const row = rowOf(doc, method, path);
  if (!row) {
    // No row: the app's own 404, in the error shape — anything else is a route the document lacks.
    if (res.status !== 404) return `${where}: the document has no route for this, and it was answered`;
    return null;
  }
  const responses = (row.op.responses ?? {}) as Record<string, Json>;
  let answer = responses[String(res.status)];
  if (!answer) return `${where}: the document does not list ${res.status} for ${row.method.toUpperCase()} ${row.template}`;
  const shared = ((doc.components as Json).responses ?? {}) as Record<string, Json>;
  let ref = "";
  if (typeof answer.$ref === "string") {
    ref = answer.$ref.replace(/^#\/components\/responses\//, "");
    answer = shared[ref]!;
  }
  for (const [name, h] of Object.entries((answer.headers ?? {}) as Record<string, Json>)) {
    const header = h.$ref
      ? (((doc.components as Json).headers as Record<string, Json>)[String(h.$ref).split("/").pop()!] ?? h)
      : h;
    if (header.required && res.headers.get(name) === null) return `${where}: no ${name} header`;
  }
  const content = answer.content as Record<string, Json> | undefined;
  const type = res.headers.get("content-type") ?? "";
  if (!content) return null;
  const [declared] = Object.keys(content);
  if (method.toUpperCase() === "HEAD") return null;
  if (!type.startsWith(declared!)) return `${where}: answered ${type || "no content type"}, the document says ${declared}`;
  if (declared !== "application/json") return null;
  const schemaAt = ref
    ? `doc#/${pointer("components", "responses", ref, "content", declared, "schema")}`
    : `doc#/${pointer("paths", row.template, row.method, "responses", String(res.status), "content", declared, "schema")}`;
  let validate = compiled.get(schemaAt);
  if (!validate) compiled.set(schemaAt, (validate = ajv.compile({ $ref: schemaAt })));
  const body: unknown = await res.clone().json();
  if (validate(body)) return null;
  return `${where}: ${ajv.errorsText(validate.errors)} in ${JSON.stringify(body).slice(0, 400)}`;
}
