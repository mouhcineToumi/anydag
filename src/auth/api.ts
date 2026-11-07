/**
 * The one thing the page needs to know about who is using it.
 *
 * There is no sign-in: the server answers `/api/auth/me` with the fixed local user, always.
 */

/** Who is using the app. Mirrors the server's fixed local user. */
export interface Account {
  uid: string;
  handle: string;
  email: string;
  name: string;
}

/** The local user, or `null` when the server is not answering. The first call the page makes. */
export async function me(): Promise<Account | null> {
  const response = await fetch("/api/auth/me");
  if (!response.ok) return null;
  return ((await response.json()) as { account: Account }).account;
}
