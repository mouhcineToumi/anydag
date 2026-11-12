import { useEffect, useState } from "react";

import { TextField } from "@/ui/controls";
import { desktop } from "@/vault/desktop";

import { PROVIDER_NAMES } from "../providerNames";
import { markSaved } from "../saved";
import { useProviders } from "../useProviders";

import { Field, Group, Hint } from "./common";

/**
 * The keys this computer's desktop app keeps for the model providers, in the system keyring and
 * never in the page. It is *This computer*'s: a key belongs to the machine it is typed on, and the
 * same vault opened in another browser asks the server's environment instead.
 *
 * Outside the desktop app there is nothing to type: the keys are the server's environment or
 * `.env.local`, so the tab says so rather than drawing fields that would write nowhere.
 */
export function ProvidersPane() {
  /* The list is cached for every surface, so a key that has just been saved asks again rather than
     leaving the AI tab naming a provider that was not ready a moment ago. */
  const [, refresh] = useProviders();
  return <ProviderKeys onChange={refresh} />;
}

/** The keys a provider is read by, one row each — the env var names `plugins/generate/providers.ts`
 *  reads first for each provider, which the shell also accepts (`PROVIDER_KEY_ENVS`). */
const KEYS: readonly { name: string; label: string }[] = [
  { name: "GEMINI_API_KEY", label: PROVIDER_NAMES.gemini },
  { name: "ZAI_API_KEY", label: PROVIDER_NAMES.zai },
  { name: "ANYDAG_LLM_API_KEY", label: PROVIDER_NAMES.custom },
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
  const footer = (
    <Hint data-dag-setting-provider-keys="">
      {keys
        ? "Kept in your system’s keyring and handed to the server when it starts. Saving restarts it. A key is never shown again."
        : "Keys come from the server’s environment. Set GEMINI_API_KEY, ZAI_API_KEY or ANYDAG_LLM_API_KEY before the server starts."}
    </Hint>
  );
  if (!keys) return <Group title="API keys" footer={footer} />;
  const done = async (name: string, act: Promise<boolean>) => {
    setBusy(name);
    try {
      const ok = await act;
      if (ok) markSaved(`provider-key.${name}`);
      setStored(new Set(await keys.names()));
      setDraft((d) => ({ ...d, [name]: "" }));
      onChange();
    } finally {
      setBusy(null);
    }
  };
  return (
    <Group title="API keys" footer={footer}>
      {KEYS.map(({ name, label }) => (
        <Field key={name} label={label} plain data-dag-setting-key={name} save={`provider-key.${name}`}>
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
