/**
 * The one door to the server.
 *
 * Every command reaches the routes through here, which is what keeps the CLI a *client*: nothing in
 * `cli/` reads or writes a vault on disk, so the same command works whether the app's server is
 * running (`server.json`) or this process opened the vault itself (`server/connect.ts`).
 *
 * The server needs one thing of a caller — `x-anydag-token` — and a vault is named the way the page
 * names it, `?vault=<id>`; with none the server's default (the vault opened last) is meant.
 *
 * Failures are turned into an {@link ApiError} carrying the exit code, so a command never has to
 * know what a 404 means: the server's own `{error}` sentence reaches the terminal, and the code
 * says which kind of failure it was.
 */

/** The query key a request names its vault with. */
const VAULT_PARAM = "vault";

/** Routes about the app rather than one vault — `server/app.ts`'s `UNSCOPED`. */
const UNSCOPED = ["/api/health", "/api/vaults", "/api/settings", "/api/auth/me"];

/** Whether a route is about one vault: the document routes, and `/api/` but the app's own. */
function scoped(path: string): boolean {
  return path.startsWith("/__board") || (path.startsWith("/api/") && !UNSCOPED.some((u) => path === u || path.startsWith(`${u}/`)));
}

export const EXIT = {
  ok: 0,
  /** The server refused: a 4xx or 5xx that is not one of the ones below. */
  failed: 1,
  usage: 2,
  /** The board moved underneath the edit (a 409), or `tidy --check` found it untidy. */
  conflict: 3,
  /** The board, or a model's draft, has errors in it. */
  errors: 4,
  /** A page opened in the browser never reported itself ready. */
  notReady: 5,
  /** No server answered. */
  noServer: 6,
  /** There is no vault to act in: none named, none opened before, or the one named would not open. */
  noVault: 7,
} as const;

export class ApiError extends Error {
  constructor(
    message: string,
    readonly exit: number,
    readonly status = 0,
    readonly body: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

/** A 409 from a write: the text the board has now, and the base a retry must carry. */
class Conflict extends ApiError {
  constructor(
    readonly base: string,
    readonly text: string,
    message = "the board changed underneath this edit",
  ) {
    super(`${message} — its base is now ${base.slice(0, 12)}`, EXIT.conflict, 409, { base, text });
  }
}

export type Query = Record<string, string | undefined>;

export interface ApiOptions {
  origin: string;
  /** The per-launch token every request carries. */
  token: string;
  /** The id of the vault every scoped request is about; the server's default when left out. */
  vault?: string | undefined;
  fetch?: typeof fetch;
}

export class Api {
  readonly origin: string;
  readonly token: string;
  readonly vault: string | undefined;
  private readonly doFetch: typeof fetch;

  constructor(opts: ApiOptions) {
    this.origin = opts.origin;
    this.token = opts.token;
    this.vault = opts.vault || undefined;
    this.doFetch = opts.fetch ?? fetch;
  }

  url(path: string, query?: Query): string {
    const q = new URLSearchParams();
    /* A scoped route names the vault in its query; a caller that gave one itself (a transfer's
       other end is in the body, but a `ws`-style override is allowed) wins. */
    if (this.vault && scoped(path) && query?.[VAULT_PARAM] === undefined) q.set(VAULT_PARAM, this.vault);
    for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined) q.set(k, v);
    const s = q.toString();
    return `${this.origin}${path}${s ? `?${s}` : ""}`;
  }

  /** The response itself, for the three callers that want bytes or a stream rather than JSON. */
  async raw(path: string, init: RequestInit & { query?: Query } = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set("x-anydag-token", this.token);
    let res: Response;
    try {
      res = await this.doFetch(this.url(path, init.query), { ...init, headers });
    } catch (e) {
      const cause = (e as { cause?: unknown }).cause;
      const why = cause instanceof Error ? cause.message : String(e);
      throw new ApiError(
        `no AnyDag server at ${this.origin} (${why}) — open the app, or run without one with --vault <path>`,
        EXIT.noServer,
      );
    }
    if (!res.ok) throw await failure(res);
    return res;
  }

  async get<T = Record<string, unknown>>(path: string, query?: Query): Promise<T> {
    return (await (await this.raw(path, { query })).json()) as T;
  }

  async post<T = Record<string, unknown>>(path: string, body?: unknown, query?: Query): Promise<T> {
    const res = await this.raw(path, {
      method: "POST",
      query,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body ?? {}),
    });
    return (await res.json()) as T;
  }

  async put<T = Record<string, unknown>>(path: string, body: unknown): Promise<T> {
    const res = await this.raw(path, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return (await res.json()) as T;
  }
}

async function failure(res: Response): Promise<ApiError> {
  let body: Record<string, unknown> = {};
  try {
    const parsed: unknown = await res.json();
    if (parsed && typeof parsed === "object") body = parsed as Record<string, unknown>;
  } catch {
    /* Not JSON — a proxy's page, or a dev server with nothing behind it. The status is all there is. */
  }
  const said = typeof body.error === "string" ? body.error : `${res.status} ${res.statusText}`;
  if (res.status === 404 && body.code === "vault") return new ApiError(said, EXIT.noVault, 404, body);
  if (res.status === 409 && typeof body.base === "string" && typeof body.text === "string") {
    return new Conflict(body.base, body.text, said);
  }
  return new ApiError(said, EXIT.failed, res.status, body);
}
