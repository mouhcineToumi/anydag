/**
 * Every `/v1` body and answer as a zod schema: what the routes read a request through, and what
 * `GET /v1/openapi.json` and `docs/api/sync.openapi.json` are generated from (`api/server/openapi.ts`).
 *
 * Load-bearing:
 * - **`wire.ts` stays the contract, and this file cannot disagree with it.** `wire.ts` is plain
 *   TypeScript with no imports, which the app's sync client takes verbatim; these schemas are the
 *   same shapes for the server and the document. The `Agrees` list at the foot holds each schema's
 *   parsed type equal to its `wire.ts` type, both ways, in `npm run checks`' typecheck: a field added,
 *   dropped, made optional or retyped on one side alone does not compile. *Frozen* still applies — a
 *   change here an older peer would misread moves `PROTOCOL`.
 * - **A request schema refuses with the sentence the hand-written checks said, in their order.**
 *   Every check carries its old message, and fields are declared in the order they were checked, so
 *   `parse` in `routes/http.ts` — which answers the first issue in that order — says what the route
 *   said before #530 for any body. `api/test/schema.test.ts` holds that against those checks, kept
 *   there verbatim. Nothing is coerced: a field of the wrong type is refused, never repaired.
 * - **A request is described as it is accepted**, which is sometimes wider than `wire.ts`: an
 *   optional field may also be `null`, and `report`'s counts may be left out. The document shows the
 *   input form; the parsed form is the wire's.
 * - **The log batch and the feedback form are described, not tightened.** `cleanBatch` keeps what
 *   it can of a batch and drops the rest (it never answers 400), so its schema is generated from
 *   `EVENTS` — the same table `cleanBatch` reads — and describes what is kept. The feedback form's
 *   caps are `feedbackProblem`'s, which the page and the app's server share; its JSON parts are read
 *   through the schemas here.
 */

import { z } from "zod";

import { note, registry } from "../openapi/document";
import { FEEDBACK_KINDS, MAX_FEEDBACK_DOC, MAX_FEEDBACK_NAME, MAX_FEEDBACK_TEXT } from "./feedback";
import {
  ARCHES,
  EVENTS,
  INSTALL,
  LOCALE,
  LOGS_VERSION,
  MAX_EVENTS,
  OSES,
  ROUTE as LOG_ROUTE,
  SHELLS,
  VERSION as LOG_VERSION,
  type LogBatch as WireLogBatch,
  type Spec as PropSpec,
} from "./logs";
import type * as wire from "./wire";
import { BLOB_ID, MAX_CHANGES, MAX_PAGE, METRICS, PROTOCOL_HEADER, type ErrorCode } from "./wire";

/** The sync api server's registry: every schema named here is a component of its document. */
export const SYNC = registry();

const named = <T extends z.ZodType>(id: string, description: string, s: T): T => note(SYNC, s, { id, description });
const about = <T extends z.ZodType>(description: string, s: T): T => note(SYNC, s, { description });

/** `str(v, what, max, min)` as `routes/http.ts` had it: a string of `min` to `max` characters. */
function text(what: string, max: number, min = 1) {
  const error = `${what} must be a string of ${min} to ${max} characters`;
  return z.string({ error }).min(min, { error }).max(max, { error });
}

/** `count(v, what)` as it was: a whole number of at least 0. */
function count(what: string) {
  const error = `${what} must be a whole number of at least 0`;
  return z.int({ error }).min(0, { error });
}

/** A sealed value the server stores and never reads (base64url). */
const sealed = (what: string, max: number) => text(what, max);
const SEALED_MAX = 64 * 1024;
const META_MAX = 64 * 1024;

const whole = () => z.int().min(0);
const instant = () => z.string();
const blobId = () => z.string().regex(BLOB_ID);

// -- errors ---------------------------------------------------------------------------------------

const CODES = [
  "ES_AUTH",
  "ES_FORBIDDEN",
  "ES_NOT_FOUND",
  "ES_BAD_REQUEST",
  "ES_STALE",
  "ES_NO_BLOB",
  "ES_QUOTA",
  "ES_HORIZON",
  "ES_PAIR",
  "ES_KEY_SET",
  "ES_PROTOCOL",
  "ES_TOO_LARGE",
  "ES_RATE",
  "ES_UNAVAILABLE",
  "ES_UPSTREAM",
] as const satisfies readonly ErrorCode[];

const StaleKey = named(
  "StaleKey",
  "In `ES_STALE`: where a key's head really is.",
  z.object({
    key: z.string(),
    head: about("The head's `seq`, `null` when the key has never existed.", z.int().min(1).nullable()),
    blob: about("The head's blob, `null` when it is a delete or there is none.", blobId().nullable()),
  }),
);

const ErrorBody = named(
  "ErrorBody",
  "Every refusal: branch on `code`; `message` is for a person.",
  z.object({
    code: z.enum(CODES),
    message: z.string(),
    conflicts: about("`ES_STALE`: every key whose parent was wrong, with its head.", z.array(StaleKey).optional()),
    missing: about("`ES_NO_BLOB`: the blob ids the server lacks.", z.array(blobId()).optional()),
    horizon: about("`ES_HORIZON`: the lowest `seq` still in the log.", z.int().min(0).optional()),
  }),
);

/** A refusal whose `code` is one of `codes`: what one answer status of one route can say. */
export const refusal = (codes: readonly ErrorCode[]) => ErrorBody.and(z.object({ code: z.enum(codes as [ErrorCode]) }));

export const ServerError = named(
  "ServerError",
  "A failure no `ES_*` code describes: the server's own. A client retries it; the stack is never in it.",
  z.object({ message: z.string() }),
);

// -- health, pairing, devices ---------------------------------------------------------------------

export const Health = named(
  "Health",
  "What a server speaks: a client reads `protocol` before anything else.",
  z.object({ version: z.string(), protocol: z.int(), mode: z.enum(["single", "multi"]) }),
);

export const Info = named(
  "Info",
  "What this server runs. `feedback` is the relay's availability, not just its switch: on without its GitHub token or repository is `false`.",
  z.object({
    name: z.string(),
    version: z.string(),
    features: z.object({ sync: z.boolean(), logs: z.boolean(), feedback: z.boolean() }),
  }),
);

export const Ready = named("Ready", "Whether the database answers.", z.object({ ok: z.boolean() }));

export const PairRequest = named(
  "PairRequest",
  "A pairing code, and the device it pairs. The code is read as a person types it: any case, dashes and spaces ignored.",
  z.object({
    code: text("code", 64),
    device: z.object(
      { name: text("device.name", 200), platform: text("device.platform", 100) },
      { error: "device must be {name, platform}" },
    ),
  }),
);

const AccountRef = named("AccountRef", "An account, by id and name.", z.object({ id: z.string(), name: z.string() }));

const Device = named(
  "Device",
  "A device paired into an account.",
  z.object({
    id: z.string(),
    name: z.string(),
    platform: z.string(),
    created: instant(),
    seen: about("The last request this device made, to the day.", z.string().nullable()),
    revoked: instant().nullable(),
    current: about("In `GET /v1/devices`: whether this is the device asking.", z.boolean().optional()),
  }),
);

export const PairResponse = named(
  "PairResponse",
  "The device token (shown once, 43 base64url characters), its account and the device.",
  z.object({ token: z.string(), account: AccountRef, device: Device }),
);

export const DevicesResponse = named("DevicesResponse", "The account's devices.", z.object({ devices: z.array(Device) }));

export const Ok = named("Ok", "Done.", z.object({ ok: z.literal(true) }));

// -- vaults and their key -------------------------------------------------------------------------

export const RemoteVault = named(
  "RemoteVault",
  "A remote vault. Its `name` is sealed under the vault's own key.",
  z.object({
    id: z.string(),
    name: about("Sealed, base64url.", z.string()),
    seq: about("The last `seq` assigned: 0 for a vault nothing was committed to.", whole()),
    created: instant(),
    keyed: about("Whether its key was set: a vault with none is an upload that never finished.", z.boolean()),
  }),
);

export const VaultsResponse = named("VaultsResponse", "The account's vaults.", z.object({ vaults: z.array(RemoteVault) }));

export const CreateVault = named(
  "CreateVault",
  "A new vault's sealed name, and optionally the id the device's own vault already has, kept when it is free.",
  z.object({
    name: sealed("name", SEALED_MAX),
    id: text("id", 10, 10)
      .regex(/^[0-9a-z]{10}$/, { error: "id must be ten characters of lower-case Crockford base32" })
      .nullish()
      .transform((v) => v ?? undefined)
      .optional(),
  }),
);

const argon2id = z.object({ kdf: z.literal("argon2id"), m: z.int(), t: z.int(), p: z.int(), salt: z.string() });
const scrypt = z.object({ kdf: z.literal("scrypt"), N: z.int(), r: z.int(), p: z.int(), salt: z.string() });

const KdfParams = named("KdfParams", "How the passphrase's key is derived.", z.discriminatedUnion("kdf", [argon2id, scrypt]));

/** `n(k)` as `vaults.ts` had it: a whole number of at least 1. */
function factor(k: string) {
  const error = `params.${k} must be a whole number of at least 1`;
  return z.int({ error }).min(1, { error });
}

/*
 * The salt is checked first and the KDF after it, as the hand-written check did, and the answer
 * keeps the order of fields it built (`kdf`, the factors, `salt`).
 */
const kdfIn = z
  .object({ salt: text("params.salt", 1024) }, { error: "params must be an object" })
  .and(
    z.discriminatedUnion(
      "kdf",
      [
        z.object({ kdf: z.literal("argon2id"), m: factor("m"), t: factor("t"), p: factor("p") }),
        z.object({ kdf: z.literal("scrypt"), N: factor("N"), r: factor("r"), p: factor("p") }),
      ],
      { error: "params.kdf must be argon2id or scrypt" },
    ),
  )
  .transform(({ salt, ...rest }) => ({ ...rest, salt }));

export const PutVaultKey = named(
  "PutVaultKey",
  "The vault key, sealed twice. Replacing a key takes its current `etag`.",
  z.object({
    wrapped: about("The vault key sealed under the passphrase's key.", sealed("wrapped", SEALED_MAX)),
    recovery: about("The vault key sealed under the recovery key.", sealed("recovery", SEALED_MAX)),
    params: kdfIn,
    etag: text("etag", 200)
      .nullish()
      .transform((v) => v ?? undefined)
      .optional(),
  }),
);

export const VaultKey = named(
  "VaultKey",
  "The vault key, sealed under the passphrase's key and under the recovery key, with the KDF that opens the first.",
  z.object({ wrapped: z.string(), recovery: z.string(), params: KdfParams, etag: z.string() }),
);

export const Report = named(
  "Report",
  "Counts a client saw, for the usage ledger only. A count left out or `null` is 0.",
  z.object({
    copied: about(
      "Conflict copies written.",
      count("copied")
        .nullish()
        .transform((v) => v ?? 0),
    ),
    merged: about(
      "Three-way merges that succeeded.",
      count("merged")
        .nullish()
        .transform((v) => v ?? 0),
    ),
  }),
);

export const Plan = named(
  "Plan",
  "A plan's limits; every `null` is unlimited.",
  z.object({
    id: z.string(),
    storage_bytes: about("Live bytes plus bytes uploaded and never committed.", whole().nullable()),
    history_days: whole().nullable(),
    history_bytes: about(
      "Superseded history kept, in sealed bytes. `null` is `storage_bytes`, and unlimited only when that is null too.",
      whole().nullable(),
    ),
    max_file_bytes: whole().nullable(),
    devices: whole().nullable(),
  }),
);

export const AccountInfo = named(
  "AccountInfo",
  "The device's account, its plan and what it uses.",
  z.object({
    id: z.string(),
    name: z.string(),
    plan: Plan,
    used: z.object({
      storage_live: whole(),
      storage_pending: whole(),
      storage_history: whole(),
      devices: whole(),
      vaults: whole(),
    }),
  }),
);

// -- blobs ----------------------------------------------------------------------------------------

export const BlobStored = named(
  "BlobStored",
  "The blob is held, at this size: a second upload of an id the server holds is answered the same.",
  z.object({ ok: z.literal(true), size: whole() }),
);

// -- the log --------------------------------------------------------------------------------------

/** Where a commit's change is: `change 3: …` names the fourth. */
const at = (iss: { path?: PropertyKey[] }): string => String(iss.path?.find((p) => typeof p === "number") ?? "?");

const parentError = (iss: { path?: PropertyKey[] }) => `change ${at(iss)}: parent must be a seq or null`;
const blobError = (iss: { path?: PropertyKey[] }) => `change ${at(iss)}: blob must be a blob id or null`;

const Change = named(
  "Change",
  "One change in a commit.",
  z.object(
    {
      key: z.string({ error: (iss) => `change ${at(iss)}: a key is 43 base64url characters` }).regex(BLOB_ID, {
        error: (iss) => `change ${at(iss)}: a key is 43 base64url characters`,
      }),
      parent: about(
        "The `seq` of the head this change was based on — a delete's too — or `null` for a key that has never had one.",
        z.union([z.null({ error: parentError }), z.int({ error: parentError }).min(1, { error: parentError })], {
          error: parentError,
        }),
      ),
      blob: about(
        "The new content's blob, or `null` for a delete.",
        z.union([z.null({ error: blobError }), z.string({ error: blobError }).regex(BLOB_ID, { error: blobError })], {
          error: blobError,
        }),
      ),
      meta: about(
        "Sealed with this change's key, blob and parent inside it.",
        z
          .string({ error: (iss) => `change ${at(iss)}: meta must be a sealed string of at most ${META_MAX} characters` })
          .max(META_MAX, { error: (iss) => `change ${at(iss)}: meta must be a sealed string of at most ${META_MAX} characters` }),
      ),
    },
    { error: (iss) => `change ${at(iss)} must be an object` },
  ),
);

export const CommitRequest = named(
  "CommitRequest",
  `Up to ${MAX_CHANGES} changes, no key twice, accepted whole or refused whole.`,
  z.object({
    changes: z
      .array(Change, { error: "changes must be a list" })
      .min(1, { error: "a commit needs at least one change" })
      .max(MAX_CHANGES, { error: `a commit holds at most ${MAX_CHANGES} changes; send several` })
      /* Runs whatever the elements said, so a key changed twice is said at its own change, before
         any later one's fault — the order the hand-written loop found them in. */
      .superRefine(
        (changes, ctx) => {
          if (!Array.isArray(changes)) return;
          const seen = new Set<string>();
          changes.forEach((ch: unknown, i) => {
            const key = typeof ch === "object" && ch !== null ? (ch as { key?: unknown }).key : undefined;
            if (typeof key !== "string" || !BLOB_ID.test(key)) return;
            if (seen.has(key))
              ctx.addIssue({ code: "custom", path: [i], message: `change ${i}: key ${key} is changed twice in one commit` });
            seen.add(key);
          });
        },
        { when: () => true },
      ),
  }),
);

export const CommitResponse = named(
  "CommitResponse",
  "The `seq` given to each change, in order.",
  z.object({ seqs: z.array(z.int().min(1)) }),
);

const LogEntry = named(
  "LogEntry",
  "A row of the log as it is read back.",
  z.object({
    seq: z.int().min(1),
    key: z.string(),
    parent: z.int().min(1).nullable(),
    blob: blobId().nullable(),
    size: about("The sealed blob's size in bytes, 0 for a delete.", whole()),
    meta: z.string(),
    device: about("The device that committed it: a client skips its own.", z.string()),
    at: instant(),
  }),
);

export const ChangesResponse = named(
  "ChangesResponse",
  "Entries with `seq > since`, ascending.",
  z.object({
    changes: z.array(LogEntry),
    next: about("The cursor to ask with next: the last `seq` returned, or `since` when none was.", whole()),
    more: about("Whether more entries are waiting past `next`.", z.boolean()),
    head: about("The vault's last `seq`.", whole()),
    horizon: about("The lowest `seq` still in the log.", whole()),
  }),
);

const Head = named(
  "Head",
  "A key's current state.",
  z.object({
    key: z.string(),
    seq: z.int().min(1),
    parent: about(
      "The `parent` of the change that made this head: what its sealed `meta` is bound to.",
      z.int().min(1).nullable(),
    ),
    blob: blobId().nullable(),
    size: whole(),
    meta: z.string(),
  }),
);

export const HeadsResponse = named(
  "HeadsResponse",
  "A page of heads in key order, deletes included. `seq` is the vault's last when the page was read.",
  z.object({
    heads: z.array(Head),
    next: about("The `after` to ask with next, `null` on the last page.", z.string().nullable()),
    seq: whole(),
  }),
);

// -- the operator's ---------------------------------------------------------------------------------

export const AdminAccount = named(
  "AdminAccount",
  "An account, as the operator sees it.",
  z.object({ id: z.string(), name: z.string(), plan: z.string(), created: instant(), devices: whole(), vaults: whole() }),
);

export const AdminAccounts = named("AdminAccounts", "Every account.", z.object({ accounts: z.array(AdminAccount) }));

export const NewAccount = named(
  "NewAccount",
  "An account's name, and the plan to put it on (`free` when none is given).",
  z.object({
    name: text("name", 100).regex(/^[A-Za-z0-9_.@-]+$/, {
      error: "an account name is letters, digits, dots, dashes, underscores and @",
    }),
    plan: text("plan", 64)
      .nullish()
      .transform((v) => v ?? undefined)
      .optional(),
  }),
);

export const PairFor = named(
  "PairFor",
  "The account a pairing code is for, by id or name.",
  z.object({ account: text("account", 100) }),
);

export const AdminPair = named(
  "AdminPair",
  "A pairing code a device exchanges at `/v1/pair`, and the server's public URL.",
  z.object({ code: z.string(), expires: instant(), url: z.string() }),
);

const PLAN_ID = /^[A-Za-z0-9_.-]{1,64}$/;
const PLAN_ID_ERROR = "a plan id is 1 to 64 letters, digits, dots, dashes or underscores";

/** A limit as `parsePlan` read it: absent or `null` is unlimited. */
function limit(k: string, description?: string) {
  const error = `${k} must be a whole number of at least 0, or null for unlimited`;
  const s = z.int({ error }).min(0, { error }).nullable().default(null);
  return description ? about(description, s) : s;
}

const limits = {
  storage_bytes: limit("storage_bytes", "Live bytes plus bytes uploaded and never committed."),
  history_days: limit("history_days"),
  history_bytes: limit("history_bytes", "Superseded history kept, in sealed bytes; `null` is `storage_bytes`."),
  max_file_bytes: limit("max_file_bytes"),
  devices: limit("devices"),
};

/** `PUT /v1/admin/plans/{id}`'s body: the limits, the id being the path's. */
export const PlanLimitsBody = named("PlanLimits", "A plan's limits: a limit left out or `null` is unlimited.", z.object(limits));

/** A plan named by its path or the CLI's argument, read with the limits above. */
export const PlanLimits = z.object({ id: z.string().regex(PLAN_ID, { error: PLAN_ID_ERROR }), ...PlanLimitsBody.shape });

export const PlanAndAccount = named(
  "PlanAndAccount",
  "A plan's id and limits, and optionally an account (by id or name) to put on it.",
  z.object({
    id: text("id", 64).regex(PLAN_ID, { error: PLAN_ID_ERROR }),
    ...limits,
    account: text("account", 100)
      .nullish()
      .transform((v) => v ?? undefined)
      .optional(),
  }),
);

export const PlanFor = named("PlanFor", "The plan to put an account on.", z.object({ plan: text("plan", 64) }));

export const UsageResponse = named(
  "UsageResponse",
  "The usage ledger's rows.",
  z.object({
    usage: z.array(
      z.object({
        day: about("`YYYY-MM-DD`, UTC.", z.string()),
        account: z.string(),
        vault: about("`null` for an account-wide figure (`devices_active`).", z.string().nullable()),
        metric: z.enum(METRICS),
        value: z.number(),
      }),
    ),
  }),
);

export const GcResult = named(
  "GcResult",
  "What the collector did.",
  z.object({ compacted: whole(), blobs: whole(), bytes: whole() }),
);

// -- logs and feedback ----------------------------------------------------------------------------

function prop(spec: PropSpec): z.ZodType {
  if (spec === "count") return whole();
  if (spec === "ms") return z.number().min(0).lt(1e9);
  if (spec === "bool") return z.boolean();
  if (spec === "route") return z.string().regex(LOG_ROUTE);
  if (spec === "text") return z.string();
  return z.enum(spec as [string, ...string[]]);
}

const LogEvent = z.discriminatedUnion(
  "name",
  Object.entries(EVENTS).map(([name, props]) =>
    z.object({
      name: z.literal(name),
      at: about("When it happened, an ISO instant.", z.string()),
      props: z.object(Object.fromEntries(Object.entries(props).map(([k, spec]) => [k, prop(spec).optional()]))),
    }),
  ) as unknown as [z.ZodObject, ...z.ZodObject[]],
);

export const LogBatch = named(
  "LogBatch",
  "Logs from an install that said yes, in `protocol/logs.ts`' closed vocabulary. Whatever it cannot describe is dropped, never refused: an unknown event or prop, a bad time, a batch with no event left.",
  z.object({
    v: z.literal(LOGS_VERSION),
    env: z.object({
      version: z.string().regex(LOG_VERSION),
      shell: z.enum(SHELLS),
      os: z.enum(OSES),
      arch: z.enum(ARCHES),
      locale: about("A language, and a region when there is one.", z.string().regex(LOCALE)),
      install: about("A random id made when somebody said yes.", z.string().regex(INSTALL)),
    }),
    events: about(`Up to ${MAX_EVENTS} are read; the rest are dropped.`, z.array(LogEvent)),
  }),
);

export const LogsAccepted = named(
  "LogsAccepted",
  "How many events were kept: the whole batch, or none (over a rate, a cap, or nothing left once cleaned).",
  z.object({ accepted: whole() }),
);

/** `docs(raw, what)` as `feedback.ts` had it: a list of `{name, text}`, or nothing. */
export const feedbackDocs = (what: string) => {
  const error = `${what} must be a list of {name, text}`;
  return z.array(z.object({ name: z.string({ error }), text: z.string({ error }) }, { error }), { error });
};

const FeedbackDoc = named(
  "FeedbackDoc",
  "A board or note that was ticked: its name and its whole text.",
  z.object({ name: z.string().max(MAX_FEEDBACK_NAME), text: z.string().max(MAX_FEEDBACK_DOC) }),
);

export const FeedbackForm = named(
  "FeedbackForm",
  "A person's bug or idea. The caps are `protocol/feedback.ts`' (everything together at most 10 MB, five files, five boards and notes), which the page and the app's server hold too.",
  z.object({
    kind: z.enum(FEEDBACK_KINDS),
    text: about("The person's own words.", z.string().min(1).max(MAX_FEEDBACK_TEXT)),
    boards: about("JSON: the boards that were ticked.", z.array(FeedbackDoc).optional()),
    notes: about("JSON: the notes that were ticked.", z.array(FeedbackDoc).optional()),
    env: about(
      "JSON: the version, the system and the arch. A value that is not one short word is kept as `unknown`.",
      z.object({ version: z.string(), os: z.string(), arch: z.string() }).optional(),
    ),
    files: about(
      "Pictures, videos, PDFs or text files.",
      z.array(note(SYNC, z.string(), { contentMediaType: "application/octet-stream" })).optional(),
    ),
  }),
);

export const FeedbackSent = named("FeedbackSent", "The issue the feedback became.", z.object({ url: z.string() }));

// -- parameters -----------------------------------------------------------------------------------

export const OpenApiDocument = named(
  "OpenApiDocument",
  "An OpenAPI 3.1 document: this one.",
  z.looseObject({ openapi: z.string(), info: z.looseObject({}), paths: z.record(z.string(), z.unknown()) }),
);

export const VaultParam = about(
  "The vault's id: ten characters of lower-case Crockford base32.",
  z.string().regex(/^[0-9a-z]{10}$/),
);
export const BlobParam = about("The blob's id: 43 base64url characters (an HMAC-SHA256).", z.string().regex(BLOB_ID));
export const DeviceParam = about("The device's id.", z.string());
export const PlanParam = about("The plan's id.", z.string().regex(PLAN_ID));
export const AccountParam = about("The account, by its id or its name.", z.string());

/** A page's size, as `qint` reads it: a whole number from 1 to `MAX_PAGE`, the most when left out. */
const pageSize = (what: string) => about(what, z.int().min(1).max(MAX_PAGE).default(MAX_PAGE));

export const ChangesQuery = z.object({
  since: about("Entries with a `seq` above this one.", z.int().min(0).default(0)),
  limit: pageSize("The most entries in the page."),
});

export const HeadsQuery = z.object({
  after: about("The key to start after: the last page's `next`.", z.string().max(64).optional()),
  limit: pageSize("The most heads in the page."),
});

const DAY = /^\d{4}-\d{2}-\d{2}$/;
export const UsageQuery = z.object({
  account: about("An account, by id or name.", z.string().optional()),
  since: about("The first day, `YYYY-MM-DD`.", z.string().regex(DAY).optional()),
  until: about("The last day, `YYYY-MM-DD`.", z.string().regex(DAY).optional()),
});

/** A blob upload's body: bytes, not JSON. */
export const BlobBytes = note(SYNC, z.string(), { contentMediaType: "application/octet-stream" });

/** The header every checked request sends, and every `/v1` answer says back. */
export const ProtocolHeader = z.object({
  [PROTOCOL_HEADER]: about("The sync protocol this client speaks; any other, or none, is `ES_PROTOCOL`.", z.string()),
});

// -- the schemas agree with `wire.ts` -----------------------------------------------------------------

type Same<A, B> = (<T>() => T extends Flat<A> ? 1 : 2) extends <T>() => T extends Flat<B> ? 1 : 2 ? true : false;
type Flat<T> = T extends readonly (infer E)[] ? Flat<E>[] : T extends object ? { [K in keyof T]: Flat<T[K]> } : T;
type Out<S extends z.ZodType> = z.output<S>;

/** Each line fails to compile when a schema and its `wire.ts` type differ in any field. */
type Agrees = [
  Same<Out<typeof StaleKey>, wire.StaleKey>,
  Same<Out<typeof ErrorBody>, wire.ErrorBody>,
  Same<Out<typeof Health>, wire.Health>,
  Same<Out<typeof Info>, wire.Info>,
  Same<Out<typeof Ready>, wire.Ready>,
  Same<Out<typeof PairRequest>, wire.PairRequest>,
  Same<Out<typeof PairResponse>, wire.PairResponse>,
  Same<Out<typeof AccountRef>, wire.AccountRef>,
  Same<Out<typeof Device>, wire.Device>,
  Same<Out<typeof DevicesResponse>, wire.DevicesResponse>,
  Same<Out<typeof RemoteVault>, wire.RemoteVault>,
  Same<Out<typeof VaultsResponse>, wire.VaultsResponse>,
  Same<Out<typeof CreateVault>, wire.CreateVault>,
  Same<Out<typeof KdfParams>, wire.KdfParams>,
  Same<Out<typeof kdfIn>, wire.KdfParams>,
  Same<Out<typeof VaultKey>, wire.VaultKey>,
  Same<Out<typeof PutVaultKey>, wire.PutVaultKey>,
  Same<Out<typeof Report>, wire.Report>,
  Same<Out<typeof Plan>, wire.Plan>,
  Same<Out<typeof PlanLimits>, wire.Plan>,
  Same<Out<typeof AccountInfo>, wire.AccountInfo>,
  Same<Out<typeof CommitRequest>, { changes: wire.Change[] }>,
  Same<Out<typeof CommitResponse>, wire.CommitResponse>,
  Same<Out<typeof LogEntry>, wire.LogEntry>,
  Same<Out<typeof ChangesResponse>, wire.ChangesResponse>,
  Same<Out<typeof Head>, wire.Head>,
  Same<Out<typeof HeadsResponse>, wire.HeadsResponse>,
  Same<Out<typeof AdminAccount>, wire.AdminAccount>,
  Same<Out<typeof AdminPair>, wire.AdminPair>,
  Same<Out<typeof UsageResponse>, wire.UsageResponse>,
  Same<Out<typeof GcResult>, wire.GcResult>,
  Same<Out<typeof LogBatch>["v"], WireLogBatch["v"]>,
  Same<Out<typeof LogBatch>["env"], WireLogBatch["env"]>,
];
const agrees: Agrees = [
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
];
void agrees;
