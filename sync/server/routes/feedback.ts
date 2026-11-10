/**
 * `POST /v1/feedback` — a person's bug or idea, made a GitHub issue, and nothing kept.
 *
 * Load-bearing:
 * - **Open, like `/v1/logs`**: the app that sends feedback is usually not a device of this server.
 *   What stands in for a token is a size cap read before the body (`MAX_FEEDBACK_BYTES` and the
 *   multipart's framing), five requests a minute an address and sixty in all — and, unlike a log
 *   batch, each refusal is a 4xx the card shows, because a person is waiting on the answer.
 * - **Stateless**: one request is buffered in memory, checked against `protocol/feedback.ts`, its
 *   files uploaded, the issue made, `{url}` answered. No file, no database row and no log line holds
 *   any of it; a failure is logged by its status alone.
 * - **Every upload before the issue.** A failed upload means no issue; the app keeps the draft. An
 *   asset uploaded before the failure stays in GitHub's storage — the relay has no copy and GitHub
 *   no API to delete one — which `docs/architecture/feedback-relay.md` records as accepted.
 * - **The token is this environment's and nobody else's**: `ANYDAG_FEEDBACK_GITHUB_TOKEN`. With none
 *   the route answers `ES_UNAVAILABLE`; `ANYDAG_FEEDBACK=off` makes it `ES_NOT_FOUND`.
 */

import { Hono } from "hono";

import {
  feedbackProblem,
  MAX_FEEDBACK_BYTES,
  type FeedbackDoc,
  type FeedbackEnv,
  type FeedbackKind,
  type FeedbackSent,
} from "../../protocol/feedback";
import { GitHub, GitHubError } from "../github";
import { HttpError, isObject, Rate, senderOf, type Deps, type Vars } from "./http";

const PER_MINUTE = 5;
const ALL_PER_MINUTE = 60;
/** The multipart's own bytes — boundaries, part headers, the env — on top of what the caps count. */
const FRAMING = 256 * 1024;
const MAX_BODY = MAX_FEEDBACK_BYTES + FRAMING;

const LABELS: Record<FeedbackKind, string[]> = {
  bug: ["status: triage", "type: bug", "feedback"],
  idea: ["status: triage", "type: feature", "feedback"],
};

/** The body, read up to `max` bytes and refused past it — a missing `content-length` included. */
async function capped(req: Request, max: number): Promise<Uint8Array> {
  const reader = req.body?.getReader();
  if (!reader) return new Uint8Array();
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => {});
      throw new HttpError("ES_TOO_LARGE", `feedback is at most ${MAX_FEEDBACK_BYTES / 1024 / 1024} MB`);
    }
    parts.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.byteLength;
  }
  return out;
}

function json(raw: FormDataEntryValue | null, what: string): unknown {
  if (raw === null) return undefined;
  if (typeof raw !== "string") throw new HttpError("ES_BAD_REQUEST", `${what} must be a field, not a file`);
  try {
    return JSON.parse(raw);
  } catch {
    throw new HttpError("ES_BAD_REQUEST", `${what} is not JSON`);
  }
}

function docs(raw: unknown, what: string): FeedbackDoc[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || !raw.every((d) => isObject(d) && typeof d.name === "string" && typeof d.text === "string"))
    throw new HttpError("ES_BAD_REQUEST", `${what} must be a list of {name, text}`);
  return raw.map((d) => ({ name: d.name as string, text: d.text as string }));
}

function envOf(raw: unknown): FeedbackEnv {
  const word = (v: unknown) => (typeof v === "string" && /^[\w.+-]{1,40}$/.test(v) ? v : "unknown");
  const e = isObject(raw) ? raw : {};
  return { version: word(e.version), os: word(e.os), arch: word(e.arch) };
}

/** A name set in Markdown: nothing in it may close a link, open a tag or start a mention. */
function mdName(name: string): string {
  return name.replace(/[\\[\]()<>*_`#@!|]/g, (c) => `\\${c}`);
}

/** HTML text, for a `<summary>`. */
function htmlText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** A fence longer than any run of backticks in `text`, so a board's own fences stay inside. */
function fenced(text: string, lang: string): string {
  const longest = Math.max(2, ...[...text.matchAll(/`+/g)].map((m) => m[0].length));
  const fence = "`".repeat(longest + 1);
  return `${fence}${lang}\n${text.replace(/\n$/, "")}\n${fence}`;
}

/**
 * A person's words, kept as written but unable to notify anyone: an `@name` would ping a GitHub
 * account from the maintainer's token, which is the abuse a relay like this one invites.
 */
function quiet(text: string): string {
  return text.replace(/@(?=[A-Za-z0-9-])/g, "@​");
}

export function issueTitle(kind: FeedbackKind, text: string): string {
  const line =
    text
      .split("\n")
      .find((l) => l.trim())
      ?.trim() ?? "";
  const cut = line.length > 80 ? `${line.slice(0, 79).trimEnd()}…` : line;
  return `${kind === "bug" ? "Bug" : "Idea"}: ${quiet(cut) || "feedback"}`;
}

export function issueBody(s: {
  kind: FeedbackKind;
  text: string;
  boards: readonly FeedbackDoc[];
  notes: readonly FeedbackDoc[];
  files: readonly { name: string; type: string; url: string }[];
  env: FeedbackEnv;
}): string {
  const out: string[] = [`**${s.kind === "bug" ? "Bug" : "Idea"}**, sent from AnyDag's feedback card.`, "", quiet(s.text.trim())];
  if (s.files.length) {
    out.push("", "### Attachments", "");
    for (const f of s.files) out.push(`${f.type.startsWith("image/") ? "!" : ""}[${mdName(f.name)}](${f.url})`);
  }
  for (const [label, list, lang] of [
    ["Board", s.boards, "markdown"],
    ["Note", s.notes, "markdown"],
  ] as const) {
    for (const d of list) {
      out.push("", `<details><summary>${label}: ${htmlText(d.name)}</summary>`, "", fenced(d.text, lang), "", "</details>");
    }
  }
  out.push(
    "",
    "---",
    `AnyDag ${s.env.version} · ${s.env.os} · ${s.env.arch}`,
    "",
    "_Sent from AnyDag through the feedback relay._",
  );
  return out.join("\n");
}

export function feedbackRoutes(deps: Deps & { fetch?: typeof fetch }): Hono<{ Variables: Vars }> {
  const app = new Hono<{ Variables: Vars }>();
  const rate = new Rate(PER_MINUTE, ALL_PER_MINUTE);
  const { feedbackToken: token, feedbackRepo: repo } = deps.config;
  const github = token ? new GitHub({ token, repo, ...(deps.fetch ? { fetch: deps.fetch } : {}) }) : null;

  app.post("/v1/feedback", async (c) => {
    if (!deps.config.feedback) throw new HttpError("ES_NOT_FOUND", "this server does not take feedback");
    if (!github) throw new HttpError("ES_UNAVAILABLE", "feedback not available: this server has no GitHub token");
    if (!rate.allow(senderOf(c), deps.now().getTime()))
      throw new HttpError("ES_RATE", "too much feedback from here this minute; try again in a minute");
    if (Number(c.req.header("content-length") ?? 0) > MAX_BODY)
      throw new HttpError("ES_TOO_LARGE", `feedback is at most ${MAX_FEEDBACK_BYTES / 1024 / 1024} MB`);
    const type = c.req.header("content-type") ?? "";
    if (!/^multipart\/form-data;/i.test(type)) throw new HttpError("ES_BAD_REQUEST", "feedback is a multipart/form-data body");

    const raw = await capped(c.req.raw, MAX_BODY);
    let form: FormData;
    try {
      form = await new Response(raw as unknown as BodyInit, { headers: { "content-type": type } }).formData();
    } catch {
      throw new HttpError("ES_BAD_REQUEST", "the body is not multipart/form-data");
    }

    const kind = form.get("kind");
    const text = form.get("text");
    const boards = docs(json(form.get("boards"), "boards"), "boards");
    const notes = docs(json(form.get("notes"), "notes"), "notes");
    const env = envOf(json(form.get("env"), "env"));
    const files: File[] = [];
    for (const f of form.getAll("files")) {
      if (typeof f === "string") throw new HttpError("ES_BAD_REQUEST", "files must be files, not fields");
      files.push(f);
    }
    const problem = feedbackProblem({
      kind,
      text,
      boards,
      notes,
      files: files.map((f) => ({ name: f.name, type: f.type, size: f.size })),
    });
    if (problem) throw new HttpError("ES_BAD_REQUEST", problem);
    const k = kind as FeedbackKind;

    try {
      const sent: { name: string; type: string; url: string }[] = [];
      for (const f of files)
        sent.push({
          name: f.name,
          type: f.type,
          url: await github.upload(f.name, f.type, new Uint8Array(await f.arrayBuffer())),
        });
      const url = await github.issue(
        issueTitle(k, text as string),
        issueBody({ kind: k, text: text as string, boards, notes, files: sent, env }),
        LABELS[k],
      );
      const answer: FeedbackSent = { url };
      return c.json(answer, 201);
    } catch (e) {
      if (!(e instanceof GitHubError)) throw e;
      console.error(`anydag-sync: feedback: ${e.message}`);
      throw new HttpError("ES_UPSTREAM", `${e.message}; no issue was made`);
    }
  });

  return app;
}
