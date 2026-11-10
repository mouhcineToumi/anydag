/**
 * Feedback, on the app's side: where it goes, what it says about this machine, and the forward.
 *
 * Load-bearing:
 * - **The app holds no GitHub token.** It sends to a relay — `POST /v1/feedback` on a sync server
 *   (`api/server/routes/feedback.ts`) — and the relay alone holds one. The page never calls the
 *   relay: it asks `POST /api/feedback`, and this forwards.
 * - **Where it goes**: `ANYDAG_FEEDBACK_URL` (an address, or `off`), else the address a release
 *   builds in (`__ANYDAG_FEEDBACK_URL__`, from `ANYDAG_FEEDBACK_BUILD_URL` in `server/build.mjs`),
 *   else nowhere — and the card says feedback is not available. Unlike logs, a paired sync server is
 *   never assumed: a self-hoster's server forwarding to *our* tracker is not what they set up.
 * - **What it says about the machine is `env` and nothing else**: the version, the system, the arch.
 *   The card lists all three before Send, from `GET /api/feedback`.
 * - **A refusal is the relay's sentence**, at the relay's status, so the card shows why and keeps
 *   the draft; a relay that cannot be reached is a 502 in our words.
 */

import {
  feedbackProblem,
  type FeedbackDoc,
  type FeedbackEnv,
  type FeedbackKind,
  type FeedbackSent,
} from "../api/protocol/feedback";
import { err } from "./http";

declare const __ANYDAG_FEEDBACK_URL__: string;
const BUILT_IN = typeof __ANYDAG_FEEDBACK_URL__ === "string" ? __ANYDAG_FEEDBACK_URL__ : "";

const TIMEOUT_MS = 120_000;

/** `…/v1/feedback` from what somebody configured: a relay's address, or the endpoint itself. */
export function feedbackEndpoint(raw: string): string | null {
  const s = raw.trim().replace(/\/+$/, "");
  if (!/^https?:\/\/[^\s/]+/i.test(s)) return null;
  return /\/v1\/feedback$/.test(s) ? s : `${s}/v1/feedback`;
}

/** Where a submission goes, or `null`; `ANYDAG_FEEDBACK_URL=off` sends nowhere. */
export function feedbackDestination(env: NodeJS.ProcessEnv): string | null {
  const set = env.ANYDAG_FEEDBACK_URL?.trim();
  if (set === "off" || set === "0") return null;
  if (set) return feedbackEndpoint(set);
  return BUILT_IN ? feedbackEndpoint(BUILT_IN) : null;
}

export function feedbackEnv(version: string): FeedbackEnv {
  return { version, os: process.platform, arch: process.arch };
}

export interface Submission {
  kind: FeedbackKind;
  text: string;
  boards: FeedbackDoc[];
  notes: FeedbackDoc[];
  files: { name: string; type: string; bytes: Uint8Array }[];
  env: FeedbackEnv;
}

/** Send it on, and the issue's address back; any refusal is an `Http` with the relay's words. */
export async function forwardFeedback(to: string, s: Submission, fetchImpl: typeof fetch = fetch): Promise<FeedbackSent> {
  const problem = feedbackProblem({
    ...s,
    files: s.files.map((f) => ({ name: f.name, type: f.type, size: f.bytes.byteLength })),
  });
  if (problem) throw err(400, problem, { code: "feedback-invalid" });
  const form = new FormData();
  form.set("kind", s.kind);
  form.set("text", s.text);
  form.set("boards", JSON.stringify(s.boards));
  form.set("notes", JSON.stringify(s.notes));
  form.set("env", JSON.stringify(s.env));
  for (const f of s.files) form.append("files", new File([f.bytes as unknown as BlobPart], f.name, { type: f.type }));

  let res: Response;
  try {
    res = await fetchImpl(to, { method: "POST", body: form, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    throw err(502, `the feedback relay at ${new URL(to).host} could not be reached`, { code: "feedback-unreachable" });
  }
  let said: Record<string, unknown> = {};
  try {
    said = (await res.json()) as Record<string, unknown>;
  } catch {
    /* not JSON: a proxy's page, say */
  }
  if (res.status === 201 && typeof said.url === "string") return { url: said.url };
  const message = typeof said.message === "string" && said.message ? said.message : `the feedback relay answered ${res.status}`;
  throw err(res.status >= 400 ? res.status : 502, message, {
    code: typeof said.code === "string" ? said.code : "feedback-failed",
  });
}
