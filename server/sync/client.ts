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
import { MAX_PAGE } from "../../api/protocol/wire";

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
}

const enc = encodeURIComponent;

export class HttpSyncApi implements SyncApi {
  private readonly base: string;
  private readonly token: string | null;
  private readonly fetcher: typeof fetch;
  private readonly retries: number;
  private readonly backoff: number;

  constructor(opts: HttpOptions) {
    this.base = opts.url.replace(/\/+$/, "");
    this.token = opts.token ?? null;
    this.fetcher = opts.fetch ?? fetch;
    this.retries = opts.retries ?? 2;
    this.backoff = opts.backoff ?? 250;
  }

  /** One request, retried while it gets no answer; an answer that is not 2xx throws its code. */
  private async send(method: string, route: string, body?: unknown, raw?: Uint8Array): Promise<Response> {
    const headers: Record<string, string> = {};
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
      if (res.ok) return res;
      if (res.status === 404 && method === "HEAD") return res;
      const text = await res.text().catch(() => "");
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
      if (parsed) throw new SyncError(res.status, parsed.code, parsed.message ?? parsed.code, parsed);
      throw new SyncError(
        res.status,
        res.status >= 500 ? "ES_NETWORK" : "ES_BAD_REQUEST",
        `${method} ${route}: ${res.status} ${text.slice(0, 200)}`,
      );
    }
  }

  private async json<T>(method: string, route: string, body?: unknown): Promise<T> {
    const res = await this.send(method, route, body);
    return (await res.json()) as T;
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
    const res = await this.send("PUT", `/v1/vaults/${enc(vault)}/blobs/${enc(id)}`, undefined, bytes);
    const j = (await res.json()) as { size?: number };
    return typeof j.size === "number" ? j.size : bytes.byteLength;
  }

  async getBlob(vault: string, id: string): Promise<Uint8Array> {
    const res = await this.send("GET", `/v1/vaults/${enc(vault)}/blobs/${enc(id)}`);
    return new Uint8Array(await res.arrayBuffer());
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
