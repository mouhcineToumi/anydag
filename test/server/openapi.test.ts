/**
 * The local server's OpenAPI document (#531): a valid OpenAPI 3.1 document holding every route the
 * app registers and every route `docs/parity.json` names, and no other; served at
 * `GET /api/openapi.json` behind the gate; without the `cloud` routes when that switch is off. That
 * every answer the suite records is the one the document gives is held by `answers.setup.ts` on
 * every app a test makes; the routes no other test asks are asked here, and the last block shows the
 * check would say so.
 */
import "./sqlite-shim";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { Json } from "../../api/openapi/document";
import { createApp, routes } from "../../server/app";
import { Session } from "../../server/context";
import { localDocument, ROUTES } from "../../server/openapi";
// @ts-expect-error — a plain `.mjs` with no types, as every script beside it
import { apiRoutes, readManifest } from "../../scripts/parity.mjs";
import { BOARD, makeEnv, NOTE, QUIZ, sweepTemps, type Env } from "./helpers";
import { answerProblem } from "./spec";

/* As `api/test/openapi.test.ts` reads it: Ajv resolves `$dynamicRef: "#meta"` onto the wrong anchor. */
const OAS = JSON.parse(
  fs
    .readFileSync(fileURLToPath(new URL("../../api/test/oas-3.1.schema.json", import.meta.url)), "utf8")
    .replaceAll('"$dynamicRef": "#meta"', '"$ref": "#/$defs/schema"'),
) as Json;

const TOKEN = "t";
const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

let env: Env;
beforeEach(() => {
  env = makeEnv();
});
afterEach(async () => {
  await env.cleanup();
  sweepTemps();
});

function appOf(vars: NodeJS.ProcessEnv = { ...process.env, ANYDAG_CLOUD: "on" }) {
  const app = createApp({ session: new Session(env.home, env.vault, "test", vars), token: TOKEN, page: null });
  const call = (method: string, at: string, body?: unknown, headers: Record<string, string> = {}) =>
    app.request(`http://127.0.0.1${at}`, {
      method,
      headers: { "content-type": "application/json", "x-anydag-token": TOKEN, host: "127.0.0.1", ...headers },
      ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }),
    });
  return { app, call };
}

/** Every operation of a document, as `METHOD /path`. */
const operations = (doc: Json): string[] =>
  Object.entries(doc.paths as Record<string, Json>).flatMap(([at, methods]) =>
    Object.keys(methods).map((m) => `${m.toUpperCase()} ${at}`),
  );

/** A row as `docs/parity.json` and `apiRoutes()` spell a route: a trailing `/*` is `{path:path}`. */
const spelled = (r: { method: string; hono: string }) => `${r.method.toUpperCase()} ${r.hono.replace(/\/\*$/, "/{path:path}")}`;

const difference = (a: Iterable<string>, b: Iterable<string>) => {
  const has = new Set(b);
  return [...new Set(a)].filter((x) => !has.has(x)).sort();
};

describe("the document", () => {
  it("is a valid OpenAPI 3.1 document", () => {
    const ajv = new Ajv2020({ strict: false, allErrors: true });
    addFormats.default(ajv);
    const validate = ajv.compile(OAS);
    const doc = localDocument();
    expect(validate(doc) ? "" : ajv.errorsText(validate.errors)).toBe("");
    expect(doc.openapi).toBe("3.1.0");
    // …and the check can fail.
    const broken = structuredClone(doc) as { paths: Record<string, Record<string, { responses: Record<string, Json> }>> };
    delete broken.paths["/api/health"]!.get!.responses["200"]!.description;
    expect(validate(broken)).toBe(false);
  });

  it("holds schemas that compile, and refs that land", () => {
    const doc = localDocument();
    const ajv = new Ajv2020({ strict: false });
    ajv.addSchema(doc, "doc");
    const components = doc.components as Record<string, Record<string, unknown>>;
    for (const name of Object.keys(components.schemas!))
      expect(() => ajv.compile({ $ref: `doc#/components/schemas/${name}` }), name).not.toThrow();
    const refs = JSON.stringify(doc).match(/"\$ref":"#\/components\/[^"]+"/g) ?? [];
    expect(refs.length).toBeGreaterThan(50);
    for (const ref of new Set(refs)) {
      const [, kind, name] = /#\/components\/([^/]+)\/([^"]+)"/.exec(ref)!;
      expect(components[kind!]?.[name!], ref).toBeDefined();
    }
  });

  it("names every route the app registers, and no route it does not", () => {
    const app = routes(
      { session: new Session(env.home, env.vault, "test", { ...process.env, ANYDAG_CLOUD: "on" }), token: TOKEN, page: null },
      new WeakSet(),
    );
    const registered = app.routes.filter((r) => r.method !== "ALL").map((r) => `${r.method} ${r.path}`);
    const documented = ROUTES.map((r) => `${r.method.toUpperCase()} ${r.hono}`);
    expect(difference(registered, documented)).toEqual([]);
    expect(difference(documented, registered)).toEqual([]);
    expect(new Set(registered).size).toBe(ROUTES.length);
  });

  it("names every route docs/parity.json does, and no other, both ways", () => {
    const manifest = readManifest() as { features: { rest: unknown }[] };
    const named = manifest.features.flatMap((f) => (Array.isArray(f.rest) ? (f.rest as string[]) : []));
    const documented = ROUTES.map(spelled);
    expect(difference(named, documented)).toEqual([]);
    expect(difference(documented, named)).toEqual([]);
    /* …and the source the manifest is held to says the same. */
    const source = apiRoutes() as string[];
    expect(difference(source, documented)).toEqual([]);
    expect(difference(documented, source)).toEqual([]);
  });

  it("is the same bytes every time it is made, and the bytes committed", () => {
    const made = `${JSON.stringify(localDocument(), null, 2)}\n`;
    expect(JSON.stringify(localDocument())).toBe(JSON.stringify(structuredClone(localDocument())));
    const committed = fileURLToPath(new URL("../../docs/api/local.openapi.json", import.meta.url));
    expect(fs.readFileSync(committed, "utf8") === made, "run `npm run openapi`").toBe(true);
  });
});

describe("GET /api/openapi.json", () => {
  it("answers the document for this server's switch", async () => {
    const res = await appOf().call("GET", "/api/openapi.json");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(localDocument({ cloud: true }));
  });

  it("is behind the gate: no token is a 401, another Host a 421", async () => {
    const { call } = appOf();
    const bare = await call("GET", "/api/openapi.json", undefined, { "x-anydag-token": "" });
    expect(bare.status).toBe(401);
    expect(await bare.json()).toMatchObject({ code: "token" });
    expect((await call("GET", "/api/openapi.json", undefined, { host: "evil.example" })).status).toBe(421);
  });

  it("leaves out the cloud routes when the switch is off, and those routes are not there", async () => {
    const { call } = appOf({ ...process.env, ANYDAG_CLOUD: "off" });
    const doc = (await (await call("GET", "/api/openapi.json")).json()) as Json;
    const listed = new Set(operations(doc));
    const gone = ROUTES.filter((r) => r.cloud);
    expect(gone.length).toBeGreaterThan(10);
    for (const r of ROUTES) expect(listed.has(`${r.method.toUpperCase()} ${r.path}`), `${r.method} ${r.path}`).toBe(!r.cloud);
    for (const r of gone) expect((await call(r.method.toUpperCase(), r.hono, r.body ? {} : undefined)).status, r.hono).toBe(404);
  });
});

describe("the routes no other test asks", () => {
  /* Each answer is held to the document by `answers.setup.ts` as it comes back; the statuses say the
     request was the one meant. */
  it("answer what the document says", async () => {
    fs.writeFileSync(path.join(env.vault.root, "b.board.md"), BOARD);
    fs.writeFileSync(path.join(env.vault.root, "n.md"), NOTE);
    fs.writeFileSync(path.join(env.vault.root, "q.quiz.md"), QUIZ);
    const { call } = appOf();
    const v = `vault=${env.vault.id}`;
    const status = async (method: string, at: string, body?: unknown) => (await call(method, at, body)).status;

    expect(await status("GET", "/api/settings")).toBe(200);
    expect(await status("POST", `/__board/mkdir?${v}`, { name: "Projects" })).toBe(200);
    expect(await status("POST", `/__board/project?${v}`, { name: "n", status: "active", hue: "teal" })).toBe(200);
    expect(await status("POST", `/__board/event?${v}`, { name: "n", start: "2026-11-18" })).toBe(200);
    expect(await status("GET", `/__board/diagnostics?${v}&name=b`)).toBe(200);
    expect(await status("POST", `/__board/diagnostics?${v}`, { text: BOARD, kind: "board" })).toBe(200);
    expect(await status("GET", `/__board/fences?${v}&name=b`)).toBe(200);
    expect(await status("POST", `/__board/upload?${v}&name=b`, { dataUrl: PNG })).toBe(200);
    expect(await status("GET", `/__board/files?${v}`)).toBe(200);
    expect(await status("GET", `/__board/assets/unused?${v}&name=b`)).toBe(200);
    expect(await status("POST", `/__board/assets/sweep?${v}&name=b`)).toBe(200);
    expect(await status("GET", `/__board/components?${v}`)).toBe(200);
    expect(await status("POST", `/__board/components/delete?${v}`, { name: "nothing-here" })).toBe(404);
    expect(await status("GET", `/__board/library?${v}`)).toBe(200);
    expect(await status("GET", `/__board/icons?${v}&q=aws`)).toBe(200);
    expect(await status("GET", `/api/practice?${v}`)).toBe(200);
    expect(await status("POST", `/api/practice?${v}`, { events: [] })).toBe(200);
    expect(
      await status("POST", `/api/practice?${v}`, {
        events: [{ quiz: "zzzzzzzzzz", question: "q1", correct: true, run: "quiz" }],
      }),
    ).toBe(404);
    expect(await status("PUT", `/api/practice?${v}`, { graduate: 3 })).toBe(200);

    const made = await call("POST", `/__board/chat?${v}`, { provider: "claude", model: "sonnet" });
    expect(made.status).toBe(200);
    const { id } = ((await made.json()) as { chat: { id: string } }).chat;
    expect(await status("POST", `/__board/chat/rename?${v}`, { id, title: "Renamed" })).toBe(200);

    for (const at of [`/__board/events?${v}`, `/__board/chat/events?${v}&id=${id}`]) {
      const res = await call("GET", at);
      expect(res.status, at).toBe(200);
      expect(res.headers.get("content-type"), at).toMatch(/^text\/event-stream/);
      await res.body?.cancel();
    }
  });
});

describe("an answer the document does not give", () => {
  const answer = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const ME = { user: { id: "local", tz: "Europe/Paris" } };

  it("passes when it is the document's", async () => {
    const me = (await (await appOf().call("GET", "/api/auth/me")).json()) as Json;
    expect(await answerProblem(true, "GET", "/api/auth/me", answer(200, me))).toBeNull();
  });

  it("is said: a field the document does not name, a status it does not list, another media type", async () => {
    const me = (await (await appOf().call("GET", "/api/auth/me")).json()) as Json;
    expect(await answerProblem(true, "GET", "/api/auth/me", answer(200, { ...me, extra: 1 }))).toMatch(/unevaluated/);
    expect(await answerProblem(true, "GET", "/api/auth/me", answer(418, ME))).toMatch(/does not list 418/);
    expect(
      await answerProblem(
        true,
        "GET",
        "/api/auth/me",
        new Response("hi", { status: 200, headers: { "content-type": "text/plain" } }),
      ),
    ).toMatch(/the document says application\/json/);
  });

  it("is said for a refusal that is not `{error, code?}`, and for a route the document lacks", async () => {
    expect(await answerProblem(true, "POST", "/__board/put", answer(400, { message: "no" }))).toMatch(/error/);
    expect(await answerProblem(true, "GET", "/__board/nowhere", answer(200, {}))).toMatch(/no route/);
    /* …while the gate's own answers, and the page, are not a route's. */
    expect(await answerProblem(true, "GET", "/__board/nowhere", answer(404, { error: "no route" }))).toBeNull();
    expect(await answerProblem(true, "GET", "/index.html", answer(200, {}))).toBeNull();
  });

  it("knows a cloud route is not there with the switch off", async () => {
    expect(await answerProblem(false, "GET", "/api/sync", answer(200, {}))).toMatch(/no route/);
  });
});
