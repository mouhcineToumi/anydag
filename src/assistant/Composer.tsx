import { ArrowUp, ChevronDown, Layers, Square, UnfoldVertical } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent } from "react";

import { readIndex, type IndexDoc } from "@/refs/useIndex";
import { useSettings } from "@/settings/useSettings";
import { EffortPicker } from "@/ui/EffortPicker";
import { ModelPicker } from "@/ui/ModelPicker";
import { pickerProvidersFromChat } from "@/ui/modelList";
import { currentVault } from "@/vault/current";
import { loadVaults } from "@/vault/api";
import { useVaults } from "@/vault/useVaults";

import { DocChip, DocMark, type ChipDoc } from "./DocChip";
import { mentionAt, mentionOptions, type ActiveMention, type MentionDoc } from "./mentions";
import { scopeOf } from "./scope";
import type { ChatMeta, Mode, Provider, ProviderModels } from "./types";

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
export function defaultChoice(
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
  /** Send the words, the model to run them on, and the documents the message names with `@`. */
  onSend(text: string, choice: Choice, mentions: readonly MentionDoc[]): void;
  onStop(): void;
  /** Grant (or take back, with `null`) a vault — making the chat first when it has none yet. */
  onGrant(choice: Choice, vault: string, mode: Mode | null): void;
  /** Focus the box when it appears, which a panel wants and a page with a history does not. */
  autofocus?: boolean;
  /** The document the chat works on (#323), drawn as a chip above the field; `null` for the whole vault. */
  subject?: ChipDoc | null;
  /** The chip's remove button: the chat becomes about the whole vault. */
  onDropSubject?(): void;
}

export function Composer({ meta, models, running, onSend, onStop, onGrant, autofocus, subject, onDropSubject }: ComposerProps) {
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
  const [mentions, setMentions] = useState<MentionDoc[]>([]);
  const [mention, setMention] = useState<ActiveMention | null>(null);
  const [active, setActive] = useState(0);
  const [docs, setDocs] = useState<readonly IndexDoc[] | null>(null);
  /* The `@` an Escape closed, so the same one does not reopen until the person types another. */
  const closed = useRef<number | null>(null);
  /* Where the last pick left the caret: Backspace there takes that chip, even with words before it. */
  const picked = useRef<number | null>(null);
  const composer = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [tall, setTall] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (autofocus) box.current?.focus();
  }, [autofocus, meta?.id]);
  useEffect(() => setTall(false), [meta?.id]);
  useEffect(() => {
    setMention(null);
    closed.current = null;
    picked.current = null;
  }, [meta?.id]);
  /* Grows with what is typed, to a ceiling the stylesheet sets — unless the person has expanded it,
     where the box is the expanded one and the ceiling is the stylesheet's other one. */
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    if (!tall) el.style.height = `${el.scrollHeight}px`;
  }, [text, tall]);

  const open = mention !== null;
  /* The vault is read when a list first opens, not when the composer mounts: an index is the whole
     vault, and most messages never name a document. `readIndex` keeps it current for the next one. */
  useEffect(() => {
    if (!open) return;
    let live = true;
    void readIndex().then(
      (index) => {
        if (live) setDocs(index.docs);
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [open]);
  const options = useMemo(
    () => (mention ? mentionOptions(docs ?? [], mention.query, new Set(mentions.map((m) => m.id))) : []),
    [mention, docs, mentions],
  );
  useEffect(() => {
    setActive((at) => (options.length ? Math.min(at, options.length - 1) : 0));
  }, [options.length]);
  useEffect(() => {
    if (!open) return;
    list.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [open, active]);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!composer.current?.contains(e.target as Node)) setMention(null);
    };
    document.addEventListener("pointerdown", away, true);
    return () => document.removeEventListener("pointerdown", away, true);
  }, [open]);

  const at = models?.find((m) => m.provider === choice.provider);
  const unavailable = at && !at.available ? at : null;
  const can = text.trim() !== "" && !running && !unavailable;

  const send = () => {
    if (!can) return;
    onSend(text.trim(), choice, mentions);
    setText("");
    setMentions([]);
    setMention(null);
    closed.current = null;
    picked.current = null;
    setTall(false);
  };

  /** Take the `@query` out of the message and put the document's chip in its place. */
  const pick = (doc: MentionDoc) => {
    if (!mention) return;
    const caret = mention.start;
    const next = text.slice(0, mention.start) + text.slice(mention.start + 1 + mention.query.length);
    setText(next);
    setMentions((had) => (had.some((m) => m.id === doc.id) ? had : [...had, doc]));
    setMention(null);
    closed.current = null;
    picked.current = caret;
    box.current?.focus();
  };

  /* The `@` follows the caret as it moves or the words change; Escape closes one and leaves the
     words where they are, until another `@` starts a query of its own. */
  const look = (value: string, caret: number) => {
    const found = mentionAt(value, caret);
    if (!found) {
      closed.current = null;
      setMention(null);
      return;
    }
    if (closed.current === found.start) {
      setMention(null);
      return;
    }
    closed.current = null;
    setMention(found);
    setActive(0);
  };

  const change = (e: ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    const caret = e.target.selectionStart ?? value.length;
    /* A new `@` is a new question, even at the index an Escape closed. */
    if (value[Math.max(0, caret - 1)] === "@") closed.current = null;
    setText(value);
    picked.current = null;
    look(value, caret);
  };

  const select = (e: ChangeEvent<HTMLTextAreaElement>) => {
    look(e.target.value, e.target.selectionStart ?? 0);
  };

  const key = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (mention) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActive((i) => (options.length ? (i + 1) % options.length : 0));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActive((i) => (options.length ? (i - 1 + options.length) % options.length : 0));
        return;
      }
      if (e.key === "Escape") {
        /* The list goes; the `@` and what was typed after it stay in the message. */
        e.preventDefault();
        e.stopPropagation();
        closed.current = mention.start;
        setMention(null);
        return;
      }
      if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
        const doc = options[active];
        if (doc) {
          e.preventDefault();
          pick(doc);
          return;
        }
      }
    }
    /* A chip is one thing, so one Backspace takes the last of them when the caret is at its edge. */
    const edge = e.currentTarget.selectionStart;
    if (
      e.key === "Backspace" &&
      mentions.length &&
      edge === e.currentTarget.selectionEnd &&
      (edge === 0 || edge === picked.current)
    ) {
      e.preventDefault();
      setMentions((had) => had.slice(0, -1));
      picked.current = null;
      return;
    }
    if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
    e.preventDefault();
    send();
  };

  return (
    <div className="dag-chat-composer" data-dag-chat-composer="" ref={composer}>
      {mention ? (
        <div className="dag-chat-mentions" data-dag-chat-mentions="" role="listbox" aria-label="Mention a document" ref={list}>
          {options.length ? (
            options.map((doc, i) => (
              <button
                key={doc.id}
                type="button"
                role="option"
                aria-selected={i === active}
                className="dag-chat-mention"
                data-dag-chat-mention-item={doc.name}
                data-dag-chat-mention-active={i === active ? "" : undefined}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(doc)}
              >
                <DocMark kind={doc.kind} size={14} />
                <span className="dag-chat-mention__title">{doc.title}</span>
                {doc.name !== doc.title ? <span className="dag-chat-mention__where">{doc.name}</span> : null}
              </button>
            ))
          ) : (
            <p className="dag-chat-mention__none">{docs ? `No document matches “${mention.query}”.` : "Reading the vault…"}</p>
          )}
        </div>
      ) : null}
      {subject || mentions.length ? (
        <div className="dag-chat-composer__docs">
          {subject ? (
            <DocChip
              doc={subject}
              data-dag-chat-subject={subject.name}
              onRemove={onDropSubject}
              removeLabel={`Work on the whole vault, not only ${subject.title}`}
            />
          ) : null}
          {mentions.map((doc) => (
            <DocChip
              key={doc.id}
              doc={doc}
              data-dag-chat-mention={doc.name}
              onRemove={() => setMentions((had) => had.filter((m) => m.id !== doc.id))}
              removeLabel={`Remove ${doc.title} from the message`}
            />
          ))}
        </div>
      ) : null}
      <textarea
        ref={box}
        className={`dag-chat-composer__input${tall ? " dag-chat-composer__input--tall" : ""}`}
        data-dag-chat-input=""
        rows={1}
        value={text}
        placeholder="Ask for a change, or a question"
        aria-label="Message the Assistant"
        onChange={change}
        onSelect={select}
        onKeyDown={key}
      />
      {unavailable ? (
        <p className="dag-chat-composer__why" data-dag-chat-why="">
          {unavailable.label} is not available: {unavailable.why ?? "it did not answer"}.
        </p>
      ) : null}
      <div className="dag-chat-composer__row">
        <Scope meta={meta} onGrant={(vault, mode) => onGrant(choice, vault, mode)} />
        <span className="dag-chat-modelpick">
          <ModelPicker
            className="dag-chat-picker"
            data-dag-chat-model=""
            providers={pickerProvidersFromChat(models)}
            provider={choice.provider}
            model={choice.model}
            defaultProvider={at?.default ?? choice.provider}
            onChange={(picked) => {
              const provider = (picked.provider ?? choice.provider) as Provider;
              const p = models?.find((m) => m.provider === provider);
              setOver((o) => ({ ...o, provider, model: picked.model ?? p?.default ?? choice.model }));
            }}
          />
        </span>
        <EffortPicker
          className="dag-chat-picker dag-chat-picker--effort"
          data-dag-chat-effort=""
          value={choice.effort}
          onChange={(level) => setOver((o) => ({ ...o, effort: level ?? "" }))}
        />
        <button
          type="button"
          className="dag-icon dag-chat-composer__expand"
          data-dag-chat-expand=""
          aria-label={tall ? "Collapse the message box" : "Expand the message box"}
          aria-pressed={tall}
          title={tall ? "Collapse" : "Expand"}
          onClick={() => setTall((v) => !v)}
        >
          <UnfoldVertical {...ICON} aria-hidden="true" />
        </button>
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
  const view = useMemo(() => scopeOf(vaults, currentVault(), meta), [vaults, meta]);
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
        <span>{view.home}</span>
        {view.granted.length ? <span className="dag-chat-scope__more">+{view.granted.length}</span> : null}
        <ChevronDown {...ICON} aria-hidden="true" />
      </button>
      {open ? (
        <div className="dag-chat-scope__menu" role="menu" data-dag-chat-scope-menu="">
          <p className="dag-chat-scope__line">
            <strong>{view.home}</strong>
            <span>this vault, always</span>
          </p>
          {view.granted.map((g) => (
            <p className="dag-chat-scope__line" key={g.id} data-dag-chat-granted={g.id}>
              <strong>{g.name}</strong>
              <span>{g.mode === "edit" ? "read and change" : "read only"}</span>
              <button type="button" className="dag-button" data-dag-chat-revoke={g.id} onClick={() => onGrant(g.id, null)}>
                Take back
              </button>
            </p>
          ))}
          <p className="dag-chat-scope__title">Grant another vault…</p>
          {view.others.length ? (
            view.others.map((v) => (
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
