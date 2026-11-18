/**
 * An answer of the local server held to its OpenAPI document (`server/openapi.ts`): what
 * `answers.setup.ts` does to every answer an app the unit suite makes gives, and what
 * `openapi.test.ts` tests directly. The sync api server's harness does the same to its own
 * (`api/test/spec.ts`); the rules differ where the servers do.
 *
 * Load-bearing:
 * - **The document is the generated one, for the app's `cloud` switch** — never the committed copy,
 *   which `check:openapi` holds to the code.
 * - **Closed where the document is open.** An answer recorded here may not carry a field the
 *   document does not name, so every object with fields is closed before it is compiled, but an
 *   `allOf`'s parts and a schema that says what else it allows.
 * - **The gate answers before any route** (`server/app.ts`): a request it turns away — `401` with no
 *   token, `421` for another `Host`, `400 {code: "path"}` for the API spelled oddly — and the routes'
 *   own `404` for a path or a method no row has are not a route's answer, and are held to the shape
 *   the gate gives, not to a row.
 * - **Only the API is held**: the page's files, and the secret path's prefix (`/s/<secret>/`)
 *   stripped from what it hands on. A stream (`text/event-stream`) and bytes are held to their status
 *   and media type, never read.
 */

import { Ajv2020, type ValidateFunction } from "ajv/dist/2020.js";

import type { Json } from "../../api/openapi/document";
import { localDocument } from "../../server/openapi";

interface Held {
  doc: Json;
  ajv: Ajv2020;
  compiled: Map<string, ValidateFunction>;
  rows: { re: RegExp; template: string; methods: Record<string, Json> }[];
}

const held = new Map<boolean, Held>();

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

const literal = (s: string): string => s.replace(/[.*+?^$()|[\]\\]/g, "\\$&");

function documentFor(cloud: boolean): Held {
  let got = held.get(cloud);
  if (!got) {
    const doc = structuredClone(localDocument({ cloud }));
    close(doc);
    const ajv = new Ajv2020({ strict: false, allErrors: true });
    ajv.addSchema(doc, "doc");
    /* A path with no parameter first: `/__board/chat/new` is that row, not `{id}`'s. */
    const rows = Object.entries(doc.paths as Record<string, Record<string, Json>>)
      .map(([template, methods]) => ({
        template,
        methods,
        re: new RegExp(
          `^${template
            .split(/(\{[^}]+\})/)
            .map((part) => (part === "{path}" ? ".+" : part.startsWith("{") ? "[^/]+" : literal(part)))
            .join("")}$`,
        ),
      }))
      .sort((a, b) => Number(a.template.includes("{")) - Number(b.template.includes("{")));
    got = { doc, ajv, compiled: new Map(), rows };
    held.set(cloud, got);
  }
  return got;
}

const pointer = (...parts: string[]): string => parts.map((p) => p.replace(/~/g, "~0").replace(/\//g, "~1")).join("/");

/** What the gate and the routes' `notFound` answer to a request no row is for. */
async function gateProblem(where: string, res: Response): Promise<string | null> {
  if (res.status === 421) return null;
  if (res.status !== 400 && res.status !== 401 && res.status !== 404)
    return `${where}: the document has no route for this, and it was answered`;
  const body = (await res
    .clone()
    .json()
    .catch(() => null)) as Json | null;
  if (!body || typeof body.error !== "string") return `${where}: the gate's answer is not \`{error, code?}\``;
  return null;
}

/**
 * What is wrong with `res` as the answer to `method url`, or `null`. `res` is read through a clone,
 * so the caller's copy is untouched.
 */
export async function answerProblem(cloud: boolean, method: string, url: string, res: Response): Promise<string | null> {
  let path = new URL(url, "http://127.0.0.1").pathname.replace(/^\/s\/[^/]+(?=\/)/, "");
  if (!(path.startsWith("/api/") || path.startsWith("/__board/"))) return null;
  const { ajv, compiled, rows } = documentFor(cloud);
  const where = `${method} ${path} → ${res.status}`;
  const m = method.toLowerCase();
  const row = rows.find((r) => r.re.test(path) && r.methods[m]);
  if (!row || res.status === 421 || (res.status === 401 && !res.headers.get("content-type")?.includes("json")))
    return gateProblem(where, res);
  if (res.status === 401 || (res.status === 400 && (await res.clone().text()).includes('"code":"path"')))
    return gateProblem(where, res);
  path = row.template;
  const answer = ((row.methods[m]!.responses ?? {}) as Record<string, Json>)[String(res.status)];
  if (!answer) return `${where}: the document does not list ${res.status} for ${method.toUpperCase()} ${row.template}`;
  const content = answer.content as Record<string, Json> | undefined;
  const type = res.headers.get("content-type") ?? "";
  if (!content) return null;
  const declared = Object.keys(content);
  if (declared.includes("*/*")) return null;
  const match = declared.find((d) => type.startsWith(d));
  if (!match) return `${where}: answered ${type || "no content type"}, the document says ${declared.join(" or ")}`;
  if (match !== "application/json") return null;
  const schemaAt = `doc#/${pointer("paths", row.template, m, "responses", String(res.status), "content", match, "schema")}`;
  let validate = compiled.get(schemaAt);
  if (!validate) compiled.set(schemaAt, (validate = ajv.compile({ $ref: schemaAt })));
  const body: unknown = await res.clone().json();
  if (validate(body)) return null;
  return `${where}: ${ajv.errorsText(validate.errors)} in ${JSON.stringify(body).slice(0, 400)}`;
}
