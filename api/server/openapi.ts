/**
 * The sync api server's OpenAPI document: every route `createApp` registers, in a table beside the
 * schemas the handlers read their bodies through. `GET /v1/openapi.json` answers it for the features
 * this server runs, and `npm run openapi` writes it, every feature on, to `docs/api/sync.openapi.json`
 * with its reference beside it (`docs/api/sync.md`).
 *
 * Load-bearing:
 * - **The table is held to the app both ways** (`api/test/openapi.test.ts`): every route the app
 *   registers is a row here, every row is a route, and every answer the api suites record is one
 *   its row declares — the status, and the body against the row's schema. A route added without a
 *   row fails there, not in review.
 * - **A feature that is `off` does not exist here either.** A row says which switch it is behind
 *   (`feature`), and the document for a server with that switch off leaves it out — sync's rows
 *   include `/v1/admin/*` and `/metrics`, which only look at sync's data, as `app.ts` gates them.
 * - **Who may ask is the row's `auth`**, and it brings the refusals that come with it: a device's
 *   `ES_AUTH`, a vault's `ES_NOT_FOUND`, the operator's `ES_FORBIDDEN`, and `ES_PROTOCOL` on every
 *   route `app.ts` checks the protocol of. The prose is the routes' own load-bearing notes, shortened.
 */

import { z } from "zod";

import { type Answer, type Json, openapi, type Route } from "../openapi/document";
import * as s from "../protocol/schema";
import { type ErrorCode, PROTOCOL, PROTOCOL_HEADER, STATUS } from "../protocol/wire";

export interface Features {
  sync: boolean;
  logs: boolean;
  feedback: boolean;
}

type Auth = "open" | "code" | "device" | "vault" | "admin";

export interface SyncRoute extends Route {
  /** The switch the route is behind; `null` answers whatever the switches say. */
  feature: keyof Features | null;
}

/** What each code means on the wire, said once for every answer that can carry it. */
const SAYS: Record<ErrorCode, string> = {
  ES_AUTH: "no device token, an unknown one, or a revoked device's",
  ES_FORBIDDEN: "not the admin token, or no admin token configured",
  ES_NOT_FOUND: "no such vault, blob, device, account or plan",
  ES_BAD_REQUEST: "a body or a query that does not have the shape this document gives",
  ES_STALE: "a change's `parent` is not its key's head; nothing was written (`conflicts`)",
  ES_NO_BLOB: "a commit names a blob the server does not hold; upload first (`missing`)",
  ES_QUOTA: "over the plan: storage, a file's size, or the number of devices",
  ES_HORIZON: "a cursor older than the compaction horizon; read the heads (`horizon`)",
  ES_PAIR: "a pairing code that is unknown, used or expired",
  ES_KEY_SET: "the vault has a key, and the `etag` sent is not its current one",
  ES_PROTOCOL: `the request did not say sync protocol ${PROTOCOL} in \`${PROTOCOL_HEADER}\``,
  ES_TOO_LARGE: "feedback bigger than the relay reads",
  ES_RATE: "over a rate: try again in a minute",
  ES_UNAVAILABLE: "this server has no GitHub token or repository for the relay",
  ES_UPSTREAM: "GitHub refused or failed; no issue was made",
};

const SAYS_PROTOCOL = {
  [PROTOCOL_HEADER]: {
    id: "Protocol",
    description: `The sync protocol this server speaks: ${PROTOCOL}.`,
    schema: z.string(),
    required: true,
  },
};

/** The answers for `codes`, one per status, each saying which codes it can carry. */
function refusals(codes: readonly ErrorCode[], v1: boolean): Record<number, Answer> {
  const by = new Map<number, ErrorCode[]>();
  const order = Object.keys(STATUS);
  for (const code of [...codes].sort((a, b) => order.indexOf(a) - order.indexOf(b)))
    by.set(STATUS[code], [...(by.get(STATUS[code]) ?? []), code]);
  const out: Record<number, Answer> = {};
  for (const [status, list] of [...by].sort(([a], [b]) => a - b))
    out[status] = {
      /* Named only under `/v1`, where every answer says the protocol: `/metrics`' 403 does not. */
      ...(v1 ? { id: list.join("_or_") } : {}),
      description: list.map((c) => `\`${c}\`: ${SAYS[c]}.`).join(" "),
      schema: s.refusal(list),
      ...(v1 ? { headers: SAYS_PROTOCOL } : {}),
    };
  return out;
}

interface Row {
  method: Route["method"];
  /** The route as Hono spells it: `/v1/vaults/:v`. */
  path: string;
  operationId: string;
  summary: string;
  description?: string;
  tag: string;
  feature: SyncRoute["feature"];
  auth: Auth;
  /** Whether `app.ts` checks the request's protocol header: every route not in its `ANY_PROTOCOL`. */
  checked: boolean;
  /** The path's parameters by name; a vault's `v` is known already. */
  params?: Record<string, z.ZodType>;
  query?: z.ZodObject;
  body?: Route["body"];
  answers: Record<number, Answer>;
  /** The codes the handler itself refuses with; the auth's own are added. */
  codes?: ErrorCode[];
}

/** The row as the builder takes it: the path's parameters, the auth's refusals, the 500. */
function route(r: Row): SyncRoute {
  /* What `app.ts` says the protocol on: a path under `/v1/` — `/v1` itself does not. */
  const v1 = r.path.startsWith("/v1/");
  const codes = new Set<ErrorCode>(r.codes ?? []);
  if (r.checked) codes.add("ES_PROTOCOL");
  if (r.auth === "device" || r.auth === "vault") codes.add("ES_AUTH");
  if (r.auth === "vault") codes.add("ES_NOT_FOUND");
  if (r.auth === "admin") codes.add("ES_FORBIDDEN");
  if (r.body?.schema && (r.body.type ?? "application/json") === "application/json") codes.add("ES_BAD_REQUEST");

  const names = [...r.path.matchAll(/:([A-Za-z_]+)/g)].map((m) => m[1]!);
  const shape: Record<string, z.ZodType> = {};
  for (const n of names) {
    const p = n === "v" ? s.VaultParam : r.params?.[n];
    if (!p) throw new Error(`openapi: ${r.path} names :${n} and its row does not say what it is`);
    shape[n] = p;
  }

  const answers: Record<number, Answer> = {};
  for (const [status, a] of Object.entries(r.answers))
    answers[Number(status)] = v1 ? { ...a, headers: { ...SAYS_PROTOCOL, ...a.headers } } : a;
  Object.assign(answers, refusals([...codes], v1));
  answers[500] = {
    ...(v1 ? { id: "ServerFailed", headers: SAYS_PROTOCOL } : {}),
    description: "The server failed; the stack is on its stderr, never here.",
    schema: s.ServerError,
  };

  const params: NonNullable<Route["params"]> = {};
  if (names.length) params.path = z.object(shape);
  if (r.query) params.query = r.query;
  if (r.checked) params.header = s.ProtocolHeader;

  return {
    method: r.method,
    path: r.path.replace(/:([A-Za-z_]+)/g, "{$1}"),
    operationId: r.operationId,
    summary: r.summary,
    ...(r.description ? { description: r.description } : {}),
    tag: r.tag,
    security: r.auth === "device" || r.auth === "vault" ? ["device"] : r.auth === "admin" ? ["admin"] : [],
    ...(Object.keys(params).length ? { params } : {}),
    ...(r.body ? { body: r.body } : {}),
    answers,
    feature: r.feature,
  };
}

const json = (description: string, schema: z.ZodType): Answer => ({ description, schema });

/** Every route `createApp` registers, in the order a reader meets them. */
export const ROUTES: SyncRoute[] = [
  // -- the service --------------------------------------------------------------------------------
  route({
    method: "get",
    path: "/v1",
    operationId: "info",
    summary: "What this server runs",
    description: "How the app tells what a server runs without trying each feature.",
    tag: "service",
    feature: null,
    auth: "open",
    checked: false,
    answers: { 200: json("The server's name, version and features.", s.Info) },
  }),
  route({
    method: "get",
    path: "/v1/health",
    operationId: "health",
    summary: "Liveness, and the protocol this server speaks",
    tag: "service",
    feature: null,
    auth: "open",
    checked: false,
    answers: { 200: json("The process is up.", s.Health) },
  }),
  route({
    method: "get",
    path: "/v1/ready",
    operationId: "ready",
    summary: "Whether the database answers",
    description:
      "The check a proxy and a compose healthcheck watch. A failing database is logged on stderr, never in the answer.",
    tag: "service",
    feature: null,
    auth: "open",
    checked: false,
    answers: { 200: json("The database answered.", s.Ready), 503: json("The database did not answer.", s.Ready) },
  }),
  route({
    method: "get",
    path: "/v1/openapi.json",
    operationId: "openapi",
    summary: "This document",
    description: "The routes of a feature this server has switched off are not in it.",
    tag: "service",
    feature: null,
    auth: "open",
    checked: false,
    answers: { 200: json("The OpenAPI 3.1 document of this server.", s.OpenApiDocument) },
  }),

  // -- pairing and devices ------------------------------------------------------------------------
  route({
    method: "post",
    path: "/v1/pair",
    operationId: "pair",
    summary: "Pair a device with a one-time code",
    description:
      "The code is the credential: ten Crockford base32 characters, used once, dead after fifteen minutes. A bad, used and expired code are one answer. The device limit is checked after the code is taken, so a refused pairing spends it.",
    tag: "devices",
    feature: "sync",
    auth: "code",
    checked: true,
    body: { schema: s.PairRequest },
    answers: { 200: json("The device token, shown once.", s.PairResponse) },
    codes: ["ES_PAIR", "ES_QUOTA"],
  }),
  route({
    method: "get",
    path: "/v1/devices",
    operationId: "devices",
    summary: "The account's devices",
    tag: "devices",
    feature: "sync",
    auth: "device",
    checked: true,
    answers: { 200: json("Every device of the account, the one asking marked `current`.", s.DevicesResponse) },
  }),
  route({
    method: "delete",
    path: "/v1/devices/:id",
    operationId: "revokeDevice",
    params: { id: s.DeviceParam },
    summary: "Revoke a device",
    description: "Its next request is refused `ES_AUTH` — the asking device's own included.",
    tag: "devices",
    feature: "sync",
    auth: "device",
    checked: true,
    answers: { 200: json("Revoked.", s.Ok) },
    codes: ["ES_NOT_FOUND"],
  }),

  // -- vaults -------------------------------------------------------------------------------------
  route({
    method: "get",
    path: "/v1/vaults",
    operationId: "vaults",
    summary: "The account's vaults",
    tag: "vaults",
    feature: "sync",
    auth: "device",
    checked: true,
    answers: { 200: json("Every vault of the account; their names are sealed.", s.VaultsResponse) },
  }),
  route({
    method: "post",
    path: "/v1/vaults",
    operationId: "createVault",
    summary: "Make a vault",
    description:
      "The id is the server's; a proposed one is kept when it is free. A failed upload is taken up again: an unkeyed, empty vault of the same account under that id is answered instead of a second one.",
    tag: "vaults",
    feature: "sync",
    auth: "device",
    checked: true,
    body: { schema: s.CreateVault },
    answers: { 201: json("The vault.", s.RemoteVault) },
  }),
  route({
    method: "get",
    path: "/v1/vaults/:v/key",
    operationId: "vaultKey",
    summary: "The vault's sealed key",
    tag: "vaults",
    feature: "sync",
    auth: "vault",
    checked: true,
    answers: { 200: json("The key, sealed twice, and its etag.", s.VaultKey) },
  }),
  route({
    method: "put",
    path: "/v1/vaults/:v/key",
    operationId: "putVaultKey",
    summary: "Set or replace the vault's key",
    description:
      "Set once, then changed only by whoever holds its etag: a second device uploading the same vault at the same moment loses loudly.",
    tag: "vaults",
    feature: "sync",
    auth: "vault",
    checked: true,
    body: { schema: s.PutVaultKey },
    answers: { 200: json("The key as stored, with a fresh etag.", s.VaultKey) },
    codes: ["ES_KEY_SET"],
  }),
  route({
    method: "post",
    path: "/v1/vaults/:v/report",
    operationId: "report",
    summary: "Count conflict copies and merges",
    description: "For the usage ledger only.",
    tag: "vaults",
    feature: "sync",
    auth: "vault",
    checked: true,
    body: { schema: s.Report },
    answers: { 200: json("Counted.", s.Ok) },
  }),
  route({
    method: "get",
    path: "/v1/account",
    operationId: "account",
    summary: "The device's account, plan and usage",
    tag: "vaults",
    feature: "sync",
    auth: "device",
    checked: true,
    answers: { 200: json("The account.", s.AccountInfo) },
    codes: ["ES_NOT_FOUND"],
  }),

  // -- blobs --------------------------------------------------------------------------------------
  route({
    method: "head",
    path: "/v1/vaults/:v/blobs/:id",
    operationId: "hasBlob",
    params: { id: s.BlobParam },
    summary: "Whether the server holds a blob, and its size",
    tag: "blobs",
    feature: "sync",
    auth: "vault",
    checked: true,
    answers: {
      200: {
        description: "Held; no body.",
        headers: { "content-length": { description: "The sealed blob's size in bytes.", schema: z.string(), required: true } },
      },
    },
    codes: ["ES_BAD_REQUEST", "ES_NOT_FOUND"],
  }),
  route({
    method: "get",
    path: "/v1/vaults/:v/blobs/:id",
    operationId: "blob",
    params: { id: s.BlobParam },
    summary: "A blob's sealed bytes",
    description:
      "The index, not the directory, says whether a blob is here: one uploaded and never committed is served until the collector forgets it.",
    tag: "blobs",
    feature: "sync",
    auth: "vault",
    checked: true,
    answers: { 200: { description: "The sealed bytes.", type: "application/octet-stream" } },
    codes: ["ES_BAD_REQUEST", "ES_NOT_FOUND"],
  }),
  route({
    method: "put",
    path: "/v1/vaults/:v/blobs/:id",
    operationId: "putBlob",
    params: { id: s.BlobParam },
    summary: "Upload a blob",
    description:
      "The sealed bytes as the body, with a `Content-Length`: the size is decided before a byte is read, against the plan's `max_file_bytes`, the server's own cap and the storage left (uploads not yet committed count). Idempotent: an id the server holds is answered without reading the body.",
    tag: "blobs",
    feature: "sync",
    auth: "vault",
    checked: true,
    body: { schema: s.BlobBytes, type: "application/octet-stream", description: "The sealed bytes." },
    answers: { 200: json("Held, at this size.", s.BlobStored) },
    codes: ["ES_BAD_REQUEST", "ES_QUOTA"],
  }),

  // -- the log ------------------------------------------------------------------------------------
  route({
    method: "post",
    path: "/v1/vaults/:v/commit",
    operationId: "commit",
    summary: "Commit changes, all or nothing",
    description:
      "Accepted only if every change's `parent` is its key's head. A refusal names what to do next: `ES_STALE` every conflicting key and its head, `ES_NO_BLOB` the blobs to upload. Nothing is written in either case.",
    tag: "log",
    feature: "sync",
    auth: "vault",
    checked: true,
    body: { schema: s.CommitRequest },
    answers: { 200: json("The `seq` of each change.", s.CommitResponse) },
    codes: ["ES_STALE", "ES_NO_BLOB", "ES_QUOTA"],
  }),
  route({
    method: "get",
    path: "/v1/vaults/:v/changes",
    operationId: "changes",
    summary: "The log after a cursor",
    description:
      "A cursor below the horizon has missed compacted rows and is refused `ES_HORIZON`: read the heads instead. `more` is `next < head`, never whether the page came back full.",
    tag: "log",
    feature: "sync",
    auth: "vault",
    checked: true,
    query: s.ChangesQuery,
    answers: { 200: json("A page of the log.", s.ChangesResponse) },
    codes: ["ES_BAD_REQUEST", "ES_HORIZON"],
  }),
  route({
    method: "get",
    path: "/v1/vaults/:v/heads",
    operationId: "heads",
    summary: "Every key's head, a page at a time",
    description: "A device that reads every page and then pulls `changes?since=<the first page's seq>` has missed nothing.",
    tag: "log",
    feature: "sync",
    auth: "vault",
    checked: true,
    query: s.HeadsQuery,
    answers: { 200: json("A page of heads.", s.HeadsResponse) },
    codes: ["ES_BAD_REQUEST"],
  }),
  route({
    method: "get",
    path: "/v1/vaults/:v/poke",
    operationId: "poke",
    summary: "Hear about commits as they land",
    description:
      'A server-sent event stream: `data: {"seq":N}` after each commit to the vault and a `: ping` comment every 20 s. It carries a number and nothing else: a client reads `changes` either way, so a lost poke costs a poll interval, never a change.',
    tag: "log",
    feature: "sync",
    auth: "vault",
    checked: false,
    answers: {
      200: { description: "The stream, open until the client goes.", type: "text/event-stream" },
      204: { description: "This server does not poke (`ANYDAG_API_POKE=off`): poll." },
    },
  }),

  // -- logs and feedback --------------------------------------------------------------------------
  route({
    method: "post",
    path: "/v1/logs",
    operationId: "logs",
    summary: "Send anonymous logs",
    description:
      "Open: an install that sends logs is usually not a device of this server. A batch over the size cap, the per-address rate or the server's is answered `{accepted: 0}` and dropped, never an error a client would retry; one that is not JSON is `ES_BAD_REQUEST`.",
    tag: "logs",
    feature: "logs",
    auth: "open",
    checked: false,
    body: { schema: s.LogBatch },
    answers: { 202: json("How many events were kept.", s.LogsAccepted) },
  }),
  route({
    method: "post",
    path: "/v1/feedback",
    operationId: "feedback",
    summary: "Send a bug or an idea, made a GitHub issue",
    description:
      "Stateless: nothing of it is kept. Every file is uploaded before the issue is made, so a failed upload makes no issue. Five a minute an address, sixty in all.",
    tag: "feedback",
    feature: "feedback",
    auth: "open",
    checked: false,
    body: {
      schema: s.FeedbackForm,
      type: "multipart/form-data",
      encoding: {
        boards: { contentType: "application/json" },
        notes: { contentType: "application/json" },
        env: { contentType: "application/json" },
      },
    },
    answers: { 201: json("The issue.", s.FeedbackSent) },
    codes: ["ES_BAD_REQUEST", "ES_TOO_LARGE", "ES_RATE", "ES_UNAVAILABLE", "ES_UPSTREAM"],
  }),

  // -- the operator's -----------------------------------------------------------------------------
  route({
    method: "get",
    path: "/v1/admin/accounts",
    operationId: "adminAccounts",
    summary: "Every account",
    tag: "admin",
    feature: "sync",
    auth: "admin",
    checked: false,
    answers: { 200: json("Every account, with its live devices and its vaults counted.", s.AdminAccounts) },
  }),
  route({
    method: "post",
    path: "/v1/admin/accounts",
    operationId: "adminCreateAccount",
    summary: "Make an account",
    tag: "admin",
    feature: "sync",
    auth: "admin",
    checked: false,
    body: { schema: s.NewAccount },
    answers: { 201: json("The account.", s.AdminAccount) },
    codes: ["ES_NOT_FOUND"],
  }),
  route({
    method: "post",
    path: "/v1/admin/pair",
    operationId: "adminPair",
    summary: "Mint a pairing code for an account",
    tag: "admin",
    feature: "sync",
    auth: "admin",
    checked: false,
    body: { schema: s.PairFor },
    answers: { 200: json("The code, shown as `XXXXX-XXXXX`.", s.AdminPair) },
    codes: ["ES_NOT_FOUND"],
  }),
  route({
    method: "put",
    path: "/v1/admin/plans/:id",
    operationId: "adminPutPlan",
    params: { id: s.PlanParam },
    summary: "Write a plan's limits",
    description: "A plan is data: this writes it, and only `…/plan` puts an account on one.",
    tag: "admin",
    feature: "sync",
    auth: "admin",
    checked: false,
    body: { schema: s.PlanLimitsBody },
    answers: { 200: json("The plan as written.", s.Plan) },
  }),
  route({
    method: "put",
    path: "/v1/admin/plan",
    operationId: "adminPlan",
    summary: "Write a plan, and optionally put an account on it",
    description: "The one-call form `anydag-api plan set --account` mirrors.",
    tag: "admin",
    feature: "sync",
    auth: "admin",
    checked: false,
    body: { schema: s.PlanAndAccount },
    answers: { 200: json("The plan as written.", s.Plan) },
    codes: ["ES_NOT_FOUND"],
  }),
  route({
    method: "post",
    path: "/v1/admin/accounts/:id/plan",
    operationId: "adminSetPlan",
    params: { id: s.AccountParam },
    summary: "Put an account on a plan",
    description: "The account is named by its id or its name.",
    tag: "admin",
    feature: "sync",
    auth: "admin",
    checked: false,
    body: { schema: s.PlanFor },
    answers: { 200: json("The account on its new plan.", s.AdminAccount) },
    codes: ["ES_NOT_FOUND"],
  }),
  route({
    method: "get",
    path: "/v1/admin/usage",
    operationId: "adminUsage",
    summary: "The usage ledger",
    tag: "admin",
    feature: "sync",
    auth: "admin",
    checked: false,
    query: s.UsageQuery,
    answers: { 200: json("The ledger's rows.", s.UsageResponse) },
    codes: ["ES_BAD_REQUEST", "ES_NOT_FOUND"],
  }),
  route({
    method: "post",
    path: "/v1/admin/gc",
    operationId: "adminGc",
    summary: "Run the collector now",
    tag: "admin",
    feature: "sync",
    auth: "admin",
    checked: false,
    answers: { 200: json("What it did.", s.GcResult) },
  }),
  route({
    method: "get",
    path: "/metrics",
    operationId: "metrics",
    summary: "Prometheus metrics",
    description: "Latency by route template, usage, open poke streams.",
    tag: "admin",
    feature: "sync",
    auth: "admin",
    checked: false,
    answers: { 200: { description: "The text exposition format.", type: "text/plain" } },
  }),
];

const INFO = {
  title: "AnyDag sync API",
  version: String(PROTOCOL),
  description: [
    "`anydag-api`: end-to-end-encrypted sync, opt-in anonymous logs and the feedback relay, one Node process anybody can run (`api/` in the AnyDag repository).",
    "",
    "The server holds opaque keys, sealed blobs and sealed metadata, and never a path or a byte of a file: a `key` is an HMAC of a path, a blob id an HMAC of the bytes, a `meta` and a vault's `name` are sealed, all base64url.",
    "",
    `\`info.version\` is the sync protocol, ${PROTOCOL}. Every request to a route that lists the \`${PROTOCOL_HEADER}\` header must send it, and every \`/v1\` answer says it back. A refusal is \`{code, message}\` at the status its \`ES_*\` code has, whatever the route; branch on the code.`,
    "",
    "Generated from the code (`api/server/openapi.ts`, `api/protocol/schema.ts`): do not edit it by hand.",
  ].join("\n"),
};

const TAGS = [
  { name: "service", description: "What runs, and whether it is up. No token." },
  { name: "devices", description: "Pairing a device, and the account's devices." },
  { name: "vaults", description: "A device's account, its vaults and their keys." },
  { name: "blobs", description: "Sealed bytes in, sealed bytes out." },
  { name: "log", description: "Each vault's gapless log of commits, and its heads." },
  { name: "logs", description: "Anonymous logs from installs that said yes. No token." },
  { name: "feedback", description: "The feedback relay. No token." },
  { name: "admin", description: "The operator's routes, behind `ANYDAG_API_ADMIN_TOKEN`." },
];

const SECURITY: Record<string, Json> = {
  device: {
    type: "http",
    scheme: "bearer",
    description: "A device token, from `POST /v1/pair`: 43 base64url characters, shown once.",
  },
  admin: { type: "http", scheme: "bearer", description: "The operator's `ANYDAG_API_ADMIN_TOKEN`." },
};

const ALL: Features = { sync: true, logs: true, feedback: true };

/** The document for a server running `features`: every route of a feature that is off left out. */
export function syncDocument(features: Features = ALL): Json {
  return openapi({
    info: INFO,
    tags: TAGS,
    securitySchemes: SECURITY,
    registry: s.SYNC,
    routes: ROUTES.filter((r) => r.feature === null || features[r.feature]),
  });
}
