/**
 * `GET /__board/assets/*`, the legacy `<name>.assets/` pictures (#10). It went out with only a
 * `content-type`, so an SVG opened as a page ran its script on the app's origin with the session's
 * cookie; and its `.assets` check ran before the path was normalised, so an `%2F..%2F` the route
 * decoded reached any file in the vault, `.anydag/` included.
 */
import "./sqlite-shim";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../../server/app";
import { Session } from "../../server/context";
import { BOARD, makeEnv, sweepTemps, write, type Env } from "./helpers";

const SVG = `<svg xmlns="http://www.w3.org/2000/svg"><script>fetch('/__board/list')</script></svg>`;

let env: Env;
let app: ReturnType<typeof createApp>;
beforeEach(async () => {
  env = makeEnv();
  app = createApp({ session: new Session(env.home, env.vault, "test", {}), token: "t", page: null });
  await env.vault.create("plan", "board", BOARD);
  write(env.root, "plan.assets/paste-1.svg", SVG);
  write(env.root, "attachments/d.svg", SVG);
});
afterEach(async () => {
  await env.cleanup();
  sweepTemps();
});

const get = (rest: string) =>
  app.request(`http://127.0.0.1/__board/assets/${rest}`, { headers: { host: "127.0.0.1", "x-anydag-token": "t" } });

describe("a legacy picture", () => {
  it("goes out with the guards every attachment has", async () => {
    const res = await get("plan.assets/paste-1.svg");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/svg+xml");
    expect(res.headers.get("content-security-policy")).toContain("sandbox");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await res.text()).toBe(SVG);
  });

  it("is only ever a file inside a `.assets` folder, however the path is spelled", async () => {
    for (const rest of [
      "x.assets%2F..%2Fattachments%2Fd.svg",
      "plan.assets%2F..%2F.anydag%2Fvault.json",
      "plan.assets/..%2Fattachments%2Fd.svg",
      "plan.assets",
      "attachments%2Fd.svg",
    ]) {
      expect((await get(rest)).status, rest).toBe(403);
    }
  });
});
