/**
 * Which requests are about one vault. A `/__board` route and every `/api/` route but the few about
 * the app itself run inside the vault `?vault=<id>` names, or the one opened last (`context.ts`), and
 * are refused `404 {code: "vault"}` when that vault is not open. `app.ts` scopes by it; the OpenAPI
 * document (`server/openapi.ts`) says which routes can be refused so.
 */

/** The routes about the app rather than one vault: they answer with no vault open. */
const UNSCOPED = ["/api/health", "/api/vaults", "/api/settings", "/api/auth/me", "/api/telemetry", "/api/openapi.json"];

/** Whether a request to `path` runs inside a vault. */
export const scoped = (path: string): boolean =>
  path.startsWith("/__board") || (path.startsWith("/api/") && !UNSCOPED.some((u) => path === u || path.startsWith(`${u}/`)));
