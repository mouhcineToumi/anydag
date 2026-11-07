#!/usr/bin/env node
/**
 * Give every item on every board of an account its id in the file
 * migration.
 *
 *   node scripts/stamp.mjs [--origin http://localhost:3600]
 *
 * **Through the api, never through the disk**, so it migrates whichever store the api is on: an
 * empty patch is exactly a stamp, because the local server stamps whatever a patch leaves behind.
 * Each write carries the `base` it read, so a board somebody is editing right now is refused and
 * reported rather than overwritten — run it again.
 *
 * Idempotent: a stamped board stamps to itself, and the api does not write a patch that changed
 * nothing. The *document* ids need no script at all — listing an account gives every document one.
 *
 * Exit codes: 0 every board is stamped · 4 one or more failed · 6 the api is not answering.
 */
import { authed, signIn } from "./session.mjs";

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const ORIGIN = (
  flag("--origin", process.env.ANYDAG_ORIGIN || `http://localhost:${process.env.ANYDAG_COMPOSE_PORT || 3600}`)
).replace(/\/$/, "");

let session;
try {
  session = await signIn(ORIGIN);
} catch (e) {
  console.error(String(e.message ?? e));
  process.exit(6);
}
const call = authed(session.cookie);
const json = async (url, init) => {
  const res = await call(url, init);
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { error: text.slice(0, 200) };
  }
  return { ok: res.ok, status: res.status, body };
};

const listing = await json(`${ORIGIN}/__board/list`).catch(() => null);
if (!listing?.ok) {
  console.error(`stamp: nothing is answering on ${ORIGIN}. \`npm run dev\` or \`docker compose up -d\``);
  process.exit(6);
}

let stamped = 0;
let same = 0;
const failed = [];
for (const name of listing.body.boards ?? []) {
  const q = `name=${encodeURIComponent(name)}`;
  const got = await json(`${ORIGIN}/__board/get?${q}`);
  if (!got.ok) {
    failed.push([name, `get ${got.status}`]);
    continue;
  }
  const res = await json(`${ORIGIN}/__board/patch?${q}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ops: [], base: got.body.base }),
  });
  if (!res.ok) failed.push([name, `patch ${res.status} ${res.body.error ?? ""}`]);
  else if (res.body.text === got.body.text) same++;
  else stamped++;
}

console.log(`stamp: ${stamped} stamped · ${same} already stamped · ${failed.length} failed`);
for (const [name, why] of failed) console.log(`  ${name}: ${why}`);
process.exit(failed.length ? 4 : 0);
