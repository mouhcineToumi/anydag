import { ArrowDown, ArrowUp, Pin, Plus, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from "react";

import type { QuizDiagnostic } from "@/quiz/codes";
import { parseQuiz, pinned, type Question } from "@/quiz/parse";
import {
  addQuestion,
  inputOf,
  mintQuestionId,
  moveQuestion,
  removeQuestion,
  replaceQuestion,
  setDescription,
  setShuffle,
  stampIds,
  type QuestionInput,
} from "@/quiz/write";
import { QUIZ_MODE, readPref, writeLocal } from "@/settings/prefs";

/**
 * A quiz's form (decision 7): a card per question, and the file behind them.
 *
 * **Every field is Markdown source in a plain field**, drawn by the runner. A quiz's text is a line
 * here and a paragraph there, and a second rich-text surface is exactly what this is not building.
 *
 * **Every write goes through `src/quiz/write.ts`**, so an edit rewrites the question it is about and
 * no other byte of the file. And every write first gives an id to any question that has none
 * (`stampIds`): that is the moment decision 3 names — "whenever the editor writes the file for
 * another reason" — and it is what lets a card be addressed by its id rather than by a position that
 * the other writer can move.
 *
 * **A field keeps what is being typed while it has the caret.** The form redraws from the file on
 * every keystroke, and the file's form of a prompt is trimmed — so a field that showed the file's
 * answer would eat a space the moment it was typed, before the next word. `Field` holds its own
 * draft while focused and takes the file's again when it lets go.
 */

type Mode = "questions" | "source";

function readMode(): Mode {
  return readPref(QUIZ_MODE) === "source" ? "source" : "questions";
}

interface FieldProps {
  value: string;
  onCommit(next: string): void;
  multiline?: boolean;
  /** The fewest rows a multi-line field shows: an option starts as one line and grows. */
  minRows?: number;
  placeholder?: string;
  label: string;
  readOnly?: boolean;
  autoFocus?: boolean;
  className?: string;
  attrs?: Record<string, string>;
}

function Field({
  value,
  onCommit,
  multiline = false,
  minRows = 2,
  placeholder,
  label,
  readOnly,
  autoFocus,
  className,
  attrs,
}: FieldProps) {
  const [draft, setDraft] = useState(value);
  const focused = useRef(false);
  const ref = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  useEffect(() => {
    if (!focused.current) setDraft(value);
  }, [value]);
  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);
  const common = {
    ref,
    value: draft,
    placeholder,
    "aria-label": label,
    readOnly,
    className: `dag-quiz__field${className ? ` ${className}` : ""}`,
    onFocus: () => {
      focused.current = true;
    },
    onBlur: () => {
      focused.current = false;
      setDraft(value);
    },
    onChange: (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setDraft(e.target.value);
      onCommit(e.target.value);
    },
    ...attrs,
  };
  return multiline ? (
    <textarea rows={Math.min(12, Math.max(minRows, draft.split("\n").length))} {...common} />
  ) : (
    <input type="text" {...common} />
  );
}

/**
 * The problems on the lines of one question: from its heading to the line before the next one.
 *
 * Not `WQ_NO_ID`: that one is about the file — the id the form writes the first time the
 * question is edited or answered — and on a card it read as something the person had got wrong. It
 * stays in Source, with the file.
 */
function problemsOf(diagnostics: QuizDiagnostic[], questions: Question[], i: number): QuizDiagnostic[] {
  const from = questions[i]!.line;
  const to = i + 1 < questions.length ? questions[i + 1]!.line : Infinity;
  return diagnostics.filter((d) => d.line >= from && d.line < to && d.code !== "WQ_NO_ID");
}

function Problems({ list, lines = false }: { list: QuizDiagnostic[]; lines?: boolean }) {
  if (list.length === 0) return null;
  return (
    <ul className="dag-quiz__problems" data-dag-quiz-problems="">
      {list.map((d, i) => (
        <li key={i} className="dag-quiz__problem" data-dag-quiz-problem={d.code} data-severity={d.severity}>
          {lines ? <span className="dag-quiz__problem-line">line {d.line}</span> : null}
          <span>{d.message}</span>
        </li>
      ))}
    </ul>
  );
}

interface CardProps {
  q: Question;
  index: number;
  count: number;
  problems: QuizDiagnostic[];
  focus: boolean;
  /** The quiz shuffles its options: each option offers to keep its place. */
  shuffle: boolean;
  onEdit(input: QuestionInput): void;
  onMove(to: number): void;
  onRemove(): void;
}

function QuestionCard({ q, index, count, problems, focus, shuffle, onEdit, onMove, onRemove }: CardProps) {
  const input = inputOf(q);
  const [asking, setAsking] = useState(false);
  const correct = q.options.filter((o) => o.correct).length;
  /* No options: answered in words, its explanation the model answer — or a flashcard, the front
     shown, then the back, with nothing typed. */
  const open = q.options.length === 0;
  const card = q.card;
  /* Something after the options the form has no field for: rewriting the card would drop it, so the
     card says where to edit it instead. */
  const stray = problems.some((p) => p.code === "EQ_STRAY");
  const setOption = (i: number, patch: Partial<{ text: string; correct: boolean; pin: boolean }>) =>
    onEdit({ ...input, options: input.options.map((o, k) => (k === i ? { ...o, ...patch } : o)) });
  const moveOption = (i: number, to: number) => {
    const options = [...input.options];
    options.splice(to, 0, ...options.splice(i, 1));
    onEdit({ ...input, options });
  };

  return (
    <section className="dag-quiz__card" data-dag-quiz-question={q.id ?? `L${q.line}`} aria-label={`Question ${index + 1}`}>
      <header className="dag-quiz__card-head">
        <span className="dag-quiz__card-number">
          Question {index + 1}
          {card ? (
            <span className="dag-quiz__flashcard-tag" data-dag-quiz-flashcard="">
              Flashcard
            </span>
          ) : null}
        </span>
        <span className="dag-quiz__card-tools">
          <button
            type="button"
            className="dag-icon"
            title="Move up"
            aria-label="Move up"
            disabled={index === 0}
            onClick={() => onMove(index - 1)}
          >
            <ArrowUp size={14} strokeWidth={2} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="dag-icon"
            title="Move down"
            aria-label="Move down"
            disabled={index === count - 1}
            onClick={() => onMove(index + 1)}
          >
            <ArrowDown size={14} strokeWidth={2} aria-hidden="true" />
          </button>
          {asking ? (
            <span className="dag-quiz__confirm" data-dag-quiz-confirm="">
              <span>Delete this question?</span>
              <button type="button" className="dag-quiz__danger" data-dag-quiz-delete-yes="" onClick={onRemove}>
                Delete
              </button>
              <button type="button" onClick={() => setAsking(false)}>
                Cancel
              </button>
            </span>
          ) : (
            <button
              type="button"
              className="dag-icon"
              title="Delete question"
              aria-label="Delete question"
              data-dag-quiz-delete=""
              onClick={() => setAsking(true)}
            >
              <Trash2 size={14} strokeWidth={2} aria-hidden="true" />
            </button>
          )}
        </span>
      </header>
      {stray ? <p className="dag-quiz__note">This question has text the form cannot show. Edit it in Source.</p> : null}
      <Field
        label={card ? "Front" : "Question"}
        placeholder={card ? "The front: a question, a term, a prompt" : "What do you want to ask?"}
        value={q.prompt}
        readOnly={stray}
        autoFocus={focus}
        className="dag-quiz__prompt"
        attrs={{ "data-dag-quiz-prompt": "" }}
        onCommit={(prompt) => onEdit({ ...input, prompt })}
      />
      <Field
        label={card ? "More on the front" : "More to the question"}
        placeholder={
          card
            ? "More on the front, a code sample, a picture (optional)"
            : "More to the question, a code sample, a picture (optional)"
        }
        multiline
        value={q.body}
        readOnly={stray}
        attrs={{ "data-dag-quiz-body": "" }}
        onCommit={(body) => onEdit({ ...input, body })}
      />
      {open && !card ? (
        <p className="dag-quiz__note" data-dag-quiz-open="">
          Answered in words: the person writes an answer, sees the model answer below, and says whether they had it. Add an option
          to make it multiple choice.
        </p>
      ) : null}
      {card ? (
        <p className="dag-quiz__note" data-dag-quiz-flashcard-note="">
          A flashcard: the person sees the front, thinks of the answer, shows the back, and says whether they had it.
        </p>
      ) : null}
      {open ? (
        <label className="dag-quiz__check">
          <input
            type="checkbox"
            className="dag-check"
            checked={card}
            disabled={stray}
            data-dag-quiz-flashcard-toggle=""
            onChange={(e) => onEdit({ ...input, card: e.target.checked })}
          />
          Ask it as a flashcard
          <span className="dag-quiz__hint"> — no box to type in: show the back, then say whether they had it</span>
        </label>
      ) : null}
      {card ? null : (
        <div className="dag-quiz__options" role="list" aria-label="Options">
          {q.options.map((o, i) => (
            <div
              key={i}
              className="dag-quiz__option"
              role="listitem"
              data-dag-quiz-option={i}
              data-dag-quiz-correct={o.correct ? "" : undefined}
            >
              <input
                type="checkbox"
                className="dag-check"
                checked={o.correct}
                disabled={stray}
                aria-label={`Option ${i + 1} is correct`}
                title="Correct"
                data-dag-quiz-correct-toggle=""
                onChange={(e) => setOption(i, { correct: e.target.checked })}
              />
              {/* A text area of one row that grows: an option may be a code block. */}
              <Field
                label={`Option ${i + 1}`}
                placeholder={o.correct ? "A correct answer" : "A wrong answer"}
                multiline
                minRows={1}
                value={o.text}
                readOnly={stray}
                className="dag-quiz__option-text"
                attrs={{ "data-dag-quiz-option-text": "" }}
                onCommit={(text) => setOption(i, { text })}
              />
              {shuffle ? (
                <button
                  type="button"
                  className="dag-icon dag-quiz__pin"
                  aria-pressed={pinned(o)}
                  disabled={stray || (!o.pin && pinned(o))}
                  title={
                    o.pin
                      ? "Keeps its place when the options shuffle — click to let it move"
                      : pinned(o)
                        ? "Keeps its place: it speaks about the options around it"
                        : "Keep its place when the options shuffle"
                  }
                  aria-label={`Keep option ${i + 1} in its place`}
                  data-dag-quiz-pin={o.pin ? "" : pinned(o) ? "words" : undefined}
                  onClick={() => setOption(i, { pin: !o.pin })}
                >
                  <Pin size={14} strokeWidth={2} aria-hidden="true" />
                </button>
              ) : null}
              <button
                type="button"
                className="dag-icon"
                title="Move up"
                aria-label={`Move option ${i + 1} up`}
                disabled={stray || i === 0}
                onClick={() => moveOption(i, i - 1)}
              >
                <ArrowUp size={14} strokeWidth={2} aria-hidden="true" />
              </button>
              <button
                type="button"
                className="dag-icon"
                title="Remove option"
                aria-label={`Remove option ${i + 1}`}
                data-dag-quiz-remove-option=""
                disabled={stray}
                onClick={() => onEdit({ ...input, options: input.options.filter((_, k) => k !== i) })}
              >
                <X size={14} strokeWidth={2} aria-hidden="true" />
              </button>
            </div>
          ))}
          <button
            type="button"
            className="dag-quiz__add-option"
            data-dag-quiz-add-option=""
            disabled={stray}
            onClick={() => onEdit({ ...input, options: [...input.options, { text: "", correct: false }] })}
          >
            <Plus size={14} strokeWidth={2} aria-hidden="true" />
            Add an option
          </button>
        </div>
      )}
      {open ? null : (
        <label className="dag-quiz__check">
          <input
            type="checkbox"
            className="dag-check"
            checked={q.multi}
            disabled={stray || correct > 1}
            data-dag-quiz-multi=""
            onChange={(e) => onEdit({ ...input, multi: e.target.checked })}
          />
          Ask for every correct answer
          {correct > 1 ? <span className="dag-quiz__hint"> (it does: more than one is correct)</span> : null}
        </label>
      )}
      <Field
        label={card ? "Back" : open ? "Model answer" : "Explanation"}
        placeholder={
          card
            ? "The back: the answer, shown once they have thought of theirs"
            : open
              ? "The answer, shown once they have written theirs — a code block if it is code"
              : "Why the answer is right, shown after answering (optional)"
        }
        multiline
        value={q.why}
        readOnly={stray}
        attrs={{ "data-dag-quiz-why": "" }}
        onCommit={(why) => onEdit({ ...input, why })}
      />
      <Problems list={problems} />
    </section>
  );
}

export function QuizEditor({
  text,
  onChange,
  target = null,
  onTargetShown,
  children,
}: {
  text: string;
  onChange(next: string): void;
  /**
   * A question a search result or a `dag:<id>#<question>` link named — its `{#id}`, or `L<line>` for
   * one with none yet, the corpus's own parts. Shown once: scrolled to the middle, the caret in its
   * prompt, and let go of, the note page's rule (`src/refs/target.ts`).
   */
  target?: string | null;
  onTargetShown?(): void;
  children?: ReactNode;
}) {
  const quiz = useMemo(() => parseQuiz(text), [text]);
  const [mode, setMode] = useState<Mode>(readMode);
  const [focus, setFocus] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!target || quiz.questions.length === 0) return;
    const card = root.current?.querySelector<HTMLElement>(`[data-dag-quiz-question="${CSS.escape(target)}"]`);
    if (!card) return;
    if (mode !== "questions") setMode("questions");
    card.scrollIntoView({ block: "center" });
    card.querySelector<HTMLInputElement>("[data-dag-quiz-prompt]")?.focus({ preventScroll: true });
    onTargetShown?.();
  }, [target, quiz, mode, onTargetShown]);

  const chooseMode = (next: Mode) => {
    setMode(next);
    writeLocal(QUIZ_MODE, next);
  };

  /** Stamp what has no id, then write — decision 3's moment. */
  const write = (fn: (stamped: string, questions: Question[]) => string) => {
    const stamped = stampIds(text).text;
    onChange(fn(stamped, parseQuiz(stamped).questions));
  };

  /** A question at the end: two options to fill in, or none — an open question, or a flashcard. */
  const add = (kind: "choice" | "open" | "flashcard" = "choice") => {
    const id = mintQuestionId(new Set(quiz.questions.flatMap((q) => (q.id ? [q.id] : []))));
    write((t) =>
      addQuestion(t, {
        id,
        prompt: "",
        options:
          kind === "choice"
            ? [
                { text: "", correct: true },
                { text: "", correct: false },
              ]
            : [],
        ...(kind === "flashcard" ? { card: true } : {}),
      }),
    );
    setFocus(id);
  };

  const top = quiz.diagnostics.filter((d) => quiz.questions.length === 0 || d.line < quiz.questions[0]!.line);

  return (
    <div className="dag-quiz" data-dag-quiz-editor={mode} ref={root}>
      <div className="dag-quiz__bar">
        <div className="dag-quiz__mode" role="radiogroup" aria-label="Edit as">
          {(["questions", "source"] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={mode === m}
              data-dag-quiz-mode={m}
              onClick={() => chooseMode(m)}
            >
              {m === "questions" ? "Questions" : "Source"}
            </button>
          ))}
        </div>
        {children}
      </div>
      {mode === "source" ? (
        <div className="dag-quiz__source">
          <Field
            label="Source"
            multiline
            value={text}
            className="dag-quiz__source-text"
            attrs={{ "data-dag-quiz-source": "" }}
            onCommit={onChange}
          />
          <Problems list={quiz.diagnostics} lines />
        </div>
      ) : (
        <>
          <Field
            label="Description"
            placeholder="What this quiz is about (optional)"
            multiline
            value={quiz.description}
            attrs={{ "data-dag-quiz-description": "" }}
            onCommit={(md) => onChange(setDescription(text, md))}
          />
          <label className="dag-quiz__check dag-quiz__shuffle">
            <input
              type="checkbox"
              className="dag-check"
              checked={quiz.shuffle}
              data-dag-quiz-shuffle=""
              onChange={(e) => onChange(setShuffle(text, e.target.checked))}
            />
            Shuffle the options in each run
            <span className="dag-quiz__hint"> — a pinned option, and one that begins “All of the above”, keeps its place</span>
          </label>
          <Problems list={top.filter((d) => d.code !== "WQ_EMPTY")} />
          {quiz.questions.length === 0 ? <p className="dag-quiz__empty">No questions yet.</p> : null}
          {quiz.questions.map((q, i) => (
            <QuestionCard
              key={q.id ?? `line-${q.line}`}
              q={q}
              index={i}
              count={quiz.questions.length}
              problems={problemsOf(quiz.diagnostics, quiz.questions, i)}
              focus={q.id !== undefined && q.id === focus}
              shuffle={quiz.shuffle}
              onEdit={(input) => write((t, qs) => replaceQuestion(t, qs[i]!.id!, { ...input, id: qs[i]!.id }))}
              onMove={(to) => write((t, qs) => moveQuestion(t, qs[i]!.id!, to))}
              onRemove={() => write((t, qs) => removeQuestion(t, qs[i]!.id!))}
            />
          ))}
          <div className="dag-quiz__adds">
            <button type="button" className="dag-quiz__add" data-dag-quiz-add="" onClick={() => add()}>
              <Plus size={16} strokeWidth={2} aria-hidden="true" />
              {quiz.questions.length === 0 ? "Add the first question" : "Add a question"}
            </button>
            <button
              type="button"
              className="dag-quiz__add"
              data-dag-quiz-add-open=""
              title="A question answered in words, compared with a model answer"
              onClick={() => add("open")}
            >
              <Plus size={16} strokeWidth={2} aria-hidden="true" />
              Add an open question
            </button>
            <button
              type="button"
              className="dag-quiz__add"
              data-dag-quiz-add-flashcard=""
              title="A front and a back: think of the answer, show the back, say whether you had it"
              onClick={() => add("flashcard")}
            >
              <Plus size={16} strokeWidth={2} aria-hidden="true" />
              Add a flashcard
            </button>
          </div>
        </>
      )}
    </div>
  );
}
