/**
 * The sync api server's OpenAPI document (#530): a valid OpenAPI 3.1 document, holding every route
 * the app registers and no route it does not, served at `/v1/openapi.json` with no token, and without
 * the routes of a feature that is off. That every recorded answer is the one the document gives is
 * held by the harness itself (`helpers.ts`, `spec.ts`); the last block here shows it would say so.
 *
 * `oas-3.1.schema.json` beside this file is the OpenAPI Initiative's own schema of an OpenAPI 3.1
 * document (https://spec.openapis.org/oas/3.1/schema/2022-10-07, Apache-2.0), kept as it was
 * published so the check needs no network.
 */

import fs from "node:fs";
import { fileURLToPath } from "node:url";

import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { type Json, pathOf } from "../openapi/document";
import { ROUTES, syncDocument } from "../server/openapi";
import { call, harness, type Harness } from "./helpers";
import { answerProblem } from "./spec";

/* Ajv resolves the schema's `$dynamicRef: "#meta"` to the wrong anchor (onto the object holding it),
   so it is read as what it means with no dialect of one's own: the `schema` definition, an object or
   a boolean. Each Schema Object is compiled on its own below. */
const OAS = JSON.parse(
  fs
    .readFileSync(fileURLToPath(new URL("./oas-3.1.schema.json", import.meta.url)), "utf8")
    .replaceAll('"$dynamicRef": "#meta"', '"$ref": "#/$defs/schema"'),
) as Json;
const ALL = { sync: true, logs: true, feedback: true };

let h: Harness | null = null;
/* The first harness of a worker migrates the database it then copies (`helpers.ts`), seconds on a
   busy machine: paid here, as `routes.test.ts` does, and not inside one test's five. */
beforeAll(async () => {
  await (await harness()).close();
}, 60_000);
afterEach(async () => {
  await h?.close();
  h = null;
});

/** Every operation of a document, as `METHOD /path`. */
const operations = (doc: Json): string[] =>
  Object.entries(doc.paths as Record<string, Json>).flatMap(([path, methods]) =>
    Object.keys(methods).map((m) => `${m.toUpperCase()} ${path}`),
  );

/** A row's path with something in each parameter, for asking it. */
const concrete = (path: string): string => path.replace("{v}", "abcdefgh12").replace(/\{id\}/, "a".repeat(43));

describe("the document", () => {
  it("is a valid OpenAPI 3.1 document", () => {
    const ajv = new Ajv2020({ strict: false, allErrors: true });
    addFormats.default(ajv);
    const validate = ajv.compile(OAS);
    const doc = syncDocument();
    expect(validate(doc) ? "" : ajv.errorsText(validate.errors)).toBe("");
    expect(doc.openapi).toBe("3.1.0");
    // …and the check can fail: another version, an answer with no description.
    expect(validate({ ...doc, openapi: "3.0.3" })).toBe(false);
    const broken = structuredClone(doc) as { paths: Record<string, Record<string, { responses: Record<string, Json> }>> };
    delete broken.paths["/v1/health"]!.get!.responses["200"]!.description;
    expect(validate(broken)).toBe(false);
  });

  it("holds schemas that compile, and refs that land", () => {
    const doc = syncDocument();
    const ajv = new Ajv2020({ strict: false });
    ajv.addSchema(doc, "doc");
    const components = doc.components as Record<string, Record<string, unknown>>;
    for (const name of Object.keys(components.schemas!))
      expect(() => ajv.compile({ $ref: `doc#/components/schemas/${name}` })).not.toThrow();
    const refs = JSON.stringify(doc).match(/"\$ref":"#\/components\/[^"]+"/g) ?? [];
    expect(refs.length).toBeGreaterThan(50);
    for (const ref of new Set(refs)) {
      const [, kind, name] = /#\/components\/([^/]+)\/([^"]+)"/.exec(ref)!;
      expect(components[kind!]?.[name!], ref).toBeDefined();
    }
  });

  it("names every route the app registers, and no route it does not", async () => {
    h = await harness();
    const registered = new Set(h.app.routes.filter((r) => r.method !== "ALL").map((r) => `${r.method} ${pathOf(r.path)}`));
    /* Hono answers HEAD with the GET handler, so a HEAD row is a GET route. */
    const documented = new Set(ROUTES.map((r) => `${r.method === "head" ? "GET" : r.method.toUpperCase()} ${r.path}`));
    expect([...registered].filter((r) => !documented.has(r))).toEqual([]);
    expect([...documented].filter((r) => !registered.has(r))).toEqual([]);
    expect(registered.size).toBeGreaterThan(25);
  });

  it("is the same bytes every time it is made", () => {
    expect(JSON.stringify(syncDocument())).toBe(JSON.stringify(syncDocument()));
  });
});

describe("GET /v1/openapi.json", () => {
  it("answers the document with no token and no protocol", async () => {
    h = await harness();
    const res = await call(h, "GET", "/v1/openapi.json", { protocol: null });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(syncDocument(ALL));
  });

  for (const [feature, env] of [
    ["sync", { ANYDAG_API_SYNC: "off" }],
    ["logs", { ANYDAG_API_LOGS: "off" }],
    ["feedback", { ANYDAG_API_FEEDBACK: "off" }],
  ] as const) {
    it(`leaves out ${feature}'s routes when it is off, and those routes are not there`, async () => {
      h = await harness("pglite", env);
      const doc = (await (await call(h, "GET", "/v1/openapi.json")).json()) as Json;
      const gone = ROUTES.filter((r) => r.feature === feature);
      expect(gone.length).toBeGreaterThan(0);
      const listed = new Set(operations(doc));
      for (const r of ROUTES)
        expect(listed.has(`${r.method.toUpperCase()} ${r.path}`), `${r.method} ${r.path}`).toBe(r.feature !== feature);
      for (const r of gone) {
        const res = await call(h, r.method.toUpperCase(), concrete(r.path), { json: r.body ? {} : undefined });
        expect(res.status, `${r.method} ${r.path}`).toBe(404);
        if (r.method !== "head") expect(((await res.json()) as { code: string }).code).toBe("ES_NOT_FOUND");
      }
    });
  }
});

describe("an answer the document does not give", () => {
  const answer = (status: number, body: unknown, headers: Record<string, string> = { "anydag-sync-protocol": "2" }) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

  it("passes when it is the document's", async () => {
    expect(await answerProblem(ALL, "GET", "/v1/health", answer(200, { version: "x", protocol: 2, mode: "single" }))).toBeNull();
  });

  it("is said: a field missing, a field the document does not name, a status it does not list, a header it lacks", async () => {
    expect(await answerProblem(ALL, "GET", "/v1/health", answer(200, { version: "x", mode: "single" }))).toMatch(/protocol/);
    expect(
      await answerProblem(ALL, "GET", "/v1/health", answer(200, { version: "x", protocol: 2, mode: "single", extra: 1 })),
    ).toMatch(/unevaluated/);
    expect(await answerProblem(ALL, "GET", "/v1/health", answer(418, {}))).toMatch(/does not list 418/);
    expect(await answerProblem(ALL, "GET", "/v1/health", answer(200, { version: "x", protocol: 2, mode: "single" }, {}))).toMatch(
      /no anydag-sync-protocol header/,
    );
  });

  it("is said for a refusal whose code that status does not carry", async () => {
    const res = answer(401, { code: "ES_QUOTA", message: "no" });
    expect(await answerProblem(ALL, "GET", "/v1/vaults", res)).toMatch(/allowed values/);
  });

  it("is said for a route the document lacks that answers anything but 404", async () => {
    expect(await answerProblem(ALL, "GET", "/v1/nowhere", answer(200, {}))).toMatch(/no route/);
    expect(await answerProblem({ ...ALL, logs: false }, "POST", "/v1/logs", answer(202, { accepted: 1 }))).toMatch(/no route/);
  });
});
