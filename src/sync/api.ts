import type { SyncDevices, SyncLinkRequest, SyncLinked, SyncPairRequest, SyncPaired, SyncRemotes, SyncStatus } from "./types";

/**
 * Typed calls to every `/api/sync/*` route. The page's `fetch` wrapper adds `?vault=`; a failure is
 * the server's `{error, code}`, kept on {@link SyncError} so a pane can say the sentence.
 */
export class SyncError extends Error {
  constructor(
    message: string,
    readonly code: string | null,
    readonly status: number,
  ) {
    super(message);
  }
}

async function call<T>(method: "GET" | "POST", route: string, body?: object): Promise<T> {
  let r: Response;
  try {
    r = await fetch(`/api/sync${route}`, {
      method,
      ...(body ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}),
    });
  } catch {
    throw new SyncError("The server did not answer. Try again.", null, 0);
  }
  const got = (await r.json().catch(() => ({}))) as { error?: string; code?: string };
  if (!r.ok) throw new SyncError(got.error ?? "It could not be done. Try again.", got.code ?? null, r.status);
  return got as T;
}

export const syncStatus = () => call<SyncStatus>("GET", "");
export const syncPair = (req: SyncPairRequest) => call<SyncPaired>("POST", "/pair", req);
export const syncRemotes = () => call<SyncRemotes>("GET", "/remotes");
export const syncLink = (req: SyncLinkRequest) => call<SyncLinked>("POST", "/link", req);
export const syncNow = () => call<SyncStatus>("POST", "/now", {});
export const syncUnlink = () => call<SyncStatus>("POST", "/unlink", {});
export const syncDevices = () => call<SyncDevices>("GET", "/devices");
export const syncRevoke = (id: string) => call<SyncDevices>("POST", "/devices/revoke", { id });
