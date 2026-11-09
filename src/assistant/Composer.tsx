import { ArrowUp, ChevronDown, Layers, Square } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";

import { useSettings } from "@/settings/useSettings";
import { loadVaults, type Vault } from "@/vault/api";
import { useVaults } from "@/vault/useVaults";

import { modelLabel, providerLabel } from "./Thread";
import type { ChatMeta, Mode, Provider, ProviderModels } from "./types";
import { grantsOf } from "./types";

const ICON = { size: 14, strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" } as const;

/** What the next turn is sent with: the model it runs on and how hard it thinks. */
export interface Choice {
  provider: Provider;
  model: string;
  /** `""` is the harness's own. */
  effort: string;
}

/**
 * What a chat that has none starts with: the Settings default when that provider can answer, else the
 * first provider that can, else Claude Code's — which the picker then shows as unavailable and says why.
 */
function defaultChoice(
  models: readonly ProviderModels[] | null,
  pref: { provider: string | null; model: string | null },
): Choice {
  const usable = models?.filter((m) => m.available) ?? [];
  const wanted = models?.find((m) => m.provider === pref.provider && m.available);
  const at = wanted ?? usable[0] ?? models?.[0];
  const provider = at?.provider ?? "claude";
  const model = at && at === wanted && pref.model ? pref.model : (at?.default ?? "claude-sonnet-5-5");
  return { provider, model, effort: "" };
}

export interface ComposerProps {
  meta: ChatMeta | null;
  models: readonly ProviderModels[] | null;
  /** A turn is running here or in another tab, or one is being sent. */
  running: boolean;
  onSend(text: string, choice: Choice): void;
  onStop(): void;
  /** Grant (or take back, with `null`) a vault — making the chat first when it has none yet. */
  onGrant(choice: Choice, vault: string, mode: Mode | null): void;
  /** Focus the box when it appears, which a panel wants and a page with a history does not. */
  autofocus?: boolean;
}

export function Composer({ meta, models, running, onSend, onStop, onGrant, autofocus }: ComposerProps) {
  const pref = useSettings().assistant;
  const base = useMemo<Choice>(
    () => (meta ? { provider: meta.provider, model: meta.model, effort: meta.effort ?? "" } : defaultChoice(models, pref)),
    [meta, models, pref],
  );
  /* What was picked since the chat last said what it was on: the chat's own record wins again the
     moment a turn is sent, because the server has written the pick into it. */
  const [over, setOver] = useState<Partial<Choice>>({});
  useEffect(() => setOver({}), [meta?.id, meta?.provider, meta?.model, meta?.effort]);
  const choice: Choice = { ...base, ...over };
  const [text, setText] = useState("");
  const box = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (autofocus) box.current?.focus();
  }, [autofocus, meta?.id]);
  /* Grows with what is typed, to a ceiling the stylesheet sets. */
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [text]);

  const at = models?.find((m) => m.provider === choice.provider);
  const unavailable = at && !at.available ? at : null;
  const efforts = at?.efforts ?? ["", "low", "medium", "high", "max"];
  const can = text.trim() !== "" && !running && !unavailable;

  const send = () => {
    if (!can) return;
    onSend(text.trim(), choice);
    setText("");
  };
  const key = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
    e.preventDefault();
    send();
  };

  return (
    <div className="dag-chat-composer" data-dag-chat-composer="">
      <textarea
        ref={box}
        className="dag-chat-composer__input"
        data-dag-chat-input=""
        rows={1}
        value={text}
        placeholder="Ask for a change, or a question"
        aria-label="Message the Assistant"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={key}
      />
      {unavailable ? (
        <p className="dag-chat-composer__why" data-dag-chat-why="">
          {unavailable.label} is not available: {unavailable.why ?? "it did not answer"}.
        </p>
      ) : null}
      <div className="dag-chat-composer__row">
        <Scope meta={meta} onGrant={(vault, mode) => onGrant(choice, vault, mode)} />
        <span className="dag-chat-composer__space" />
        <select
          className="dag-select dag-chat-picker"
          data-dag-chat-model=""
          aria-label="Provider and model"
          value={`${choice.provider}|${choice.model}`}
          onChange={(e) => {
            const [provider, ...rest] = e.target.value.split("|");
            setOver((o) => ({ ...o, provider: provider as Provider, model: rest.join("|") }));
          }}
        >
          {(models ?? []).map((p) => {
            const list =
              p.models.some((m) => m.id === choice.model) || p.provider !== choice.provider
                ? p.models
                : [{ id: choice.model, label: choice.model }, ...p.models];
            return (
              <optgroup key={p.provider} label={p.available ? p.label : `${p.label} (unavailable)`} disabled={!p.available}>
                {list.map((m) => (
                  <option key={m.id} value={`${p.provider}|${m.id}`} disabled={!p.available}>
                    {p.label} · {m.label}
                  </option>
                ))}
              </optgroup>
            );
          })}
          {!models ? (
            <option value={`${choice.provider}|${choice.model}`}>
              {providerLabel(choice.provider)} · {modelLabel(choice.model)}
            </option>
          ) : null}
        </select>
        <select
          className="dag-select dag-chat-picker dag-chat-picker--effort"
          data-dag-chat-effort=""
          aria-label="Effort"
          value={choice.effort}
          onChange={(e) => setOver((o) => ({ ...o, effort: e.target.value }))}
        >
          {efforts.map((x) => (
            <option key={x} value={x}>
              {x === "" ? "Default effort" : `${x.charAt(0).toUpperCase()}${x.slice(1)} effort`}
            </option>
          ))}
        </select>
        {running ? (
          <button
            type="button"
            className="dag-chat-send dag-chat-send--stop"
            data-dag-chat-stop=""
            aria-label="Stop"
            title="Stop"
            onClick={onStop}
          >
            <Square {...ICON} fill="currentColor" aria-hidden="true" />
          </button>
        ) : (
          <button
            type="button"
            className="dag-chat-send"
            data-dag-chat-send=""
            aria-label="Send"
            title="Send (Enter)"
            disabled={!can}
            onClick={send}
          >
            <ArrowUp {...ICON} aria-hidden="true" />
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * What the chat reaches: its own vault, and any others the person has granted. A grant is a vault
 * and a mode — read, or change too — and the agent can only ask; the card in the thread is where it
 * asks, and this is where the person gives or takes back on their own.
 */
function Scope({ meta, onGrant }: { meta: ChatMeta | null; onGrant(vault: string, mode: Mode | null): void }) {
  const [open, setOpen] = useState(false);
  const vaults = useVaults();
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    void loadVaults();
    const away = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      setOpen(false);
    };
    document.addEventListener("pointerdown", away, true);
    document.addEventListener("keydown", esc, true);
    return () => {
      document.removeEventListener("pointerdown", away, true);
      document.removeEventListener("keydown", esc, true);
    };
  }, [open]);

  const granted = meta ? grantsOf(meta) : {};
  const named = (id: string): string => vaults?.find((v) => v.id === id)?.name ?? "another vault";
  const here = (v: Vault) => v.id === meta?.home || (!meta && v.default);
  const home = meta ? named(meta.home) : (vaults?.find((v) => v.default)?.name ?? "This vault");
  const extra = Object.keys(granted).length;
  const others = (vaults ?? []).filter((v) => v.open && !here(v) && !granted[v.id]);
  return (
    <div className="dag-chat-scope" ref={wrap}>
      <button
        type="button"
        className="dag-chat-scope__chip"
        data-dag-chat-scope=""
        aria-expanded={open}
        aria-haspopup="true"
        title="The vaults this chat can reach"
        onClick={() => setOpen((v) => !v)}
      >
        <Layers {...ICON} aria-hidden="true" />
        <span>{home}</span>
        {extra ? <span className="dag-chat-scope__more">+{extra}</span> : null}
        <ChevronDown {...ICON} aria-hidden="true" />
      </button>
      {open ? (
        <div className="dag-chat-scope__menu" role="menu" data-dag-chat-scope-menu="">
          <p className="dag-chat-scope__line">
            <strong>{home}</strong>
            <span>this vault, always</span>
          </p>
          {Object.entries(granted).map(([id, g]) => (
            <p className="dag-chat-scope__line" key={id} data-dag-chat-granted={id}>
              <strong>{named(id)}</strong>
              <span>{g.mode === "edit" ? "read and change" : "read only"}</span>
              <button type="button" className="dag-button" data-dag-chat-revoke={id} onClick={() => onGrant(id, null)}>
                Take back
              </button>
            </p>
          ))}
          <p className="dag-chat-scope__title">Grant another vault…</p>
          {others.length ? (
            others.map((v) => (
              <p className="dag-chat-scope__line" key={v.id}>
                <strong>{v.name}</strong>
                <button
                  type="button"
                  className="dag-button"
                  data-dag-chat-grant-vault={v.id}
                  data-dag-chat-grant-mode="ask"
                  onClick={() => onGrant(v.id, "ask")}
                >
                  Read
                </button>
                <button
                  type="button"
                  className="dag-button"
                  data-dag-chat-grant-vault={v.id}
                  data-dag-chat-grant-mode="edit"
                  onClick={() => onGrant(v.id, "edit")}
                >
                  Read and change
                </button>
              </p>
            ))
          ) : (
            <p className="dag-chat-scope__line">
              <span>No other vault is open.</span>
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}
