/**
 * An OpenAPI document as a Markdown reference: what `npm run openapi` writes beside each committed
 * spec, so a person or an agent can read the API in the checkout without a viewer. It reads only the
 * document — any spec `openapi()` made — so a second spec is a second call, not a second renderer.
 *
 * Load-bearing:
 * - **It draws what the JSON says and adds nothing**: every route, parameter, body, answer and
 *   component, in the document's order. A reader who needs more than the tables reads the JSON.
 * - **Every anchor is explicit** (`<a id>`), so a link to a component survives a heading's wording.
 */

import type { Json } from "./document";

const SAFE = 9007199254740991;

const cell = (s: string): string => s.replace(/\|/g, "\\|").replace(/\n+/g, " ");
const anchor = (name: string): string => `schema-${name.toLowerCase()}`;
const opAnchor = (id: string): string => `op-${id.toLowerCase()}`;
const refName = (ref: string): string => ref.replace(/^#\/components\/schemas\//, "");
const code = (v: unknown): string => `\`${typeof v === "string" ? JSON.stringify(v) : String(v)}\``;

const isNull = (s: Json): boolean => s.type === "null" && Object.keys(s).length === 1;

/**
 * A short reading of a schema's type and its limits, for one table cell. An object written in place
 * is its field names (its fields get rows of their own), or with `spell` each field's own reading.
 */
function typeOf(s: Json | undefined, spell = false): string {
  if (!s || Object.keys(s).length === 0) return "any";
  if (typeof s.$ref === "string") {
    const name = refName(s.$ref);
    return `[\`${name}\`](#${anchor(name)})`;
  }
  if (s.const !== undefined) return code(s.const);
  if (Array.isArray(s.enum)) return (s.enum as unknown[]).map(code).join(" or ");
  for (const k of ["oneOf", "anyOf"] as const) {
    if (!Array.isArray(s[k])) continue;
    const branches = s[k] as Json[];
    const some = branches.filter((b) => !isNull(b));
    const read = some.map((b) => typeOf(b, spell)).join(" or ");
    return some.length < branches.length ? `${read}, or \`null\`` : read;
  }
  if (Array.isArray(s.allOf)) return (s.allOf as Json[]).map((b) => typeOf(b, spell)).join(", with ");
  const types = Array.isArray(s.type) ? (s.type as string[]) : typeof s.type === "string" ? [s.type] : [];
  const main = types.filter((t) => t !== "null");
  let out: string;
  if (main[0] === "array") out = `list of ${typeOf(s.items as Json)}`;
  else if (main[0] === "object" && s.properties)
    out = spell
      ? `{ ${Object.entries(s.properties as Record<string, Json>)
          .map(([k, p]) => `${k}: ${typeOf(p, true)}`)
          .join("; ")} }`
      : `{ ${Object.keys(s.properties as Json).join(", ")} }`;
  else if (main.length) out = main.join(" or ");
  else out = "any";
  const limits: string[] = [];
  if (typeof s.minLength === "number" || typeof s.maxLength === "number")
    limits.push(
      s.minLength === s.maxLength
        ? `${s.minLength} characters`
        : `${s.minLength ?? 0} to ${s.maxLength ?? "any number of"} characters`,
    );
  if (typeof s.minItems === "number") limits.push(`at least ${s.minItems}`);
  if (typeof s.maxItems === "number") limits.push(`at most ${s.maxItems}`);
  if (typeof s.minimum === "number" && s.minimum !== -SAFE) limits.push(`≥ ${s.minimum}`);
  if (typeof s.exclusiveMinimum === "number") limits.push(`> ${s.exclusiveMinimum}`);
  if (typeof s.maximum === "number" && s.maximum !== SAFE) limits.push(`≤ ${s.maximum}`);
  if (typeof s.exclusiveMaximum === "number") limits.push(`< ${s.exclusiveMaximum}`);
  if (typeof s.pattern === "string") limits.push(`matching \`${s.pattern}\``);
  if (typeof s.contentMediaType === "string") limits.push(`\`${s.contentMediaType}\``);
  if (s.default !== undefined) limits.push(`default ${code(s.default)}`);
  if (limits.length) out += `, ${limits.join(", ")}`;
  if (types.includes("null")) out += ", or `null`";
  return out;
}

/** An object's fields as rows, an inline object's own fields beneath it as `parent.field`. */
function rows(s: Json, prefix = ""): string[] {
  const props = (s.properties ?? {}) as Record<string, Json>;
  const required = new Set((s.required ?? []) as string[]);
  const out: string[] = [];
  for (const [name, p] of Object.entries(props)) {
    const full = `${prefix}${name}`;
    out.push(
      `| \`${full}\` | ${cell(typeOf(p))} | ${required.has(name) ? "yes" : "no"} | ${cell(String(p.description ?? ""))} |`,
    );
    if (p.properties && !p.$ref) out.push(...rows(p, `${full}.`));
    const items = p.items as Json | undefined;
    if (items?.properties && !items.$ref) out.push(...rows(items, `${full}[].`));
  }
  return out;
}

function fields(s: Json): string[] {
  const head = ["| Field | Type | Required | Description |", "|---|---|---|---|"];
  if (s.properties) return [...head, ...rows(s)];
  for (const k of ["oneOf", "anyOf"] as const) {
    if (!Array.isArray(s[k])) continue;
    const out: string[] = [];
    (s[k] as Json[]).forEach((branch, i) => {
      out.push(i === 0 ? "One of:" : "", "", ...(branch.properties ? [...head, ...rows(branch)] : [`- ${typeOf(branch)}`]), "");
    });
    return out;
  }
  return [`${typeOf(s)}`];
}

function security(op: Json, schemes: Record<string, Json>): string {
  const list = (op.security ?? []) as Record<string, unknown>[];
  if (!list.length) return "none";
  return list
    .map((req) =>
      Object.keys(req)
        .map((k) => (schemes[k]?.description ? `\`${k}\` (${String(schemes[k].description).replace(/\.$/, "")})` : `\`${k}\``))
        .join(" and "),
    )
    .join(", or ");
}

function media(content: Json | undefined): { type: string; schema?: Json } | null {
  if (!content) return null;
  const [type, m] = Object.entries(content)[0] ?? [];
  if (!type) return null;
  const schema = (m as Json | undefined)?.schema as Json | undefined;
  return schema ? { type, schema } : { type };
}

/** The Markdown reference of `doc`. `json` is the committed JSON's file name, which it links. */
export function reference(doc: Json, json: string): string {
  const info = doc.info as Json;
  const paths = doc.paths as Record<string, Record<string, Json>>;
  const components = (doc.components ?? {}) as Json;
  const schemas = (components.schemas ?? {}) as Record<string, Json>;
  const schemes = (components.securitySchemes ?? {}) as Record<string, Json>;
  const responses = (components.responses ?? {}) as Record<string, Json>;
  const tags = (doc.tags ?? []) as { name: string; description?: string }[];

  const ops: { tag: string; method: string; path: string; op: Json }[] = [];
  for (const [path, methods] of Object.entries(paths))
    for (const [method, op] of Object.entries(methods))
      ops.push({ tag: ((op.tags as string[]) ?? ["other"])[0]!, method, path, op });

  const out: string[] = [
    `# ${String(info.title)}`,
    "",
    `<!-- Generated by \`npm run openapi\` from the code; \`npm run checks\` fails when it is stale. Do not edit. -->`,
    "",
    `Version ${String(info.version)} · OpenAPI ${String(doc.openapi)} · the document: [\`${json}\`](${json})`,
    "",
    String(info.description ?? ""),
    "",
    "## Routes",
    "",
    "| Method | Path | Summary |",
    "|---|---|---|",
    ...ops.map(
      ({ method, path, op }) =>
        `| \`${method.toUpperCase()}\` | [\`${cell(path)}\`](#${opAnchor(String(op.operationId))}) | ${cell(String(op.summary ?? ""))} |`,
    ),
    "",
  ];

  for (const tag of tags) {
    const mine = ops.filter((o) => o.tag === tag.name);
    if (!mine.length) continue;
    out.push(`## ${tag.name}`, "", tag.description ?? "", "");
    for (const { method, path, op } of mine) {
      out.push(`<a id="${opAnchor(String(op.operationId))}"></a>`, "", `### \`${method.toUpperCase()} ${path}\``, "");
      out.push(`**${String(op.summary ?? "")}.**${op.description ? ` ${String(op.description)}` : ""}`, "");
      out.push(`Token: ${security(op, schemes)}. Operation id: \`${String(op.operationId)}\`.`, "");
      const params = (op.parameters ?? []) as Json[];
      if (params.length) {
        out.push("| Parameter | In | Type | Required | Description |", "|---|---|---|---|---|");
        for (const p of params)
          out.push(
            `| \`${String(p.name)}\` | ${String(p.in)} | ${cell(typeOf(p.schema as Json))} | ${p.required ? "yes" : "no"} | ${cell(String(p.description ?? ""))} |`,
          );
        out.push("");
      }
      const body = media((op.requestBody as Json | undefined)?.content as Json | undefined);
      if (body) out.push(`Body (\`${body.type}\`): ${body.schema ? typeOf(body.schema) : "bytes"}.`, "");
      out.push("| Status | Body | Description |", "|---|---|---|");
      for (const [status, r] of Object.entries(op.responses as Record<string, Json>)) {
        const res = typeof r.$ref === "string" ? (responses[r.$ref.replace(/^#\/components\/responses\//, "")] ?? r) : r;
        const m = media(res.content as Json | undefined);
        const what = m ? (m.schema ? typeOf(m.schema, true) : `\`${m.type}\``) : "none";
        out.push(`| ${status} | ${cell(what)} | ${cell(String(res.description ?? ""))} |`);
      }
      out.push("");
    }
  }

  out.push("## Schemas", "");
  for (const [name, s] of Object.entries(schemas)) {
    out.push(`<a id="${anchor(name)}"></a>`, "", `### \`${name}\``, "");
    if (s.description) out.push(String(s.description), "");
    out.push(...fields(s), "");
  }

  if (Object.keys(schemes).length) {
    out.push("## Tokens", "", "| Name | Kind | Description |", "|---|---|---|");
    for (const [name, s] of Object.entries(schemes))
      out.push(`| \`${name}\` | ${String(s.type)} ${String(s.scheme ?? "")} | ${cell(String(s.description ?? ""))} |`);
    out.push("");
  }
  return `${out
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd()}\n`;
}
