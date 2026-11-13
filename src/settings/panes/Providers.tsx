import { useEffect, useState } from "react";

import { TextField } from "@/ui/controls";
import { LlmSentence } from "@/ui/LlmSentence";
import { ProviderMark } from "@/ui/ProviderMark";
import { desktop } from "@/vault/desktop";

import { explainLlmReason, LlmRequestError, reasonOf } from "../llmReason";
import { checkedAgo, providerStatus, STATUS_LABEL } from "../providerStatus";
import { markSaved } from "../saved";
import { type ProviderInfo, providersCheckedAt, useProviders } from "../useProviders";

import { Group, Hint } from "./common";

/**
 * Every AI provider in one list, each in its own row: its mark, what it is, a pill for its state,
 * and what it takes to set it up. The state is the server's (`GET /__board/llm`), so a row says
 * "Ready" because the provider could answer, not because a field has something in it.
 *
 * - **A keyed provider's key is typed in its own row**, in the desktop app, where the shell keeps it
 *   encrypted and hands it to the server when it starts. *Save and test* stores it, waits for the
 *   server to come back with it, and then makes one short call (`POST /__board/llm/test`), so the row
 *   reports a model that answered. A key never comes back to the page.
 * - **OpenAI-compatible also takes an address and a model.** They are not secrets: the shell keeps
 *   them in `~/.anydag/provider-env.json` and hands them to the server as `ANYDAG_LLM_BASE_URL` and
 *   `ANYDAG_LLM_MODEL`, the same names `.env.local` uses, so a browser and the app read one setting.
 * - **In a browser there is no field**: a key is the server's environment, and the row says which
 *   variable it reads.
 * - **Check again** asks the server to check every provider afresh: after signing in to Claude Code,
 *   the row turns Ready without closing Settings.
 */
export function ProvidersPane() {
  const [llm, refresh] = useProviders();
  const at = providersCheckedAt();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(timer);
  }, []);
  const host = desktop()?.keys ? "desktop" : "browser";
  /* The pane's title already says AI providers, so the group has none; the line about what is kept
     where sits above the list, and the note about keys once under it. */
  return (
    <>
      <p className="dag-providers__scope" data-dag-providers-scope="">
        Sign-ins and keys stay on this computer. Which model each feature uses is yours, in every vault.
      </p>
      <Group
        footer={
          <>
            {host === "desktop" ? (
              <Hint>
                Keys are kept on this computer, encrypted where the system allows, and never shown again. Saving restarts the
                server.
              </Hint>
            ) : null}
            <Hint data-dag-providers-checked="">
              Checked {checkedAgo(at, now)} ·{" "}
              <button type="button" className="dag-providers__check" data-dag-providers-check="" onClick={refresh}>
                Check again
              </button>
            </Hint>
          </>
        }
      >
        {llm ? (
          <ul className="dag-providers" data-dag-providers="">
            {llm.providers.map((p) => (
              <ProviderRow key={p.id} p={p} all={llm.providers} host={host} onChange={refresh} />
            ))}
          </ul>
        ) : (
          <p className="dag-providers__scope">Asking the server which providers could answer…</p>
        )}
      </Group>
    </>
  );
}

type Test = { state: "idle" } | { state: "busy"; what: string } | { state: "ok"; text: string } | { state: "fail"; text: string };

function ProviderRow({
  p,
  all,
  host,
  onChange,
}: {
  p: ProviderInfo;
  all: readonly ProviderInfo[];
  host: "desktop" | "browser";
  onChange(): void;
}) {
  const status = providerStatus(p);
  const explained = p.ready ? null : explainLlmReason(p.reason, { host, providers: all });
  const keyed = p.kind === "http";
  return (
    <li className="dag-providers__row" data-dag-provider={p.id} data-dag-provider-status={status}>
      <div className="dag-providers__head">
        {/* A provider with no mark yet keeps the column, so every name starts in one line. */}
        <span className="dag-providers__mark">
          <ProviderMark provider={p.id} size={18} nameFallback={false} />
        </span>
        <span className="dag-providers__text">
          <span className="dag-providers__name">{p.label}</span>
          <span className="dag-providers__desc">{p.description}</span>
        </span>
        <span className="dag-providers__pill" data-dag-provider-pill={status}>
          {STATUS_LABEL[status]}
        </span>
      </div>
      {explained && status !== "needs-key" && status !== "needs-address" ? (
        <p className="dag-providers__why">
          <LlmSentence text={explained.sentence} />
        </p>
      ) : null}
      {keyed ? host === "desktop" ? <KeyedSetup p={p} onChange={onChange} /> : <FromEnvironment p={p} /> : null}
    </li>
  );
}

/** In a browser a key is the server's environment: say which variable, and nothing to type. */
function FromEnvironment({ p }: { p: ProviderInfo }) {
  const vars = p.keyEnv ?? [];
  const address = p.id === "custom";
  return (
    <p className="dag-providers__why" data-dag-provider-env="">
      {vars.length ? (
        <>
          Its key comes from the server&rsquo;s environment: <code>{vars[0]}</code>
          {vars.length > 1 ? (
            <>
              {" "}
              or <code>{vars[1]}</code>
            </>
          ) : null}
          .
        </>
      ) : null}
      {address ? (
        <>
          {" "}
          Its address is <code>ANYDAG_LLM_BASE_URL</code> and its model <code>ANYDAG_LLM_MODEL</code>.
        </>
      ) : null}
    </p>
  );
}

/**
 * The desktop's setup for a keyed provider: the key, and for OpenAI-compatible the address and the
 * model. Each change the shell stores restarts the server, so Save and test stores everything that
 * changed first, then waits for the list to come back, then asks for one short answer.
 */
function KeyedSetup({ p, onChange }: { p: ProviderInfo; onChange(): void }) {
  const shell = desktop();
  const keys = shell?.keys;
  const env = shell?.providerEnv;
  const keyName = p.keyEnv?.[0];
  const custom = p.id === "custom";
  const [stored, setStored] = useState(false);
  const [key, setKey] = useState("");
  const [address, setAddress] = useState("");
  const [model, setModel] = useState("");
  const [saved, setSaved] = useState<{ address: string; model: string }>({ address: "", model: "" });
  const [test, setTest] = useState<Test>({ state: "idle" });

  useEffect(() => {
    let live = true;
    void keys?.names().then((n) => live && setStored(Boolean(keyName && (p.keyEnv ?? []).some((k) => n.includes(k)))));
    if (custom)
      void env?.get().then((v) => {
        if (!live) return;
        const now = { address: v.ANYDAG_LLM_BASE_URL ?? "", model: v.ANYDAG_LLM_MODEL ?? "" };
        setSaved(now);
        setAddress(now.address);
        setModel(now.model);
      });
    return () => {
      live = false;
    };
  }, [keys, env, keyName, custom, p.keyEnv]);

  if (!keys || !keyName) return null;
  const addressBad = custom && address.trim() !== "" && !/^https?:\/\/\S+$/i.test(address.trim());
  const changed = key.trim() !== "" || (custom && (address.trim() !== saved.address || model.trim() !== saved.model));
  const busy = test.state === "busy";

  const saveAndTest = async () => {
    try {
      if (custom && env) {
        if (address.trim() !== saved.address) {
          setTest({ state: "busy", what: "Saving the address…" });
          if (!(await env.set("ANYDAG_LLM_BASE_URL", address.trim())))
            throw new Error("The address was not saved. It must start with http:// or https://.");
        }
        if (model.trim() !== saved.model) {
          setTest({ state: "busy", what: "Saving the model…" });
          if (!(await env.set("ANYDAG_LLM_MODEL", model.trim()))) throw new Error("The model was not saved.");
        }
        setSaved({ address: address.trim(), model: model.trim() });
      }
      if (key.trim()) {
        setTest({ state: "busy", what: "Saving the key…" });
        if (!(await keys.set(keyName, key.trim()))) throw new Error("The key was not saved.");
        setKey("");
        setStored(true);
        markSaved(`provider-key.${keyName}`);
      }
      onChange();
      setTest({ state: "busy", what: "Asking the model for one word…" });
      setTest({ state: "ok", text: await testProvider(p.id) });
    } catch (e) {
      setTest({ state: "fail", text: (e as Error).message });
    }
  };

  const remove = async () => {
    setTest({ state: "busy", what: "Removing the key…" });
    await keys.unset(keyName);
    setStored(false);
    setTest({ state: "idle" });
    onChange();
  };

  return (
    <div className="dag-providers__setup">
      {custom ? (
        <>
          <label className="dag-providers__field">
            <span className="dag-providers__label">Address</span>
            <TextField
              wide
              data-dag-provider-base-url=""
              spellCheck={false}
              autoComplete="off"
              placeholder="https://api.example.com/v1"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              aria-invalid={addressBad || undefined}
            />
          </label>
          <label className="dag-providers__field">
            <span className="dag-providers__label">Model</span>
            <TextField
              wide
              data-dag-provider-model=""
              spellCheck={false}
              autoComplete="off"
              placeholder="The model this server serves"
              value={model}
              onChange={(e) => setModel(e.target.value)}
            />
          </label>
        </>
      ) : null}
      <label className="dag-providers__field" data-dag-setting-key={keyName}>
        <span className="dag-providers__label">API key</span>
        <TextField
          type="password"
          wide
          autoComplete="off"
          spellCheck={false}
          placeholder={stored ? "Saved. Type a new one to replace it." : custom ? "If the server asks for one" : "Paste the key"}
          aria-label={`${p.label} API key`}
          value={key}
          onChange={(e) => setKey(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && changed && !addressBad && !busy) void saveAndTest();
          }}
        />
      </label>
      <div className="dag-settings__actions">
        <button
          type="button"
          className="dag-button"
          data-dag-provider-save=""
          disabled={busy || addressBad || (!changed && !stored && !p.ready && !(custom && saved.address))}
          onClick={() => void saveAndTest()}
        >
          {changed ? "Save and test" : "Test"}
        </button>
        {stored ? (
          <button type="button" className="dag-button" data-dag-provider-remove="" disabled={busy} onClick={() => void remove()}>
            Remove key
          </button>
        ) : null}
        <span className="dag-providers__test" role="status" data-dag-provider-test={test.state}>
          {test.state === "busy" ? test.what : test.state === "ok" || test.state === "fail" ? test.text : null}
        </span>
      </div>
      {addressBad ? <p className="dag-providers__why">The address starts with http:// or https://.</p> : null}
    </div>
  );
}

/** One short call through the server; the sentence the row shows either way. */
async function testProvider(provider: string): Promise<string> {
  const res = await fetch("/__board/llm/test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ provider }),
  });
  const body = (await res.json().catch(() => ({}))) as { ms?: number; model?: string | null; error?: string; reason?: unknown };
  if (res.ok) {
    const secs = typeof body.ms === "number" ? ` in ${(body.ms / 1000).toFixed(1)} s` : "";
    return `${body.model ?? "The model"} answered${secs}.`;
  }
  const reason = reasonOf(body.reason);
  const explained = explainLlmReason(reason, { host: "desktop" });
  throw new LlmRequestError(explained?.sentence ?? body.error ?? "The provider did not answer.", reason);
}
