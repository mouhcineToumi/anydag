/** What Tailscale says about this machine, read off its CLI's JSON (`server/tailscale.ts`). */
import { describe, expect, it } from "vitest";

import { addressOf, servesPort, Tailscale, type Run } from "../../server/tailscale";

const STATUS = { BackendState: "Running", Self: { DNSName: "desk.tail2d3e3c.ts.net." } };
const SERVING = {
  TCP: { "443": { HTTPS: true } },
  Web: { "desk.tail2d3e3c.ts.net:443": { Handlers: { "/": { Proxy: "http://127.0.0.1:4319" } } } },
};

function fake(answers: Record<string, { ok?: boolean; out?: string; err?: string; missing?: boolean }>): Run & { calls: string[][] } {
  const calls: string[][] = [];
  const run = (async (args: string[]) => {
    calls.push(args);
    const a = answers[args.join(" ")] ?? { ok: false, err: "unknown" };
    return { ok: a.ok ?? true, out: a.out ?? "", err: a.err ?? "", missing: a.missing ?? false };
  }) as Run & { calls: string[][] };
  run.calls = calls;
  return run;
}

describe("tailscale", () => {
  it("reads the machine's address without the trailing dot", () => {
    expect(addressOf(STATUS)).toBe("https://desk.tail2d3e3c.ts.net");
    expect(addressOf({})).toBeNull();
    expect(addressOf(null)).toBeNull();
  });

  it("says the door is served only when that host's 443 proxies to its port on loopback", () => {
    expect(servesPort(SERVING, "desk.tail2d3e3c.ts.net", 4319)).toBe(true);
    expect(servesPort(SERVING, "desk.tail2d3e3c.ts.net", 4320)).toBe(false);
    expect(servesPort(SERVING, "other.tail2d3e3c.ts.net", 4319)).toBe(false);
    const elsewhere = { Web: { "desk.tail2d3e3c.ts.net:443": { Handlers: { "/": { Proxy: "http://10.0.0.5:4319" } } } } };
    expect(servesPort(elsewhere, "desk.tail2d3e3c.ts.net", 4319)).toBe(false);
    expect(servesPort({}, "desk.tail2d3e3c.ts.net", 4319)).toBe(false);
  });

  it("is not installed when there is no CLI, and asks nothing more", async () => {
    const run = fake({ "status --json": { ok: false, missing: true } });
    expect(await new Tailscale(run).state(4319)).toEqual({ installed: false, running: false, address: null, serving: null });
    expect(run.calls).toHaveLength(1);
  });

  it("is installed and not running when logged out", async () => {
    const run = fake({ "status --json": { ok: false, out: "Logged out." } });
    expect(await new Tailscale(run).state(4319)).toMatchObject({ installed: true, running: false, serving: null });
  });

  it("reports the address and whether it serves the door, and keeps the answer a few seconds", async () => {
    let t = 0;
    const run = fake({ "status --json": { out: JSON.stringify(STATUS) }, "serve status --json": { out: JSON.stringify(SERVING) } });
    const ts = new Tailscale(run, () => t);
    expect(await ts.state(4319)).toEqual({ installed: true, running: true, address: "https://desk.tail2d3e3c.ts.net", serving: true });
    await ts.state(4319);
    expect(run.calls).toHaveLength(2);
    t = 10_000;
    await ts.state(4319);
    expect(run.calls).toHaveLength(4);
  });

  it("serves the door's port, and passes Tailscale's refusal on word for word", async () => {
    const ok = fake({ "serve --bg 4319": { out: "Available within your tailnet:\n\nhttps://desk.ts.net/\n" } });
    expect(await new Tailscale(ok).serve(4319)).toEqual({ ok: true, message: "Available within your tailnet:\n\nhttps://desk.ts.net/" });
    const no = fake({ "serve --bg 4319": { ok: false, err: "Serve is not enabled on your tailnet." } });
    expect(await new Tailscale(no).serve(4319)).toEqual({ ok: false, message: "Serve is not enabled on your tailnet." });
  });
});
