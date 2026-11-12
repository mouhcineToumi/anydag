import { Check, ChevronDown, Copy } from "lucide-react";
import { useEffect, useState } from "react";

import { loadModels } from "@/assistant/api";
import type { ProviderModels } from "@/assistant/types";
import { assertNever } from "@/board/useBoard";
import { explainLlmReason, type LlmAction } from "@/settings/llmReason";
import { useProviders, type Providers } from "@/settings/useProviders";
import { currentOf } from "@/vault/api";
import { desktop } from "@/vault/desktop";
import { useVaults } from "@/vault/useVaults";

import { REASONING, resetSettings, writeSettings } from "../store";
import { useSettings } from "../useSettings";
import { TextField } from "@/ui/controls";
import { LlmSentence } from "@/ui/LlmSentence";

import { Field, Group, Hint, ICON, Reset, copyText } from "./common";

/**
 * Which model draws this workspace's prompt cards, and how an agent reaches it.
 *
 * The model half is the old card's *Prompt cards* section. The agent half is new to the page and
 * read-only: the address an MCP client is pointed at, which `/api/health` already reports, and the
 * command that connects one. **A key is never the page's**: in the desktop app it is typed here and
 * goes straight to the shell, which keeps it encrypted (`safeStorage`) and hands it to the server
 * as its environment; the page can ask only whether one is stored.
 * Outside the app it is the server's environment or `.env.local`.
 */
export function AgentsPane() {
  const s = useSettings();
  const [llm, refresh] = useProviders();
  const chosen = llm?.providers.find((p) => p.id === (s.llm.provider ?? llm.default));
  const keys = desktop()?.keys;
  const explained =
    chosen && !chosen.ready && chosen.reason
      ? explainLlmReason(chosen.reason, { host: keys ? "desktop" : "browser", providers: llm?.providers })
      : null;
  /* This pane is the AI settings, so "Open AI settings" would open the page already open. The only
     settings action worth a button here is the desktop's "Add a key", which goes to its field below. */
  const keyField = keys ? chosen?.reason?.keyEnv?.[0] : undefined;
  const explanation = explained && {
    ...explained,
    actions: explained.actions.filter((a) => a.kind !== "settings" || keyField !== undefined),
  };
  const problem =
    chosen && !chosen.ready
      ? (explanation?.sentence ?? `${chosen.label} is not set up: ${chosen.error ?? "it could not answer"}.`)
      : null;
  /* In the app a key is typed below; anywhere else it is the server's environment, which is worth one line. */
  const note =
    problem ??
    (chosen?.id === "claude"
      ? "Uses your own Claude subscription, through the Claude Code signed in on this computer. No key, and it counts against that plan's usage."
      : chosen?.id === "opencode"
        ? "Uses the OpenCode signed in on this computer, with whatever it is signed in to (OpenCode Go, or a provider you connected). No key here, and it counts against that account."
        : keys
          ? null
          : "Keys come from the server's environment. This only picks which provider to ask.");
  const act = (a: LlmAction) => {
    switch (a.kind) {
      case "settings":
        /* Only the desktop's "Add a key" is left by the filter above: it means the field below. */
        if (keyField) document.querySelector<HTMLInputElement>(`[data-dag-setting-key="${keyField}"] input`)?.focus();
        return;
      case "provider":
        if (a.provider) writeSettings({ llm: { provider: a.provider, model: null } });
        refresh();
        return;
      case "retry":
        refresh();
        return;
      default:
        return assertNever(a.kind);
    }
  };
  return (
    <>
      <Group
        title="Prompt cards"
        footer={
          note ? (
            <>
              <Hint data-dag-setting-llm-hint="">
                <LlmSentence text={note} />
              </Hint>
              {explanation ? (
                <div className="dag-settings__actions">
                  {explanation.actions.map((a) => (
                    <button
                      key={`${a.kind}:${a.label}`}
                      type="button"
                      className="dag-button"
                      data-dag-setting-llm-act={a.kind}
                      onClick={() => act(a)}
                    >
                      {a.label}
                    </button>
                  ))}
                </div>
              ) : null}
            </>
          ) : undefined
        }
      >
        <Field label="Provider" hint="A prompt card describes a diagram and this model draws it.">
          <select
            className="dag-select dag-select--wide"
            data-dag-setting-llm-provider=""
            value={s.llm.provider ?? ""}
            /* A model name belongs to its provider, so choosing another provider clears it back to
               that provider's own default rather than sending a Gemini name to Z.ai. */
            onChange={(e) => writeSettings({ llm: { provider: e.target.value || null, model: null } })}
          >
            <option value="">Default{llm ? ` (${labelOf(llm, llm.default)})` : ""}</option>
            {(llm?.providers ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
                {p.ready ? "" : " (not set up)"}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Model">
          <TextField
            wide
            data-dag-setting-llm-model=""
            list="dag-llm-models"
            spellCheck={false}
            placeholder={chosen?.defaultModel || "Default"}
            value={s.llm.model ?? ""}
            onChange={(e) => writeSettings({ llm: { model: e.target.value } })}
          />
          <datalist id="dag-llm-models">
            {(chosen?.models ?? []).map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
        </Field>
        <Field label="Thinking" hint="More is slower, and rarely a better diagram. Low is usually enough.">
          <select
            className="dag-select"
            data-dag-setting-llm-reasoning=""
            value={s.llm.reasoning ?? ""}
            onChange={(e) => writeSettings({ llm: { reasoning: e.target.value || null } })}
          >
            <option value="">Default</option>
            {REASONING.map((level) => (
              <option key={level} value={level}>
                {level.charAt(0).toUpperCase() + level.slice(1)}
              </option>
            ))}
          </select>
        </Field>
      </Group>

      <AssistantGroup />

      <ProviderKeys onChange={refresh} />

      <Agents />

      <Reset
        what="the prompt card's and the Assistant's provider, model and thinking"
        onReset={() => resetSettings(["llm", "assistant"])}
      />
    </>
  );
}

/**
 * What a new Assistant chat starts on: the harness and the model.
 * Only a new chat reads it — a chat already begun keeps what it was last sent with, and the
 * composer changes that per turn. Both harnesses are the person's own, signed in on this computer.
 */
function AssistantGroup() {
  const s = useSettings();
  const [providers, setProviders] = useState<ProviderModels[] | null>(null);
  useEffect(() => {
    let live = true;
    loadModels().then(
      (got) => live && setProviders(got),
      /* No server: the selects offer the defaults and nothing else, which is true. */
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, []);
  const chosen = providers?.find((p) => p.provider === s.assistant.provider);
  const note = chosen && !chosen.available ? `${chosen.label} is not available: ${chosen.why ?? "it did not answer"}.` : null;
  return (
    <Group
      title="Assistant"
      footer={
        <Hint data-dag-setting-assistant-hint="">
          {note ??
            "The chat in the panel and on the Assistant page runs on your own Claude Code or OpenCode, signed in on this computer. Each message can pick another."}
        </Hint>
      }
    >
      <Field label="Provider" hint="What a new chat runs on.">
        <select
          className="dag-select dag-select--wide"
          data-dag-setting-assistant-provider=""
          value={s.assistant.provider ?? ""}
          /* A model name belongs to its provider, so choosing another provider clears it back to that
             provider's own default. */
          onChange={(e) =>
            writeSettings({ assistant: { provider: (e.target.value || null) as "claude" | "opencode" | null, model: null } })
          }
        >
          <option value="">Whichever can answer</option>
          {(providers ?? []).map((p) => (
            <option key={p.provider} value={p.provider}>
              {p.label}
              {p.available ? "" : " (not available)"}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Model">
        <select
          className="dag-select dag-select--wide"
          data-dag-setting-assistant-model=""
          disabled={!chosen}
          value={s.assistant.model ?? ""}
          onChange={(e) => writeSettings({ assistant: { model: e.target.value || null } })}
        >
          <option value="">{chosen ? `Default (${chosen.default})` : "Default"}</option>
          {(chosen?.models ?? []).map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
      </Field>
    </Group>
  );
}

/** A provider's name for a person, off its id; the id itself when the list does not know it. */
function labelOf(list: Providers, id: string): string {
  return list.providers.find((p) => p.id === id)?.label ?? id;
}

/** The keys a provider is read by, one row each — the env var names `plugins/generate/providers.ts`
 *  reads first for each provider, which the shell also accepts (`PROVIDER_KEY_ENVS`). */
const KEYS: readonly { name: string; label: string }[] = [
  { name: "GEMINI_API_KEY", label: "Gemini" },
  { name: "ZAI_API_KEY", label: "Z.ai" },
  { name: "ANYDAG_LLM_API_KEY", label: "OpenAI-compatible" },
];

/** In the desktop app only: store a provider's key. It is written, never read back. */
function ProviderKeys({ onChange }: { onChange: () => void }) {
  const keys = desktop()?.keys;
  const [stored, setStored] = useState<ReadonlySet<string>>(new Set());
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    void keys?.names().then((n) => setStored(new Set(n)));
  }, [keys]);
  if (!keys) return null;
  const done = async (name: string, act: Promise<boolean>) => {
    setBusy(name);
    try {
      await act;
      setStored(new Set(await keys.names()));
      setDraft((d) => ({ ...d, [name]: "" }));
      onChange();
    } finally {
      setBusy(null);
    }
  };
  return (
    <Group
      title="API keys"
      footer={
        <Hint>
          Kept in your system&rsquo;s keyring and handed to the server when it starts. Saving restarts it. A key is never shown
          again.
        </Hint>
      }
    >
      {KEYS.map(({ name, label }) => (
        <Field key={name} label={label} plain data-dag-setting-key={name}>
          <span className="dag-settings__actions">
            <TextField
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder={stored.has(name) ? "Saved" : "Not set"}
              aria-label={`${label} API key`}
              value={draft[name] ?? ""}
              onChange={(e) => setDraft((d) => ({ ...d, [name]: e.target.value }))}
              onKeyDown={(e) => {
                const value = (draft[name] ?? "").trim();
                if (e.key === "Enter" && value) void done(name, keys.set(name, value));
              }}
            />
            <button
              type="button"
              className="dag-button"
              disabled={busy !== null || !(draft[name] ?? "").trim()}
              onClick={() => void done(name, keys.set(name, (draft[name] ?? "").trim()))}
            >
              Save
            </button>
            {stored.has(name) && (
              <button
                type="button"
                className="dag-button"
                disabled={busy !== null}
                onClick={() => void done(name, keys.unset(name))}
              >
                Remove
              </button>
            )}
          </span>
        </Field>
      ))}
    </Group>
  );
}

/**
 * Connecting an agent: the two lines that make Claude Code or Claude Desktop talk to this vault. The
 * MCP server is a program the client starts (`anydag mcp`, over stdio), not an address, and it
 * reaches the running app when there is one — so what it edits is what is open here.
 */
function Agents() {
  const here = currentOf(useVaults());
  const folder = here.path || "<path to the vault>";
  const quoted = /[^\w@%+=:,./-]/.test(folder) ? `'${folder.replace(/'/g, `'\\''`)}'` : folder;
  /* In the app, the command it wrote, by its path: `~/.local/bin` is not on a Mac's PATH, and on
     Windows there is no folder on the PATH to write one to. */
  const bin = desktop()?.cli ?? "anydag";
  const binQuoted = /[^\w@%+=:,./\\-]/.test(bin) ? `'${bin.replace(/'/g, `'\\''`)}'` : bin;
  const code = `claude mcp add anydag -- ${binQuoted} mcp --vault ${quoted}`;
  const config = JSON.stringify({ mcpServers: { anydag: { command: bin, args: ["mcp", "--vault", folder] } } }, null, 2);
  return (
    <Group
      title="Connect an agent"
      footer={
        <Hint data-dag-setting-mcp-hint="">
          Both start <code>anydag mcp</code> for this vault. Add <code>--read-only</code> to let an agent read without writing.
        </Hint>
      }
    >
      <Field label="Claude Code" hint="Run this once in a terminal." plain stack>
        <CopyLine value={code} hook="mcp-claude-code" />
      </Field>
      <details className="dag-settings__more">
        <summary>
          <span className="dag-settings__name">Claude Desktop</span>
          <span className="dag-settings__value">Add to its config file</span>
          <ChevronDown size={14} strokeWidth={2} aria-hidden="true" />
        </summary>
        <div className="dag-settings__moreBody">
          <CopyLine value={config} hook="mcp-claude-desktop" multiline />
        </div>
      </details>
    </Group>
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
