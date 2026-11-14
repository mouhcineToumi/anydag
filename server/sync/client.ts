/**
 * The sync client's door to `anydag-sync`: one method per `/v1` route
 * the app calls, as `SyncApi`, and `HttpSyncApi` over `fetch`. The engine is written against the
 * interface, so the tests drive it with an in-memory server and the app with this one.
 *
 * Load-bearing:
 * - **Every failure is a `SyncError` with a code**, the wire's `ES_*` or `ES_NETWORK` for a request
 *   that got no answer (or a 5xx with no `ES_*` body). The engine branches on the code: `ES_STALE`
 *   pulls, `ES_HORIZON` resyncs, `ES_AUTH` stops.
 * - **A request that got no answer is asked again** on a short backoff; an answer, a 4xx above all,
 *   never is — it is the server's word on the request.
 * - **Every request says `PROTOCOL`, and every answer must say it back** (`PROTOCOL_HEADER`). An
 *   answer that says another, or none — a 0.2.0 server, which would store and serve metadata this
 *   client cannot check — is `ES_PROTOCOL`, whatever its status; `/v1/health` says it in its body.
 * - Paths are exactly `wire.ts`'s, and a blob travels as the raw body.
 */

import type {
  AccountInfo,
  Change,
  ChangesResponse,
  CommitResponse,
  CreateVault,
  DevicesResponse,
  ErrorBody,
  ErrorCode,
  HeadsResponse,
  Health,
  PairRequest,
  PairResponse,
  PutVaultKey,
  RemoteVault,
  Report,
  VaultKey,
  VaultsResponse,
} from "../../api/protocol/wire";
import { MAX_PAGE, PROTOCOL, PROTOCOL_HEADER } from "../../api/protocol/wire";

export interface SyncApi {
  health(): Promise<Health>;
  pair(req: PairRequest): Promise<PairResponse>;
  devices(): Promise<DevicesResponse>;
  revokeDevice(id: string): Promise<void>;
  vaults(): Promise<VaultsResponse>;
  createVault(body: CreateVault): Promise<RemoteVault>;
  /** The wrapped key, or `null` while none is set. */
  getKey(vault: string): Promise<VaultKey | null>;
  putKey(vault: string, body: PutVaultKey): Promise<VaultKey>;
  /** The sealed size the server holds for `id`, or `null` when it holds none. */
  hasBlob(vault: string, id: string): Promise<number | null>;
  putBlob(vault: string, id: string, bytes: Uint8Array): Promise<number>;
  getBlob(vault: string, id: string): Promise<Uint8Array>;
  commit(vault: string, changes: Change[]): Promise<CommitResponse>;
  changes(vault: string, since: number, limit?: number): Promise<ChangesResponse>;
  heads(vault: string, after?: string, limit?: number): Promise<HeadsResponse>;
  report(vault: string, report: Report): Promise<void>;
  account(): Promise<AccountInfo>;
}

export class SyncError extends Error {
  readonly status: number;
  readonly code: ErrorCode | "ES_NETWORK";
  readonly body?: ErrorBody;

  constructor(status: number, code: ErrorCode | "ES_NETWORK", message: string, body?: ErrorBody) {
    super(message);
    this.name = "SyncError";
    this.status = status;
    this.code = code;
    this.body = body;
  }
}

export const isSyncError = (e: unknown, code?: ErrorCode | "ES_NETWORK"): e is SyncError =>
  e instanceof SyncError && (code === undefined || e.code === code);

export interface HttpOptions {
  /** The server's base URL, `https://sync.example` — `/v1/…` is appended. */
  url: string;
  token?: string | null;
  fetch?: typeof fetch;
  /** How many times a request that got no answer is asked again. */
  retries?: number;
  /** Milliseconds before the first retry; doubled each time. */
  backoff?: number;
  /** The most of an answer read, in bytes; `REPLY_MAX` unless a test says less. */
  replyMax?: { json: number; blob: number };
}

const enc = encodeURIComponent;

/**
 * The most this client reads of an answer (#9). A page of `changes` or `heads` is a thousand rows of
 * a few hundred bytes; a blob is one file, sealed. A server that answers more — or keeps a body
 * open — is refused at the bound rather than read into memory until the process runs out.
 */
const REPLY_MAX = { json: 64 * 1024 * 1024, blob: 1024 * 1024 * 1024 };

/** The body of `res`, at most `max` bytes of it: past that the read stops and the request fails. */
async function bounded(res: Response, max: number, what: string): Promise<Uint8Array> {
  const said = Number(res.headers.get("content-length"));
  const over = () =>
    new SyncError(
      res.status,
      "ES_TOO_LARGE",
      `${what}: the sync server answered more than ${max} bytes, which this AnyDag will not read`,
    );
  if (Number.isFinite(said) && said > max) {
    await res.body?.cancel().catch(() => undefined);
    throw over();
  }
  if (!res.body) return new Uint8Array();
  const reader = res.body.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => undefined);
      throw over();
    }
    parts.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.byteLength;
  }
  return out;
}

const decoder = new TextDecoder();

export class HttpSyncApi implements SyncApi {
  private readonly base: string;
  private readonly token: string | null;
  private readonly fetcher: typeof fetch;
  private readonly retries: number;
  private readonly backoff: number;
  private readonly replyMax: { json: number; blob: number };

  constructor(opts: HttpOptions) {
    this.base = opts.url.replace(/\/+$/, "");
    this.token = opts.token ?? null;
    this.fetcher = opts.fetch ?? fetch;
    this.retries = opts.retries ?? 2;
    this.backoff = opts.backoff ?? 250;
    this.replyMax = opts.replyMax ?? REPLY_MAX;
  }

  /** One request, retried while it gets no answer; an answer that is not 2xx throws its code. */
  private async send(method: string, route: string, body?: unknown, raw?: Uint8Array): Promise<Response> {
    const headers: Record<string, string> = { [PROTOCOL_HEADER]: String(PROTOCOL) };
    if (this.token) headers.authorization = `Bearer ${this.token}`;
    let payload: BodyInit | undefined;
    if (raw) {
      headers["content-type"] = "application/octet-stream";
      headers["content-length"] = String(raw.byteLength);
      payload = raw as unknown as BodyInit;
    } else if (body !== undefined) {
      headers["content-type"] = "application/json";
      payload = JSON.stringify(body);
    }
    let wait = this.backoff;
    for (let attempt = 0; ; attempt++) {
      let res: Response;
      try {
        res = await this.fetcher(this.base + route, { method, headers, body: payload });
      } catch (e) {
        if (attempt < this.retries) {
          await new Promise((r) => setTimeout(r, wait));
          wait *= 2;
          continue;
        }
        throw new SyncError(0, "ES_NETWORK", `${method} ${route}: ${(e as Error).message ?? "no answer"}`);
      }
      if (res.ok || (res.status === 404 && method === "HEAD")) {
        this.sameProtocol(res, method, route);
        return res;
      }
      // A refusal is a sentence: what passes the bound of one is not one.
      const text = await bounded(res, this.replyMax.json, `${method} ${route}`)
        .then((b) => decoder.decode(b))
        .catch(() => "");
      let parsed: ErrorBody | undefined;
      try {
        const j = JSON.parse(text) as Partial<ErrorBody>;
        if (typeof j.code === "string" && j.code.startsWith("ES_")) parsed = j as ErrorBody;
      } catch {
        /* not JSON */
      }
      if (!parsed && res.status >= 500 && attempt < this.retries) {
        await new Promise((r) => setTimeout(r, wait));
        wait *= 2;
        continue;
      }
      if (parsed) {
        // The server's own refusal of our protocol says which side is behind better than we can.
        if (parsed.code !== "ES_PROTOCOL") this.sameProtocol(res, method, route);
        throw new SyncError(res.status, parsed.code, parsed.message ?? parsed.code, parsed);
      }
      throw new SyncError(
        res.status,
        res.status >= 500 ? "ES_NETWORK" : "ES_BAD_REQUEST",
        `${method} ${route}: ${res.status} ${text.slice(0, 200)}`,
      );
    }
  }

  /** `ES_PROTOCOL` unless the answer is from a server of this client's protocol. */
  private sameProtocol(res: Response, method: string, route: string): void {
    if (route === "/v1/health") return;
    const said = res.headers.get(PROTOCOL_HEADER);
    if (said === String(PROTOCOL)) return;
    const theirs = said === null ? null : Number(said);
    throw new SyncError(
      res.status,
      "ES_PROTOCOL",
      theirs === null
        ? `The sync server at ${this.base} is older than this AnyDag: it did not say a sync protocol (${method} ${route}), and this AnyDag speaks ${PROTOCOL}. Update the sync server.`
        : `The sync server at ${this.base} speaks sync protocol ${said}, and this AnyDag speaks ${PROTOCOL}: update ${theirs > PROTOCOL ? "AnyDag" : "the sync server"}.`,
    );
  }

  private async json<T>(method: string, route: string, body?: unknown): Promise<T> {
    const res = await this.send(method, route, body);
    return JSON.parse(decoder.decode(await bounded(res, this.replyMax.json, `${method} ${route}`))) as T;
  }

  health(): Promise<Health> {
    return this.json("GET", "/v1/health");
  }

  pair(req: PairRequest): Promise<PairResponse> {
    return this.json("POST", "/v1/pair", req);
  }

  devices(): Promise<DevicesResponse> {
    return this.json("GET", "/v1/devices");
  }

  async revokeDevice(id: string): Promise<void> {
    await this.send("DELETE", `/v1/devices/${enc(id)}`);
  }

  vaults(): Promise<VaultsResponse> {
    return this.json("GET", "/v1/vaults");
  }

  createVault(body: CreateVault): Promise<RemoteVault> {
    return this.json("POST", "/v1/vaults", body);
  }

  async getKey(vault: string): Promise<VaultKey | null> {
    try {
      return await this.json<VaultKey>("GET", `/v1/vaults/${enc(vault)}/key`);
    } catch (e) {
      if (isSyncError(e, "ES_NOT_FOUND")) return null;
      throw e;
    }
  }

  putKey(vault: string, body: PutVaultKey): Promise<VaultKey> {
    return this.json("PUT", `/v1/vaults/${enc(vault)}/key`, body);
  }

  async hasBlob(vault: string, id: string): Promise<number | null> {
    const res = await this.send("HEAD", `/v1/vaults/${enc(vault)}/blobs/${enc(id)}`);
    if (res.status === 404) return null;
    const n = Number(res.headers.get("content-length") ?? "0");
    return Number.isFinite(n) ? n : 0;
  }

  async putBlob(vault: string, id: string, bytes: Uint8Array): Promise<number> {
    const route = `/v1/vaults/${enc(vault)}/blobs/${enc(id)}`;
    const res = await this.send("PUT", route, undefined, bytes);
    const j = JSON.parse(decoder.decode(await bounded(res, this.replyMax.json, `PUT ${route}`))) as { size?: number };
    return typeof j.size === "number" ? j.size : bytes.byteLength;
  }

  async getBlob(vault: string, id: string): Promise<Uint8Array> {
    const route = `/v1/vaults/${enc(vault)}/blobs/${enc(id)}`;
    const res = await this.send("GET", route);
    return bounded(res, this.replyMax.blob, `GET ${route}`);
  }

  commit(vault: string, changes: Change[]): Promise<CommitResponse> {
    return this.json("POST", `/v1/vaults/${enc(vault)}/commit`, { changes });
  }

  changes(vault: string, since: number, limit = MAX_PAGE): Promise<ChangesResponse> {
    return this.json("GET", `/v1/vaults/${enc(vault)}/changes?since=${since}&limit=${limit}`);
  }

  heads(vault: string, after = "", limit = MAX_PAGE): Promise<HeadsResponse> {
    return this.json("GET", `/v1/vaults/${enc(vault)}/heads?after=${enc(after)}&limit=${limit}`);
  }

  async report(vault: string, report: Report): Promise<void> {
    await this.send("POST", `/v1/vaults/${enc(vault)}/report`, report);
  }

  account(): Promise<AccountInfo> {
    return this.json("GET", "/v1/account");
  }
}
