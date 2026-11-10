/**
 * Reaching the local server from a script.
 *
 * There is no account: a server serves one machine and asks for the
 * token it was started with, as the `x-anydag-token` header or the `anydag_token` cookie. Through
 * `npm run dev` the Vite proxy adds it and a script needs nothing; against `anydag serve` directly it
 * needs the token, which this finds where the server left it.
 *
 * `snapshot.mjs`, `tidy.mjs`, `generate.mjs` and `stamp.mjs` call `signIn`, which no longer signs in
 * anybody — it finds the token, and the name is kept so the four read as they did.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * The token: `ANYDAG_TOKEN`, else the `server.json` of `ANYDAG_HOME`, this checkout's `.dev-home`,
 * or `~/.anydag`. There is no fallback value: `npm run dev` mints one per run, so a guessed token
 * is only a 401 with a clearer name.
 */
export function token() {
  if (process.env.ANYDAG_TOKEN) return process.env.ANYDAG_TOKEN;
  const homes = [process.env.ANYDAG_HOME, path.resolve(".dev-home"), path.join(os.homedir(), ".anydag")].filter(Boolean);
  for (const home of homes) {
    try {
      const got = JSON.parse(fs.readFileSync(path.join(home, "server.json"), "utf8"));
      if (typeof got.token === "string") return got.token;
    } catch {
      /* Not there, or not a server's. */
    }
  }
  throw new Error("no AnyDag token found — set ANYDAG_TOKEN, or start `npm run dev` so `server.json` has one");
}

/** What `signIn` returns — the token, as `cookie`, plus the one person the machine has. */
export async function signIn(_origin) {
  return { cookie: token(), account: { handle: "local", email: "" } };
}

/** A Playwright `storageState` carrying the token as the server's own cookie. */
export function storageState(value, domain = "127.0.0.1") {
  return {
    cookies: [
      {
        name: "anydag_token",
        value,
        domain,
        path: "/",
        expires: Math.floor(Date.now() / 1000) + 60 * 60 * 24,
        httpOnly: true,
        secure: false,
        sameSite: "Strict",
      },
    ],
    origins: [],
  };
}

/** `fetch`, with the token on it. */
export function authed(value) {
  return (url, init = {}) => fetch(url, { ...init, headers: { ...(init.headers ?? {}), "x-anydag-token": value } });
}
