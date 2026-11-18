/**
 * An OpenAPI 3.1 document made from a table of routes whose bodies and answers are zod schemas: the
 * one builder every spec this repository publishes goes through. The sync api server's table is
 * `api/server/openapi.ts`; the local server's will be one more table (#531), not a second builder.
 *
 * Load-bearing:
 * - **The schemas are the code's, never a copy.** A route's `body` is the schema its handler reads
 *   the request with, and an answer's `schema` is the one the wire's type is checked against, so
 *   the document cannot say one thing while the handler does another. Nothing here is written by hand
 *   but the prose.
 * - **zod writes the JSON Schema** (`z.toJSONSchema`, draft 2020-12, which is OpenAPI 3.1's own
 *   dialect): a request in its *input* form — what may be sent, defaults and `null`s included — and
 *   an answer in its *output* form. A schema registered with an `id` in the spec's registry becomes
 *   `#/components/schemas/<id>` wherever it appears; one id meaning two different schemas (an input
 *   and an output form that differ) is a thrown error, never a silent pick. An answer or a header
 *   given an `id` is written once under `components` the same way.
 * - **An object is open** in the document even where zod strips unknown keys on output: an answer
 *   may gain a field without a client built from the document refusing it. A test that wants the
 *   closed form says so itself (`api/test/openapi.test.ts`).
 * - **The same table makes the same bytes**: paths, methods and components keep the table's order,
 *   so the committed copy (`npm run openapi`) diffs only where the API changed.
 * - Each spec has its own registry (`registry()`), never zod's global one: the unit suite shares
 *   modules between files, and two specs' ids must not meet.
 */

import { z } from "zod";

type Method = "get" | "head" | "post" | "put" | "delete" | "patch";

/** What a schema may carry into the document: an `id` makes it a component; any other key is copied in as it is. */
export interface Meta {
  id?: string;
  description?: string;
  [keyword: string]: unknown;
}

export type Registry = z.core.$ZodRegistry<Meta>;

/** A spec's own registry: `note` names a schema (an `id`) or describes a field in it. */
export const registry = (): Registry => z.registry<Meta>();

/** `schema`, with `meta` in `reg`. */
export function note<T extends z.ZodType>(reg: Registry, schema: T, meta: Meta): T {
  reg.add(schema as z.core.$ZodType, meta);
  return schema;
}

/** A JSON Schema or an OpenAPI object, as the document holds it. */
export type Json = { [key: string]: unknown };

interface Header {
  /** Named, the header is written once as `#/components/headers/<id>` and referred to. */
  id?: string;
  description: string;
  schema: z.ZodType;
  required?: boolean;
}

export interface Answer {
  /** Named, the answer is written once as `#/components/responses/<id>` and referred to. */
  id?: string;
  description: string;
  /** JSON (`application/json`) unless `type` says otherwise. */
  schema?: z.ZodType;
  /** The media type, when the answer is not JSON. With no `schema`, the body is described by the type alone. */
  type?: string;
  headers?: Record<string, Header>;
}

interface Body {
  /** What the handler reads the body through; none for bytes. */
  schema?: z.ZodType;
  /** `application/json` unless said. */
  type?: string;
  description?: string;
  /** Multipart only: a part's own media type, for a part that is JSON inside a form. */
  encoding?: Record<string, { contentType: string }>;
}

export interface Route {
  method: Method;
  /** In OpenAPI's form, `/v1/vaults/{v}` — `pathOf` turns a Hono path into it. */
  path: string;
  /** Unique across the spec; a client generator names its function after it. */
  operationId: string;
  summary: string;
  description?: string;
  tag: string;
  /** The security schemes any one of which lets a caller in; empty is open to anybody. */
  security: string[];
  params?: { path?: z.ZodObject; query?: z.ZodObject; header?: z.ZodObject };
  body?: Body;
  answers: Record<number, Answer>;
}

export interface Spec {
  info: { title: string; version: string; description: string };
  tags: { name: string; description: string }[];
  securitySchemes: Record<string, Json>;
  registry: Registry;
  routes: Route[];
}

/** A Hono route path in OpenAPI's form: `/v1/vaults/:v/blobs/:id` → `/v1/vaults/{v}/blobs/{id}`. */
export const pathOf = (hono: string): string => hono.replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, "{$1}");

const JSON_TYPE = "application/json";

/** `#/$defs/X`, zod's local reference, as the document's `#/components/schemas/X`. */
function refs(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(refs);
  if (typeof v !== "object" || v === null) return v;
  const out: Json = {};
  for (const [k, x] of Object.entries(v)) {
    out[k] = k === "$ref" && typeof x === "string" ? x.replace(/^#\/\$defs\//, "#/components/schemas/") : refs(x);
  }
  return out;
}

/** Turns the zod schemas of one spec into JSON Schema, collecting its components as it goes. */
class Converter {
  readonly schemas: Record<string, Json> = {};
  /** `components.responses` and `components.headers`, each written once and referred to. */
  readonly shared = { responses: {} as Record<string, Json>, headers: {} as Record<string, Json> };
  private readonly written = new Map<string, string>();

  constructor(private readonly reg: Registry) {}

  convert(schema: z.ZodType, io: "input" | "output"): Json {
    const out = z.toJSONSchema(schema, {
      metadata: this.reg,
      io,
      target: "draft-2020-12",
      unrepresentable: "throw",
      override: ({ zodSchema, jsonSchema }) => {
        const def = (zodSchema as z.core.$ZodType)._zod.def as { type: string; catchall?: unknown };
        // Open unless the schema itself is strict (a catchall of `never`): see the header.
        if (def.type === "object" && def.catchall === undefined && jsonSchema.additionalProperties === false)
          delete jsonSchema.additionalProperties;
      },
    }) as Json;
    const { $schema: _, $defs, ...rest } = out;
    for (const [id, def] of Object.entries(($defs ?? {}) as Record<string, Json>)) this.keep("schemas", id, refs(def) as Json);
    return refs(rest) as Json;
  }

  /** `value` as `#/components/<kind>/<id>`: kept the first time, and the same bytes every other time. */
  share(kind: "responses" | "headers", id: string, value: Json): Json {
    this.keep(kind, id, value);
    return { $ref: `#/components/${kind}/${id}` };
  }

  private keep(kind: "schemas" | "responses" | "headers", id: string, value: Json): void {
    const key = `${kind}/${id}`;
    const text = JSON.stringify(value);
    const had = this.written.get(key);
    if (had !== undefined && had !== text)
      throw new Error(`openapi: ${key} has two different forms (a request's and an answer's?): give each its own id`);
    if (had !== undefined) return;
    this.written.set(key, text);
    (kind === "schemas" ? this.schemas : this.shared[kind])[id] = value;
  }
}

function parameters(where: "path" | "query" | "header", shape: z.ZodObject | undefined, reg: Registry, conv: Converter): Json[] {
  if (!shape) return [];
  return Object.entries(shape.shape).map(([name, schema]) => {
    const s = schema as z.ZodType;
    const description = reg.get(s)?.description;
    const p: Json = { name, in: where };
    if (description) p.description = description;
    p.required = where === "path" || !s.safeParse(undefined).success;
    const json = conv.convert(s, "input");
    delete json.description;
    p.schema = json;
    return p;
  });
}

function content(type: string, schema: z.ZodType | undefined, io: "input" | "output", conv: Converter): Json {
  return { [type]: schema ? { schema: conv.convert(schema, io) } : {} };
}

/** The OpenAPI 3.1 document of `spec`, as plain JSON. */
export function openapi(spec: Spec): Json {
  const conv = new Converter(spec.registry);
  const paths: Record<string, Json> = {};
  const ids = new Set<string>();
  for (const r of spec.routes) {
    if (ids.has(r.operationId)) throw new Error(`openapi: two routes are called ${r.operationId}`);
    ids.add(r.operationId);
    const op: Json = { operationId: r.operationId, summary: r.summary };
    if (r.description) op.description = r.description;
    op.tags = [r.tag];
    op.security = r.security.map((name) => ({ [name]: [] }));
    const params = [
      ...parameters("path", r.params?.path, spec.registry, conv),
      ...parameters("query", r.params?.query, spec.registry, conv),
      ...parameters("header", r.params?.header, spec.registry, conv),
    ];
    if (params.length) op.parameters = params;
    if (r.body) {
      const type = r.body.type ?? JSON_TYPE;
      const media = content(type, r.body.schema, "input", conv);
      if (r.body.encoding) (media[type] as Json).encoding = r.body.encoding;
      op.requestBody = { ...(r.body.description ? { description: r.body.description } : {}), required: true, content: media };
    }
    const responses: Json = {};
    for (const [status, a] of Object.entries(r.answers)) {
      const res: Json = { description: a.description };
      if (a.headers) {
        const headers: Json = {};
        for (const [name, h] of Object.entries(a.headers)) {
          const header = { description: h.description, required: h.required ?? false, schema: conv.convert(h.schema, "output") };
          headers[name] = h.id ? conv.share("headers", h.id, header) : header;
        }
        res.headers = headers;
      }
      if (a.schema || a.type) res.content = content(a.type ?? JSON_TYPE, a.schema, "output", conv);
      responses[status] = a.id ? conv.share("responses", a.id, res) : res;
    }
    op.responses = responses;
    paths[r.path] ??= {};
    paths[r.path]![r.method] = op;
  }
  return {
    openapi: "3.1.0",
    info: { title: spec.info.title, version: spec.info.version, description: spec.info.description },
    jsonSchemaDialect: "https://json-schema.org/draft/2020-12/schema",
    tags: spec.tags,
    paths,
    components: {
      schemas: conv.schemas,
      responses: conv.shared.responses,
      headers: conv.shared.headers,
      securitySchemes: spec.securitySchemes,
    },
  };
}
