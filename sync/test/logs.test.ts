import fs from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { LogStore } from "../server/routes/logs";
import { call, harness, type Harness } from "./helpers";

/**
 * `POST /v1/logs`: open, cleaned again, kept as one file a day, and dropped rather than refused when
 * a sender is over its rate.
 */

const INSTALL = "0f8fad5b-d9cb-469f-a165-70867728950e";
const env = { version: "0.1.0", shell: "browser", os: "linux", arch: "x64", locale: "en", install: INSTALL };
const batch = (events: unknown[]) => ({ v: 1, env, events });
const tidy = { name: "feature.use", at: "2026-11-06T11:59:00Z", props: { what: "tidy" } };

let h: Harness | null = null;
afterEach(async () => {
  await h?.close();
  h = null;
});

const lines = (hh: Harness, day = "2026-11-06") =>
  fs
    .readFileSync(path.join(hh.root, "logs", `${day}.jsonl`), "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l) as Record<string, unknown>);

describe("/v1/logs", () => {
  it("takes a batch with no token and keeps each event cleaned, with nothing about the request", async () => {
    h = await harness();
    const res = await call(h, "POST", "/v1/logs", {
      json: batch([tidy, { name: "feature.use", at: tidy.at, props: { what: "Secret board" } }, { name: "error", at: tidy.at, props: { where: "page", message: "no note `Diary` at /home/me/x" } }]),
      headers: { "x-forwarded-for": "203.0.113.9" },
    });
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ accepted: 2 });
    const kept = lines(h);
    expect(kept).toHaveLength(2);
    expect(kept[0]).toMatchObject({ install: INSTALL, version: "0.1.0", name: "feature.use", props: { what: "tidy" } });
    expect(kept[1]!.props).toEqual({ where: "page", message: 'no note "…" at <path>' });
    const all = JSON.stringify(kept);
    for (const leak of ["Secret", "Diary", "203.0.113.9", "/home"]) expect(all).not.toContain(leak);
  });

  it("drops what it cannot describe, and what a sender sends past its rate", async () => {
    h = await harness();
    expect(await (await call(h, "POST", "/v1/logs", { json: { v: 1, env: { ...env, install: "x" }, events: [tidy] } })).json()).toEqual({ accepted: 0 });
    expect((await call(h, "POST", "/v1/logs", { bytes: new TextEncoder().encode("{") })).status).toBe(400);
    let accepted = 0;
    for (let i = 0; i < 40; i++) accepted += ((await (await call(h, "POST", "/v1/logs", { json: batch([tidy]) })).json()) as { accepted: number }).accepted;
    /* Thirty a minute from one sender, the two refused above among them. */
    expect(accepted).toBe(28);
    h.clock.advance(60_000);
    expect(await (await call(h, "POST", "/v1/logs", { json: batch([tidy]) })).json()).toEqual({ accepted: 1 });
  });

  it("is not there when the server keeps no logs", async () => {
    h = await harness("pglite", { ANYDAG_SYNC_LOGS: "off" });
    expect((await call(h, "POST", "/v1/logs", { json: batch([tidy]) })).status).toBe(404);
  });
});

describe("LogStore", () => {
  it("removes day files older than it keeps", () => {
    const dir = fs.mkdtempSync(path.join(process.env.TMPDIR ?? "/tmp", "anydag-logs-"));
    try {
      for (const d of ["2026-09-01", "2026-10-30", "2026-11-06"]) fs.writeFileSync(path.join(dir, `${d}.jsonl`), "{}\n");
      fs.writeFileSync(path.join(dir, "notes.txt"), "kept");
      expect(new LogStore(dir, 30).prune(new Date("2026-11-07T00:00:00Z"))).toBe(1);
      expect(fs.readdirSync(dir).sort()).toEqual(["2026-10-30.jsonl", "2026-11-06.jsonl", "notes.txt"]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
