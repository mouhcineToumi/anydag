/**
 * OpenCode as the Assistant's harness.
 *
 * One `opencode serve` per chat in use, and one `opencode run --server` client per turn. `serve`
 * starts its MCP servers once, with the config it was started with, so the chat id has to be in that
 * config; a client cannot teach it another. Three things only a run found, each against OpenCode
 * 2.2.5:
 *
 * - **The agent's `{file:…}` prompt is read once, when the config loads.** Rewriting `system.md`
 *   under a running `serve` changed nothing, in a fresh session either. The system prompt carries the
 *   mode and the vault scope, so it changes between turns, and a `serve` is therefore keyed by the
 *   prompt it started with: a turn with another one stops it and starts a new one (a session lives in
 *   OpenCode's database, not in the process, so `--session` still resumes). Mode flips are rare.
 * - **`GET /api/mcp` says when the MCP server is attached** — `data` is empty for the first second or
 *   two, then `anydag … connected` — which makes the race observable. The adapter waits for it,
 *   then sends the throwaway prompt all the same.
 * - **A cancel is `POST /api/session/<id>/interrupt`**, with basic auth as `opencode:<password>`.
 *
 * The serve's own files (its config home, its working folder) live in a folder of its own and not in
 * the run's `scratch`, which the caller may remove when the run ends while the serve lives on.
 *
 * The stream is `parseOpencodeLine`'s: `step_start`, `tool_use` (once the call has finished),
 * `text` (whole), `step_finish` (with tokens) and `error`.
 */

import { spawn as nodeSpawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { forgetOpencode, lines, tail, terminate } from "../../plugins/generate/cli";
import { findOpencode, opencodeEnv } from "../../plugins/generate/providers";
import { opencodeModel } from "../../plugins/generate/llm";
import {
  bareTool,
  type Harness,
  type HarnessEvent,
  type McpCommand,
  type RunEnd,
  type RunOptions,
  type Running,
} from "./harness";
import type { Usage } from "./types";

const AGENT = "dag-assistant";
/** `timeout` of the MCP server, above chat mode's five-minute approval. */
const MCP_TIMEOUT_MS = 600_000;
const START_TIMEOUT_MS = 20_000;
const ATTACH_TIMEOUT_MS = 20_000;
const WARM_TIMEOUT_MS = 60_000;
/** How long a client may outlive its session's interrupt before it is sent SIGTERM too. */
const INTERRUPT_GRACE_MS = 3_000;
const DEFAULT_IDLE_MS = 10 * 60_000;

/** `OPENCODE_CONFIG_CONTENT`: the one MCP server, and an agent that may call it and nothing else. */
export function opencodeRunConfig(mcp: McpCommand, systemFile: string): object {
  return {
    autoupdate: false,
    mcp: {
      anydag: {
        type: "local",
        command: [mcp.command, ...mcp.args],
        environment: mcp.env,
        /* Without this OpenCode 2 hides every MCP tool behind a JavaScript `execute`, the
           `anydag_*` permission matches nothing, and the model gets a shell. */
        codemode: false,
        timeout: MCP_TIMEOUT_MS,
        enabled: true,
      },
    },
    agent: {
      [AGENT]: {
        mode: "primary",
        prompt: `{file:${systemFile}}`,
        /* Last match wins, so `*` goes first; `skill` is not covered by it and is denied by name. */
        permission: { "*": "deny", skill: "deny", "anydag_*": "allow" },
      },
    },
  };
}

/** The flags of one turn's client. There is no `--variant` and no `--dir` in OpenCode 2: the effort is `#variant`. */
export function opencodeRunArgs(o: { url: string; model: string; effort?: string; resume?: string; title?: string }): string[] {
  return [
    "run",
    "--server",
    o.url,
    "-m",
    opencodeModel(o.model, o.effort),
    "--agent",
    AGENT,
    "--format",
    "json",
    ...(o.title ? ["--title", o.title] : []),
    ...(o.resume ? ["--session", o.resume] : []),
  ];
}

/** What the lines so far have said that is not an event. */
export interface OpencodeState {
  session?: string;
  /** Set by the first `step_finish`; tokens add up across every one of them. */
  usage?: Usage;
  error?: string;
  /** The first step of the turn: which tools it called, and whether it has ended. */
  first: { tools: string[]; finished: boolean };
}

export const newOpencodeState = (): OpencodeState => ({ first: { tools: [], finished: false } });

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | undefined => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : undefined);
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);

/** An `error` event's words: 2.2.5 sends `error.message`, older ones `error.data.message`. */
function errorText(e: unknown): string {
  const o = obj(e);
  return (
    str(o?.message) ?? str(obj(o?.data)?.message) ?? str(o?.name) ?? (e === undefined ? "OpenCode failed" : JSON.stringify(e))
  );
}

function addUsage(st: OpencodeState, part: Obj) {
  const t = obj(part.tokens) ?? {};
  const cache = obj(t.cache) ?? {};
  const u = (st.usage ??= { input: 0, output: 0, cached: 0, cost: 0 });
  u.input = (u.input ?? 0) + num(t.input) + num(cache.write);
  /* Reasoning is billed as output and OpenCode counts it apart. */
  u.output = (u.output ?? 0) + num(t.output) + num(t.reasoning);
  u.cached = (u.cached ?? 0) + num(cache.read);
  u.cost = (u.cost ?? 0) + num(part.cost);
}

/** One line of `opencode run --format json`, as the events it means. A line that is not JSON is nothing. */
export function parseOpencodeLine(line: string, st: OpencodeState): HarnessEvent[] {
  let d: Obj | undefined;
  try {
    d = obj(JSON.parse(line));
  } catch {
    return [];
  }
  if (!d) return [];
  const out: HarnessEvent[] = [];
  const sid = str(d.sessionID);
  if (sid && !st.session) {
    st.session = sid;
    out.push({ kind: "session", id: sid });
  }
  const part = obj(d.part) ?? {};
  switch (d.type) {
    case "tool_use": {
      const state = obj(part.state) ?? {};
      const status = state.status;
      if ((status !== "completed" && status !== "error") || typeof part.tool !== "string") break;
      const id = str(part.id) ?? str(part.partID) ?? `${part.tool}-${out.length}`;
      if (!st.first.finished) st.first.tools.push(part.tool);
      out.push({ kind: "tool", id, name: bareTool(part.tool), input: state.input ?? {} });
      const output = typeof state.output === "string" ? state.output : (str(state.error) ?? "");
      out.push({ kind: "result", id, output, error: status === "error" });
      break;
    }
    case "text":
      if (str(part.text)) out.push({ kind: "text", text: part.text as string });
      break;
    case "step_finish":
      addUsage(st, part);
      st.first.finished = true;
      break;
    case "error":
      st.error = errorText(d.error);
      out.push({ kind: "error", text: st.error });
      break;
  }
  return out;
}

/**
 * Whether a turn's first step found no vault tools to call: the model reached for `skill`, the one
 * tool a run that started before the MCP server attached is left with. Nothing else in the stream
 * says what was offered, so a model that simply answered "I have no tools" in words is not caught.
 */
export const offeredNoTools = (st: OpencodeState): boolean =>
  st.first.tools.includes("skill") && !st.first.tools.some((t) => t.startsWith("anydag_"));

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const sha = (...parts: string[]): string => createHash("sha1").update(parts.join("\0")).digest("hex");

/** A `serve`, once it is up. */
interface Serve {
  chat: string;
  /** The system prompt and MCP command it was started with: another turn with different ones needs another. */
  key: string;
  child: ChildProcess;
  url: string;
  password: string;
  dir: string;
  xdg: string;
  cwd: string;
  busy: number;
  idle?: ReturnType<typeof setTimeout>;
  exited: Promise<void>;
}

export interface OpencodeOptions {
  /** `opencode`, found where `findOpencode` looks — `ANYDAG_OPENCODE_BIN`, the `PATH`, the installers' places — unless told. */
  bin?: string;
  env?: NodeJS.ProcessEnv;
  spawnImpl?: typeof nodeSpawn;
  /** How long a chat's `serve` may sit unused before it is stopped. */
  idleMs?: number;
  /** Where a serve's own folder goes; the OS temp dir unless a test says otherwise. */
  tmpRoot?: string;
  /** For tests: fetch. */
  fetchImpl?: typeof fetch;
}

export function opencodeHarness(o: OpencodeOptions = {}): Harness {
  const spawn = o.spawnImpl ?? nodeSpawn;
  const doFetch = o.fetchImpl ?? fetch;
  const idleMs = o.idleMs ?? DEFAULT_IDLE_MS;
  const baseEnv = (): NodeJS.ProcessEnv => o.env ?? process.env;
  const binFor = (env: NodeJS.ProcessEnv): string => {
    if (o.bin) return o.bin;
    const found = findOpencode(env);
    return found.ok ? found.bin : "opencode";
  };

  const serves = new Map<string, Serve>();
  const gates = new Map<string, Promise<unknown>>();

  /* ---- the serve's HTTP API ---- */

  async function api(s: Serve, method: string, route: string): Promise<Response> {
    const auth = Buffer.from(`opencode:${s.password}`).toString("base64");
    return doFetch(`${s.url}${route}`, {
      method,
      headers: { Authorization: `Basic ${auth}` },
      signal: AbortSignal.timeout(5_000),
    });
  }

  const interrupt = (s: Serve, session: string) => api(s, "POST", `/api/session/${encodeURIComponent(session)}/interrupt`);

  /** Wait until `anydag` shows as connected on `GET /api/mcp`, or give up quietly: the warm-up and the retry are the net. */
  async function untilAttached(s: Serve): Promise<void> {
    const until = Date.now() + ATTACH_TIMEOUT_MS;
    while (Date.now() < until && s.child.exitCode === null) {
      try {
        const body = (await (await api(s, "GET", "/api/mcp")).json()) as {
          data?: { name?: string; status?: { status?: string } }[];
        };
        if (body.data?.some((m) => m.name === "anydag" && m.status?.status === "connected")) return;
      } catch {
        /* not answering yet */
      }
      await sleep(200);
    }
  }

  /* ---- starting and stopping a serve ---- */

  function startServe(r: RunOptions, key: string): Promise<Serve> {
    const dir = fs.mkdtempSync(path.join(o.tmpRoot ?? os.tmpdir(), "dag-opencode-"));
    const xdg = path.join(dir, "xdg-config");
    const cwd = path.join(dir, "cwd");
    fs.mkdirSync(xdg);
    fs.mkdirSync(cwd);
    const system = path.join(dir, "system.md");
    fs.writeFileSync(system, r.system);
    const env = {
      ...opencodeEnv(baseEnv()),
      XDG_CONFIG_HOME: xdg,
      OPENCODE_CONFIG_CONTENT: JSON.stringify(opencodeRunConfig(r.mcp, system)),
    } as NodeJS.ProcessEnv;
    const child = spawn(binFor(env), ["serve", "--port", "0", "--hostname", "127.0.0.1"], {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const exited = new Promise<void>((resolve) => child.once("close", () => resolve()));
    const clean = () => fs.rmSync(dir, { recursive: true, force: true });

    return new Promise<Serve>((resolve, reject) => {
      let out = "";
      let settled = false;
      const fail = (why: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        child.kill("SIGKILL");
        void exited.then(clean);
        reject(new Error(why));
      };
      const timer = setTimeout(
        () => fail(`OpenCode did not start in ${START_TIMEOUT_MS / 1000} s: ${tail(out)}`),
        START_TIMEOUT_MS,
      );
      const heard = (b: Buffer | string) => {
        out += b.toString();
        const url = /server listening on (http:\/\/\S+)/.exec(out)?.[1];
        const password = /server password (\S+)/.exec(out)?.[1];
        if (settled || !url || !password) return;
        settled = true;
        clearTimeout(timer);
        const s: Serve = { chat: r.chat, key, child, url, password, dir, xdg, cwd, busy: 0, exited };
        void exited.then(() => {
          clearTimeout(s.idle);
          if (serves.get(r.chat) === s) serves.delete(r.chat);
          clean();
        });
        resolve(s);
      };
      child.stdout?.on("data", heard);
      child.stderr?.on("data", heard);
      child.on("error", (e) => fail(`could not start OpenCode: ${e.message}`));
      child.once("close", (code) => fail(`opencode serve exited ${code}: ${tail(out)}`));
    });
  }

  async function stopServe(s: Serve): Promise<void> {
    clearTimeout(s.idle);
    if (serves.get(s.chat) === s) serves.delete(s.chat);
    if (s.child.exitCode === null && s.child.signalCode === null) {
      const killer = terminate(s.child);
      await s.exited;
      clearTimeout(killer);
    }
  }

  function armIdle(s: Serve) {
    clearTimeout(s.idle);
    s.idle = setTimeout(() => (s.busy > 0 ? armIdle(s) : void stopServe(s)), idleMs);
    s.idle.unref?.();
  }

  /** Spawn a client of `s`; the events go to `onLine` and it settles with the exit and what stderr said. */
  function client(s: Serve, r: RunOptions, args: string[], prompt: string, onLine: (line: string) => void) {
    fs.mkdirSync(r.scratch, { recursive: true });
    const env = { ...opencodeEnv(baseEnv()), XDG_CONFIG_HOME: s.xdg, OPENCODE_PASSWORD: s.password } as NodeJS.ProcessEnv;
    const child = spawn(binFor(env), args, { cwd: r.scratch, env, stdio: ["pipe", "pipe", "pipe"] });
    const reader = lines(onLine);
    let stderr = "";
    const closed = new Promise<{ code: number | null; stderr: string }>((resolve) => {
      child.stdout?.on("data", (b: Buffer | string) => reader.push(b));
      child.stderr?.on("data", (b: Buffer | string) => (stderr += b.toString()));
      child.on("error", (e) => resolve({ code: -1, stderr: `could not start OpenCode: ${e.message}` }));
      child.on("close", (code) => {
        reader.flush();
        resolve({ code, stderr });
      });
    });
    /* The prompt goes in on stdin: its size and a leading dash are nobody's problem. */
    child.stdin?.on("error", () => undefined);
    child.stdin?.end(prompt);
    return { child, closed };
  }

  /** The throwaway prompt that settles a fresh serve's first request, and the session it left, deleted. */
  async function warm(s: Serve, r: RunOptions): Promise<void> {
    let session: string | undefined;
    const args = opencodeRunArgs({ url: s.url, model: r.model, effort: r.effort, title: "dag-warm" });
    const c = client(s, r, args, "Reply with OK.", (line) => {
      session ??= /"sessionID":"(ses_[^"]+)"/.exec(line)?.[1];
    });
    const timer = setTimeout(() => c.child.kill("SIGKILL"), WARM_TIMEOUT_MS);
    await c.closed;
    clearTimeout(timer);
    if (session) await api(s, "DELETE", `/api/session/${encodeURIComponent(session)}`).catch(() => undefined);
  }

  /** This chat's serve: reused if it started with this system prompt, replaced if not, started and warmed if none. */
  function serveFor(r: RunOptions): Promise<Serve> {
    const key = sha(r.system, JSON.stringify(r.mcp));
    const next = (gates.get(r.chat) ?? Promise.resolve()).then(async () => {
      const have = serves.get(r.chat);
      if (have && have.key === key && have.child.exitCode === null) {
        clearTimeout(have.idle);
        have.busy++;
        return have;
      }
      if (have) await stopServe(have);
      const s = await startServe(r, key);
      serves.set(r.chat, s);
      s.busy++;
      await untilAttached(s);
      await warm(s, r);
      return s;
    });
    gates.set(
      r.chat,
      next.catch(() => undefined),
    );
    return next;
  }

  /* ---- a turn ---- */

  interface Attempt {
    end: RunEnd;
    retry: boolean;
    /** The session a dropped attempt made, to be deleted. */
    session?: string;
  }

  /** One client run. The first step is held back until it ends, so a run that found no tools can be dropped unseen. */
  function attempt(
    s: Serve,
    r: RunOptions,
    on: (e: HarnessEvent) => void,
    canRetry: boolean,
    stopping: { value: boolean },
    current: { stop?: () => Promise<void> },
  ): Promise<Attempt> {
    const st = newOpencodeState();
    let held: HarnessEvent[] | null = canRetry ? [] : null;
    let dropped = false;
    /* The session goes out at once — a stop needs it known, and a dropped attempt's is replaced by the
       retry's own `session` event, which is the last the caller hears. Everything else waits. */
    const emit = (e: HarnessEvent) => (held && e.kind !== "session" ? held.push(e) : on(e));
    const args = opencodeRunArgs({ url: s.url, model: r.model, effort: r.effort, resume: r.resume });
    const c = client(s, r, args, r.prompt, (line) => {
      if (dropped) return;
      for (const e of parseOpencodeLine(line, st)) {
        /* What an interrupt makes the client report (a reset connection) is the person's stop, not a failure. */
        if (stopping.value && e.kind === "error") continue;
        emit(e);
      }
      if (held && st.first.finished) {
        if (offeredNoTools(st)) {
          dropped = true;
          held = null;
          void stopClient();
        } else {
          for (const e of held) on(e);
          held = null;
        }
      }
    });

    let exited = false;
    void c.closed.then(() => (exited = true));
    /* Abort the session, never SIGTERM the client first: killing the client left the tool running to
       completion on the server. SIGTERM only if there is no session yet, or the interrupt did not end it. */
    async function stopClient(): Promise<void> {
      if (exited) return;
      const session = st.session ?? r.resume;
      if (session) {
        await interrupt(s, session).catch(() => undefined);
        const grace = setTimeout(() => c.child.kill("SIGTERM"), INTERRUPT_GRACE_MS);
        grace.unref?.();
        await c.closed;
        clearTimeout(grace);
      } else {
        const killer = terminate(c.child);
        await c.closed;
        clearTimeout(killer);
      }
    }
    current.stop = stopClient;

    return c.closed.then(({ code, stderr }) => {
      if (dropped) return { end: {}, retry: true, session: st.session };
      if (held) for (const e of held) on(e);
      const usage = st.usage;
      if (stopping.value) return { end: { usage }, retry: false };
      if (st.error) return { end: { usage, error: st.error }, retry: false };
      if (code !== 0) {
        const why = `OpenCode exited ${code}${stderr.trim() ? `: ${tail(stderr)}` : ""}`;
        on({ kind: "error", text: why });
        return { end: { usage, error: why }, retry: false };
      }
      return { end: { usage }, retry: false };
    });
  }

  function run(r: RunOptions, on: (e: HarnessEvent) => void): Running {
    const stopping = { value: false };
    const current: { stop?: () => Promise<void> } = {};
    let leased: Serve | undefined;

    const done = (async (): Promise<RunEnd> => {
      try {
        leased = await serveFor(r);
        if (stopping.value) return {};
        for (let n = 0; ; n++) {
          const res = await attempt(leased, r, on, n === 0, stopping, current);
          if (!res.retry || stopping.value) return res.end;
          /* The abandoned attempt's session: a fresh one is the retry's to make again, so this one goes. */
          if (res.session && !r.resume)
            await api(leased, "DELETE", `/api/session/${encodeURIComponent(res.session)}`).catch(() => undefined);
        }
      } catch (e) {
        const text = e instanceof Error ? e.message : String(e);
        on({ kind: "error", text });
        return { error: text };
      } finally {
        if (leased) {
          leased.busy--;
          armIdle(leased);
        }
      }
    })();

    return {
      done,
      async stop() {
        stopping.value = true;
        await current.stop?.();
        await done;
      },
    };
  }

  /** `opencode session delete`, on a private server with an empty config: it is in the person's database, not a serve's. */
  async function forget(session: string): Promise<void> {
    await forgetOpencode(binFor(opencodeEnv(baseEnv())), session, baseEnv(), { spawnImpl: spawn, tmpRoot: o.tmpRoot });
  }

  async function close(): Promise<void> {
    await Promise.all([...serves.values()].map(stopServe));
  }

  return { provider: "opencode", run, forget, close };
}
