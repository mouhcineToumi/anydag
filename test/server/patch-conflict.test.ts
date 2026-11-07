/**
 * A write against a version that has moved is refused, and the refusal carries what replaced it.
 *
 * This was `e2e/edit.spec.ts`'s *a write against a version that has moved is refused*, tagged
 * `@smoke`: it opened a board in Chromium only to `fetch` the route from inside the page and read
 * the status, the body and the file. Nothing in it was drawn, so it is the route's contract and
 * lives here, against the real `createApp` and a real vault, in a few milliseconds. The gesture that
 * *meets* a 409 in the browser (the page adopts the text and retries) is what `e2e/notes.spec.ts`
 * (*two writers on different blocks are merged*) and `e2e/edit.spec.ts` (*a drag pins the item it
 * moved*) still hold.
 */
import "./sqlite-shim";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../../server/app";
import { Session } from "../../server/context";
import { makeEnv, sweepTemps, write, type Env } from "./helpers";

const BOARD = "---\ntitle: Drag me\n---\n\n```md {#one}\nThe first item.\n```\n\n```md {#two}\nThe second item.\n```\n";

let env: Env;
beforeEach(() => {
  env = makeEnv();
});
afterEach(async () => {
  await env.cleanup();
  sweepTemps();
});

async function patch(base: string) {
  const app = createApp({ session: new Session(env.home, env.vault, "test"), token: "t", page: null });
  const res = await app.request("http://127.0.0.1/__board/patch?name=plan", {
    method: "POST",
    headers: { "content-type": "application/json", "x-anydag-token": "t", host: "127.0.0.1" },
    body: JSON.stringify({ base, ops: [{ id: "one", attrs: { x: 8 } }] }),
  });
  return { status: res.status, body: (await res.json()) as { base?: string; text?: string } };
}

describe("POST /__board/patch with a base", () => {
  it("refuses a stale one with 409, the text that replaced it, and the base to retry against", async () => {
    write(env.root, "plan.board.md", BOARD);
    const stale = await patch("0000000000000000000000000000000000000000");

    expect(stale.status).toBe(409);
    /* The refusal carries what replaced it, so the client can retry against real content rather than
       refetching and guessing. */
    expect(stale.body.text).toBe(BOARD);
    expect(stale.body.base).toHaveLength(40);
    expect((await env.vault.read("plan"))!.text).toBe(BOARD);
  });

  it("takes the base the refusal handed back, and writes only the one attribute", async () => {
    /* The control for the test above: a 409 that came from every request, whatever its base, would
       pass it. */
    write(env.root, "plan.board.md", BOARD);
    const refused = await patch("0000000000000000000000000000000000000000");
    const retried = await patch(refused.body.base!);

    expect(retried.status).toBe(200);
    const text = (await env.vault.read("plan"))!.text;
    expect(text).toContain("```md {#one x=8}");
    expect(text).toContain("```md {#two}");
  });
});
