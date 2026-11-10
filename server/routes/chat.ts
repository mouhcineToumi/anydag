/**
 * The Assistant's routes: the page's and the
 * CLI's, and the two the chat's own MCP server calls (`/__board/chat/block`, `/__board/chat/access`),
 * which only answer a request carrying `X-AnyDag-Chat` for a turn that is running.
 *
 * A chat lives in a vault, so these are vault-scoped like every `/__board` route, but a chat is found
 * by its id in whichever open vault holds it — the page may hold a link to a chat in another vault.
 */

import type { Context, Hono } from "hono";
import { streamSSE } from "hono/streaming";

import type { Assistant } from "../chat/live";
import { modelsFor } from "../chat/models";
import { PROVIDERS, type ChatEvent, type Mode, type Provider } from "../chat/types";
import { bodyOf, err } from "../http";

const str = (v: unknown, what: string): string => {
  if (typeof v !== "string" || !v.trim()) throw err(400, `\`${what}\` is required`);
  return v.trim();
};
const provider = (v: unknown): Provider | undefined => {
  if (v === undefined || v === null || v === "") return undefined;
  if (!PROVIDERS.includes(v as Provider)) throw err(400, `\`${String(v)}\` is not a provider`);
  return v as Provider;
};
const mode = (v: unknown): Mode | undefined => {
  if (v === undefined || v === null || v === "") return undefined;
  if (v !== "ask" && v !== "edit") throw err(400, "`mode` is `ask` or `edit`");
  return v;
};

/** Requests from a chat's MCP server: the reach, the approvals, the recorder. Registered
 *  before the vault scoping, so a chat's request is scoped to the chat's vault, not the default. */
export function chatGuard(app: Hono, a: Assistant): void {
  app.use("*", async (c, next) => (c.req.header("x-anydag-chat") ? a.guard(c, next) : next()));
}

export function chatRoutes(app: Hono, a: Assistant): void {
  app.get("/__board/chats", (c) => c.json({ chats: a.list(c.req.query("all") ? null : c.req.query("vault")) }));

  app.get("/__board/chat/models", async (c) => c.json(await modelsFor(a.providers(), process.env, a.fake())));

  app.post("/__board/chat", async (c) => {
    const b = await bodyOf(c);
    const p = provider(b.provider);
    if (!p) throw err(400, "`provider` is required");
    const chat = a.create(c.req.query("vault"), {
      provider: p,
      model: str(b.model, "model"),
      effort: typeof b.effort === "string" ? b.effort : undefined,
      title: typeof b.title === "string" ? b.title : undefined,
    });
    return c.json({ chat });
  });

  app.get("/__board/chat", (c) => c.json(a.read(str(c.req.query("id"), "id"), c.req.query("vault"))));

  app.post("/__board/chat/rename", async (c) => {
    const b = await bodyOf(c);
    return c.json({ chat: a.rename(str(b.id, "id"), str(b.title, "title"), c.req.query("vault")) });
  });

  app.post("/__board/chat/delete", async (c) => {
    const b = await bodyOf(c);
    await a.remove(str(b.id, "id"), c.req.query("vault"));
    return c.json({ ok: true });
  });

  app.post("/__board/chat/turn", async (c) => {
    const b = await bodyOf(c);
    const turn = a.say(str(b.id, "id"), str(b.text, "text"), {
      vault: c.req.query("vault"),
      provider: provider(b.provider),
      model: typeof b.model === "string" && b.model ? b.model : undefined,
      effort: b.effort === null ? null : typeof b.effort === "string" ? b.effort : undefined,
    });
    return c.json({ turn });
  });

  app.post("/__board/chat/stop", async (c) => {
    const b = await bodyOf(c);
    await a.stop(str(b.id, "id"));
    return c.json({ ok: true });
  });

  app.post("/__board/chat/approve", async (c) => {
    const b = await bodyOf(c);
    if (typeof b.yes !== "boolean") throw err(400, "`yes` is true or false");
    a.answer(str(b.id, "id"), str(b.step, "step"), b.yes);
    return c.json({ ok: true });
  });

  app.post("/__board/chat/grant", async (c) => {
    const b = await bodyOf(c);
    const m = b.mode === null || b.on === false ? null : (mode(b.mode) ?? "ask");
    return c.json({ chat: a.grant(str(b.id, "id"), str(b.vault, "vault"), m, c.req.query("vault")) });
  });

  const undo = (redo: boolean) => async (c: Context) => {
    const b = await bodyOf(c);
    return c.json({
      record: await a.undo(str(b.id, "id"), str(b.turn, "turn"), str(b.block, "block"), redo, c.req.query("vault")),
    });
  };
  // Written out, not looped: `scripts/parity.mjs` reads the routes off the literal calls.
  app.post("/__board/chat/undo", undo(false));
  app.post("/__board/chat/redo", undo(true));

  // The chat's MCP server's own two.
  app.post("/__board/chat/block", async (c) => {
    if (!c.req.header("x-anydag-chat")) throw err(403, "only a chat's own tools call this", { code: "chat-only" });
    const b = await bodyOf(c);
    return c.json({ block: a.block(c, typeof b.title === "string" ? b.title : "") });
  });

  app.post("/__board/chat/access", async (c) => {
    if (!c.req.header("x-anydag-chat")) throw err(403, "only a chat's own tools call this", { code: "chat-only" });
    const b = await bodyOf(c);
    return c.json(await a.access(c, str(b.vault, "vault"), typeof b.why === "string" ? b.why : "", mode(b.mode) ?? "ask"));
  });

  /** One chat's events with `?id=`, every chat's without — the list redraws on `chat` and `end`. */
  app.get("/__board/chat/events", (c) =>
    streamSSE(c, async (stream) => {
      const id = c.req.query("id") || "*";
      const queue: ChatEvent[] = [];
      let wake: (() => void) | null = null;
      const off = a.listen(id, (e) => {
        queue.push(e);
        wake?.();
      });
      stream.onAbort(() => {
        off();
        wake?.();
      });
      await stream.write(": open\n\n");
      while (!stream.aborted) {
        const e = queue.shift();
        if (!e) {
          let timer: NodeJS.Timeout | undefined;
          await new Promise<void>((r) => {
            wake = r;
            timer = setTimeout(r, 20_000);
          });
          clearTimeout(timer);
          wake = null;
          if (!queue.length && !stream.aborted) await stream.write(": ping\n\n");
          continue;
        }
        await stream.writeSSE({ event: `chat:${e.type}`, data: JSON.stringify(e) });
      }
      off();
    }),
  );
}
