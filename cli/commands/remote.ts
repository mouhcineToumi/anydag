import { UsageError, str, type Parsed } from "../args";
import { emit, table, type Command, type Ctx } from "../context";
import type { Device, PairCode, RemoteStatus } from "../../server/remote";
import type { TailscaleState } from "../../server/tailscale";

/**
 * Remote access, from a terminal: the second door a paired phone reaches (`server/remote.ts`).
 *
 * These are the desktop's own routes — the remote door refuses every one of them — so a phone can
 * never pair another phone or switch remote access off. A pairing code is printed once.
 */

function tailscaleLine(t: TailscaleState, port: number): string {
  if (!t.installed) return "not installed — https://tailscale.com/download, or set an address of your own";
  if (!t.running) return "installed, not connected — `tailscale up`";
  if (t.serving) return `serving ${t.address} to the door`;
  return `${t.address}, not passed to the door — \`anydag remote serve\` (tailscale serve --bg ${port})`;
}

function sayStatus(ctx: Ctx, s: RemoteStatus, t?: TailscaleState): void {
  const state = !s.enabled ? "off" : s.listening ? "on" : `on, not answering${s.problem ? ` — ${s.problem}` : ""}`;
  for (const line of table([
    ["remote access", state],
    ["listens on", `127.0.0.1:${s.port}`],
    ["address", s.url ?? "not set — `anydag remote on --url https://<this machine>.<tailnet>.ts.net`"],
    ...(t ? [["tailscale", tailscaleLine(t, s.port)]] : []),
  ]))
    ctx.io.out(line);
}

const PORT = { name: "port", type: "string" as const, value: "<n>", help: "the port the remote door listens on, 1024–65535; 4319 when left out" };
const URL_FLAG = { name: "url", type: "string" as const, value: "<https://…>", help: "the address a phone opens — the one `tailscale serve` gives this machine" };

function patchOf(p: Parsed): { port?: number; url?: string } {
  const out: { port?: number; url?: string } = {};
  const port = str(p, "port");
  if (port !== undefined) {
    const n = Number(port);
    if (!Number.isInteger(n)) throw new UsageError(`\`${port}\` is not a port`);
    out.port = n;
  }
  const url = str(p, "url");
  if (url !== undefined) out.url = url;
  return out;
}

export const REMOTE: Command[] = [
  {
    name: ["remote", "status"],
    args: "",
    summary: "whether a paired phone can reach this desktop, on which port and at which address",
    help:
      "Remote access is a second door onto the running app, for a phone: it listens on 127.0.0.1 and a proxy " +
      "that holds the certificate — `tailscale serve --bg <port>` — is what the phone reaches. It needs the app running.",
    routes: ["GET /api/remote", "GET /api/remote/tailscale"],
    async run(ctx) {
      const s = await ctx.api.get<RemoteStatus>("/api/remote");
      const tailscale = await ctx.api.get<TailscaleState>("/api/remote/tailscale");
      emit(ctx, { ...s, tailscale }, () => sayStatus(ctx, s, tailscale));
    },
  },
  {
    name: ["remote", "on"],
    args: "",
    summary: "open the remote door, optionally saying its port and the address a phone opens",
    help: "With no `--url` and none set yet, the address is this machine's on its tailnet, when Tailscale is connected.",
    flags: [PORT, URL_FLAG],
    routes: ["PUT /api/remote", "GET /api/remote/tailscale"],
    async run(ctx, p) {
      const patch = patchOf(p);
      let s = await ctx.api.put<RemoteStatus>("/api/remote", { enabled: true, ...patch });
      const tailscale = await ctx.api.get<TailscaleState>("/api/remote/tailscale");
      if (!s.url && tailscale.address) s = await ctx.api.put<RemoteStatus>("/api/remote", { url: tailscale.address });
      emit(ctx, { ...s, tailscale }, () => {
        sayStatus(ctx, s, tailscale);
        ctx.io.err(tailscale.serving ? "then: `anydag remote pair`" : `then: \`anydag remote serve\` (tailscale serve --bg ${s.port}), and \`anydag remote pair\``);
      });
    },
  },
  {
    name: ["remote", "off"],
    args: "",
    summary: "close the remote door: every paired device is cut off until it is opened again",
    routes: ["PUT /api/remote"],
    async run(ctx) {
      const s = await ctx.api.put<RemoteStatus>("/api/remote", { enabled: false });
      emit(ctx, s, () => sayStatus(ctx, s));
    },
  },
  {
    name: ["remote", "serve"],
    args: "",
    summary: "have Tailscale pass this machine's tailnet address to the remote door — `tailscale serve --bg <port>`",
    help: "Tailscale holds the certificate and the door stays on 127.0.0.1. When Tailscale refuses — HTTPS off for the tailnet, or this user not its operator — its own words are printed.",
    routes: ["POST /api/remote/tailscale/serve"],
    async run(ctx) {
      const got = await ctx.api.post<{ ok: boolean; message: string }>("/api/remote/tailscale/serve", {});
      emit(ctx, got, () => (got.ok ? ctx.io.err(got.message || "serving") : ctx.io.err(got.message)));
      return got.ok ? 0 : 1;
    },
  },
  {
    name: ["remote", "pair"],
    args: "",
    summary: "a one-time code a phone pairs with, good for five minutes — the person's to hand over, never an agent's",
    routes: ["POST /api/remote/pair"],
    async run(ctx) {
      const got = await ctx.api.post<PairCode>("/api/remote/pair", {});
      emit(ctx, got, () => {
        ctx.io.out(got.link ?? got.code);
        ctx.io.err(
          got.link
            ? `open that on the phone, or scan it from Settings → Devices; it works once, until ${got.expires.slice(11, 16)} UTC`
            : "no address is set, so this is the bare code: `anydag remote on --url https://…` gives a link to open",
        );
      });
    },
  },
  {
    name: ["remote", "devices"],
    args: "",
    summary: "the devices paired with this desktop, and when each was last seen",
    routes: ["GET /api/remote/devices"],
    async run(ctx) {
      const { devices } = await ctx.api.get<{ devices: Device[] }>("/api/remote/devices");
      emit(ctx, { devices }, () => {
        if (devices.length === 0) return ctx.io.err("no paired devices");
        for (const line of table(devices.map((d) => [d.id, d.name, `seen ${d.seen.slice(0, 16).replace("T", " ")}`]))) ctx.io.out(line);
      });
    },
  },
  {
    name: ["remote", "revoke"],
    args: "<id>",
    min: 1,
    summary: "unpair a device: it is cut off at once, and pairs again only with a new code",
    routes: ["POST /api/remote/devices/revoke"],
    async run(ctx, p) {
      const got = await ctx.api.post<{ revoked: boolean }>("/api/remote/devices/revoke", { id: p.pos[0] });
      emit(ctx, got, () => ctx.io.err(got.revoked ? "revoked" : `no device \`${p.pos[0]}\``));
      return got.revoked ? 0 : 1;
    },
  },
];
