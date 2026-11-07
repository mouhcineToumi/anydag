/**
 * What a turn asks of an agent harness, and what it hears back. Claude Code and OpenCode each
 * implement it (`claude.ts`, `opencode.ts`), and `fake.ts` is a
 * scripted one the e2e suite drives — so the runner in `live.ts` never knows which it has.
 *
 * A harness reaches the vault through **one MCP server and nothing else**: `anydag-server mcp --chat
 * <id>`, which `mcp` names. Every built-in tool, every setting file and every other MCP server of the
 * person's is switched off; how is the adapter's business.
 */

import type { Usage } from "./types";

/** How to start the chat's MCP server: a stdio command the harness spawns. */
export interface McpCommand {
  command: string;
  args: string[];
  env: Record<string, string>;
}

export interface RunOptions {
  chat: string;
  /** The model as its harness spells it: `claude-sonnet-5-5`, `opencode-go/glm-5.3-flash`. */
  model: string;
  /** Claude's `--effort`, OpenCode's `#variant`; absent for the model's own. */
  effort?: string;
  /** The system prompt: the mode, the vaults in reach, how to cite. Changes between turns. */
  system: string;
  /** The person's words — with, on a fresh session that has history, the transcript before them. */
  prompt: string;
  /**
   * The provider session to resume, or none for a new one. A harness that lets the caller pick the
   * id (Claude's `--session-id`) uses `fresh` for a new session; one that mints its own reports it.
   */
  resume?: string;
  fresh?: string;
  mcp: McpCommand;
  /** A scratch folder for this run's files (a system prompt file, an isolated config home). */
  scratch: string;
}

/** What a harness says while a turn runs, in order. */
export type HarnessEvent =
  /** Text arriving token by token (Claude), to be replaced by the `text` that closes it. */
  | { kind: "delta"; text: string }
  /** A whole run of reply text. */
  | { kind: "text"; text: string }
  /** A tool called — the whole input, once it is all there. */
  | { kind: "tool"; id: string; name: string; input: unknown }
  /** What it answered. */
  | { kind: "result"; id: string; output: string; error: boolean }
  /** The provider session this turn runs in, as soon as it is known. */
  | { kind: "session"; id: string }
  | { kind: "error"; text: string };

export interface RunEnd {
  usage?: Usage;
  /** Set when the harness failed rather than finished: the words to show. */
  error?: string;
}

export interface Running {
  /** Settles once the harness has said everything; never rejects. */
  done: Promise<RunEnd>;
  /** Stop the turn: Claude by SIGTERM, OpenCode by aborting the session. Settles `done`. */
  stop(): Promise<void>;
}

export interface Harness {
  /** The scripted harness (`fake.ts`): no binary, no login, no model. */
  fake?: boolean;
  readonly provider: "claude" | "opencode";
  run(o: RunOptions, on: (e: HarnessEvent) => void): Running;
  /** Forget a provider session (a chat deleted). Best effort. */
  forget(session: string): Promise<void>;
  /** Stop anything kept warm (OpenCode's `serve`), when the app quits. */
  close(): Promise<void>;
}

/** The tool a harness names, with its server's prefix taken off: `mcp__anydag__note_read` → `note_read`. */
export const bareTool = (name: string): string => name.replace(/^mcp__anydag__/, "").replace(/^anydag_/, "");
