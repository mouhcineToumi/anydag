/**
 * The request schemas say what the hand-written checks said (#530). Before the OpenAPI document, each
 * route read its body with checks of its own (`str`, `count`, `params`, `parseChanges`, `parsePlan`,
 * `docs`); they are kept below as they were, and every body of a corpus is read both ways: the same
 * value, or the same refusal with the same sentence — the first fault in the order the old checks
 * found it, which is the part a schema gets wrong without trying.
 *
 * The corpus is each route's good body with one field, then two, replaced by an odd value (missing,
 * `null`, the wrong type, too short, too long, a float, an unsafe integer, a key another change has),
 * and an unknown field added.
 */

import { describe, expect, it } from "vitest";

import { cleanBatch, EVENTS, type Spec as PropSpec } from "../protocol/logs";
import {
  CommitRequest,
  CreateVault,
  feedbackDocs,
  LogBatch,
  NewAccount,
  PairFor,
  PairRequest,
  PlanAndAccount,
  PlanFor,
  PutVaultKey,
  Report,
} from "../protocol/schema";
import { BLOB_ID, MAX_CHANGES, type KdfParams, type Plan } from "../protocol/wire";
import { parsePlan } from "../server/routes/admin";
import { HttpError, isObject, parse } from "../server/routes/http";

// -- the checks as they were before #530 ----------------------------------------------------------

function str(v: unknown, what: string, max = 4096, min = 1): string {
  if (typeof v !== "string" || v.length < min || v.length > max)
    throw new HttpError("ES_BAD_REQUEST", `${what} must be a string of ${min} to ${max} characters`);
  return v;
}

function count(v: unknown, what: string): number {
  if (typeof v !== "number" || !Number.isSafeInteger(v) || v < 0)
    throw new HttpError("ES_BAD_REQUEST", `${what} must be a whole number of at least 0`);
  return v;
}

const SEALED_MAX = 64 * 1024;
const META_MAX = 64 * 1024;

function oldPair(b: Record<string, unknown>) {
  const typed = str(b.code, "code", 64);
  const dev = b.device;
  if (typeof dev !== "object" || dev === null || Array.isArray(dev))
    throw new HttpError("ES_BAD_REQUEST", "device must be {name, platform}");
  const name = str((dev as Record<string, unknown>).name, "device.name", 200);
  const platform = str((dev as Record<string, unknown>).platform, "device.platform", 100);
  return { code: typed, device: { name, platform } };
}

function oldCreateVault(b: Record<string, unknown>) {
  const name = str(b.name, "name", SEALED_MAX);
  let id: string | undefined;
  if (b.id !== undefined && b.id !== null) {
    id = str(b.id, "id", 10, 10);
    if (!/^[0-9a-z]{10}$/.test(id))
      throw new HttpError("ES_BAD_REQUEST", "id must be ten characters of lower-case Crockford base32");
  }
  return { name, id };
}

function oldParams(v: unknown): KdfParams {
  if (!isObject(v)) throw new HttpError("ES_BAD_REQUEST", "params must be an object");
  const salt = str(v.salt, "params.salt", 1024);
  const n = (k: string): number => {
    const x = v[k];
    if (typeof x !== "number" || !Number.isSafeInteger(x) || x < 1)
      throw new HttpError("ES_BAD_REQUEST", `params.${k} must be a whole number of at least 1`);
    return x;
  };
  if (v.kdf === "argon2id") return { kdf: "argon2id", m: n("m"), t: n("t"), p: n("p"), salt };
  if (v.kdf === "scrypt") return { kdf: "scrypt", N: n("N"), r: n("r"), p: n("p"), salt };
  throw new HttpError("ES_BAD_REQUEST", "params.kdf must be argon2id or scrypt");
}

function oldPutKey(b: Record<string, unknown>) {
  const put: { wrapped: string; recovery: string; params: KdfParams; etag?: string } = {
    wrapped: str(b.wrapped, "wrapped", SEALED_MAX),
    recovery: str(b.recovery, "recovery", SEALED_MAX),
    params: oldParams(b.params),
  };
  if (b.etag !== undefined && b.etag !== null) put.etag = str(b.etag, "etag", 200);
  return put;
}

function oldReport(b: Record<string, unknown>) {
  return { copied: count(b.copied ?? 0, "copied"), merged: count(b.merged ?? 0, "merged") };
}

function oldChanges(raw: unknown) {
  if (!Array.isArray(raw)) throw new HttpError("ES_BAD_REQUEST", "changes must be a list");
  if (raw.length === 0) throw new HttpError("ES_BAD_REQUEST", "a commit needs at least one change");
  if (raw.length > MAX_CHANGES)
    throw new HttpError("ES_BAD_REQUEST", `a commit holds at most ${MAX_CHANGES} changes; send several`);
  const seen = new Set<string>();
  return raw.map((ch, i) => {
    if (!isObject(ch)) throw new HttpError("ES_BAD_REQUEST", `change ${i} must be an object`);
    const { key, parent, blob, meta } = ch;
    if (typeof key !== "string" || !BLOB_ID.test(key))
      throw new HttpError("ES_BAD_REQUEST", `change ${i}: a key is 43 base64url characters`);
    if (seen.has(key)) throw new HttpError("ES_BAD_REQUEST", `change ${i}: key ${key} is changed twice in one commit`);
    seen.add(key);
    if (parent !== null && (typeof parent !== "number" || !Number.isSafeInteger(parent) || parent < 1))
      throw new HttpError("ES_BAD_REQUEST", `change ${i}: parent must be a seq or null`);
    if (blob !== null && (typeof blob !== "string" || !BLOB_ID.test(blob)))
      throw new HttpError("ES_BAD_REQUEST", `change ${i}: blob must be a blob id or null`);
    if (typeof meta !== "string" || meta.length > META_MAX)
      throw new HttpError("ES_BAD_REQUEST", `change ${i}: meta must be a sealed string of at most ${META_MAX} characters`);
    return { key, parent: parent as number | null, blob: blob as string | null, meta };
  });
}

function oldNewAccount(b: Record<string, unknown>) {
  const name = str(b.name, "name", 100);
  if (!/^[A-Za-z0-9_.@-]+$/.test(name))
    throw new HttpError("ES_BAD_REQUEST", "an account name is letters, digits, dots, dashes, underscores and @");
  const plan = b.plan === undefined || b.plan === null ? undefined : str(b.plan, "plan", 64);
  return { name, plan };
}

const LIMITS = ["storage_bytes", "history_days", "history_bytes", "max_file_bytes", "devices"] as const;

function oldParsePlan(id: string, v: Record<string, unknown>): Plan {
  if (!/^[A-Za-z0-9_.-]{1,64}$/.test(id))
    throw new HttpError("ES_BAD_REQUEST", "a plan id is 1 to 64 letters, digits, dots, dashes or underscores");
  const plan: Plan = { id, storage_bytes: null, history_days: null, history_bytes: null, max_file_bytes: null, devices: null };
  for (const k of LIMITS) {
    const x = v[k];
    if (x === undefined || x === null) continue;
    if (typeof x !== "number" || !Number.isSafeInteger(x) || x < 0)
      throw new HttpError("ES_BAD_REQUEST", `${k} must be a whole number of at least 0, or null for unlimited`);
    plan[k] = x;
  }
  return plan;
}

/** `PUT /v1/admin/plan`, with the write between its two reads made a step of the answer. */
function oldPlanAndAccount(b: Record<string, unknown>) {
  const steps: unknown[] = [];
  const plan = oldParsePlan(str(b.id, "id", 64), b);
  steps.push(["write", plan]);
  if (b.account !== undefined && b.account !== null) steps.push(["account", str(b.account, "account", 100)]);
  return steps;
}

const PLAN_HALF = PlanAndAccount.omit({ account: true });
const ACCOUNT_HALF = PlanAndAccount.pick({ account: true });

function newPlanAndAccount(b: Record<string, unknown>) {
  const steps: unknown[] = [];
  const plan = parse(PLAN_HALF, b);
  steps.push(["write", plan]);
  const { account } = parse(ACCOUNT_HALF, b);
  if (account !== undefined) steps.push(["account", account]);
  return steps;
}

function oldDocs(raw: unknown, what: string) {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || !raw.every((d) => isObject(d) && typeof d.name === "string" && typeof d.text === "string"))
    throw new HttpError("ES_BAD_REQUEST", `${what} must be a list of {name, text}`);
  return raw.map((d) => ({ name: d.name as string, text: d.text as string }));
}

// -- the corpus -------------------------------------------------------------------------------------

const ID = (c: string) => c.repeat(43);
const KEY_A = ID("a");

const ODD: unknown[] = [
  undefined,
  null,
  0,
  -1,
  1,
  1.5,
  2 ** 60,
  "",
  "x",
  "abcdefgh12",
  "ABCDEFGH12",
  "y".repeat(11),
  "z".repeat(65),
  "w".repeat(201),
  "has space",
  KEY_A,
  ID("b"),
  true,
  [],
  {},
  [{ name: "n", text: "t" }],
  [{ name: 1 }],
  "argon2id",
  "scrypt",
];
const FEW: unknown[] = [undefined, null, 1.5, "", "x", {}, [], KEY_A, 2 ** 60];

type Path = (string | number)[];

function paths(v: unknown, at: Path = []): Path[] {
  if (Array.isArray(v)) return v.flatMap((x, i) => [[...at, i], ...paths(x, [...at, i])]);
  if (isObject(v)) return Object.entries(v).flatMap(([k, x]) => [[...at, k], ...paths(x, [...at, k])]);
  return [];
}

function set(v: unknown, path: Path, to: unknown): unknown {
  const out = structuredClone(v);
  let at = out as Record<string | number, unknown>;
  for (const p of path.slice(0, -1)) at = at[p] as Record<string | number, unknown>;
  const last = path[path.length - 1]!;
  if (to === undefined && !Array.isArray(at)) delete at[last];
  else at[last] = to;
  return out;
}

/** The good body, one field and then two replaced by odd values, and one with an unknown field. */
function corpus(good: Record<string, unknown>): unknown[] {
  const all = paths(good);
  const out: unknown[] = [good, { ...good, unknown: 1 }];
  for (const p of all) for (const v of ODD) out.push(set(good, p, v));
  const under = (p: Path, q: Path) => q.length > p.length && p.every((x, k) => q[k] === x);
  for (let i = 0; i < all.length; i++)
    for (let j = i + 1; j < all.length; j++) {
      if (under(all[i]!, all[j]!)) continue;
      for (const a of FEW) for (const b of FEW) out.push(set(set(good, all[i]!, a), all[j]!, b));
    }
  return out;
}

type Outcome = { ok: string } | { refused: string };

function outcome(f: () => unknown): Outcome {
  try {
    return { ok: JSON.stringify(f()) };
  } catch (e) {
    if (e instanceof HttpError && e.code === "ES_BAD_REQUEST") return { refused: e.message };
    throw e;
  }
}

function agree(
  name: string,
  good: Record<string, unknown>,
  before: (b: Record<string, unknown>) => unknown,
  now: (b: Record<string, unknown>) => unknown,
) {
  it(name, () => {
    const differ: string[] = [];
    const bodies = corpus(good);
    for (const body of bodies) {
      if (!isObject(body)) continue;
      const a = outcome(() => before(body));
      const b = outcome(() => now(body));
      if (JSON.stringify(a) !== JSON.stringify(b))
        differ.push(`${JSON.stringify(body).slice(0, 300)}\n  before ${JSON.stringify(a)}\n  now    ${JSON.stringify(b)}`);
    }
    expect(bodies.length).toBeGreaterThan(20);
    expect(differ.slice(0, 5).join("\n")).toBe("");
  });
}

const change = (key: string, parent: number | null, blob: string | null) => ({ key, parent, blob, meta: "c2VhbGVk" });

describe("each request schema says what the hand-written checks said", () => {
  agree("POST /v1/pair", { code: "ABCDE-12345", device: { name: "laptop", platform: "linux" } }, oldPair, (b) =>
    parse(PairRequest, b),
  );
  agree("POST /v1/vaults", { name: "c2VhbGVk", id: "abcdefgh12" }, oldCreateVault, (b) => parse(CreateVault, b));
  agree(
    "PUT /v1/vaults/{v}/key, argon2id",
    {
      wrapped: "d3JhcHBlZA",
      recovery: "cmVjb3Zlcnk",
      params: { kdf: "argon2id", m: 65536, t: 3, p: 1, salt: "c2FsdA" },
      etag: "e1",
    },
    oldPutKey,
    (b) => parse(PutVaultKey, b),
  );
  agree(
    "PUT /v1/vaults/{v}/key, scrypt",
    { wrapped: "d3JhcHBlZA", recovery: "cmVjb3Zlcnk", params: { kdf: "scrypt", N: 16384, r: 8, p: 1, salt: "c2FsdA" } },
    oldPutKey,
    (b) => parse(PutVaultKey, b),
  );
  agree("POST /v1/vaults/{v}/report", { copied: 2, merged: 3 }, oldReport, (b) => parse(Report, b));
  agree(
    "POST /v1/vaults/{v}/commit",
    { changes: [change(KEY_A, null, ID("b")), change(ID("c"), 4, null), change(ID("d"), 7, ID("e"))] },
    (b) => oldChanges(b.changes),
    (b) => parse(CommitRequest, b).changes,
  );
  agree("POST /v1/admin/accounts", { name: "ada@example", plan: "pro" }, oldNewAccount, (b) => parse(NewAccount, b));
  agree(
    "POST /v1/admin/pair",
    { account: "ada" },
    (b) => ({ account: str(b.account, "account", 100) }),
    (b) => parse(PairFor, b),
  );
  agree(
    "POST /v1/admin/accounts/{id}/plan",
    { plan: "pro" },
    (b) => ({ plan: str(b.plan, "plan", 64) }),
    (b) => parse(PlanFor, b),
  );
  agree(
    "PUT /v1/admin/plan",
    { id: "pro", storage_bytes: 10, history_days: 3, history_bytes: null, max_file_bytes: 5, devices: 2, account: "ada" },
    oldPlanAndAccount,
    newPlanAndAccount,
  );
  for (const id of ["pro", "", "no space", "p".repeat(65), "a.b-c_d"])
    agree(
      `PUT /v1/admin/plans/${id || "(empty)"}`,
      { storage_bytes: 10, history_days: 3, history_bytes: null, max_file_bytes: 5, devices: 2 },
      (b) => oldParsePlan(id, b),
      (b) => parsePlan(id, b),
    );
  for (const what of ["boards", "notes"])
    agree(
      `POST /v1/feedback's ${what}`,
      {
        list: [
          { name: "a.board.md", text: "x" },
          { name: "b", text: "" },
        ],
      },
      (b) => oldDocs(b.list, what),
      (b) => (b.list === undefined ? [] : parse(feedbackDocs(what), b.list)),
    );

  it("a commit of no change and one of too many say so before any change's fault", () => {
    const bad = { key: "short", parent: "x", blob: 1, meta: 2 };
    for (const changes of [[], Array.from({ length: MAX_CHANGES + 1 }, () => bad), "nope", null, { 0: bad }]) {
      expect(outcome(() => parse(CommitRequest, { changes }).changes)).toEqual(outcome(() => oldChanges(changes)));
    }
  });

  it("a key changed twice is said at its change, before a later change's fault and before its own other fields'", () => {
    const changes = [
      change(KEY_A, null, null),
      change(ID("c"), null, null),
      { ...change(KEY_A, null, null), parent: "x" },
      { key: 7 },
    ];
    const said = outcome(() => parse(CommitRequest, { changes }).changes);
    expect(said).toEqual({ refused: `change 2: key ${KEY_A} is changed twice in one commit` });
    expect(said).toEqual(outcome(() => oldChanges(changes)));
  });
});

describe("the log batch's schema", () => {
  const sample = (spec: PropSpec): unknown =>
    spec === "count"
      ? 3
      : spec === "ms"
        ? 12.4
        : spec === "bool"
          ? true
          : spec === "route"
            ? "GET /v1/x"
            : spec === "text"
              ? "it broke at /home/a/b.md"
              : spec[0];
  const env = {
    version: "0.9.0",
    shell: "desktop",
    os: "linux",
    arch: "x64",
    locale: "pt-BR",
    install: "0f8fad5b-d9cb-469f-a165-70867728950e",
  };

  it("describes every batch cleanBatch keeps, every event and every prop", () => {
    const events = Object.entries(EVENTS).map(([name, props]) => ({
      name,
      at: "2026-11-06T11:59:00.250Z",
      props: Object.fromEntries(Object.entries(props).map(([k, spec]) => [k, sample(spec)])),
    }));
    const kept = cleanBatch({ v: 1, env, events });
    expect(kept?.events).toHaveLength(events.length);
    const r = LogBatch.safeParse(kept);
    expect(r.success ? "" : r.error.message).toBe("");
  });

  it("describes what is left of a batch with things it cannot describe", () => {
    const kept = cleanBatch({
      v: 1,
      env: { ...env, shell: "toaster", os: "beos", locale: "not a locale", extra: 1 },
      events: [
        { name: "feature.use", at: "2026-11-06T11:59:00Z", props: { what: "tidy", who: "ada" } },
        { name: "no.such", at: "2026-11-06T11:59:00Z", props: {} },
        { name: "error", at: "yesterday", props: { message: "x" } },
      ],
    });
    expect(kept?.events).toHaveLength(1);
    const r = LogBatch.safeParse(kept);
    expect(r.success ? "" : r.error.message).toBe("");
  });
});
