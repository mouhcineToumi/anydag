import fs from "node:fs";

import { UsageError, bool, str, type Parsed } from "../args";
import { emit, table, type Command, type Ctx } from "../context";
import type { SyncDevices, SyncLinked, SyncPaired, SyncRemotes, SyncStatus } from "../../server/sync/types";

/**
 * Sync, from a terminal: the current vault's link to a sync server.
 *
 * **A passphrase is never an argument.** Argv is readable by every user of the machine (`ps`), so it
 * is typed with no echo at a terminal, or read from `--passphrase-file <path>` — `-` for stdin, read
 * only when named. The recovery code an upload makes is printed once, and kept nowhere.
 */

const PASSPHRASE_FILE = {
  name: "passphrase-file",
  type: "string" as const,
  value: "<path>",
  help: "read the passphrase (or with --recovery, the recovery code) from this file; - is stdin",
};

/** The secret a link needs: a hidden prompt, or the first line of the file named. */
async function secret(ctx: Ctx, p: Parsed, what: string, twice: boolean): Promise<string> {
  const file = str(p, "passphrase-file");
  if (file !== undefined) {
    let text: string;
    try {
      text = file === "-" ? await ctx.io.readStdin() : fs.readFileSync(file, "utf8");
    } catch (e) {
      throw new UsageError(`could not read ${file}: ${(e as Error).message}`);
    }
    const line = text.split(/\r?\n/)[0] ?? "";
    if (!line) throw new UsageError(`${file === "-" ? "stdin" : file} holds no ${what}`);
    return line;
  }
  if (!ctx.io.stdinIsTTY)
    throw new UsageError(`give the ${what} with --passphrase-file <path>, or --passphrase-file - to read it from stdin`);
  const first = await ctx.io.ask(`${what}: `, { hidden: true });
  if (!first) throw new UsageError(`no ${what} given`);
  if (twice && (await ctx.io.ask(`the ${what} again: `, { hidden: true })) !== first)
    throw new UsageError(`the two ${what}s differ — nothing was linked`);
  return first;
}

function sayStatus(ctx: Ctx, s: SyncStatus): void {
  if (!s.linked) {
    ctx.io.out(s.server ? `not linked — paired with ${s.server} as ${s.device}` : "not linked, not paired");
    return;
  }
  const rows: string[][] = [
    ["state", s.state + (s.reason ? ` — ${s.reason}` : "")],
    ["server", s.server ?? ""],
    ["remote", s.remote ?? ""],
    ["device", s.device ?? ""],
    ["pending", String(s.pending)],
    ["last", s.last ?? "never"],
  ];
  for (const line of table(rows)) ctx.io.out(line);
  for (const c of s.conflicts) ctx.io.out(`conflict  ${c}`);
}

const when = (iso: string | null): string => (iso ? iso.slice(0, 10) : "");

export const SYNC: Command[] = [
  {
    name: ["sync", "status"],
    args: "",
    summary: "whether this vault syncs, with whom, and how it is going",
    routes: ["GET /api/sync"],
    async run(ctx) {
      const s = await ctx.api.get<SyncStatus>("/api/sync");
      emit(ctx, s, () => sayStatus(ctx, s));
    },
  },
  {
    name: ["sync", "pair"],
    args: "<server> <code>",
    min: 2,
    summary: "pair this vault with a sync server, with the one-time code its admin made for you",
    flags: [
      {
        name: "device",
        type: "string",
        value: "<name>",
        help: "what this device is called on the server; the machine's name when left out",
      },
    ],
    routes: ["POST /api/sync/pair"],
    async run(ctx, p) {
      const got = await ctx.api.post<SyncPaired>("/api/sync/pair", {
        server: p.pos[0],
        code: p.pos[1],
        device: str(p, "device"),
      });
      emit(ctx, got, () =>
        ctx.io.err(`paired with ${got.server} as ${got.device}, in ${got.account}'s account — \`anydag sync link\` next`),
      );
    },
  },
  {
    name: ["sync", "remotes"],
    args: "",
    summary: "the vaults the paired account holds on the server — what a download or a merge links to",
    routes: ["GET /api/sync/remotes"],
    async run(ctx) {
      const got = await ctx.api.get<SyncRemotes>("/api/sync/remotes");
      emit(ctx, got, () => {
        if (!got.remotes.length)
          return ctx.io.err("the account holds no vault yet — `anydag sync link --upload` makes one of this vault");
        const rows = got.remotes.map((r) => [
          r.id,
          `${r.seq} change${r.seq === 1 ? "" : "s"}`,
          when(r.created),
          r.keyed ? (r.mine ? "this vault" : "") : "unfinished upload",
        ]);
        for (const line of table(rows)) ctx.io.out(line);
      });
    },
  },
  {
    name: ["sync", "link"],
    args: "",
    summary: "link this vault: --upload it as a new remote, --download <remote> into it, or --merge <remote> with it",
    help:
      "--upload makes a new remote vault of this one under a passphrase, pushes every file, and prints a recovery code — once. " +
      "--download <remote> needs an empty vault and adopts the remote's id; --merge <remote> keeps what is here, and anything that differs becomes a conflict copy. " +
      "Both open the key with the passphrase, or with --recovery, the recovery code. The secret is typed with no echo, or read from --passphrase-file.",
    flags: [
      { name: "upload", type: "boolean", help: "a new remote vault of this one" },
      { name: "download", type: "string", value: "<remote>", help: "an empty vault takes this remote's files and id" },
      { name: "merge", type: "string", value: "<remote>", help: "this vault's files and this remote's, together" },
      { name: "recovery", type: "boolean", help: "open the key with the recovery code rather than the passphrase" },
      PASSPHRASE_FILE,
    ],
    routes: ["POST /api/sync/link"],
    async run(ctx, p) {
      const upload = bool(p, "upload");
      const download = str(p, "download");
      const merge = str(p, "merge");
      if ([upload, download !== undefined, merge !== undefined].filter(Boolean).length !== 1)
        throw new UsageError("give one of --upload, --download <remote> or --merge <remote>");
      if (upload) {
        if (bool(p, "recovery"))
          throw new UsageError("an upload makes the recovery code: --recovery is for --download and --merge");
        const passphrase = await secret(ctx, p, "passphrase", true);
        const got = await ctx.api.post<SyncLinked>("/api/sync/link", { mode: "upload", passphrase });
        emit(ctx, got, () => {
          ctx.io.err(`uploaded as ${got.vault}. The recovery code below is shown this once and kept nowhere — write it down:`);
          ctx.io.out(got.recovery ?? "");
        });
        return;
      }
      const remote = (download ?? merge)!;
      const word = bool(p, "recovery") ? "recovery code" : "passphrase";
      const said = await secret(ctx, p, word, false);
      const got = await ctx.api.post<SyncLinked>("/api/sync/link", {
        mode: download !== undefined ? "download" : "merge",
        remote,
        ...(word === "passphrase" ? { passphrase: said } : { recovery: said }),
      });
      emit(ctx, got, () => {
        ctx.io.err(`linked to ${remote}${got.vault !== ctx.vault ? ` — this vault is ${got.vault} now` : ""}`);
        sayStatus(ctx, got.status);
      });
    },
  },
  {
    name: ["sync", "unlink"],
    args: "",
    summary:
      "stop syncing this vault — its files stay, and so does the remote; the device token and the key kept here are forgotten",
    routes: ["POST /api/sync/unlink"],
    async run(ctx) {
      const s = await ctx.api.post<SyncStatus>("/api/sync/unlink");
      emit(ctx, s, () => ctx.io.err("unlinked — every file is still here, and the remote is still on the server"));
    },
  },
  {
    name: ["sync", "now"],
    args: "",
    summary: "pull and push now, and say how it went",
    routes: ["POST /api/sync/now"],
    async run(ctx) {
      const s = await ctx.api.post<SyncStatus>("/api/sync/now");
      emit(ctx, s, () => sayStatus(ctx, s));
      return s.state === "idle" ? 0 : 1;
    },
  },
  {
    name: ["sync", "devices"],
    args: "",
    summary: "the devices paired into the account, this one marked",
    routes: ["GET /api/sync/devices"],
    async run(ctx) {
      const got = await ctx.api.get<SyncDevices>("/api/sync/devices");
      emit(ctx, got, () => {
        const rows = got.devices.map((d) => [
          d.id,
          d.name,
          d.platform,
          d.revoked ? `revoked ${when(d.revoked)}` : d.seen ? `seen ${when(d.seen)}` : "",
          d.me ? "this device" : "",
        ]);
        for (const line of table(rows)) ctx.io.out(line);
      });
    },
  },
  {
    name: ["sync", "devices", "revoke"],
    args: "<id>",
    min: 1,
    summary: "sign a device out of the account — it can no longer sync, and its files stay where they are",
    routes: ["POST /api/sync/devices/revoke"],
    async run(ctx, p) {
      const got = await ctx.api.post<SyncDevices>("/api/sync/devices/revoke", { id: p.pos[0] });
      emit(ctx, got, () => ctx.io.err(`signed ${p.pos[0]} out`));
    },
  },
];
