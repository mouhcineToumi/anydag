/**
 * The schemas and rows of the routes a build carries only with its `cloud` switch on
 * (`server/features.ts`): sync (`server/routes/sync.ts`, its contract `server/sync/types.ts`),
 * anonymous logs (`server/routes/telemetry.ts`) and feedback (`server/routes/feedback.ts`).
 */

import { z } from "zod";

import { err } from "../http";
import { body, field, json, kept, named } from "./fields";
import { route } from "./row";

/* ---------------------------------------------------------------- sync */

const SyncStatus = named(
  "SyncStatus",
  "The current vault's link to a sync server.",
  z.object({
    vault: z.string(),
    linked: z.boolean(),
    state: z.enum(["idle", "syncing", "offline", "paused", "error", "unlinked"]),
    reason: z.string().nullable(),
    server: z.string().nullable(),
    remote: z.string().nullable(),
    device: z.string().nullable(),
    pending: z.int(),
    conflicts: z.array(z.string()),
    last: z.string().nullable(),
  }),
);

const SyncDevices = named(
  "SyncDevices",
  "The paired account's devices, this one marked `me`.",
  z.object({
    devices: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        platform: z.string(),
        created: z.string(),
        seen: z.string().nullable(),
        revoked: z.string().nullable(),
        me: z.boolean(),
      }),
    ),
  }),
);

export const PairBody = body(
  "PairBody",
  "A sync server's address and the one-time code its admin made, and what to call this device there.",
  {
    server: kept(z.string(), "The server's address: `https://`, or `http://` on this machine."),
    code: kept(z.string(), "The one-time code."),
    device: kept(z.string(), "This device's name there; left out, the machine's host name."),
  },
  ["server", "code"],
);

export const LinkBody = body(
  "LinkBody",
  "How to link the vault: `upload` it as a new remote under a passphrase, `download` a remote into an empty vault, or `merge` the two by path.",
  {
    mode: kept(z.enum(["upload", "download", "merge"]), "Which."),
    passphrase: kept(z.string(), "`upload`: at least eight characters. `download` and `merge`: the remote's, or `recovery`."),
    recovery: kept(z.string(), "`download` and `merge`: the recovery code `upload` answered once."),
    remote: kept(z.string(), "`download` and `merge`: the remote vault's id (`GET /api/sync/remotes`)."),
  },
  ["mode"],
);

export const RevokeBody = body(
  "RevokeBody",
  "A device of the account to sign out.",
  {
    id: field(
      z.string().min(1),
      "The device's id.",
      (raw) => {
        if (typeof raw !== "string" || !raw) throw err(400, "Name the device to sign out by its `id`.");
        return raw;
      },
      "read",
    ),
  },
  ["id"],
);

/** A sync server's own refusal comes back at its status, its `ES_*` in `code`. */
const SERVER = "The sync server's refusal, its `ES_*` in `code`";

/* ---------------------------------------------------------------- telemetry */

export const ConsentBody = body(
  "ConsentBody",
  "The person's answer to the question of sending anonymous logs.",
  {
    enabled: field(
      z.boolean().nullable(),
      "`true`, `false`, or `null` to be asked again.",
      (raw) => {
        if (raw !== true && raw !== false && raw !== null) throw err(400, "`enabled` is true, false, or null to be asked again");
        return raw;
      },
      "read",
    ),
  },
  ["enabled"],
);

export const EventsBody = body(
  "EventsBody",
  "The page's events, cleaned here before anything is kept (`api/protocol/logs.ts`).",
  {
    events: field(
      z.array(z.unknown()),
      "The events.",
      (raw) => {
        if (!Array.isArray(raw)) throw err(400, "expected `events` to be a list");
        return raw as unknown[];
      },
      "read",
    ),
  },
  ["events"],
);

const Consent = named(
  "Consent",
  "The answer, `null` until somebody gives one, and where logs go: a host, or `null` when this build sends none.",
  z.object({ consent: z.boolean().nullable(), destination: z.string().nullable() }),
);

/* ---------------------------------------------------------------- feedback */

export function names(raw: unknown, what: string): string[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw) || !raw.every((n) => typeof n === "string" && n)) throw err(400, `\`${what}\` is a list of names`);
  return [...new Set(raw as string[])];
}

export const FeedbackBody = body(
  "FeedbackBody",
  "A bug or an idea, with the documents and files the person chose to send with it. `boards` and `notes` are names in the vault, sent whole under their own name.",
  {
    kind: field(
      z.enum(["bug", "idea"]),
      "Which.",
      (raw) => {
        if (raw !== "bug" && raw !== "idea") throw err(400, "`kind` is bug or idea");
        return raw;
      },
      "read",
    ),
    text: field(
      z.string(),
      "What happened, or what you would like.",
      (raw) => {
        if (typeof raw !== "string") throw err(400, "`text` is what happened, or what you would like");
        return raw;
      },
      "read",
    ),
    boards: field(z.array(z.string().min(1)).nullable(), "Boards to send, by name.", (raw) => names(raw, "boards"), "read"),
    notes: kept(z.array(z.string().min(1)).nullable(), "Notes to send, by name."),
    files: kept(
      z.array(z.object({ name: z.string(), type: z.string(), data: z.string() })).nullable(),
      "Files to send: `data` is the bytes as base64, or a `data:` URL.",
    ),
  },
  ["kind", "text"],
);

export const CLOUD_ROUTES = [
  route({
    method: "get",
    path: "/api/sync",
    operationId: "syncStatus",
    summary: "The vault's link to a sync server",
    tag: "sync",
    cloud: true,
    answers: { 200: json("Its status.", SyncStatus) },
  }),
  route({
    method: "post",
    path: "/api/sync/pair",
    operationId: "syncPair",
    summary: "Pair the vault with a sync server",
    description: "With a one-time code its admin made. Pairing links nothing yet: `/api/sync/link` does.",
    tag: "sync",
    cloud: true,
    body: { schema: PairBody },
    answers: {
      200: json(
        "The server, the account and this device's name there.",
        z.object({ server: z.string(), account: z.string(), device: z.string() }),
      ),
    },
    refuses: {
      400: `An address that is not a sync server's, or no code; or ${SERVER}.`,
      409: 'The vault is linked: `{code: "linked"}`.',
      502: "The sync server did not answer: `ES_NETWORK`.",
    },
  }),
  route({
    method: "get",
    path: "/api/sync/remotes",
    operationId: "syncRemotes",
    summary: "The remote vaults the paired account holds",
    tag: "sync",
    cloud: true,
    answers: {
      200: json(
        "Each by id; its name is sealed. `mine` is the current vault's own.",
        z.object({
          remotes: z.array(
            z.object({ id: z.string(), created: z.string(), seq: z.int(), keyed: z.boolean(), mine: z.boolean() }),
          ),
        }),
      ),
    },
    refuses: {
      403: `The server no longer accepts this device: \`ES_AUTH\`; or ${SERVER}.`,
      409: 'The vault is not paired: `{code: "unpaired"}`.',
      502: "The sync server did not answer: `ES_NETWORK`.",
    },
  }),
  route({
    method: "post",
    path: "/api/sync/link",
    operationId: "syncLink",
    summary: "Link the vault to a remote",
    description:
      "`upload` answers the recovery code, once; `download` re-keys the vault, so the page reloads onto `?vault=<vault>`.",
    tag: "sync",
    cloud: true,
    body: { schema: LinkBody },
    answers: {
      200: json(
        "The status, the recovery code (`upload` only), and the vault's id now.",
        z.object({ status: SyncStatus, recovery: z.string().optional(), vault: z.string() }),
      ),
    },
    refuses: {
      400: "A `mode` that is not one, a passphrase too short or that does not open the key, a recovery code mistyped or not this vault's, no remote named; or the sync server's refusal.",
      404: "The account has no such remote: `ES_NOT_FOUND`.",
      409: "The vault is linked or not paired, the remote has no key or is linked on this machine, a `download` into a vault that holds documents, or this process could not keep the key (`secret`).",
      500: "The link was kept but its sync did not start.",
      502: "The sync server did not answer: `ES_NETWORK`.",
    },
  }),
  route({
    method: "post",
    path: "/api/sync/unlink",
    operationId: "syncUnlink",
    summary: "Unlink the vault",
    description: "The vault, its files and the remote are kept; the token, the key at rest and the state are forgotten.",
    tag: "sync",
    cloud: true,
    answers: { 200: json("The status, `unlinked`.", SyncStatus) },
  }),
  route({
    method: "post",
    path: "/api/sync/now",
    operationId: "syncNow",
    summary: "Sync now",
    tag: "sync",
    cloud: true,
    answers: { 200: json("The status once a pull and a push finished.", SyncStatus) },
    refuses: { 409: 'The vault is not linked: `{code: "unlinked"}`.' },
  }),
  route({
    method: "get",
    path: "/api/sync/devices",
    operationId: "syncDevices",
    summary: "The account's devices",
    tag: "sync",
    cloud: true,
    answers: { 200: json("Every device, revoked ones too.", SyncDevices) },
    refuses: {
      403: `The server no longer accepts this device: \`ES_AUTH\`; or ${SERVER}.`,
      409: 'The vault is not paired: `{code: "unpaired"}`.',
      502: "The sync server did not answer: `ES_NETWORK`.",
    },
  }),
  route({
    method: "post",
    path: "/api/sync/devices/revoke",
    operationId: "syncRevoke",
    summary: "Sign a device out of the account",
    tag: "sync",
    cloud: true,
    body: { schema: RevokeBody },
    answers: { 200: json("The devices now.", SyncDevices) },
    refuses: {
      400: "No `id`.",
      403: `The server no longer accepts this device: \`ES_AUTH\`; or ${SERVER}.`,
      404: "No such device: `ES_NOT_FOUND`.",
      409: 'The vault is not paired: `{code: "unpaired"}`.',
      502: "The sync server did not answer: `ES_NETWORK`.",
    },
  }),
  route({
    method: "get",
    path: "/api/telemetry",
    operationId: "telemetry",
    summary: "Whether anonymous logs are sent",
    tag: "logs",
    cloud: true,
    answers: { 200: json("The answer and the destination.", Consent) },
  }),
  route({
    method: "put",
    path: "/api/telemetry",
    operationId: "setTelemetry",
    summary: "Answer whether anonymous logs are sent",
    tag: "logs",
    cloud: true,
    body: { schema: ConsentBody },
    answers: { 200: json("The answer now.", Consent) },
    refuses: { 400: "`enabled` is not `true`, `false` or `null`." },
  }),
  route({
    method: "post",
    path: "/api/telemetry/events",
    operationId: "telemetryEvents",
    summary: "Hand over the page's events",
    tag: "logs",
    cloud: true,
    body: { schema: EventsBody },
    answers: { 200: json("How many were kept: `0` unless the answer is yes.", z.object({ accepted: z.int() })) },
    refuses: { 400: "`events` is not a list." },
  }),
  route({
    method: "get",
    path: "/api/feedback",
    operationId: "feedbackInfo",
    summary: "Where feedback goes",
    tag: "feedback",
    cloud: true,
    answers: {
      200: json(
        "The relay's host, `null` when this app has none, and the version, system and architecture a send carries.",
        z.object({
          destination: z.string().nullable(),
          env: z.object({ version: z.string(), os: z.string(), arch: z.string() }),
        }),
      ),
    },
  }),
  route({
    method: "post",
    path: "/api/feedback",
    operationId: "feedback",
    summary: "Send a bug or an idea",
    description: "Forwarded to the relay that makes it a GitHub issue. A chat may not call it.",
    tag: "feedback",
    cloud: true,
    body: { schema: FeedbackBody },
    answers: { 201: json("The issue.", z.object({ url: z.string() })) },
    refuses: {
      400: "A `kind`, `text`, list of names or file that is not one, or what the relay refused (`feedback-invalid`).",
      404: "A document named that is not in the vault.",
      502: "The relay could not be reached (`feedback-unreachable`), or answered what it should not.",
      503: "This app has no feedback relay: `ES_UNAVAILABLE`.",
    },
  }),
];
