#!/usr/bin/env node
/**
 * Ask the running dev server for a diagram from the command line — the prompt card without the card.
 *
 *   node scripts/generate.mjs "<description>" [--as arch] [--provider claude|opencode|custom]
 *                            [--model <id>] [--port 3500] [--json]
 *
 * It calls `POST /__board/generate`, the route the card calls, so what it prints is exactly what a
 * card would have been answered: the fence, how many attempts the fix loop took, how long, and every
 * diagnostic left over. That makes it the way to compare models — the same five descriptions through
 * two providers, read side by side — and the way to see a provider's refusal in words when the card
 * only has room for one line. Nothing is written to any board.
 *
 * Exit codes: 0 a clean diagram · 1 a diagram with errors left in it · 2 no diagram at all, or the
 * server refused · 6 the server is not up.
 */

import { authed, signIn } from "./session.mjs";

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  if (i < 0) return undefined;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
};
const json = args.includes("--json") ? (args.splice(args.indexOf("--json"), 1), true) : false;
const as = flag("as");
const provider = flag("provider");
const model = flag("model");
const port = Number(flag("port") ?? process.env.ANYDAG_PORT ?? 3500);
const prompt = args.join(" ").trim();

if (!prompt) {
  console.error(
    'usage: node scripts/generate.mjs "<description>" [--as <type>] [--provider <id>] [--model <id>] [--port 3500] [--json]',
  );
  process.exit(2);
}

const origin = `http://localhost:${port}`;
/* `/generate` reads the machine's own model settings and runs on the token the server started
   with; the request carries it like any other. `anydag generate` is the same request over the
   CLI, and this script is here for the eval rounds that call it. */
let session;
try {
  session = await signIn(origin);
} catch (e) {
  console.error(String(e?.message ?? e));
  process.exit(6);
}
let res;
try {
  res = await authed(session.cookie)(`${origin}/__board/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, as, provider, model }),
  });
} catch {
  console.error(`no dev server at ${origin} — start it with \`npm run dev\``);
  process.exit(6);
}
const body = await res.json().catch(() => ({}));

if (json) {
  console.log(JSON.stringify({ status: res.status, ...body }, null, 2));
} else if (!res.ok) {
  console.error(`${res.status}: ${body.error ?? "the server refused"}`);
} else {
  const d = body.draft;
  const head = [
    `${body.provider}/${body.model}`,
    d ? d.type : "no diagram",
    `${body.attempts} attempt${body.attempts === 1 ? "" : "s"}`,
    `${((body.ms ?? 0) / 1000).toFixed(1)}s`,
    body.ok ? "clean" : body.error ? "failed" : "errors left",
  ].join(" · ");
  console.log(head);
  if (d) {
    const attrs = Object.entries(d.attrs ?? {})
      .map(([k, v]) => (v === true ? k : typeof v === "string" && /\s/.test(v) ? `${k}="${v}"` : `${k}=${v}`))
      .join(" ");
    console.log("\n```" + d.type + (attrs ? ` {${attrs}}` : "") + "\n" + d.body + "\n```");
  }
  if (body.error) console.log(`\n${body.error}`);
  for (const x of body.diagnostics ?? [])
    console.log(
      `${x.severity === "error" ? "error" : "warn "} ${x.line === 0 ? "fence" : `line ${x.line}`} ${x.code} — ${x.message}`,
    );
}

process.exit(!res.ok ? 2 : body.ok ? 0 : body.draft ? 1 : 2);
