/**
 * Feedback: a person's bug or idea, forwarded to the relay that makes it a GitHub issue.
 *
 * | Route | Does |
 * |---|---|
 * | `GET /api/feedback` | `{destination, env}`: the relay's host or `null`, and the version, system and arch a send carries |
 * | `POST /api/feedback` `{kind, text, boards?, notes?, files?}` | `201 {url}`, the issue; a refusal is the relay's sentence at its status |
 *
 * `boards` and `notes` are names in the vault: their whole text is read here and sent, under the
 * file's own name and not its folder's. `files` are
 * `{name, type, data}`, `data` base64. A chat may not call it (`chat/live.ts` lists no such write):
 * feedback leaves the machine only when the person sends it, or asks an agent to through MCP.
 * See `server/feedback.ts`.
 */

import type { Hono } from "hono";

import type { FeedbackDoc, FeedbackKind } from "../../sync/protocol/feedback";
import type { Session } from "../context";
import { feedbackDestination, feedbackEnv, forwardFeedback } from "../feedback";
import { bodyOf, err, mustRead } from "../http";
import { leafOf, SUFFIX } from "../names";

function names(raw: unknown, what: string): string[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw) || !raw.every((n) => typeof n === "string" && n)) throw err(400, `\`${what}\` is a list of names`);
  return [...new Set(raw as string[])];
}

function files(raw: unknown): { name: string; type: string; bytes: Uint8Array }[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw err(400, "`files` is a list of {name, type, data}");
  return raw.map((f) => {
    const o = (f ?? {}) as Record<string, unknown>;
    if (typeof o.name !== "string" || typeof o.type !== "string" || typeof o.data !== "string")
      throw err(400, "each file is {name, type, data}, `data` its bytes as base64");
    const b64 = o.data.startsWith("data:") && o.data.includes(",") ? o.data.slice(o.data.indexOf(",") + 1) : o.data;
    if (!/^[A-Za-z0-9+/\s]*={0,2}$/.test(b64)) throw err(400, `\`${o.name}\`'s data is not base64`);
    return { name: o.name, type: o.type, bytes: new Uint8Array(Buffer.from(b64, "base64")) };
  });
}

export function feedbackRoutes(app: Hono, s: Session, fetchImpl: typeof fetch = fetch): void {
  app.get("/api/feedback", (c) => {
    const to = feedbackDestination(s.env);
    return c.json({ destination: to ? new URL(to).host : null, env: feedbackEnv(s.version) });
  });

  app.post("/api/feedback", async (c) => {
    const to = feedbackDestination(s.env);
    if (!to) throw err(503, "feedback not available: this app has no feedback relay set", { code: "ES_UNAVAILABLE" });
    const b = await bodyOf(c);
    if (b.kind !== "bug" && b.kind !== "idea") throw err(400, "`kind` is bug or idea");
    if (typeof b.text !== "string") throw err(400, "`text` is what happened, or what you would like");
    const read = async (list: string[], kind: "board" | "note"): Promise<FeedbackDoc[]> => {
      const out: FeedbackDoc[] = [];
      /* By its own name and not its folder's: where it lives in the vault is not what was ticked. */
      for (const name of list)
        out.push({ name: `${leafOf(name)}${SUFFIX[kind]}`, text: (await mustRead(s.vault, name, kind)).text });
      return out;
    };
    const sent = await forwardFeedback(
      to,
      {
        kind: b.kind as FeedbackKind,
        text: b.text,
        boards: await read(names(b.boards, "boards"), "board"),
        notes: await read(names(b.notes, "notes"), "note"),
        files: files(b.files),
        env: feedbackEnv(s.version),
      },
      fetchImpl,
    );
    return c.json(sent, 201);
  });
}
