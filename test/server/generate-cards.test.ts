/**
 * `POST /__board/generate` with `kind: "flashcards"` (#140): what it refuses before any model is
 * asked. The loop itself is `test/generate-cards.test.ts`, with a scripted model; nothing here
 * reaches one.
 */
import "./sqlite-shim";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../../server/app";
import { Session } from "../../server/context";
import { makeEnv, sweepTemps, type Env } from "./helpers";

let env: Env;
beforeEach(() => {
  env = makeEnv();
});
afterEach(async () => {
  await env.cleanup();
  sweepTemps();
});

async function generate(body: unknown): Promise<{ status: number; error?: string }> {
  const app = createApp({ session: new Session(env.home, env.vault, "test"), token: "t", page: null });
  const res = await app.request(`http://127.0.0.1/__board/generate?vault=${env.vault.id}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-anydag-token": "t", host: "127.0.0.1" },
    body: JSON.stringify(body),
  });
  return { status: res.status, ...((await res.json()) as { error?: string }) };
}

describe("/__board/generate, kind flashcards", () => {
  it("asks for a topic or a note", async () => {
    expect(await generate({ kind: "flashcards", prompt: "  " })).toEqual({
      status: 400,
      error: "say what the flashcards are about, or choose a note to make them from",
    });
  });

  it("refuses a count outside the range, and a kind it does not know", async () => {
    expect((await generate({ kind: "flashcards", prompt: "MVCC", count: 0 })).status).toBe(400);
    expect((await generate({ kind: "flashcards", prompt: "MVCC", count: 31 })).error).toBe(
      "`count` is a whole number from 1 to 30",
    );
    expect((await generate({ kind: "quiz", prompt: "MVCC" })).error).toBe("`kind` is `diagram` or `flashcards`");
  });

  it("takes a note larger than a diagram's source, up to its own cap", async () => {
    const said = await generate({ kind: "flashcards", prompt: "", source: "x".repeat(60_001) });
    expect(said.status).toBe(413);
    expect(said.error).toMatch(/^a note is at most 60000 characters/);
  });

  it("leaves a diagram's request as it was", async () => {
    expect(await generate({ prompt: "" })).toEqual({ status: 400, error: "describe the diagram first" });
  });
});
