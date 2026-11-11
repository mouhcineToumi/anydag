import { Check, ChevronLeft, ChevronRight, Info, PanelRightClose, RotateCcw, X } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

import { isRight, optionOrder, type Question } from "@/quiz/parse";
import { QUIZ_ABOUT, readFlag, writeLocal } from "@/settings/prefs";

import { QuizMarkdown } from "./QuizMarkdown";
import { answerIn, goTo, judgeIn, pickIn, revealIn, skippedIn, startRound, tally, typeIn, type Round } from "./round";

/**
 * A run: one question at a time, picked, checked, explained, and the next (decision 7).
 *
 * **It records nothing itself.** `record` is handed in by a page that has an account to record
 * against — a quiz's own page, the Mistakes run — and a share link's visitor or `?view=1` gets a run
 * with none, which is the whole difference between practising and taking a shared quiz. So the
 * runner has no idea where an answer goes, and nothing in `src/view/` has to learn that it could.
 *
 * **What is picked is checked against the file's ticks, exactly** (`isRight`): every correct option
 * and no other. One ticked is a radio, several — or the heading's `multi` — are checkboxes, so the
 * control already says whether one answer is being asked for.
 *
 * **Previous and Next move without answering**, and `round.ts` is what that means: a
 * question left unanswered is skipped and records nothing, one already answered shows its answer and
 * is not asked again, and the end offers the skipped ones as a round of their own.
 *
 * **The quiz's description is beside the question** — the prose before the first one,
 * which the form edits and a run used to drop. A panel on the right where the run has the width, an
 * *About this quiz* disclosure above the question where it has not (a container query on
 * `.dag-run`, since a docked sidebar takes the width a media query would count). In Mistakes it is
 * the current question's own quiz's.
 *
 * **An open question is answered in words and graded by the person**: a text box —
 * monospaced when the model answer is code — then *Show the answer*, then *I got it* or *I missed
 * it*, which is the answer recorded. Nothing grades the words: they are the person's, for comparing.
 *
 * **A flashcard is an open question with nothing to type**: the front, *Show the back* (Space or
 * Enter), then the same verdict. Moving on before judging it is a skip, as on any question.
 *
 * Keys, for somebody drilling a hundred questions: `1`–`9` pick an option, Enter checks and then
 * moves on, ← and → go back and forward; on an open question ctrl+Enter shows the answer from the
 * text box, and `1` and `2` say whether it was had; on a flashcard Space shows the back. Only while no text field has the caret — the
 * page around it may have one.
 */

export interface RunQuestion {
  /** The quiz it came from: its name for its pictures, its title for a Mistakes run's header, its
      id for what records the answer, its description for the panel beside the question, and whether
      it shuffles its options. */
  quiz: { name: string; title?: string; id?: string; description?: string; shuffle?: boolean };
  question: Question;
}

/**
 * The order each question's options are shown in, drawn once for a run: shuffled where the
 * quiz says so, the file's order everywhere else. `kept` carries the orders a question was already
 * shown in, so answering the skipped ones keeps what was seen; Again and a new run draw afresh.
 */
function ordersOf(questions: RunQuestion[], kept?: ReadonlyMap<RunQuestion, number[]>): Map<RunQuestion, number[]> {
  return new Map(
    questions.map((rq) => {
      const { options } = rq.question;
      const order = kept?.get(rq) ?? (rq.quiz.shuffle ? optionOrder(options) : options.map((_, i) => i));
      return [rq, order] as const;
    }),
  );
}

interface Props {
  questions: RunQuestion[];
  /** What the run is called: the quiz's title, or "Mistakes". */
  title: string;
  /** Record an answer, or nothing — a run on a share link records nowhere. */
  record?(q: RunQuestion, correct: boolean): void;
  /** Draw each question's quiz above it: the Mistakes run asks from several. */
  showSource?: boolean;
  /** What the end offers, beside the run again. */
  onMistakes?(): void;
  /**
   * What Again does instead of asking the same questions: the Mistakes run asks the server again,
   * because the questions answered right twice in a row have left it.
   */
  onAgain?(): void;
  onExit?(): void;
  exitLabel?: string;
  /** Said when there is nothing to ask. */
  empty?: ReactNode;
  /** Said at the end about what the answers did, when something recorded them. */
  after?(wrong: number, right: number): ReactNode;
}

/** An option of more than one line is block Markdown — a code block, a list — and drawn as one. */
const isBlock = (md: string): boolean => md.includes("\n");

/**
 * An option's words: one line inline in its row, as it always was; more, a block — a `<div>`, which
 * a code block's `<pre>` and its copy button can sit in. The copy button inside the label does not
 * pick the option: a click on interactive content in a label is that content's, not the label's.
 */
function OptionText({ name, md, block }: { name: string; md: string; block: boolean }) {
  return block ? (
    <div className="dag-run__option-text dag-run__option-text--block dag-md">
      <QuizMarkdown name={name} md={md} />
    </div>
  ) : (
    <span className="dag-run__option-text dag-md">
      <QuizMarkdown name={name} md={md} inline />
    </span>
  );
}

/** A model answer holding a fenced code block: the box it is compared with is a code box. */
const CODE = /^ {0,3}(?:`{3,}|~{3,})/m;

/**
 * Where an open question is answered: what was written stays with the question for the run,
 * and ctrl+Enter shows the model answer without leaving the box. Read-only once it is showing — the
 * words are for comparing, and nothing grades them.
 */
function OpenAnswer({
  text,
  code,
  shown,
  onType,
  onReveal,
  onStep,
}: {
  text: string;
  code: boolean;
  shown: boolean;
  onType(text: string): void;
  onReveal(): void;
  /** ← or → in an empty box, which has nothing for them to move over: the run's previous and next. */
  onStep(by: -1 | 1): void;
}) {
  return (
    <textarea
      className={code ? "dag-run__answer dag-run__answer--code" : "dag-run__answer"}
      data-dag-run-answer=""
      aria-label="Your answer"
      placeholder={code ? "Write it here, then compare it with the model answer" : "Write your answer"}
      rows={Math.min(14, Math.max(code ? 5 : 3, text.split("\n").length + 1))}
      spellCheck={!code}
      autoCapitalize={code ? "off" : undefined}
      autoCorrect={code ? "off" : undefined}
      value={text}
      readOnly={shown}
      onChange={(e) => onType(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && !shown) {
          e.preventDefault();
          onReveal();
        } else if (
          (e.key === "ArrowLeft" || e.key === "ArrowRight") &&
          text === "" &&
          !e.shiftKey &&
          !e.altKey &&
          !e.ctrlKey &&
          !e.metaKey
        ) {
          e.preventDefault();
          onStep(e.key === "ArrowLeft" ? -1 : 1);
        }
      }}
    />
  );
}

const typingIn = (t: EventTarget | null): boolean => {
  const el = t as HTMLElement | null;
  if (!el) return false;
  if (el.isContentEditable) return true;
  /* A read-only box takes no typing: an open question's, once its answer is showing, hands `1`, `2`
     and Enter back to the run. */
  if (el.tagName === "TEXTAREA") return !(el as HTMLTextAreaElement).readOnly;
  return el.tagName === "INPUT" && !["radio", "checkbox", "button", "submit"].includes((el as HTMLInputElement).type);
};

export function Runner({
  questions,
  title,
  record,
  showSource = false,
  onMistakes,
  onAgain,
  onExit,
  exitLabel = "Back to the quiz",
  empty,
  after,
}: Props) {
  /* The questions a round asks are the ones it started with: a quiz rewritten by another writer
     mid-run must not move the question somebody is answering out from under them. A new list — a
     run started again, the Mistakes run asked again — is a new round. `whole` is what Again asks,
     which is the whole run even after a round of only the skipped ones. */
  const [whole, setWhole] = useState(questions);
  const [asked, setAsked] = useState(questions);
  const [round, setRound] = useState(0);
  const [state, setState] = useState<Round>(() => startRound(questions.length));
  const [orders, setOrders] = useState(() => ordersOf(questions));
  const [aboutOpen, setAboutOpen] = useState(() => readFlag(QUIZ_ABOUT, true));
  const root = useRef<HTMLDivElement>(null);
  /* Which questions of which round have been recorded, set as the answer is given: two Enters
     before a redraw both see the question unanswered, and only one of them may record. */
  const recorded = useRef(new Set<string>());
  const done = state.finished;
  const at = state.at;
  const current = asked[at];
  const multi = current?.question.multi ?? false;
  /* Where each option is shown: `order[k]` is the file's index of the option in place `k`. */
  const order = (current && orders.get(current)) ?? current?.question.options.map((_, i) => i) ?? [];
  const picked = state.picks[at] ?? [];
  const verdict = state.verdicts[at];
  const checked = verdict !== undefined;
  const open = current?.question.open ?? false;
  const card = current?.question.card ?? false;
  const shown = state.shown[at] ?? false;

  /* `keep` is a round of what this run already showed — the skipped ones — so their order stays. */
  const restart = useCallback((from: RunQuestion[], all?: RunQuestion[], keep = false) => {
    setAsked(from);
    if (all) setWhole(all);
    setRound((r) => r + 1);
    setState(startRound(from.length));
    setOrders((was) => ordersOf(from, keep ? was : undefined));
  }, []);

  /* Only when the list changes — never on mount, where the state already is a fresh round. On
     mount it ran after the first paint, and a `1` pressed in that moment was picked and then wiped. */
  const started = useRef(questions);
  useEffect(() => {
    if (started.current === questions) return;
    started.current = questions;
    restart(questions, questions);
  }, [questions, restart]);

  /* The run takes the keys; an open question still to be answered hands the caret to its text box. */
  useEffect(() => {
    const box = root.current?.querySelector<HTMLTextAreaElement>("[data-dag-run-answer]:not([readonly])");
    (box ?? root.current)?.focus({ preventScroll: true });
  }, [at, round, done]);

  const toggle = useCallback((i: number) => setState((r) => pickIn(r, i, asked[r.at]?.question.multi ?? false)), [asked]);

  const check = useCallback(() => {
    if (!current || checked || picked.length === 0) return;
    const key = `${round}:${at}`;
    if (recorded.current.has(key)) return;
    recorded.current.add(key);
    const right = isRight(current.question, picked);
    setState((r) => (r.at === at ? answerIn(r, right) : r));
    record?.(current, right);
  }, [current, checked, picked, round, at, record]);

  /* An open question's verdict is the person's, given once its model answer is showing. */
  const reveal = useCallback(() => setState((r) => revealIn(r)), []);
  const judge = useCallback(
    (right: boolean) => {
      if (!current || !open || checked || !shown) return;
      const key = `${round}:${at}`;
      if (recorded.current.has(key)) return;
      recorded.current.add(key);
      setState((r) => (r.at === at ? judgeIn(r, right) : r));
      record?.(current, right);
    },
    [current, open, checked, shown, round, at, record],
  );

  const next = useCallback(() => setState((r) => goTo(r, r.at + 1)), []);
  const previous = useCallback(() => setState((r) => (r.at > 0 ? goTo(r, r.at - 1) : r)), []);

  const showAbout = useCallback((open: boolean) => {
    setAboutOpen(open);
    writeLocal(QUIZ_ABOUT, open ? null : "0");
  }, []);

  /* **One listener for the runner's life, there before the first paint**, reading the latest
     handler off a ref. Registered in an effect keyed on the state, it was taken off and put back
     after every render — after the paint, so a `1` pressed the moment a question appeared, or an
     Enter pressed between a pick and the redraw, landed while nothing was listening and was lost.
     The e2e suite found it, under load, as a Check button that never enabled. */
  const onKey = useRef<(e: KeyboardEvent) => void>(() => {});
  onKey.current = (e: KeyboardEvent) => {
    if (done || !current || e.ctrlKey || e.metaKey || e.altKey || typingIn(e.target)) return;
    if (card && e.key === " ") {
      /* A button somebody tabbed to answers its own Space. Prevented either way: the page must not scroll. */
      if ((e.target as HTMLElement | null)?.tagName === "BUTTON") return;
      e.preventDefault();
      if (!shown) reveal();
    } else if (open && (e.key === "1" || e.key === "2")) {
      if (shown && !checked) {
        e.preventDefault();
        judge(e.key === "1");
      }
    } else if (open && e.key === "Enter") {
      if ((e.target as HTMLElement | null)?.tagName === "BUTTON") return;
      e.preventDefault();
      if (checked) next();
      else if (!shown) reveal();
    } else if (/^[1-9]$/.test(e.key)) {
      /* The key names a place on the screen, which is an option of the file through the run's order. */
      const i = order[Number(e.key) - 1];
      if (i !== undefined) {
        e.preventDefault();
        toggle(i);
      }
    } else if (e.key === "Enter") {
      /* A button somebody tabbed to answers its own Enter: Previous must go back, not check. */
      if ((e.target as HTMLElement | null)?.tagName === "BUTTON") return;
      e.preventDefault();
      if (checked) next();
      else check();
    } else if (e.key === "ArrowRight") {
      /* Prevented here, at the window, so a radio with the focus does not also move its pick — the
         default runs after the event has been everywhere. ↑ and ↓ still walk a radio group. */
      e.preventDefault();
      next();
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      previous();
    }
  };
  useLayoutEffect(() => {
    const listen = (e: KeyboardEvent) => onKey.current(e);
    addEventListener("keydown", listen);
    return () => removeEventListener("keydown", listen);
  }, []);

  if (asked.length === 0) {
    return (
      <div className="dag-run dag-run--empty" data-dag-run="empty" ref={root} tabIndex={-1}>
        <h1 className="dag-run__title">{title}</h1>
        <p className="dag-run__note">{empty ?? "There is nothing to ask yet."}</p>
        {onExit ? (
          <div className="dag-run__actions">
            <button type="button" className="dag-run__button" onClick={onExit}>
              {exitLabel}
            </button>
          </div>
        ) : null}
      </div>
    );
  }

  if (done) {
    const { right, wrong, skipped } = tally(state);
    const left = skippedIn(state).map((i) => asked[i]!);
    return (
      <div className="dag-run dag-run--done" data-dag-run="done" ref={root} tabIndex={-1}>
        <h1 className="dag-run__title">{title}</h1>
        <p className="dag-run__score" data-dag-run-score={`${right}/${asked.length}`}>
          {right} of {asked.length} right
        </p>
        {skipped ? (
          <p className="dag-run__tally" data-dag-run-tally={`${right}/${wrong}/${skipped}`}>
            {right} right, {wrong} wrong, {skipped} skipped
          </p>
        ) : null}
        {record && after ? <p className="dag-run__note">{after(wrong, right)}</p> : null}
        <div className="dag-run__actions">
          {skipped ? (
            <button
              type="button"
              className="dag-run__button dag-run__button--primary"
              data-dag-run-skipped={skipped}
              onClick={() => restart(left, undefined, true)}
            >
              Answer the {skipped === 1 ? "one" : skipped} skipped
            </button>
          ) : null}
          <button
            type="button"
            className={`dag-run__button${skipped ? "" : " dag-run__button--primary"}`}
            data-dag-run-again=""
            onClick={() => (onAgain ? onAgain() : restart(whole))}
          >
            <RotateCcw size={14} strokeWidth={2} aria-hidden="true" />
            Again
          </button>
          {onMistakes ? (
            <button type="button" className="dag-run__button" data-dag-run-mistakes="" onClick={onMistakes}>
              Practice mistakes
            </button>
          ) : null}
          {onExit ? (
            <button type="button" className="dag-run__button" data-dag-run-exit="" onClick={onExit}>
              {exitLabel}
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  const q = current!.question;
  const name = current!.quiz.name;
  const right = verdict;
  const last = at + 1 >= asked.length;
  const answered = state.verdicts.filter((v) => v !== undefined).length;
  const about = current!.quiz.description?.trim() ?? "";
  const aboutTitle = showSource ? (current!.quiz.title ?? name) : "About this quiz";
  const aside = about !== "" && aboutOpen;
  return (
    <div
      className="dag-run"
      data-dag-run="asking"
      data-dag-run-question={q.id ?? `L${q.line}`}
      data-dag-run-checked={checked ? (right ? "right" : "wrong") : undefined}
      data-dag-run-open={q.open ? "" : undefined}
      data-dag-run-flashcard={q.card ? "" : undefined}
      ref={root}
      tabIndex={-1}
    >
      <div className="dag-run__layout" data-dag-run-about-open={aside ? "" : undefined}>
        <div className="dag-run__main">
          <div className="dag-run__head">
            <span className="dag-run__where">
              {showSource ? `${current!.quiz.title ?? name} · ` : ""}
              Question {at + 1} of {asked.length}
              {q.card ? (
                <span className="dag-run__flashcard-tag" data-dag-run-flashcard-tag="">
                  Flashcard
                </span>
              ) : null}
            </span>
            <span className="dag-run__progress" aria-hidden="true">
              <span className="dag-run__progress-bar" style={{ width: `${(answered / asked.length) * 100}%` }} />
            </span>
            {about !== "" && !aboutOpen ? (
              <button
                type="button"
                className="dag-icon dag-icon--wide dag-run__about-show"
                data-dag-run-about-show=""
                onClick={() => showAbout(true)}
              >
                <Info size={14} strokeWidth={2} aria-hidden="true" />
                About this quiz
              </button>
            ) : null}
          </div>
          {about !== "" ? (
            <details className="dag-run__about-inline" data-dag-run-about-inline="">
              <summary>{aboutTitle}</summary>
              <div className="dag-run__about-body dag-md">
                <QuizMarkdown name={name} md={about} />
              </div>
            </details>
          ) : null}
          <div className="dag-run__prompt dag-md">
            <h2 className="dag-run__question">
              <QuizMarkdown name={name} md={q.prompt} inline />
            </h2>
            <QuizMarkdown name={name} md={q.body} />
          </div>
          <p className="dag-run__hint">
            {q.card
              ? "Think of the answer, then show the back."
              : q.open
                ? "Write your answer, then compare it with the model answer."
                : multi
                  ? "Choose every correct answer."
                  : "Choose one answer."}
          </p>
          {q.card ? null : q.open ? (
            <OpenAnswer
              text={state.typed[at] ?? ""}
              code={CODE.test(q.why)}
              shown={shown}
              onType={(text) => setState((r) => typeIn(r, text))}
              onReveal={reveal}
              onStep={(by) => (by < 0 ? previous() : next())}
            />
          ) : (
            <div className="dag-run__options" role={multi ? "group" : "radiogroup"} aria-label="Options">
              {order.map((i, place) => {
                const o = q.options[i]!;
                const on = picked.includes(i);
                const mark = checked ? (o.correct ? "right" : on ? "wrong" : undefined) : undefined;
                const block = isBlock(o.text);
                return (
                  <label
                    key={i}
                    className={block ? "dag-run__option dag-run__option--block" : "dag-run__option"}
                    data-dag-run-option={i}
                    data-dag-run-place={place}
                    data-dag-run-picked={on ? "" : undefined}
                    data-dag-run-mark={mark}
                  >
                    <input
                      type={multi ? "checkbox" : "radio"}
                      name={`dag-run-${round}-${at}`}
                      checked={on}
                      disabled={checked}
                      onChange={() => toggle(i)}
                    />
                    <span className="dag-run__key" aria-hidden="true">
                      {place < 9 ? place + 1 : ""}
                    </span>
                    <OptionText name={name} md={o.text} block={block} />
                    {mark === "right" ? (
                      <Check className="dag-run__mark" size={16} strokeWidth={2.5} aria-label="Correct" />
                    ) : null}
                    {mark === "wrong" ? (
                      <X className="dag-run__mark" size={16} strokeWidth={2.5} aria-label="Not correct" />
                    ) : null}
                  </label>
                );
              })}
            </div>
          )}
          {q.open && shown ? (
            <div className="dag-run__verdict" data-dag-run-verdict={checked ? (right ? "right" : "wrong") : "open"}>
              <p className="dag-run__verdict-line">
                {checked ? (right ? "You had it." : "You missed it.") : q.card ? "The back" : "The model answer"}
              </p>
              <div className="dag-run__why dag-md" data-dag-run-model="">
                <QuizMarkdown name={name} md={q.why} />
              </div>
              {checked ? null : (
                <div className="dag-run__judge" role="group" aria-label="Did you get it?">
                  <span className="dag-run__judge-ask">Did you get it?</span>
                  <button type="button" className="dag-run__button" data-dag-run-judge="right" onClick={() => judge(true)}>
                    <span className="dag-run__key" aria-hidden="true">
                      1
                    </span>
                    I got it
                  </button>
                  <button type="button" className="dag-run__button" data-dag-run-judge="wrong" onClick={() => judge(false)}>
                    <span className="dag-run__key" aria-hidden="true">
                      2
                    </span>
                    I missed it
                  </button>
                </div>
              )}
            </div>
          ) : null}
          {checked && !q.open ? (
            <div className="dag-run__verdict" data-dag-run-verdict={right ? "right" : "wrong"}>
              <p className="dag-run__verdict-line">{right ? "Right." : "Not quite."}</p>
              {q.why ? (
                <div className="dag-run__why dag-md">
                  <QuizMarkdown name={name} md={q.why} />
                </div>
              ) : null}
            </div>
          ) : null}
          <div className="dag-run__actions">
            <button
              type="button"
              className="dag-run__button"
              data-dag-run-previous=""
              disabled={at === 0}
              title="Previous question (←)"
              onClick={previous}
            >
              <ChevronLeft size={14} strokeWidth={2} aria-hidden="true" />
              Previous
            </button>
            {q.open ? (
              shown ? null : (
                <button
                  type="button"
                  className="dag-run__button dag-run__button--primary"
                  data-dag-run-reveal=""
                  title={q.card ? "Show the back (Space or Enter)" : "Show the model answer (Enter, or Ctrl+Enter in the box)"}
                  onClick={reveal}
                >
                  {q.card ? "Show the back" : "Show the answer"}
                </button>
              )
            ) : checked ? null : (
              <button
                type="button"
                className="dag-run__button dag-run__button--primary"
                data-dag-run-check=""
                disabled={picked.length === 0}
                onClick={check}
              >
                Check
              </button>
            )}
            <button
              type="button"
              className={`dag-run__button${checked ? " dag-run__button--primary" : ""}`}
              data-dag-run-next=""
              title={last ? undefined : checked ? "Next question (Enter or →)" : "Next question, without answering this one (→)"}
              onClick={next}
            >
              {last ? "See how it went" : "Next"}
              {last ? null : <ChevronRight size={14} strokeWidth={2} aria-hidden="true" />}
            </button>
            {onExit ? (
              <button type="button" className="dag-run__button dag-run__exit" data-dag-run-exit="" onClick={onExit}>
                {exitLabel}
              </button>
            ) : null}
          </div>
        </div>
        {aside ? (
          <aside className="dag-run__about" data-dag-run-about="" aria-label={aboutTitle}>
            <div className="dag-run__about-head">
              <span className="dag-run__about-title">{aboutTitle}</span>
              <button
                type="button"
                className="dag-icon dag-run__about-hide"
                data-dag-run-about-hide=""
                aria-label="Hide the description"
                title="Hide the description"
                onClick={() => showAbout(false)}
              >
                <PanelRightClose size={14} strokeWidth={2} aria-hidden="true" />
              </button>
            </div>
            <div className="dag-run__about-body dag-md">
              <QuizMarkdown name={name} md={about} />
            </div>
          </aside>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Every question with its answers showing — what `?snapshot=1` draws for a quiz, because a picture
 * of a quiz is a fact about the file, and a runner frozen on question one is a picture of nothing.
 */
export function Sheet({
  name,
  title,
  description,
  questions,
}: {
  name: string;
  title: string;
  description: string;
  questions: Question[];
}) {
  return (
    <article className="dag-quiz-sheet" data-dag-quiz-sheet="">
      <h1 className="dag-quiz-sheet__title">{title}</h1>
      {description ? (
        <div className="dag-quiz-sheet__description dag-md">
          <QuizMarkdown name={name} md={description} />
        </div>
      ) : null}
      <ol className="dag-quiz-sheet__questions">
        {questions.map((q, n) => (
          <li key={q.id ?? n} className="dag-quiz-sheet__question" data-dag-quiz-sheet-question={q.id ?? `L${q.line}`}>
            <h2 className="dag-quiz-sheet__prompt">
              <QuizMarkdown name={name} md={q.prompt} inline />
            </h2>
            <div className="dag-md">
              <QuizMarkdown name={name} md={q.body} />
            </div>
            {q.card ? (
              <p className="dag-quiz-sheet__open" data-dag-quiz-sheet-flashcard="">
                Flashcard. The back:
              </p>
            ) : q.open ? (
              <p className="dag-quiz-sheet__open" data-dag-quiz-sheet-open="">
                Answered in words. The model answer:
              </p>
            ) : null}
            {q.options.length ? (
              <ul className="dag-quiz-sheet__options">
                {q.options.map((o, i) => (
                  <li
                    key={i}
                    className={
                      isBlock(o.text) ? "dag-quiz-sheet__option dag-quiz-sheet__option--block" : "dag-quiz-sheet__option"
                    }
                    data-dag-run-mark={o.correct ? "right" : undefined}
                  >
                    {o.correct ? (
                      <Check className="dag-run__mark" size={14} strokeWidth={2.5} aria-label="Correct" />
                    ) : (
                      <span className="dag-quiz-sheet__blank" />
                    )}
                    <OptionText name={name} md={o.text} block={isBlock(o.text)} />
                  </li>
                ))}
              </ul>
            ) : null}
            {q.why ? (
              <div className="dag-run__why dag-md">
                <QuizMarkdown name={name} md={q.why} />
              </div>
            ) : null}
          </li>
        ))}
      </ol>
    </article>
  );
}
