import { AlertTriangle, LoaderCircle, RotateCcw, Sparkles, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type SyntheticEvent } from "react";

import { assertNever } from "@/board/useBoard";
import { DIAGRAM_TYPES, type BoardItem, type DiagramType } from "@/board/types";
import type { Generated } from "@/edit/generate";
import type { EditorCtl } from "@/edit/useEditor";
import { explainLlmReason, type LlmAction, type LlmReason } from "@/settings/llmReason";
import { ModelChip } from "@/settings/ModelChip";
import { modelChoice, modelChoiceText } from "@/settings/modelChoice";
import { writeSettings } from "@/settings/store";
import { useProviders } from "@/settings/useProviders";
import { useAi } from "@/settings/useAi";
import { useSettings } from "@/settings/useSettings";
import { askPage } from "@/ui/chrome";
import { LlmSentence } from "@/ui/LlmSentence";
import { desktop } from "@/vault/desktop";

/**
 * A prompt card: somebody describes a diagram, and a model on the dev server draws it in the card's
 * place (`plugins/generate/`, `ctl.generate`).
 *
 * The card is a small form living on the paper, and three things follow from that. Its controls
 * **stop the press** that would otherwise select and drag the item — the header strip is what you
 * grab it by. Its text is **written through the editor** under the key the panel types under, so a
 * burst of typing is one thing to undo and the file always says what the card says. And its run
 * state is **its own**: `Item` is memoised, and a generation in flight is nothing the board needs to
 * know about until there is a diagram to put down.
 *
 * Under `?snapshot=1` there is no `ctl`, and the card draws its description read-only — a picture of
 * a board with an unrun prompt on it shows what was asked.
 */

type Run =
  | { state: "idle" }
  | { state: "running"; started: number; cancel: AbortController }
  | { state: "failed"; message: string; reason?: LlmReason; result?: Generated };

const ICON = { size: 14, strokeWidth: 2 } as const;
/** How long typing waits before it is written — the panel's figure, for the panel's reason. */
const WRITE_AFTER_MS = 250;

/** A press on a control is the control's, never the item's. */
const mine = (e: SyntheticEvent) => e.stopPropagation();

export function PromptItem({ item, ctl, selected }: { item: BoardItem; ctl: EditorCtl | null; selected: boolean }) {
  /* With prompt cards turned off (#296) a card already in the file is still drawn, as what was
     asked and nothing to run: no model chip, no Generate, no request for the providers. Nothing
     about the card is written, so turning the feature back on finds it as it was. */
  const on = useAi().prompts;
  if (!ctl || !on) return <StillPrompt item={item} />;
  return <LivePrompt item={item} ctl={ctl} selected={selected} />;
}

/** The card read-only: a snapshot's, a view's, and every card's with prompt cards turned off. */
function StillPrompt({ item }: { item: BoardItem }) {
  return (
    <div className="dag-prompt dag-prompt--still" style={item.h !== undefined ? { minHeight: item.h } : undefined}>
      <div className="dag-prompt__head">
        <Sparkles {...ICON} aria-hidden="true" />
        <span>Prompt{item.as ? ` · ${item.as}` : ""}</span>
      </div>
      <p className="dag-prompt__still">{item.body || "An empty prompt."}</p>
    </div>
  );
}

function LivePrompt({ item, ctl, selected }: { item: BoardItem; ctl: EditorCtl; selected: boolean }) {
  const [text, setText] = useState(item.body);
  const [run, setRun] = useState<Run>({ state: "idle" });
  const [now, setNow] = useState(() => Date.now());
  const area = useRef<HTMLTextAreaElement>(null);
  const settings = useSettings();
  const [providers] = useProviders();

  /* The file wins whenever the person is not typing into this box: Claude may have rewritten the
     prompt, or an undo put an older one back. */
  const typing = useRef(false);
  useEffect(() => {
    if (!typing.current) setText(item.body);
  }, [item.body]);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<string | null>(null);
  /* The last write this card made, so a Generate can wait for it: the answer is put down against the
     file, and a replacement racing the text it replaces is a 409 and a retry for nothing. */
  const writing = useRef<Promise<void>>(Promise.resolve());
  const flush = useCallback((): Promise<void> => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (pending.current !== null) writing.current = ctl.write(item.id, { body: pending.current });
    pending.current = null;
    return writing.current;
  }, [ctl, item.id]);
  useEffect(() => () => void flush(), [flush]);

  /* An empty card that has just been selected — dropped from the library, or added with `P` — wants
     the caret, not a second click. */
  const focused = useRef(false);
  useEffect(() => {
    if (!selected || focused.current || item.body.trim()) return;
    focused.current = true;
    area.current?.focus();
  }, [selected, item.body]);

  const running = run.state === "running";
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [running]);
  /* A card that goes away mid-run — replaced, deleted, a board switched — takes its request with it. */
  const live = useRef<AbortController | null>(null);
  useEffect(() => () => live.current?.abort(), []);

  const go = useCallback(async () => {
    if (running) return;
    const prompt = text.trim();
    if (!prompt) {
      area.current?.focus();
      return;
    }
    /* Running first, so a second press while the text is being written finds the button gone. */
    const cancel = new AbortController();
    live.current = cancel;
    setNow(Date.now());
    setRun({ state: "running", started: Date.now(), cancel });
    try {
      await flush();
      cancel.signal.throwIfAborted();
      const result = await ctl.generate(item.id, { prompt, as: item.as }, cancel.signal);
      /* A clean answer has already replaced this card, which is unmounting; there is nothing to set. */
      if (result.ok && result.draft) return;
      setRun({ state: "failed", message: result.error ?? "the diagram still has problems", result });
    } catch (e) {
      if (cancel.signal.aborted) return setRun({ state: "idle" });
      setRun({ state: "failed", message: (e as Error).message, reason: (e as { reason?: LlmReason }).reason });
    } finally {
      if (live.current === cancel) live.current = null;
    }
  }, [ctl, running, text, flush, item.id, item.as]);

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      void go();
    } else if (e.key === "Escape") {
      /* Out of the box and back to the board, whose keys the box was holding. */
      e.currentTarget.blur();
    }
  };

  const who = modelChoiceText(modelChoice(settings.llm, providers));

  const failed = run.state === "failed" ? run : null;
  const draft = failed?.result?.draft;
  const shown = (failed?.result?.diagnostics ?? []).filter((d) => d.severity === "error").slice(0, 3);
  const explanation = failed?.reason
    ? explainLlmReason(failed.reason, {
        host: desktop()?.keys ? "desktop" : "browser",
        providers: providers?.providers,
      })
    : null;
  const act = (a: LlmAction) => {
    switch (a.kind) {
      case "settings":
        askPage("settings", "ai");
        return;
      case "provider":
        if (a.provider) writeSettings({ llm: { provider: a.provider, model: null } });
        void go();
        return;
      case "retry":
        void go();
        return;
      default:
        return assertNever(a.kind);
    }
  };

  return (
    <div className="dag-prompt" data-dag-prompt={run.state} style={item.h !== undefined ? { minHeight: item.h } : undefined}>
      <div className="dag-prompt__head" title="Drag here to move the card">
        <Sparkles {...ICON} aria-hidden="true" />
        <span>Describe a diagram</span>
      </div>
      <textarea
        ref={area}
        className="dag-prompt__text"
        data-dag-prompt-text=""
        value={text}
        rows={4}
        disabled={running}
        placeholder="What should it show? e.g. “A RAG system: a web app asks an API, which searches a vector index and calls an LLM; a nightly worker ingests PDFs from S3.”"
        aria-label="Describe the diagram"
        onPointerDown={mine}
        onDoubleClick={mine}
        onFocus={() => (typing.current = true)}
        onBlur={() => {
          typing.current = false;
          void flush();
        }}
        onChange={(e) => {
          setText(e.target.value);
          pending.current = e.target.value;
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => void flush(), WRITE_AFTER_MS);
        }}
        onKeyDown={onKeyDown}
      />
      <div className="dag-prompt__bar" onPointerDown={mine} onDoubleClick={mine}>
        <ModelChip where="prompt" />
        <select
          className="dag-prompt__as"
          data-dag-prompt-as=""
          value={item.as ?? ""}
          disabled={running}
          title="Which kind of diagram, or let the model choose"
          aria-label="Diagram type"
          onChange={(e) => {
            writing.current = ctl.write(item.id, { as: (e.target.value || null) as DiagramType | null });
          }}
        >
          <option value="">Any type</option>
          {DIAGRAM_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        {running ? (
          <button type="button" className="dag-prompt__btn" data-dag-prompt-cancel="" onClick={() => run.cancel.abort()}>
            <X {...ICON} aria-hidden="true" /> Cancel
          </button>
        ) : (
          <button
            type="button"
            className="dag-prompt__btn dag-prompt__btn--go"
            data-dag-prompt-go=""
            disabled={!text.trim()}
            title="Generate (Ctrl+Enter)"
            onClick={() => void go()}
          >
            <Sparkles {...ICON} aria-hidden="true" /> {failed ? "Retry" : "Generate"}
          </button>
        )}
      </div>
      {running ? (
        <p className="dag-prompt__status" role="status">
          <LoaderCircle {...ICON} className="dag-prompt__spin" aria-hidden="true" />
          Drawing with {who} · {Math.max(0, Math.round((now - run.started) / 1000))}s
        </p>
      ) : failed ? (
        <div className="dag-prompt__fail" role="alert" data-dag-prompt-fail="" onPointerDown={mine}>
          <p className="dag-prompt__status">
            <AlertTriangle {...ICON} aria-hidden="true" />
            <LlmSentence text={explanation?.sentence ?? failed.message} />
            {failed.result?.model
              ? `; ${failed.result.model}, ${failed.result.attempts} attempt${failed.result.attempts === 1 ? "" : "s"}`
              : ""}
          </p>
          {shown.length ? (
            <ul className="dag-prompt__diags">
              {shown.map((d, i) => (
                <li key={i}>
                  <code>{d.code}</code> {d.line ? `line ${d.line}: ` : ""}
                  {d.message}
                </li>
              ))}
            </ul>
          ) : null}
          <div className="dag-prompt__acts">
            {explanation?.actions.map((a) => (
              <button
                key={`${a.kind}:${a.label}`}
                type="button"
                className="dag-prompt__btn"
                data-dag-prompt-act={a.kind}
                onClick={() => act(a)}
              >
                {a.label}
              </button>
            ))}
            {draft ? (
              <button
                type="button"
                className="dag-prompt__btn"
                data-dag-prompt-anyway=""
                title="Put this draft on the board as it is, and fix it there"
                onClick={() => void ctl.accept(item.id, draft)}
              >
                Insert anyway
              </button>
            ) : null}
            <button type="button" className="dag-prompt__btn" onClick={() => setRun({ state: "idle" })}>
              <RotateCcw {...ICON} aria-hidden="true" /> Dismiss
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
