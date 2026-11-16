/**
 * The one thing the page needs to know about who is using it.
 *
 * There is no sign-in: the server answers `/api/auth/me` with the fixed local user, always — to a
 * page that carries its credential (`server/app.ts`).
 */

import { forgetSecret, pathSecret } from "@/vault/secret";

/** Who is using the app. Mirrors the server's fixed local user. */
export interface Account {
  uid: string;
  handle: string;
  email: string;
  name: string;
}

let shut = false;

/**
 * Whether the server refused this page its credential: `anydag serve` in a browser that was never
 * handed the address it printed, or was handed it by a server since restarted. The page then says
 * to open that address rather than that the server is not answering.
 */
export const needsLink = (): boolean => shut;

/** The local user, or `null` when the server is not answering or refused the page. The first call the page makes. */
export async function me(): Promise<Account | null> {
  const response = await fetch("/api/auth/me").catch(() => null);
  const account = response?.ok
    ? await response
        .json()
        .then((body: { account?: Account }) => body.account ?? null)
        .catch(() => null)
    : null;
  if (account) return account;
  shut = response?.status === 401;
  /* A secret path the server refused — a server mints another each launch — or one something other
     than this server answered (a page served from elsewhere, which has no secret path): in the way of
     the next address `anydag serve` prints, and worth nothing kept. */
  if (pathSecret() && (shut || response?.ok)) forgetSecret();
  return null;
}
