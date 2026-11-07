/**
 * The MCP server: `anydag mcp` over stdio, one tool per route.
 *
 * **Nothing may write to stdout but the transport** — a stray `console.log` is a malformed JSON-RPC
 * frame to the client — so everything this process says goes to stderr.
 */

import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { Backend } from "./backend";
import { chatTools } from "./chat";
import { Picture, TOOLS, ToolError, makeKit, type Kit, type Tool } from "./tools";

export const INSTRUCTIONS =
  "AnyDag draws technical diagrams from a DSL onto an infinite canvas, kept as plain files in a vault — a folder on this machine. " +
  "A board is one Markdown file holding fenced diagrams, notes, tables and images; writing the file is how a diagram is made. " +
  "Read `dsl_reference` before writing a fence body, and `board_diagnose` after — its codes are stable and are what to branch on. " +
  "A vault also holds notes (Markdown, `note_*`), quizzes (`quiz_*`), tables (`table_*`), tasks and projects (`task_*`, `project_*`) and attachments (`file_*`). " +
  "There is no account: several vaults can be open, `vault_list` says which, and every tool takes an optional `vault` id — left out, it is the default vault. " +
  "Nothing here can see the drawing: every document tool returns a `url`, an `anydag://open?…` deep link the AnyDag app opens, and that is what a person opens.";

/** A tool's answer as MCP content: text for data, image content for a picture. */
function content(out: unknown) {
  if (out instanceof Picture) return [{ type: "image" as const, data: Buffer.from(out.data).toString("base64"), mimeType: out.mime }];
  return [{ type: "text" as const, text: JSON.stringify(out ?? null, null, 2) }];
}

/** Run one tool, turning any refusal into a tool error the model can read — never a protocol error. */
export async function runTool(tool: Tool, args: unknown, kit: Kit) {
  try {
    if (tool.write && kit.readOnly) {
      throw new ToolError(`\`${tool.name}\` changes things, and this server was started with --read-only`);
    }
    return { content: content(await tool.run(args, kit)) };
  } catch (e) {
    const text = e instanceof ToolError ? e.message : `${tool.name} failed: ${(e as Error).message}`;
    if (!(e instanceof ToolError)) console.error(`anydag mcp: ${tool.name}:`, e);
    return { content: [{ type: "text" as const, text }], isError: true };
  }
}

export interface ChatMode {
  id: string;
  mode: "ask" | "edit";
  /** The chat's own vault: what a document link names when a tool named none. */
  home?: string;
}

export function buildMcp(backend: Backend, opts: { readOnly: boolean; version?: string; chat?: ChatMode }): McpServer {
  const kit = makeKit(backend, opts.readOnly, opts.chat?.home);
  const server = new McpServer({ name: "anydag", version: opts.version ?? "dev" }, { instructions: INSTRUCTIONS });

  for (const tool of opts.chat ? chatTools(opts.chat.mode) : TOOLS) {
    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: tool.input, annotations: { readOnlyHint: !tool.write } },
      (args: unknown) => runTool(tool, args, kit),
    );
  }

  // The grammar as resources as well as a tool, for a client that can attach one without being asked.
  server.registerResource(
    "AnyDag cheat sheet",
    new ResourceTemplate("anydag://dsl/{type}", { list: undefined }),
    { mimeType: "text/markdown" },
    async (uri, { type }) => {
      const got = await kit.api("GET", "/__board/dsl", { query: { type: String(type) } });
      if (typeof got?.text !== "string" || !got.text) throw new Error(`no cheat sheet for \`${String(type)}\``);
      return { contents: [{ uri: uri.href, mimeType: "text/markdown", text: got.text }] };
    },
  );
  server.registerResource("AnyDag boards", "anydag://boards", { mimeType: "application/json" }, async (uri) => {
    const got = await kit.api("GET", "/__board/list");
    return { contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify({ boards: got.boards, folders: got.folders }, null, 2) }] };
  });
  return server;
}

/** Serve over stdio until the client goes away. */
export async function startMcp(backend: Backend, opts: { readOnly: boolean; version?: string; chat?: ChatMode }): Promise<McpServer> {
  const { StdioServerTransport } = await import("@modelcontextprotocol/sdk/server/stdio.js");
  const server = buildMcp(backend, opts);
  await server.connect(new StdioServerTransport());
  return server;
}
