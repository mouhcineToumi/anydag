import { Check, Copy } from "lucide-react";
import { useEffect, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";

import { currentOf } from "@/vault/api";
import { desktop } from "@/vault/desktop";
import { useVaults } from "@/vault/useVaults";
import { Switch } from "@/ui/controls";

import { Field, Group, Hint, ICON, copyText } from "./common";

/** The clients a person can copy a line for. "Other" is every MCP client that takes a command. */
const CLIENTS = [
  { id: "claude-code", label: "Claude Code" },
  { id: "claude-desktop", label: "Claude Desktop" },
  { id: "other", label: "Other client" },
] as const;

type Client = (typeof CLIENTS)[number]["id"];

/**
 * Connecting an agent: the line that makes Claude Code, Claude Desktop or another MCP client talk to
 * this vault. The MCP server is a program the client starts (`anydag mcp`, over stdio), not an
 * address, and it reaches the running app when there is one — so what it edits is what is open here.
 *
 * **Read only is the server's own flag**, `--read-only` (`server/main.ts`), which drops every tool
 * that writes. The switch changes the command shown; it is not a preference, and nothing is stored.
 */
export function AgentAccessPane() {
  const here = currentOf(useVaults());
  const [client, setClient] = useState<Client>("claude-code");
  const [readOnly, setReadOnly] = useState(false);
  const folder = here.path || "<path to the vault>";
  const quoted = /[^\w@%+=:,./-]/.test(folder) ? `'${folder.replace(/'/g, `'\\''`)}'` : folder;
  /* In the app, the command it wrote, by its path: `~/.local/bin` is not on a Mac's PATH, and on
     Windows there is no folder on the PATH to write one to. */
  const bin = desktop()?.cli ?? "anydag";
  const binQuoted = /[^\w@%+=:,./\\-]/.test(bin) ? `'${bin.replace(/'/g, `'\\''`)}'` : bin;
  const flag = readOnly ? " --read-only" : "";
  const code = `claude mcp add anydag -- ${binQuoted} mcp --vault ${quoted}${flag}`;
  const config = JSON.stringify(
    {
      mcpServers: {
        anydag: { command: bin, args: ["mcp", "--vault", folder, ...(readOnly ? ["--read-only"] : [])] },
      },
    },
    null,
    2,
  );
  const other = `${binQuoted} mcp --vault ${quoted}${flag}`;

  const onClientKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const i = CLIENTS.findIndex((c) => c.id === client);
    let next: Client | null = null;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = CLIENTS[(i + 1) % CLIENTS.length]!.id;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = CLIENTS[(i - 1 + CLIENTS.length) % CLIENTS.length]!.id;
    else if (e.key === "Home") next = CLIENTS[0]!.id;
    else if (e.key === "End") next = CLIENTS[CLIENTS.length - 1]!.id;
    if (!next) return;
    e.preventDefault();
    setClient(next);
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-dag-agent-client="${next}"]`)?.focus());
  };

  return (
    <>
      <Group
        title="Connection"
        footer={
          <Hint data-dag-setting-mcp-hint="">
            Starts <code>anydag mcp</code> for this vault. Read only adds <code>--read-only</code>, so the agent reads the vault
            and changes nothing.
          </Hint>
        }
      >
        <Field label="Read only" hint="An agent can read this vault, and every tool that writes is refused.">
          <Switch data-dag-setting-agent-readonly="" checked={readOnly} onChange={(e) => setReadOnly(e.target.checked)} />
        </Field>
        <Field label="Client" hint="Where the line below goes." plain stack>
          <div
            className="dag-settings__clients"
            role="tablist"
            aria-label="Client"
            data-dag-agent-clients=""
            onKeyDown={onClientKey}
          >
            {CLIENTS.map((c) => {
              const on = c.id === client;
              return (
                <button
                  key={c.id}
                  type="button"
                  role="tab"
                  aria-selected={on}
                  tabIndex={on ? 0 : -1}
                  className="dag-settings__client"
                  data-dag-agent-client={c.id}
                  onClick={() => setClient(c.id)}
                >
                  {c.label}
                </button>
              );
            })}
          </div>
        </Field>
      </Group>

      <Group title="Command">
        {client === "claude-code" ? (
          <Field label="Claude Code" hint="Run this once in a terminal." plain stack>
            <CopyLine value={code} hook="mcp-claude-code" multiline />
          </Field>
        ) : client === "claude-desktop" ? (
          <Field label="Claude Desktop" hint="Add this to its config file, then restart it." plain stack>
            <CopyLine value={config} hook="mcp-claude-desktop" multiline />
          </Field>
        ) : (
          <Field label="Other client" hint="Any MCP client that starts a command over stdio." plain stack>
            <CopyLine value={other} hook="mcp-other-client" multiline />
          </Field>
        )}
      </Group>
    </>
  );
}

function CopyLine({ value, hook, multiline }: { value: string; hook: string; multiline?: boolean }) {
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => setDone(false), 1600);
    return () => clearTimeout(t);
  }, [done]);
  return (
    <div className={`dag-settings-modal__copy${multiline ? " dag-settings-modal__copy--block" : ""}`}>
      <code data-dag-setting-copy-value={hook}>{value}</code>
      <button
        type="button"
        className="dag-icon"
        aria-label={done ? "Copied" : "Copy"}
        title={done ? "Copied" : "Copy"}
        data-dag-setting-copy={hook}
        onClick={() => void copyText(value).then(setDone)}
      >
        {done ? <Check {...ICON} aria-hidden="true" /> : <Copy {...ICON} aria-hidden="true" />}
      </button>
    </div>
  );
}
