/**
 * The server stopped letting this page in (#402).
 *
 * `anydag serve` mints its secret path per launch (`server/app.ts`, #339), so a page left open over a
 * server that has restarted on the same port keeps asking under the old one and is answered `401`
 * by a server that is very much alive. There is no network error to report, and every caller that
 * treats `!response.ok` as "did not land" — a board's write, the change feed's reconnect — used to
 * drop the change and say nothing: the page looked fully alive and saved nothing.
 *
 * The gate's `401` is the one refusal no request from this page can be the cause of, and the only
 * `401` the routes answer (the sync link turns a sync server's into a `403` for exactly this reason).
 * So the page's `fetch` (`watchVault` in `src/vault/current.ts`) hears it on any request to the API,
 * marks the page lost **once**, and from then on the page says so where it always can, in a toast
 * that stays (`src/ui/ServerLost.tsx`), and a write refused that way says that it was not saved.
 *
 * Nothing here weakens the gate: the page is told it was refused, not let in. The way back is the
 * one the boot page already gives — the address `anydag serve` printed — because the credential is
 * an `HttpOnly` cookie this page cannot mint for itself.
 *
 * No React here, so `test/server-lost.test.ts` can hold it in Node.
 */

import { pathSecret } from "../vault/secret";

/** Dispatched on `window`, once, when the server first refuses this page its credential. */
const LOST = "dag:server-lost";

/** What a write refused by the gate says: the change, and why — the toast that stays says how to get back. */
export const REFUSED = "The AnyDag server no longer lets this page in, so that change was not saved.";

let lost = false;

/** Whether the server has refused this page its credential since it loaded. */
export const serverLost = (): boolean => lost;

/** Mark the page lost and tell whoever listens. Idempotent: the first refusal is the news. */
export function loseServer(): void {
  if (lost) return;
  lost = true;
  if (typeof dispatchEvent === "function") dispatchEvent(new Event(LOST));
}

/** For `useSyncExternalStore`. */
export function onServerLost(listen: () => void): () => void {
  if (typeof addEventListener !== "function") return () => undefined;
  addEventListener(LOST, listen);
  return () => removeEventListener(LOST, listen);
}

/**
 * The lasting sentence, and the way back. `short` is the toast's one line; `full` its title and what
 * a screen reader is given. A page `anydag serve` handed a secret goes back by the address it printed;
 * any other (the desktop app, Vite) by loading the page again, which asks its shell for the header.
 */
export function lostWords(secret: string = pathSecret()): { short: string; full: string } {
  return secret
    ? {
        short: "Lost the AnyDag server, so nothing here is saved: open the address `anydag serve` printed.",
        full: "The AnyDag server restarted and no longer lets this page in, so nothing changed here is saved. Open the address `anydag serve` printed when it started — the one ending in ?token=… — to carry on.",
      }
    : {
        short: "Lost the AnyDag server, so nothing here is saved: reload the page.",
        full: "The AnyDag server no longer lets this page in, so nothing changed here is saved. Reload the page to carry on.",
      };
}
