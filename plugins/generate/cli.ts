/**
 * What every run of a coding agent's CLI needs, whoever runs it: a prompt card's one answer
 * (`llm.ts`) or a chat's turn (`server/chat/claude.ts`, `server/chat/opencode.ts`, `server/chat/codex.ts`). Finding the
 * binary, the environment it runs in and whether it is signed in are `providers.ts`'s; this is the
 * part around the child — reading its lines, ending it, and taking an OpenCode or Codex session out
 * of the person's history afterwards. Plain Node, no `@/` aliases: the server bundles it.
 */

import { spawn as nodeSpawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";

import { codexEnv, opencodeEnv, type Env } from "./providers";

/** How long a SIGTERM may take before it is a SIGKILL. A Claude Code run took three seconds. */
export const KILL_AFTER_MS = 5_000;

/** Whole lines out of chunks that cut them anywhere, multi-byte characters included; blank lines dropped. */
export function lines(onLine: (line: string) => void): { push(chunk: Buffer | string): void; flush(): void } {
  const decoder = new StringDecoder("utf8");
  let rest = "";
  const take = (text: string) => {
    rest += text;
    let i: number;
    while ((i = rest.indexOf("\n")) >= 0) {
      const line = rest.slice(0, i).trim();
      rest = rest.slice(i + 1);
      if (line) onLine(line);
    }
  };
  return {
    push: (chunk) => take(typeof chunk === "string" ? chunk : decoder.write(chunk)),
    flush: () => {
      take(decoder.end());
      if (rest.trim()) onLine(rest.trim());
      rest = "";
    },
  };
}

/** The last three lines of what a child said, for the sentence that says why it failed. */
export const tail = (text: string, n = 400): string => text.trim().split("\n").slice(-3).join(" ").slice(-n);

/** Whether a child is still running. */
export const running = (child: ChildProcess): boolean => child.exitCode === null && child.signalCode === null;

/**
 * SIGTERM, then SIGKILL if it is still there `after` ms later. Returns the timer, for a caller that
 * clears it once the child has closed; it never holds the process open on its own.
 */
export function terminate(child: ChildProcess, after = KILL_AFTER_MS): ReturnType<typeof setTimeout> {
  child.kill("SIGTERM");
  const killer = setTimeout(() => child.kill("SIGKILL"), after);
  killer.unref?.();
  return killer;
}

/**
 * `opencode session delete <id>`, best effort: a `--standalone` run still writes its session into the
 * person's OpenCode history. Run on an empty config of its own (`XDG_CONFIG_HOME` in a throwaway
 * folder), so the person's MCP servers and plugins are not started to delete one row, and never for
 * longer than `timeout`. A session left behind is the person's, and harmless.
 */
export async function forgetOpencode(
  bin: string,
  session: string,
  env: Env,
  o: { spawnImpl?: typeof nodeSpawn; tmpRoot?: string; timeout?: number } = {},
): Promise<void> {
  if (!/^ses_\w+$/.test(session)) return;
  const spawn = o.spawnImpl ?? nodeSpawn;
  let dir: string | undefined;
  try {
    dir = fs.mkdtempSync(path.join(o.tmpRoot ?? os.tmpdir(), "dag-opencode-forget-"));
    const childEnv = { ...opencodeEnv(env), XDG_CONFIG_HOME: dir } as NodeJS.ProcessEnv;
    const child = spawn(bin, ["session", "delete", "--standalone", session], { cwd: dir, env: childEnv, stdio: "ignore" });
    const timer = setTimeout(() => child.kill("SIGKILL"), o.timeout ?? 15_000);
    await new Promise<void>((resolve) => {
      child.once("close", () => resolve());
      child.once("error", () => resolve());
    });
    clearTimeout(timer);
  } catch {
    /* best effort */
  } finally {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * `codex delete --force <id>`, best effort: a chat's turns are Codex sessions under `~/.codex/sessions`,
 * listed in the person's `codex resume`, and a deleted chat takes them with it. `--force` because
 * without a terminal Codex refuses to ask; only a UUID is passed, because `delete` also takes a
 * session's *name* and a name is not ours to guess at.
 */
export async function forgetCodex(
  bin: string,
  session: string,
  env: Env,
  o: { spawnImpl?: typeof nodeSpawn; timeout?: number } = {},
): Promise<void> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(session)) return;
  const spawn = o.spawnImpl ?? nodeSpawn;
  try {
    const child = spawn(bin, ["delete", "--force", session], {
      cwd: os.tmpdir(),
      env: codexEnv(env) as NodeJS.ProcessEnv,
      stdio: "ignore",
    });
    const timer = setTimeout(() => child.kill("SIGKILL"), o.timeout ?? 15_000);
    await new Promise<void>((resolve) => {
      child.once("close", () => resolve());
      child.once("error", () => resolve());
    });
    clearTimeout(timer);
  } catch {
    /* best effort: a session left behind is the person's, and harmless */
  }
}
