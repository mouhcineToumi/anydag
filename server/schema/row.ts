/**
 * A row of the local server's route table, and the answers every row gets without saying so.
 *
 * A family's file (`server/schema/docs.ts`, …) declares each route it registers as a `Row`: its
 * parameters, the body schema its handler reads through, what it answers, and the refusals the
 * handler itself makes, by status. `route` adds what the server around it can answer to any request:
 *
 * - `401 {code: "token"}` — the gate, before any route (`app.ts`);
 * - `403` — a request a chat's tools make outside what the chat may reach (`chat/live.ts`'s guard),
 *   and, for a write, one whose only credential is the cookie from another origin (#336);
 * - `404 {code: "vault"}` — a route about one vault, when none is open or `?vault=` names one that is
 *   not (`server/scope.ts`);
 * - `409 {code: "no-turn"}` — a request carrying `X-AnyDag-Chat` for a chat with no turn running;
 * - `500` — a defect: Hono's own plain-text answer, the error is logged and never sent.
 *
 * Every refusal is `Refusal` (`{error, code?}`); a 409 of a route that writes under a `base` may
 * also be `Conflict`, the text that won.
 */

import { z } from "zod";

import { type Answer, pathOf, type Route } from "../../api/openapi/document";
import { scoped } from "../scope";
import { about, ConflictOrRefusal, Refusal } from "./fields";

type Method = "get" | "post" | "put";

export interface Row {
  method: Method;
  /** As Hono spells it; a trailing `*` is one parameter, `path`, that may hold slashes. */
  path: string;
  operationId: string;
  summary: string;
  description?: string;
  tag: string;
  /** Registered only when the build's `cloud` switch is on (`server/features.ts`). */
  cloud?: true;
  query?: z.ZodObject;
  header?: z.ZodObject;
  body?: Route["body"];
  /** What a request that was not refused is answered. */
  answers: Record<number, Answer>;
  /** The refusals the handler makes itself — a sentence per status saying when. */
  refuses?: Record<number, string>;
  /** A 409 may carry the text that won and its `base` (`Conflict`). */
  conflict?: true;
}

export interface LocalRoute extends Route {
  /** The route as Hono registers it, for the contract test against the app and `docs/parity.json`. */
  hono: string;
  cloud: boolean;
}

const AROUND: Record<number, (r: Row) => string | null> = {
  401: () =>
    'The request did not carry this launch\'s token (`X-AnyDag-Token`, or the cookie under `/s/<secret>/`): `{code: "token"}`.',
  403: (r) =>
    [
      /* The guard hands a chat's own routes straight on. */
      r.path.startsWith("/__board/chat/")
        ? null
        : "A chat's tools asked for something the chat may not reach: `chat-refused`, `not-granted`, `read-only`, or `declined` when the person said no.",
      r.method === "get" ? null : "A write whose only credential is the cookie came from another origin: `origin`.",
    ]
      .filter(Boolean)
      .join(" "),
  404: (r) => (scoped(r.path) ? 'No vault is open, or `?vault=` names one that is not: `{code: "vault"}`.' : null),
  409: () => 'A request carrying `X-AnyDag-Chat` for a chat with no turn running: `{code: "no-turn"}`.',
};

/** The row as the builder takes it, with the answers the server around it gives. */
export function route(r: Row): LocalRoute {
  const answers: Record<number, Answer> = { ...r.answers };
  const statuses = new Set([...Object.keys(r.refuses ?? {}).map(Number), ...Object.keys(AROUND).map(Number)]);
  for (const status of [...statuses].sort((a, b) => a - b)) {
    if (answers[status]) throw new Error(`openapi: ${r.method} ${r.path} answers ${status} and refuses with it`);
    const said = [r.refuses?.[status] ?? null, AROUND[status]?.(r) ?? null].filter((x): x is string => !!x);
    if (!said.length || status === 500) continue;
    answers[status] = { description: said.join(" "), schema: status === 409 && r.conflict ? ConflictOrRefusal : Refusal };
  }
  const defect = "A defect in the server: its error is logged here, never sent.";
  answers[500] = r.refuses?.[500]
    ? {
        description: `${r.refuses[500]} Otherwise, a defect: Hono's plain text, the error logged here and never sent.`,
        schema: Refusal,
      }
    : { description: defect, type: "text/plain" };

  const wild = r.path.endsWith("/*");
  const hono = r.path;
  const path = wild ? `${r.path.slice(0, -2)}/{path}` : pathOf(r.path);
  const params: NonNullable<Route["params"]> = {};
  if (wild)
    params.path = z.object({
      path: about("The rest of the address, slashes and all, percent-encoded.", z.string()),
    });
  if (r.query) params.query = r.query;
  if (r.header) params.header = r.header;

  return {
    method: r.method,
    path,
    hono,
    operationId: r.operationId,
    summary: r.summary,
    ...(r.description ? { description: r.description } : {}),
    tag: r.tag,
    security: ["token", "cookie"],
    ...(Object.keys(params).length ? { params } : {}),
    ...(r.body ? { body: r.body } : {}),
    answers,
    cloud: r.cloud === true,
  };
}
