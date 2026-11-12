import { LoaderCircle, Sparkles, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { assertNever } from "@/board/useBoard";
import { explainLlmReason, type LlmAction, type LlmReason } from "@/settings/llmReason";
import { readSettings, writeSettings } from "@/settings/store";
import { useProviders } from "@/settings/useProviders";
import { askPage } from "@/ui/chrome";
import { LlmSentence } from "@/ui/LlmSentence";
import { desktop } from "@/vault/desktop";

import {
  COUNT_DEFAULT,
  COUNT_MAX,
  COUNT_MIN,
  noteMaterial,
  requestCards,
  type CardProblem,
  type GeneratedCard,
} from "./generate";
import { QuizMarkdown } from "./QuizMarkdown";

const ICON = { size: 16, strokeWidth: 1.75, strokeLinecap: "round", strokeLinejoin: "round" } as const;

type From = "topic" | "note";

type Step =
  | { step: "ask"; error: string | null; reason?: LlmReason }
  | { step: "running" }
  | { step: "pick"; cards: GeneratedCard[]; keep: boolean[]; problems: CardProblem[]; error: string | null };

interface NoteChoice {
  name: string;
  label: string;
}

/** The vault's notes, by title, for the "from a note" select — the sidebar's listing, asked once. */
async function listNotes(): Promise<NoteChoice[]> {
  const r = await fetch("/__board/list");
  if (!r.ok) throw new Error(`the list of notes did not load (${r.status})`);
  const d = (await r.json()) as { notes?: string[]; titles?: Record<string, string> };
  return (d.notes ?? [])
    .map((name) => ({ name, label: d.titles?.[name] ? `${d.titles[name]} — ${name}` : name }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

async function readNote(name: string): Promise<string> {
  const r = await fetch(`/__board/get?name=${encodeURIComponent(name)}&kind=note`);
  if (!r.ok) throw new Error(r.status === 404 ? "that note is not there any more" : `the note did not load (${r.status})`);
  return ((await r.json()) as { text: string }).text;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * Flashcards made by a model, shown before any of them is kept (#140).
 *
 * The quiz page's *Generate flashcards* opens it. The person says what the cards are about — a topic
 * they type, or a note in the vault, with what to focus on — and how many; the model the settings
 * card names writes them (`/generate`, `kind: "flashcards"`), and the server has already read each
 * card with the quiz parser. **The cards are then a list with a box each, every one kept until
 * unticked, and nothing is written until *Add* is pressed** — `onAdd` writes the kept ones through
 * the quiz's `set` op, at the end, and says why when it cannot, in which case nothing was written.
 *
 * A dialog rather than draft cards in the form: a draft in the form is a question in the file, or a
 * second, unsaved kind of card the form would have to draw and every writer to skip, and a list to
 * tick is all "keep these" needs. It is the settings card's shell, for the rewrite dialog's reasons:
 * it takes focus and owns Escape, and a paste stays in it.
 */
export function GenerateCards({
  name,
  onAdd,
  onClose,
}: {
  /** The quiz's name: where a picture in a card would be found. */
  name: string;
  /** Write these cards' Markdown into the quiz; the reason it could not, or `null` once written. */
  onAdd(markdown: string[]): string | null;
  onClose(): void;
}) {
  const [from, setFrom] = useState<From>("topic");
  const [topic, setTopic] = useState("");
  const [note, setNote] = useState("");
  /* As typed: a box that clamped on every keystroke could not be emptied to type 15. */
  const [countText, setCountText] = useState(String(COUNT_DEFAULT));
  const [notes, setNotes] = useState<NoteChoice[] | null>(null);
  const [step, setStep] = useState<Step>({ step: "ask", error: null });
  const running = useRef<AbortController | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const [providers] = useProviders(step.step === "ask" && Boolean(step.reason));

  useEffect(() => {
    input.current?.focus();
    return () => running.current?.abort();
  }, []);

  useEffect(() => {
    if (from !== "note" || notes) return;
    let live = true;
    listNotes()
      .then((list) => {
        if (!live) return;
        setNotes(list);
        setNote((n) => n || list[0]?.name || "");
      })
      .catch((e: Error) => live && setStep({ step: "ask", error: e.message }));
    return () => {
      live = false;
    };
  }, [from, notes]);

  const ready = from === "topic" ? topic.trim().length > 0 : !!note;
  const typed = Math.round(Number(countText));
  const count = Number.isFinite(typed) && countText.trim() ? Math.min(COUNT_MAX, Math.max(COUNT_MIN, typed)) : COUNT_DEFAULT;

  const close = () => {
    running.current?.abort();
    onClose();
  };

  const generate = async () => {
    if (!ready || step.step === "running") return;
    const stop = new AbortController();
    running.current = stop;
    setStep({ step: "running" });
    try {
      const source = from === "note" ? noteMaterial(await readNote(note)) : undefined;
      if (from === "note" && !source) throw new Error("that note has nothing in it to make flashcards from");
      const { llm } = readSettings();
      const got = await requestCards(
        {
          prompt: topic.trim(),
          ...(source ? { source } : {}),
          count,
          provider: llm.provider,
          model: llm.model,
          reasoning: llm.reasoning,
        },
        stop.signal,
      );
      if (stop.signal.aborted) return;
      if (!got.ok || got.cards.length === 0) {
        setStep({ step: "ask", error: got.error ?? "The model's answer held no flashcard. Nothing was added." });
        return;
      }
      setStep({ step: "pick", cards: got.cards, keep: got.cards.map(() => true), problems: got.problems, error: null });
    } catch (e) {
      if (stop.signal.aborted) return;
      setStep({ step: "ask", error: (e as Error).message, reason: (e as { reason?: LlmReason }).reason });
    } finally {
      if (running.current === stop) running.current = null;
    }
  };

  const cancel = () => {
    running.current?.abort();
    running.current = null;
    setStep({ step: "ask", error: null });
  };

  const explanation =
    step.step === "ask" && step.reason
      ? explainLlmReason(step.reason, {
          host: desktop()?.keys ? "desktop" : "browser",
          providers: providers?.providers,
        })
      : null;
  const act = (a: LlmAction) => {
    switch (a.kind) {
      case "settings":
        /* The dialog and Settings share a layer; the dialog goes first so the tab is the one on top. */
        close();
        askPage("settings", "agents");
        return;
      case "provider":
        if (a.provider) writeSettings({ llm: { provider: a.provider, model: null } });
        void generate();
        return;
      case "retry":
        void generate();
        return;
      default:
        return assertNever(a.kind);
    }
  };

  const kept = step.step === "pick" ? step.cards.filter((_, i) => step.keep[i]) : [];
  const add = () => {
    if (step.step !== "pick" || kept.length === 0) return;
    const refused = onAdd(kept.map((c) => c.markdown));
    if (refused) setStep({ ...step, error: `Nothing was added: ${refused}` });
    else onClose();
  };

  /* On the body, the feedback card's way: the quiz column is a containing block, so a scrim inside
     it would cover the column and leave the toolbar and the margins bright. */
  return createPortal(
    <div className="dag-settings__scrim dag-flashcards__scrim" data-dag-flashcards="" onPointerDown={close}>
      <section
        className="dag-settings dag-flashcards"
        role="dialog"
        aria-modal="true"
        aria-label="Generate flashcards"
        data-dag-flashcards-step={step.step}
        onPointerDown={(e) => e.stopPropagation()}
        onPaste={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            close();
          } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            e.stopPropagation();
            if (step.step === "ask") void generate();
            else if (step.step === "pick") add();
          }
        }}
      >
        <header className="dag-settings__head">
          <Sparkles {...ICON} className="dag-rewrite-dialog__mark" aria-hidden="true" />
          <h2>Generate flashcards</h2>
          <span className="dag-toolbar__spacer" />
          <button type="button" className="dag-icon" aria-label="Close" data-dag-flashcards-close="" onClick={close}>
            <X {...ICON} aria-hidden="true" />
          </button>
        </header>

        {step.step === "pick" ? (
          <>
            <p className="dag-rewrite-dialog__lede">
              Untick any card you do not want. Nothing is added to the quiz until you say so.
            </p>
            <ul className="dag-flashcards__list" aria-label="The flashcards">
              {step.cards.map((c, i) => (
                <li key={i} className="dag-flashcards__card" data-dag-flashcards-card={i}>
                  <label className="dag-flashcards__keep">
                    <input
                      type="checkbox"
                      className="dag-check"
                      checked={step.keep[i]}
                      aria-label={`Keep card ${i + 1}`}
                      data-dag-flashcards-keep=""
                      onChange={(e) => setStep({ ...step, keep: step.keep.map((k, j) => (j === i ? e.target.checked : k)) })}
                    />
                  </label>
                  <div className="dag-flashcards__faces">
                    <div className="dag-flashcards__front" data-dag-flashcards-front="">
                      <QuizMarkdown name={name} md={c.front} inline />
                    </div>
                    {c.body ? (
                      <div className="dag-flashcards__more">
                        <QuizMarkdown name={name} md={c.body} />
                      </div>
                    ) : null}
                    <div className="dag-flashcards__back" data-dag-flashcards-back="">
                      <QuizMarkdown name={name} md={c.back} />
                    </div>
                  </div>
                </li>
              ))}
            </ul>
            {step.problems.length ? (
              <p className="dag-flashcards__note" data-dag-flashcards-left-out={step.problems.length}>
                {plural(new Set(step.problems.map((p) => p.card)).size, "card", "cards")} the model wrote could not be read as a
                flashcard and {new Set(step.problems.map((p) => p.card)).size === 1 ? "is" : "are"} not shown.
              </p>
            ) : null}
            {step.error ? (
              <p className="dag-flashcards__error" role="alert" data-dag-flashcards-error="">
                {step.error}
              </p>
            ) : null}
            <div className="dag-settings__foot dag-flashcards__foot">
              <button type="button" className="dag-icon dag-icon--wide" data-dag-flashcards-again="" onClick={cancel}>
                Start again
              </button>
              <button
                type="button"
                className="dag-icon dag-icon--wide dag-icon--accent"
                data-dag-flashcards-add=""
                disabled={kept.length === 0}
                onClick={add}
              >
                <span>{kept.length ? `Add ${plural(kept.length, "flashcard", "flashcards")}` : "Nothing to add"}</span>
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="dag-rewrite-dialog__lede">
              A model writes the cards from a topic or one of your notes. You see them, and choose which to keep, before anything
              is added.
            </p>
            <div className="dag-flashcards__from" role="radiogroup" aria-label="Make them from">
              {(["topic", "note"] as const).map((f) => (
                <label key={f} className="dag-quiz__check">
                  <input
                    type="radio"
                    className="dag-check dag-check--round"
                    name="dag-flashcards-from"
                    value={f}
                    checked={from === f}
                    disabled={step.step === "running"}
                    data-dag-flashcards-from={f}
                    onChange={() => setFrom(f)}
                  />
                  {f === "topic" ? "A topic" : "A note"}
                </label>
              ))}
            </div>
            {from === "note" ? (
              <select
                className="dag-select dag-flashcards__note-pick"
                aria-label="The note"
                data-dag-flashcards-note=""
                value={note}
                disabled={step.step === "running" || !notes?.length}
                onChange={(e) => setNote(e.target.value)}
              >
                {notes === null ? <option value="">Loading the notes…</option> : null}
                {notes?.length === 0 ? <option value="">This vault has no notes yet</option> : null}
                {notes?.map((n) => (
                  <option key={n.name} value={n.name}>
                    {n.label}
                  </option>
                ))}
              </select>
            ) : null}
            <textarea
              ref={input}
              className="dag-feedback__text"
              data-dag-flashcards-topic=""
              rows={3}
              value={topic}
              disabled={step.step === "running"}
              placeholder={
                from === "topic"
                  ? "For example: the causes of the First World War, or Postgres's MVCC."
                  : "What to focus on (optional). For example: only the definitions."
              }
              aria-label={from === "topic" ? "The topic" : "What to focus on"}
              onChange={(e) => setTopic(e.target.value)}
            />
            <label className="dag-flashcards__count">
              How many
              <input
                type="number"
                className="dag-input"
                min={COUNT_MIN}
                max={COUNT_MAX}
                value={countText}
                disabled={step.step === "running"}
                data-dag-flashcards-count=""
                onChange={(e) => setCountText(e.target.value)}
                onBlur={() => setCountText(String(count))}
              />
            </label>
            {step.step === "ask" && step.error ? (
              <div className="dag-flashcards__error" role="alert" data-dag-flashcards-error="">
                <LlmSentence text={explanation?.sentence ?? step.error} />
                {explanation ? (
                  <div className="dag-flashcards__acts">
                    {explanation.actions.map((a) => (
                      <button
                        key={`${a.kind}:${a.label}`}
                        type="button"
                        className="dag-icon dag-icon--wide"
                        data-dag-flashcards-act={a.kind}
                        onClick={() => act(a)}
                      >
                        {a.label}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
            <div className="dag-settings__foot dag-flashcards__foot">
              {step.step === "running" ? (
                <>
                  <span className="dag-flashcards__running" data-dag-flashcards-running="">
                    <LoaderCircle {...ICON} className="dag-rewrite__spin" aria-hidden="true" />
                    Writing the cards…
                  </span>
                  <button type="button" className="dag-icon dag-icon--wide" data-dag-flashcards-cancel="" onClick={cancel}>
                    Stop
                  </button>
                </>
              ) : (
                <>
                  <span className="dag-rewrite-dialog__hint">
                    <kbd>ctrl</kbd> <kbd>Enter</kbd> to generate
                  </span>
                  <button
                    type="button"
                    className="dag-icon dag-icon--wide dag-icon--accent"
                    data-dag-flashcards-go=""
                    disabled={!ready}
                    onClick={() => void generate()}
                  >
                    <Sparkles {...ICON} aria-hidden="true" />
                    <span>Generate</span>
                  </button>
                </>
              )}
            </div>
          </>
        )}
      </section>
    </div>,
    document.body,
  );
}
