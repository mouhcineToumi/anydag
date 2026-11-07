/** A picture pasted onto a board is an attachment, and the fence that draws it must parse. */
import "./sqlite-shim";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { parseBoard } from "../../src/board/parseBoard";
import { createApp } from "../../server/app";
import { Session } from "../../server/context";
import { makeEnv, sweepTemps, type Env } from "./helpers";

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

let env: Env;
beforeEach(() => {
  env = makeEnv();
});
afterEach(async () => {
  await env.cleanup();
  sweepTemps();
});

describe("POST /__board/asset", () => {
  it("writes an image fence whose `src=\"dag:<id>\"` parses clean, twice over", async () => {
    await env.vault.create("plan", "board", "```md {#one}\nhi\n```\n");
    const app = createApp({ session: new Session(env.home, env.vault, "test"), token: "t", page: null });
    for (let i = 0; i < 2; i++) {
      const res = await app.request("http://127.0.0.1/__board/asset?name=plan", {
        method: "POST",
        headers: { "content-type": "application/json", "x-anydag-token": "t", host: "127.0.0.1" },
        body: JSON.stringify({ dataUrl: PNG, x: 0, y: 0, w: 8 }),
      });
      expect(res.status).toBe(200);
    }
    const text = (await env.vault.read("plan"))!.text;
    expect(text).toMatch(/```image \{[^}]*src="dag:[0-9a-z]{10}"/);
    const parsed = parseBoard("plan", text);
    expect(parsed.errors).toEqual([]);
    expect(parsed.items.filter((i) => i.type === "image")).toHaveLength(2);
  });
});
