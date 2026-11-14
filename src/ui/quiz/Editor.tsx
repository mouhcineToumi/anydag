import { ArrowDown, ArrowUp, Copy, GripVertical, Pin, Plus, Sparkles, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";

import { preloadFieldEditor } from "@/blocks";
import { assertNever } from "@/board/useBoard";
import type { QuizDiagnostic } from "@/quiz/codes";
import { parseQuiz, pinned, type Question } from "@/quiz/parse";
import {
  addQuestion,
  cleanHeading,
  closeFence,
  inputOf,
  mintQuestionId,
  moveQuestion,
  reidQuestion,
  atQuestion,
  removeQuestion,
  replaceQuestion,
  resolveStray,
  setDescription,
  setShuffle,
  stampIds,
  type QuestionInput,
} from "@/quiz/write";
import { ownAssets } from "@/render/assets";
import { useAi } from "@/settings/useAi";
import { startDrag } from "@/ui/pointerDrag";

import { addCards } from "./generate";
import { GenerateCards } from "./GenerateCards";
import { said, fixLabel, type Fix, type Said } from "./problems";
import { FieldHostContext, focusField, RichField, type FieldHost } from "./RichField";
import { QuizMarkdown } from "./QuizMarkdown";

/**
 * A quiz's form: a quiz builder. A card per question, and no Markdown anywhere on it.
 *
 * **The file is never shown.** A question has a type — one right answer, several, or answered in
 * words — and its prompt, details, answers and explanation are rich-text fields (`RichField`, the
 * note's block editor cut to what a question can hold). What they write is the same `.quiz.md` an
 * agent writes: the editor never parses or writes Markdown itself, `src/note/markdown.ts` does, and
 * `src/quiz/write.ts` splices one question.
 *
 * **Every write goes through `src/quiz/write.ts`**, so an edit rewrites the question it is about and
 * no other byte of the file, and a field opened and left writes nothing (`sameQuestion`). And every
 * write first gives an id to any question that has none (`stampIds`): the moment decision 3 names —
 * "whenever the editor writes the file for another reason" — and what lets a card be addressed by
 * its id rather than by a position the other writer can move.
 *
 * **A problem is said in words on the question it is about, with what fixes it** (`problems.ts`).
 * There is no source to send anybody to, so each of the parser's codes has a repair here.
 *
 * **A write that would change what the file's questions are is refused.** A field's blocks are cut
 * to what cannot read back as another part of a question, and the writers escape what would; this is
 * the net under both — a write that would split a question or swallow the next one is not made, and
 * the card says so.
 */

type Kind = "one" | "several" | "written" | "card";

const kindOf = (q: Question): Kind => (q.card ? "card" : q.options.length === 0 ? "written" : q.multi ? "several" : "one");

const KINDS: { kind: Kind; label: string }[] = [
  { kind: "one", label: "One right answer" },
  { kind: "several", label: "Several right answers" },
  { kind: "written", label: "Answered in words" },
  /* A front and a back: no box to type in, the back shown, then whether they had it. */
  { kind: "card", label: "Flashcard" },
];

/** The kinds with no answers to choose from: a model answer, or a card's back. */
const wordsOnly = (k: Kind): k is "written" | "card" => k === "written" || k === "card";

/** The problems on the lines of one question: from its heading to the line before the next one. */
function problemsOf(diagnostics: QuizDiagnostic[], questions: Question[], i: number): QuizDiagnostic[] {
  const from = questions[i]!.line;
  const to = i + 1 < questions.length ? questions[i + 1]!.line : Infinity;
  return diagnostics.filter((d) => d.line >= from && d.line < to);
}

/**
 * Drag one of a list's rows to another place: a mark where it would land while it moves, and
 * `onDrop(to)` — the index it ends at, `splice`'s — on release. Pointer events, `startDrag`'s shape.
 */
function dragRow(e: ReactPointerEvent, row: HTMLElement | null, rows: () => HTMLElement[], onDrop: (to: number) => void): void {
  if (!row) return;
  e.preventDefault();
  let slot = -1;
  const clear = () => {
    for (const r of rows()) delete r.dataset.dagQuizDrop;
    delete row.dataset.dagQuizDragging;
  };
  startDrag(e, {
    onMove(ev) {
      const all = rows();
      row.dataset.dagQuizDragging = "";
      slot = all.findIndex((r) => {
        const b = r.getBoundingClientRect();
        return ev.clientY < b.top + b.height / 2;
      });
      if (slot < 0) slot = all.length;
      for (const [k, r] of all.entries()) {
        if (k === slot) r.dataset.dagQuizDrop = "before";
        else if (k === all.length - 1 && slot === all.length) r.dataset.dagQuizDrop = "after";
        else delete r.dataset.dagQuizDrop;
      }
    },
    onDrop() {
      const from = rows().indexOf(row);
      if (from < 0 || slot < 0) return;
      const to = slot > from ? slot - 1 : slot;
      if (to !== from) onDrop(to);
    },
    onEnd: clear,
  });
}

type StrayTo = "why" | "body" | "drop";

const STRAY_TO: { to: StrayTo; label: string }[] = [
  { to: "why", label: "Add it to the explanation" },
  { to: "body", label: "Move it above the answers" },
  { to: "drop", label: "Delete it" },
];

function ProblemList({
  list,
  onFix,
  onStray,
  stray,
  name,
}: {
  list: Said[];
  onFix(fix: Fix): void;
  /** Where a stray goes, chosen. */
  onStray?(to: StrayTo): void;
  /** A stray's text, shown under its problem. */
  stray?: string;
  name: string;
}) {
  if (list.length === 0) return null;
  return (
    <ul className="dag-quiz__problems" data-dag-quiz-problems="">
      {list.map((p, i) => {
        const label = fixLabel(p.fix);
        return (
          <li key={i} className="dag-quiz__problem" data-dag-quiz-problem={p.code} data-severity={p.severity}>
            <span className="dag-quiz__problem-words">{p.words}</span>
            {label ? (
              <button type="button" className="dag-quiz__fix" data-dag-quiz-fix={p.fix.kind} onClick={() => onFix(p.fix)}>
                {label}
              </button>
            ) : null}
            {p.fix.kind === "stray" ? (
              <div className="dag-quiz__stray" data-dag-quiz-stray="">
                {stray ? (
                  <div className="dag-quiz__stray-text">
                    <QuizMarkdown name={name} md={stray} />
                  </div>
                ) : null}
                <div className="dag-quiz__stray-fixes">
                  {STRAY_TO.map(({ to, label }) => (
                    <button
                      key={to}
                      type="button"
                      className="dag-quiz__fix"
                      data-dag-quiz-stray-to={to}
                      onClick={() => onStray?.(to)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

/** What a card asks of the form. `fix` is a repair addressed to this question. */
interface CardProps {
  q: Question;
  index: number;
  count: number;
  name: string;
  problems: QuizDiagnostic[];
  focus: boolean;
  /** The quiz shuffles its options: each option offers to keep its place. */
  shuffle: boolean;
  /** Why the last edit was not written, until the next one. */
  refused: string | null;
  onEdit(input: QuestionInput): void;
  onMove(to: number): void;
  onRemove(): void;
  onDuplicate(): void;
  onRepair(
    how: { kind: "reid" } | { kind: "clean" } | { kind: "stray"; to: StrayTo } | { kind: "close-fence"; line: number },
  ): void;
  onDragStart(e: ReactPointerEvent): void;
  onNext(): void;
}

function QuestionCard({
  q,
  index,
  count,
  name,
  problems,
  focus,
  shuffle,
  refused,
  onEdit,
  onMove,
  onRemove,
  onDuplicate,
  onRepair,
  onDragStart,
  onNext,
}: CardProps) {
  const input = inputOf(q);
  const card = useRef<HTMLElement>(null);
  const optionList = useRef<HTMLDivElement>(null);
  const [asking, setAsking] = useState(false);
  /* Turning a question with answers into one answered in words, or a flashcard, drops them: asked
     first, and the kind it was turning into is kept for the answer. */
  const [dropping, setDropping] = useState<"written" | "card" | null>(null);
  const [details, setDetails] = useState(false);
  /* An answer just added: it opens as it is drawn, in the same render as the press, so a letter
     typed straight after is never the page's. Let go once it has. */
  const [fresh, setFresh] = useState<number | null>(null);
  useEffect(() => {
    if (fresh !== null) setFresh(null);
  }, [fresh]);
  const addOption = () => {
    onEdit({ ...input, options: [...input.options, { text: "", correct: false }] });
    setFresh(input.options.length);
  };
  const kind = kindOf(q);
  const shown = problems.flatMap((d) => {
    const s = said(d, q);
    return s ? [s] : [];
  });
  /* Something the form has no field for, or an identity two questions share: rewriting the card
     would drop the one or write the other question, so the card is read-only until it is fixed. */
  const held = shown.some((p) => p.fix.kind === "stray" || p.fix.kind === "reid");
  const needsAnswer = shown.some((p) => p.code === "EQ_NO_ANSWER");

  const setOption = (i: number, patch: Partial<{ text: string; correct: boolean; pin: boolean }>) =>
    onEdit({ ...input, options: input.options.map((o, k) => (k === i ? { ...o, ...patch } : o)) });
  /* One right answer: ticking one is choosing it, and the others let go. */
  const choose = (i: number, on: boolean) =>
    kind === "one"
      ? onEdit({ ...input, options: input.options.map((o, k) => ({ ...o, correct: k === i })) })
      : setOption(i, { correct: on });
  const moveOption = (i: number, to: number) => {
    const options = [...input.options];
    options.splice(to, 0, ...options.splice(i, 1));
    onEdit({ ...input, options });
  };

  const setKind = (next: Kind) => {
    if (next === kind) return;
    if (wordsOnly(next)) {
      if (input.options.some((o) => o.text.trim())) return setDropping(next);
      return onEdit({ ...input, options: [], multi: false, card: next === "card" });
    }
    if (wordsOnly(kind))
      return onEdit({
        ...input,
        card: false,
        multi: next === "several",
        options: [
          { text: "", correct: true },
          { text: "", correct: false },
        ],
      });
    if (next === "several") return onEdit({ ...input, multi: true });
    /* One right answer: the first ticked keeps its tick. */
    const first = input.options.findIndex((o) => o.correct);
    return onEdit({ ...input, multi: false, options: input.options.map((o, k) => ({ ...o, correct: k === first })) });
  };

  const fix = (f: Fix) => {
    const at = (sel: string) => card.current?.querySelector(sel);
    switch (f.kind) {
      case "focus":
        if (f.field === "prompt") focusField(at("[data-dag-quiz-prompt]"));
        else if (f.field === "why") focusField(at("[data-dag-quiz-why]"));
        else focusField(card.current?.querySelectorAll("[data-dag-quiz-option-text]")[f.option ?? 0]);
        return;
      case "add-option":
        return addOption();
      case "reid":
      case "clean":
      case "close-fence":
        return onRepair(f);
      case "stray":
      case "none":
        return;
      default:
        return assertNever(f);
    }
  };

  const showDetails = details || !!q.body.trim();

  return (
    <section
      ref={card}
      className="dag-quiz__card"
      data-dag-quiz-question={q.id ?? `L${q.line}`}
      data-dag-quiz-kind={kind}
      data-dag-quiz-needs-answer={needsAnswer ? "" : undefined}
      aria-label={`Question ${index + 1}`}
    >
      <header className="dag-quiz__card-head">
        <button
          type="button"
          className="dag-icon dag-quiz__grip"
          title="Drag to move"
          aria-label={`Drag question ${index + 1} to move it`}
          data-dag-quiz-grip=""
          onPointerDown={onDragStart}
        >
          <GripVertical size={14} strokeWidth={2} aria-hidden="true" />
        </button>
        <span className="dag-quiz__card-number">Question {index + 1}</span>
        <select
          className="dag-select dag-quiz__kind"
          aria-label="Kind of question"
          data-dag-quiz-kind-select=""
          value={kind}
          disabled={held}
          onChange={(e) => setKind(e.target.value as Kind)}
        >
          {KINDS.map((k) => (
            <option key={k.kind} value={k.kind}>
              {k.label}
            </option>
          ))}
        </select>
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
          <button
            type="button"
            className="dag-icon"
            title="Duplicate question"
            aria-label="Duplicate question"
            data-dag-quiz-duplicate=""
            disabled={held}
            onClick={onDuplicate}
          >
            <Copy size={14} strokeWidth={2} aria-hidden="true" />
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
      {dropping ? (
        <p className="dag-quiz__confirm dag-quiz__confirm--line" data-dag-quiz-drop-answers="">
          <span>
            {dropping === "card" ? "A flashcard" : "Answered in words, this question"} has no answers to choose from. Remove them?
          </span>
          <button
            type="button"
            className="dag-quiz__danger"
            data-dag-quiz-drop-answers-yes=""
            onClick={() => {
              setDropping(null);
              onEdit({ ...input, options: [], multi: false, card: dropping === "card" });
            }}
          >
            Remove them
          </button>
          <button type="button" onClick={() => setDropping(null)}>
            Cancel
          </button>
        </p>
      ) : null}
      <ProblemList list={shown} onFix={fix} onStray={(to) => onRepair({ kind: "stray", to })} stray={q.stray} name={name} />
      {refused ? (
        <p className="dag-quiz__note" role="alert" data-dag-quiz-refused="">
          {refused}
        </p>
      ) : null}
      <RichField
        variant="line"
        label={kind === "card" ? "Front" : "Question"}
        placeholder={kind === "card" ? "The front: a question, a term, a prompt" : "What do you want to ask?"}
        md={q.prompt}
        readOnly={held}
        autoFocus={focus}
        className="dag-quiz__prompt"
        attrs={{ "data-dag-quiz-prompt": "" }}
        onCommit={(prompt) => onEdit({ ...input, prompt })}
        onEnter={onNext}
      />
      {showDetails ? (
        <RichField
          variant="block"
          label="Details"
          placeholder={
            kind === "card"
              ? "More on the front: a code sample, a picture, an equation"
              : "More to the question: a code sample, a picture, an equation"
          }
          md={q.body}
          readOnly={held}
          autoFocus={details && !q.body.trim()}
          attrs={{ "data-dag-quiz-body": "" }}
          onCommit={(body) => onEdit({ ...input, body })}
        />
      ) : (
        <button
          type="button"
          className="dag-quiz__more"
          data-dag-quiz-add-details=""
          disabled={held}
          onClick={() => setDetails(true)}
        >
          <Plus size={14} strokeWidth={2} aria-hidden="true" />
          Add details
        </button>
      )}
      {wordsOnly(kind) ? null : (
        <div className="dag-quiz__options" role="list" aria-label="Answers" ref={optionList}>
          {q.options.map((o, i) => (
            <div
              key={i}
              className="dag-quiz__option"
              role="listitem"
              data-dag-quiz-option={i}
              data-dag-quiz-correct={o.correct ? "" : undefined}
            >
              <button
                type="button"
                className="dag-icon dag-quiz__grip"
                title="Drag to move"
                aria-label={`Drag answer ${i + 1} to move it`}
                disabled={held}
                onPointerDown={(e) =>
                  dragRow(
                    e,
                    e.currentTarget.closest<HTMLElement>(".dag-quiz__option"),
                    () => Array.from(optionList.current?.querySelectorAll<HTMLElement>(":scope > .dag-quiz__option") ?? []),
                    (to) => moveOption(i, to),
                  )
                }
              >
                <GripVertical size={14} strokeWidth={2} aria-hidden="true" />
              </button>
              <input
                type={kind === "one" ? "radio" : "checkbox"}
                className={kind === "one" ? "dag-check dag-check--round" : "dag-check"}
                name={kind === "one" ? `correct-${q.id ?? q.line}` : undefined}
                checked={o.correct}
                disabled={held}
                aria-label={`Answer ${i + 1} is right`}
                title="The right answer"
                data-dag-quiz-correct-toggle=""
                onChange={(e) => choose(i, e.target.checked)}
              />
              <RichField
                variant="block"
                label={`Answer ${i + 1}`}
                placeholder={o.correct ? "A right answer" : "A wrong answer"}
                md={o.text}
                readOnly={held}
                autoFocus={fresh === i}
                className="dag-quiz__option-text"
                attrs={{ "data-dag-quiz-option-text": "" }}
                onCommit={(text) => setOption(i, { text })}
              />
              {shuffle ? (
                <button
                  type="button"
                  className="dag-icon dag-quiz__pin"
                  aria-pressed={pinned(o)}
                  disabled={held || (!o.pin && pinned(o))}
                  title={
                    o.pin
                      ? "Keeps its place when the answers shuffle — click to let it move"
                      : pinned(o)
                        ? "Keeps its place: it speaks about the answers around it"
                        : "Keep its place when the answers shuffle"
                  }
                  aria-label={`Keep answer ${i + 1} in its place`}
                  data-dag-quiz-pin={o.pin ? "" : pinned(o) ? "words" : undefined}
                  onClick={() => setOption(i, { pin: !o.pin })}
                >
                  <Pin size={14} strokeWidth={2} aria-hidden="true" />
                </button>
              ) : null}
              <button
                type="button"
                className="dag-icon"
                title="Remove answer"
                aria-label={`Remove answer ${i + 1}`}
                data-dag-quiz-remove-option=""
                disabled={held}
                onClick={() => onEdit({ ...input, options: input.options.filter((_, k) => k !== i) })}
              >
                <X size={14} strokeWidth={2} aria-hidden="true" />
              </button>
            </div>
          ))}
          <button type="button" className="dag-quiz__add-option" data-dag-quiz-add-option="" disabled={held} onClick={addOption}>
            <Plus size={14} strokeWidth={2} aria-hidden="true" />
            Add an answer
          </button>
        </div>
      )}
      <RichField
        variant="block"
        label={kind === "card" ? "Back" : kind === "written" ? "Model answer" : "Explanation"}
        placeholder={
          kind === "card"
            ? "The back: the answer, shown once they have thought of theirs"
            : kind === "written"
              ? "The answer, shown once they have written theirs"
              : "Why the answer is right, shown after answering (optional)"
        }
        md={q.why}
        readOnly={held}
        attrs={{ "data-dag-quiz-why": "" }}
        onCommit={(why) => onEdit({ ...input, why })}
      />
    </section>
  );
}

/** The questions a text holds, by id and in order, and nothing else: what a write may not change. */
const shapeOf = (text: string): string =>
  parseQuiz(text)
    .questions.map((q) => q.id ?? "")
    .join(",");

export function QuizEditor({
  name,
  scheme,
  text,
  onChange,
  target = null,
  onTargetShown,
  children,
}: {
  /** The quiz's name: where its pictures are stored and found. */
  name: string;
  scheme: "light" | "dark";
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
  const [focus, setFocus] = useState<string | null>(null);
  const [refused, setRefused] = useState<{ key: string; why: string } | null>(null);
  /* The flashcards dialog (#140): open while a model's cards are asked for and chosen from. */
  const [generating, setGenerating] = useState(false);
  /* With Generate flashcards turned off (#296) the button goes, and so does a panel left open. */
  const flashcards = useAi().flashcards;
  useEffect(() => {
    if (!flashcards) setGenerating(false);
  }, [flashcards]);
  const root = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  /*
   * A card's React key is the question's id — and a question with none is given one by the first
   * write, which would make its card a new one: the field somebody is typing into would close under
   * them. So an id minted for a card keeps the key the card already had.
   */
  const aliases = useRef(new Map<string, string>());
  const keyOf = (q: Question) => (q.id !== undefined ? (aliases.current.get(q.id) ?? q.id) : `line-${q.line}`);

  useEffect(() => {
    void preloadFieldEditor();
  }, []);

  useEffect(() => {
    if (!target || quiz.questions.length === 0) return;
    const card = root.current?.querySelector<HTMLElement>(`[data-dag-quiz-question="${CSS.escape(target)}"]`);
    if (!card) return;
    card.scrollIntoView({ block: "center" });
    focusField(card.querySelector("[data-dag-quiz-prompt]"));
    onTargetShown?.();
  }, [target, quiz, onTargetShown]);

  const host = useMemo<FieldHost>(
    () => ({
      name,
      scheme,
      resolve: (src) => ownAssets(name, src),
      upload: async (file) => {
        const dataUrl = await new Promise<string>((ok, fail) => {
          const reader = new FileReader();
          reader.onload = () => ok(String(reader.result));
          reader.onerror = () => fail(reader.error);
          reader.readAsDataURL(file);
        });
        const r = await fetch(`/__board/upload?name=${encodeURIComponent(name)}&kind=quiz`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ dataUrl }),
        });
        if (!r.ok) throw new Error(`the picture was refused (${r.status})`);
        return ((await r.json()) as { src: string }).src;
      },
    }),
    [name, scheme],
  );

  /**
   * Stamp what has no id, then write — decision 3's moment. A write whose questions are not the ones
   * it was meant to leave (`expect`, the ids in order) is not made: `key` is the card told why.
   */
  const write = (
    key: string | null,
    fn: (stamped: string, questions: Question[]) => string,
    expect?: (before: string[]) => string[],
  ) => {
    const before = parseQuiz(text).questions;
    const { text: stamped, minted } = stampIds(text);
    if (minted.length) {
      const unnamed = before.filter((q) => q.id === undefined);
      minted.forEach((id, k) => {
        const q = unnamed[k];
        if (q) aliases.current.set(id, `line-${q.line}`);
      });
    }
    const questions = parseQuiz(stamped).questions;
    const next = fn(stamped, questions);
    if (next === text) return;
    const ids = questions.map((q) => q.id ?? "");
    const wanted = (expect ? expect(ids) : ids).join(",");
    if (key !== null && shapeOf(next) !== wanted) {
      setRefused({
        key,
        why: "That can't be written into this question: it would change the questions around it. Nothing was saved.",
      });
      return;
    }
    setRefused(null);
    onChange(next);
  };

  const idAt = (qs: Question[], i: number) => qs[i]!.id!;

  /** A question at the end: two answers to fill in, or none — answered in words, or a flashcard. */
  const add = (kind: "choice" | "written" | "card" = "choice") => {
    const id = mintQuestionId(new Set(quiz.questions.flatMap((q) => (q.id ? [q.id] : []))));
    write(null, (t) =>
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
        ...(kind === "card" ? { card: true } : {}),
      }),
    );
    setFocus(id);
  };

  const description = quiz.questions.length ? quiz.diagnostics.filter((d) => d.line < quiz.questions[0]!.line) : quiz.diagnostics;
  const top = description.flatMap((d) => {
    const s = said(d);
    return s ? [s] : [];
  });
  const cards = () => Array.from(list.current?.querySelectorAll<HTMLElement>(":scope > .dag-quiz__card") ?? []);

  return (
    <FieldHostContext.Provider value={host}>
      <div className="dag-quiz" data-dag-quiz-editor="" ref={root}>
        <div className="dag-quiz__bar">{children}</div>
        <RichField
          variant="block"
          label="Description"
          placeholder="What this quiz is about (optional)"
          md={quiz.description}
          className="dag-quiz__description"
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
          Shuffle the answers in each run
          <span className="dag-quiz__hint"> — a pinned answer, and one that begins “All of the above”, keeps its place</span>
        </label>
        {/* Before the first question only a code block left open can be wrong: what it swallowed. */}
        <ProblemList
          list={top}
          name={name}
          onFix={(f) => {
            if (f.kind === "close-fence") onChange(closeFence(text, f.line));
          }}
        />
        {quiz.questions.length === 0 ? <p className="dag-quiz__empty">No questions yet.</p> : null}
        <div className="dag-quiz__list" ref={list}>
          {quiz.questions.map((q, i) => {
            /* The second of two sharing an id is keyed by its line, so React keeps two cards apart. */
            const shared = q.id !== undefined && quiz.questions.findIndex((x) => x.id === q.id) !== i;
            const key = shared ? `line-${q.line}` : keyOf(q);
            return (
              <QuestionCard
                key={key}
                q={q}
                index={i}
                count={quiz.questions.length}
                name={name}
                problems={problemsOf(quiz.diagnostics, quiz.questions, i)}
                focus={q.id !== undefined && q.id === focus}
                shuffle={quiz.shuffle}
                refused={refused?.key === key ? refused.why : null}
                onEdit={(input) => write(key, (t, qs) => replaceQuestion(t, idAt(qs, i), { ...input, id: idAt(qs, i) }))}
                onMove={(to) => write(null, (t) => atQuestion(t, i, (u, id) => moveQuestion(u, id, to)))}
                onRemove={() => write(null, (t) => atQuestion(t, i, removeQuestion))}
                onDuplicate={() => {
                  const id = mintQuestionId(new Set(quiz.questions.flatMap((x) => (x.id ? [x.id] : []))));
                  write(null, (t, qs) => addQuestion(t, { ...inputOf(qs[i]!), id }, i + 1));
                  setFocus(id);
                }}
                onRepair={(how) => {
                  switch (how.kind) {
                    case "reid":
                      return onChange(reidQuestion(text, i));
                    case "close-fence":
                      return onChange(closeFence(text, how.line));
                    case "clean":
                      return write(null, (t) => atQuestion(t, i, cleanHeading));
                    case "stray":
                      return write(null, (t) => atQuestion(t, i, (u, id) => resolveStray(u, id, how.to)));
                    default:
                      return assertNever(how);
                  }
                }}
                onDragStart={(e) =>
                  dragRow(e, e.currentTarget.closest<HTMLElement>(".dag-quiz__card"), cards, (to) =>
                    write(null, (t) => atQuestion(t, i, (u, id) => moveQuestion(u, id, to))),
                  )
                }
                onNext={() => {
                  const card = cards()[i];
                  focusField(card?.querySelector("[data-dag-quiz-option-text], [data-dag-quiz-body], [data-dag-quiz-why]"));
                }}
              />
            );
          })}
        </div>
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
            onClick={() => add("written")}
          >
            <Plus size={16} strokeWidth={2} aria-hidden="true" />
            Add a question answered in words
          </button>
          <button
            type="button"
            className="dag-quiz__add"
            data-dag-quiz-add-flashcard=""
            title="A front and a back: think of the answer, show the back, say whether you had it"
            onClick={() => add("card")}
          >
            <Plus size={16} strokeWidth={2} aria-hidden="true" />
            Add a flashcard
          </button>
          {flashcards ? (
            <button
              type="button"
              className="dag-quiz__add"
              data-dag-quiz-generate=""
              title="A model writes flashcards from a topic or a note; you choose which to keep"
              onClick={() => setGenerating(true)}
            >
              <Sparkles size={16} strokeWidth={2} aria-hidden="true" />
              Generate flashcards
            </button>
          ) : null}
        </div>
        {generating ? (
          <GenerateCards
            name={name}
            /* The kept cards go in at the end through the `set` op, against the quiz as it is *now*
               — the answer took seconds, and the file may have moved meanwhile. No question is
               stamped on the way (the form's `write` would), so nothing else in the file changes. */
            onAdd={(markdown) => {
              const done = addCards(text, markdown);
              if (!done.ok) return done.error;
              onChange(done.text);
              return null;
            }}
            onClose={() => setGenerating(false)}
          />
        ) : null}
      </div>
    </FieldHostContext.Provider>
  );
}
