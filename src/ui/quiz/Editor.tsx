import {
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Eye,
  CircleDot,
  Copy,
  GripVertical,
  ListChecks,
  MoreHorizontal,
  PenLine,
  Plus,
  Sparkles,
  SquareStack,
  Trash2,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";

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
import { Button, IconButton, Switch } from "@/ui/controls";
import { startDrag } from "@/ui/pointerDrag";

import { addCards } from "./generate";
import { GenerateCards } from "./GenerateCards";
import { Menu } from "./Menu";
import { blank, brief, said, fixLabel, unfinished, type Fix, type Said } from "./problems";
import { FieldHostContext, focusField, RichField, STILL_OURS, type FieldHost } from "./RichField";
import { Preview } from "./Preview";
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

/** The four kinds, each with what the learner does with one: the words on its tile (#257). */
const KINDS: { kind: Kind; label: string; does: string; icon: LucideIcon }[] = [
  { kind: "one", label: "One right answer", does: "They choose one of your answers.", icon: CircleDot },
  { kind: "several", label: "Several right answers", does: "They tick every right one.", icon: ListChecks },
  { kind: "written", label: "Answered in words", does: "They write, then compare with your answer.", icon: PenLine },
  /* A front and a back: no box to type in, the back shown, then whether they had it. */
  { kind: "card", label: "Flashcard", does: "A front and a back. They say if they knew it.", icon: SquareStack },
];

const KIND = Object.fromEntries(KINDS.map((k) => [k.kind, k])) as Record<Kind, (typeof KINDS)[number]>;

type Mode = "edit" | "preview";

/**
 * Edit or Preview, on the open card's head (#257): one choice of two, so a radiogroup, as the Tasks
 * page's List / Board is — one Tab stop, and the arrows move between them. Under 720px it is
 * hidden and the card's menu offers the other one.
 */
function ModeSwitch({ mode, index, onMode }: { mode: Mode; index: number; onMode(next: Mode): void }) {
  const choices: { value: Mode; label: string }[] = [
    { value: "edit", label: "Edit" },
    { value: "preview", label: "Preview" },
  ];
  return (
    <span className="dag-quiz__preview-switch" role="radiogroup" aria-label={`Show question ${index + 1} as`}>
      {choices.map(({ value, label }) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={mode === value}
          tabIndex={mode === value ? 0 : -1}
          className="dag-quiz__preview-choice"
          data-dag-quiz-preview-choice={value}
          onClick={() => onMode(value)}
          onKeyDown={(e) => {
            if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) return;
            e.preventDefault();
            const next = mode === "edit" ? "preview" : "edit";
            onMode(next);
            e.currentTarget.parentElement?.querySelector<HTMLElement>(`[data-dag-quiz-preview-choice="${next}"]`)?.focus();
          }}
        >
          {label}
        </button>
      ))}
    </span>
  );
}

function KindIcon({ kind }: { kind: Kind }) {
  const Icon = KIND[kind].icon;
  return <Icon className="dag-quiz__kind-icon" size={14} strokeWidth={2} aria-hidden="true" />;
}

/**
 * One kind as a tile: its glyph, its name and what the learner does. The same tile is the empty
 * quiz's way in, a row of *Add a question*'s menu, and a row of a question's kind menu — the words
 * are the same everywhere a kind is chosen. A plain `<button>`, as DESIGN.md keeps the empty board's
 * tiles: it has a line under its name.
 */
function KindTile({
  kind,
  role,
  checked,
  number,
  onPick,
  attrs,
}: {
  kind: Kind;
  role?: "menuitem" | "menuitemradio";
  checked?: boolean;
  /** The key that picks it in a numbered menu. */
  number?: number;
  onPick(): void;
  attrs?: Record<`data-${string}`, string>;
}) {
  const { label, does, icon: Icon } = KIND[kind];
  return (
    <button
      type="button"
      role={role}
      aria-checked={role === "menuitemradio" ? !!checked : undefined}
      className="dag-quiz__tile"
      onClick={onPick}
      {...attrs}
    >
      <Icon className="dag-quiz__tile-icon" size={16} strokeWidth={2} aria-hidden="true" />
      <span className="dag-quiz__tile-name">{label}</span>
      {number !== undefined ? <kbd className="dag-quiz__tile-key">{number}</kbd> : null}
      <span className="dag-quiz__tile-does">{does}</span>
    </button>
  );
}

/** The kinds with no answers to choose from: a model answer, or a card's back. */
const wordsOnly = (k: Kind): k is "written" | "card" => k === "written" || k === "card";

/** What a folded question's line says of it when nothing is missing: how many answers, or its kind. */
function summary(q: Question, kind: Kind): string {
  switch (kind) {
    case "one":
    case "several": {
      const n = q.options.length;
      const right = q.options.filter((o) => o.correct).length;
      return `${n} ${n === 1 ? "answer" : "answers"}${kind === "several" ? ` · ${right} right` : ""}`;
    }
    case "written":
      return "Model answer";
    case "card":
      return "Flashcard";
    default:
      return assertNever(kind);
  }
}

/**
 * Alt+↑ and Alt+↓ on a grip: the place it moves to, or `null` for a key that is not a move — or a
 * move off either end, which is swallowed so the page does not scroll instead.
 */
function moveKey(e: ReactKeyboardEvent, at: number, count: number): number | null {
  if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return null;
  const to = e.key === "ArrowUp" ? at - 1 : e.key === "ArrowDown" ? at + 1 : null;
  if (to === null) return null;
  e.preventDefault();
  return to >= 0 && to < count ? to : null;
}

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
/** What the form's fields are called, for each kind: a flashcard has a front and a back. */
interface FieldWords {
  prompt: { label: string; note?: string; placeholder: string };
  bodyNote: string;
  why: { label: string; note: string; placeholder: string };
}
const CHOICE_WORDS: FieldWords = {
  prompt: { label: "Question", placeholder: "What do you want to ask?" },
  bodyNote: "optional, under the question",
  why: { label: "Explanation", note: "optional, shown after they answer", placeholder: "Why the right answer is right" },
};
const WORDS: Record<Kind, FieldWords> = {
  one: CHOICE_WORDS,
  several: CHOICE_WORDS,
  written: {
    ...CHOICE_WORDS,
    why: { label: "Model answer", note: "shown once they have written theirs", placeholder: "The answer you expect" },
  },
  card: {
    prompt: { label: "Front", note: "what they see first", placeholder: "A question, a term, a prompt" },
    bodyNote: "optional, on the front",
    why: { label: "Back", note: "shown when they turn the card", placeholder: "The answer on the back" },
  },
};

/** An answer's text field: `data-dag-quiz-wants` marks one left blank, which the form asks for. */
function answerAttrs(blank: boolean): Record<string, string> {
  return blank ? { "data-dag-quiz-option-text": "", "data-dag-quiz-wants": "" } : { "data-dag-quiz-option-text": "" };
}

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
  title,
}: {
  list: Said[];
  onFix(fix: Fix): void;
  /** Where a stray goes, chosen. */
  onStray?(to: StrayTo): void;
  /** A stray's text, shown under its problem. */
  stray?: string;
  name: string;
  /** Said above the list: what the problems add up to. */
  title?: string;
}) {
  if (list.length === 0) return null;
  return (
    <div className="dag-quiz__problems" data-dag-quiz-problems="">
      {title ? <p className="dag-quiz__problems-title">{title}</p> : null}
      <ul className="dag-quiz__problem-list">
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
    </div>
  );
}

/** What a card asks of the form. `fix` is a repair addressed to this question. */
interface CardProps {
  q: Question;
  index: number;
  count: number;
  name: string;
  /**
   * What the card says is wrong, in words (`said`), with what a question being written still lacks
   * already left out (#257, rule 3) — the editor decides that, as it counts the unfinished ones.
   */
  shown: Said[];
  focus: boolean;
  /** The quiz shuffles its options: each option offers to keep its place. */
  shuffle: boolean;
  /** The one card open; every other is one line (#257). */
  open: boolean;
  onOpen(): void;
  onFold(): void;
  /** The focus or a press went into this card: it is the one being written. */
  onEnter(): void;
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

/**
 * A folded question: a row of the list, as DESIGN.md keeps one — a plain button, full width, with
 * an ellipsis — that opens it. It says the question, and either what the question is (`summary`) or
 * what it still lacks.
 */
function FoldedRow({ q, kind, name, shown, onOpen }: { q: Question; kind: Kind; name: string; shown: Said[]; onOpen(): void }) {
  const lacks = shown.length > 0;
  return (
    <button type="button" className="dag-quiz__row" aria-expanded={false} data-dag-quiz-row="" onClick={onOpen}>
      <KindIcon kind={kind} />
      <span className="dag-quiz__row-words" data-dag-quiz-row-words="">
        {q.prompt.trim() ? (
          <QuizMarkdown name={name} md={q.prompt} inline />
        ) : (
          <span className="dag-quiz__placeholder">No question yet</span>
        )}
      </span>
      <span className={lacks ? "dag-quiz__row-meta dag-quiz__row-meta--warn" : "dag-quiz__row-meta"} data-dag-quiz-row-meta="">
        {lacks ? (
          <>
            <span className="dag-quiz__dot" aria-hidden="true" />
            {shown.length === 1 ? brief(shown[0]!.code, q) : `${shown.length} things to finish`}
          </>
        ) : (
          summary(q, kind)
        )}
      </span>
      <ChevronRight className="dag-quiz__row-chevron" size={14} strokeWidth={2} aria-hidden="true" />
    </button>
  );
}

/**
 * An answer's place while the quiz shuffles (#257): one that names the others ("All of the above")
 * says in words that it stays, and any other is a toggle, *Keep in place* or *Kept in place*.
 */
function AnswerPin({
  option,
  index,
  last,
  held,
  onToggle,
}: {
  option: Question["options"][number];
  index: number;
  last: boolean;
  held: boolean;
  onToggle(): void;
}) {
  if (!option.pin && pinned(option))
    return (
      <span className="dag-quiz__pin dag-quiz__pin--words" data-dag-quiz-pin="words">
        {last ? "Stays last" : "Stays in place"}: it names the others
      </span>
    );
  return (
    <button
      type="button"
      className="dag-quiz__pin"
      aria-pressed={option.pin}
      aria-label={`${option.pin ? "Kept" : "Keep"} in place: answer ${index + 1}`}
      disabled={held}
      data-dag-quiz-pin={option.pin ? "" : undefined}
      onClick={onToggle}
    >
      {option.pin ? "Kept in place" : "Keep in place"}
    </button>
  );
}

function QuestionCard({
  q,
  index,
  count,
  name,
  shown,
  focus,
  shuffle,
  open,
  onOpen,
  onFold,
  onEnter,
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
  /* The open card shows its form or its Preview (#257); folding it goes back to the form. */
  const [mode, setMode] = useState<Mode>("edit");
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
  const words = WORDS[kind];
  /* An empty answer the card says is empty: its slot is marked, so the words have a place to point. */
  const emptyAnswers = new Set(
    shown.flatMap((p) => (p.fix.kind === "focus" && p.fix.field === "option" ? [p.fix.option ?? 0] : [])),
  );
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
  /* An answer moved from the keyboard: its rows are keyed by place, so the focus is put back on
     its grip where it lands. */
  const regrip = useRef<number | null>(null);
  useLayoutEffect(() => {
    if (regrip.current === null) return;
    optionList.current?.querySelectorAll<HTMLElement>(":scope > .dag-quiz__option .dag-quiz__grip")[regrip.current]?.focus();
    regrip.current = null;
  });
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
  /* What the card says on itself, worked out once for both its folded and its open form. */
  const qid = q.id ?? `L${q.line}`;
  const lacking = shown.length ? "" : undefined;
  const notReady = shown.some((p) => p.severity === "error") ? "Not ready to practise yet" : undefined;
  const dropWhat = dropping === "card" ? "A flashcard" : "Answered in words, this question";
  const tickNote = kind === "one" ? "tick the right one" : "tick every right one";

  /* Folded, a question's open-only asks are let go: a confirm left showing would come back with it. */
  useEffect(() => {
    if (open) return;
    setAsking(false);
    setDropping(null);
    setMode("edit");
  }, [open]);

  /* The grip: dragged by the pointer, moved a place by Alt+↑/↓ — the one way to reorder (#257). */
  const grip = (
    <button
      type="button"
      className="dag-icon dag-quiz__grip"
      aria-label={`Move question ${index + 1}: drag it, or Alt+Up and Alt+Down`}
      data-dag-quiz-grip=""
      onPointerDown={onDragStart}
      onKeyDown={(e) => {
        const to = moveKey(e, index, count);
        if (to !== null) onMove(to);
      }}
    >
      <GripVertical size={14} strokeWidth={2} aria-hidden="true" />
    </button>
  );

  if (!open)
    return (
      <section
        ref={card}
        className="dag-quiz__card dag-quiz__card--folded"
        data-dag-quiz-question={qid}
        data-dag-quiz-kind={kind}
        data-dag-quiz-folded=""
        data-dag-quiz-unfinished={lacking}
        aria-label={`Question ${index + 1}`}
        onFocusCapture={onEnter}
        onPointerDownCapture={onEnter}
      >
        {grip}
        <span className="dag-quiz__row-number">{index + 1}</span>
        <FoldedRow q={q} kind={kind} name={name} shown={shown} onOpen={onOpen} />
      </section>
    );

  return (
    <section
      ref={card}
      className="dag-quiz__card"
      data-dag-quiz-question={qid}
      data-dag-quiz-kind={kind}
      data-dag-quiz-needs-answer={needsAnswer ? "" : undefined}
      data-dag-quiz-unfinished={lacking}
      aria-label={`Question ${index + 1}`}
      onFocusCapture={onEnter}
      onPointerDownCapture={onEnter}
    >
      <header className="dag-quiz__card-head">
        {grip}
        <span className="dag-quiz__card-number">Question {index + 1}</span>
        {/* The kind is changed here, on the question; *Add a question* is where one is chosen to begin with. */}
        <Menu
          label="Kind of question"
          buttonClass="dag-quiz__kind"
          buttonAttrs={{ "data-dag-quiz-kind-button": "", "aria-label": `Kind of question: ${KIND[kind].label}` }}
          menuClass="dag-quiz__kinds dag-quiz__kinds--change"
          menuAttrs={{ "data-dag-quiz-kind-menu": "" }}
          disabled={held}
          button={
            <>
              <KindIcon kind={kind} />
              <span className="dag-quiz__kind-name">{KIND[kind].label}</span>
              <ChevronDown className="dag-quiz__kind-chevron" size={14} strokeWidth={2} aria-hidden="true" />
            </>
          }
        >
          {(close) =>
            KINDS.map((k) => (
              <KindTile
                key={k.kind}
                kind={k.kind}
                role="menuitemradio"
                checked={k.kind === kind}
                attrs={{ "data-dag-quiz-kind-option": k.kind }}
                onPick={() => {
                  close();
                  setKind(k.kind);
                }}
              />
            ))
          }
        </Menu>
        <span className="dag-quiz__card-tools">
          <ModeSwitch mode={mode} index={index} onMode={setMode} />
          <Menu
            label={`Question ${index + 1}`}
            buttonClass="dag-icon dag-icon--md dag-quiz__card-more"
            buttonAttrs={{ "data-dag-quiz-card-more": "", "aria-label": `More for question ${index + 1}` }}
            menuClass="dag-quiz__menu--end"
            menuAttrs={{ "data-dag-quiz-card-menu": "" }}
            button={<MoreHorizontal size={16} strokeWidth={2} aria-hidden="true" />}
          >
            {(close) => (
              <>
                {/* Under 720px the Edit / Preview switch is here rather than in the head (#257, B8). */}
                <button
                  type="button"
                  role="menuitem"
                  className="dag-more__item dag-quiz__menu-narrow"
                  data-dag-quiz-preview-item={mode === "edit" ? "preview" : "edit"}
                  onClick={() => {
                    close();
                    setMode(mode === "edit" ? "preview" : "edit");
                  }}
                >
                  {mode === "edit" ? (
                    <Eye size={14} strokeWidth={2} aria-hidden="true" />
                  ) : (
                    <PenLine size={14} strokeWidth={2} aria-hidden="true" />
                  )}
                  <span>{mode === "edit" ? "Preview" : "Edit"}</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="dag-more__item"
                  data-dag-quiz-duplicate=""
                  disabled={held}
                  onClick={() => {
                    close();
                    onDuplicate();
                  }}
                >
                  <Copy size={14} strokeWidth={2} aria-hidden="true" />
                  <span>Duplicate</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="dag-more__item dag-quiz__menu-danger"
                  data-dag-quiz-delete=""
                  onClick={() => {
                    close();
                    setAsking(true);
                  }}
                >
                  <Trash2 size={14} strokeWidth={2} aria-hidden="true" />
                  <span>Delete</span>
                </button>
              </>
            )}
          </Menu>
          <IconButton
            size="md"
            className="dag-quiz__fold"
            aria-label={`Fold question ${index + 1}`}
            aria-expanded={true}
            data-dag-quiz-fold=""
            onClick={onFold}
          >
            <ChevronUp size={16} strokeWidth={2} aria-hidden="true" />
          </IconButton>
        </span>
      </header>
      {asking ? (
        <p className="dag-quiz__confirm dag-quiz__confirm--line" data-dag-quiz-confirm="">
          <span>Delete this question?</span>
          <button type="button" className="dag-quiz__danger" data-dag-quiz-delete-yes="" onClick={onRemove}>
            Delete
          </button>
          <button type="button" onClick={() => setAsking(false)}>
            Cancel
          </button>
        </p>
      ) : null}
      {dropping ? (
        <p className="dag-quiz__confirm dag-quiz__confirm--line" data-dag-quiz-drop-answers="">
          <span>{dropWhat} has no answers to choose from. Remove them?</span>
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
      {mode === "preview" ? (
        <Preview
          key={`${q.options.map((o) => (pinned(o) ? "k" : "-")).join("")}:${shuffle}`}
          name={name}
          q={q}
          shuffle={shuffle}
          index={index}
        />
      ) : (
        <>
          <ProblemList
            list={shown}
            title={notReady}
            onFix={fix}
            onStray={(to) => onRepair({ kind: "stray", to })}
            stray={q.stray}
            name={name}
          />
          {refused ? (
            <p className="dag-quiz__note" role="alert" data-dag-quiz-refused="">
              {refused}
            </p>
          ) : null}
          <RichField
            variant="line"
            label={words.prompt.label}
            shown
            note={words.prompt.note}
            placeholder={words.prompt.placeholder}
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
              shown
              note={words.bodyNote}
              placeholder="A code sample, a picture, an equation"
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
              Add details: code, a picture, an equation
            </button>
          )}
          {wordsOnly(kind) ? null : (
            <>
              <div className="dag-quiz__label" aria-hidden="true">
                Answers
                <span className="dag-quiz__label-note"> · {tickNote}</span>
              </div>
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
                      aria-label={`Move answer ${i + 1}: drag it, or Alt+Up and Alt+Down`}
                      disabled={held}
                      onKeyDown={(e) => {
                        const to = moveKey(e, i, q.options.length);
                        if (to === null) return;
                        regrip.current = to;
                        moveOption(i, to);
                      }}
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
                      data-dag-quiz-correct-toggle=""
                      onChange={(e) => choose(i, e.target.checked)}
                    />
                    <RichField
                      variant="block"
                      label={`Answer ${i + 1}`}
                      placeholder={i === 0 ? "An answer" : "Another answer"}
                      md={o.text}
                      readOnly={held}
                      autoFocus={fresh === i}
                      className="dag-quiz__option-text"
                      attrs={answerAttrs(emptyAnswers.has(i))}
                      onCommit={(text) => setOption(i, { text })}
                    />
                    {/* A pin in words, and only while the quiz shuffles: with no shuffle nothing moves (#257). */}
                    {shuffle ? (
                      <AnswerPin
                        option={o}
                        index={i}
                        last={i === q.options.length - 1}
                        held={held}
                        onToggle={() => setOption(i, { pin: !o.pin })}
                      />
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
                <button
                  type="button"
                  className="dag-quiz__add-option"
                  data-dag-quiz-add-option=""
                  disabled={held}
                  onClick={addOption}
                >
                  <Plus size={14} strokeWidth={2} aria-hidden="true" />
                  Add an answer
                </button>
              </div>
            </>
          )}
          <RichField
            variant="block"
            label={words.why.label}
            shown
            note={words.why.note}
            placeholder={words.why.placeholder}
            md={q.why}
            readOnly={held}
            attrs={{ "data-dag-quiz-why": "" }}
            onCommit={(why) => onEdit({ ...input, why })}
          />
        </>
      )}
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
  const shuffleNote = useId();
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

  /*
   * **When a question is said to be unfinished** (#257, rule 3): once the focus leaves it with
   * something written in it, or straight away when the page opens on one already partly written. A
   * question with nothing in it never is. So a card the focus enters while it is blank is `quiet`
   * — what it lacks goes unsaid while somebody writes it — and it stops being quiet when the focus
   * or a press goes anywhere else. Kept by the card's React key, which a minted id does not change.
   */
  const [quiet, setQuiet] = useState<ReadonlySet<string>>(() => new Set());
  const active = useRef<string | null>(null);
  const byKey = useRef(new Map<string, Question>());
  const enter = useCallback((key: string | null) => {
    const was = active.current;
    if (key === was) return;
    active.current = key;
    const q = key === null ? undefined : byKey.current.get(key);
    const start = key !== null && q !== undefined && blank(q);
    setQuiet((prev) => {
      if (!(was !== null && prev.has(was)) && !start) return prev;
      const next = new Set(prev);
      if (was !== null) next.delete(was);
      if (start) next.add(key);
      return next;
    });
  }, []);
  /* A press or a focus outside every card leaves the one that was being written. A field's own
     menus and toolbars are portalled out of the card, and are still the field's. */
  useEffect(() => {
    const away = (e: Event) => {
      const t = e.target;
      if (!(t instanceof Element) || t.closest(".dag-quiz__card") || t.closest(STILL_OURS)) return;
      enter(null);
    };
    document.addEventListener("pointerdown", away, true);
    document.addEventListener("focusin", away, true);
    return () => {
      document.removeEventListener("pointerdown", away, true);
      document.removeEventListener("focusin", away, true);
    };
  }, [enter]);

  useEffect(() => {
    void preloadFieldEditor();
  }, []);

  /*
   * **One card open at a time** (#257): every other question is one line. Opening one folds the
   * one that was open — a field in it has already written what was typed, on each keystroke — and
   * folding is leaving it, so what it lacks is said on its line from then on. Kept by the card's
   * React key, which a minted id does not change. `reveal` is a card opened from elsewhere — a
   * search result, *Show them* — to scroll to once it is drawn open, `true` for the caret in its
   * prompt as well.
   */
  const [openKey, setOpenKey] = useState<string | null>(null);
  const reveal = useRef<{ key: string; prompt: boolean } | null>(null);
  const openCard = (key: string | null, show?: { prompt: boolean }) => {
    /* Folding the card being written leaves it; a press on another card has already left it. */
    if (key !== openKey && active.current !== null && active.current === openKey) enter(null);
    setOpenKey(key);
    reveal.current = key !== null && show ? { key, prompt: show.prompt } : null;
  };
  useLayoutEffect(() => {
    const want = reveal.current;
    if (!want || want.key !== openKey) return;
    reveal.current = null;
    const card = root.current?.querySelector<HTMLElement>(".dag-quiz__card:not([data-dag-quiz-folded])");
    if (!card) return;
    card.scrollIntoView({ block: want.prompt ? "center" : "start" });
    if (want.prompt) focusField(card.querySelector("[data-dag-quiz-prompt]"));
  });

  /* A question moved from the keyboard: the focus goes back on its grip where it lands, which a
     moved element can lose on the way. */
  const regrip = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (regrip.current === null) return;
    const at = rows.findIndex((r) => r.key === regrip.current);
    regrip.current = null;
    if (at >= 0) cards()[at]?.querySelector<HTMLElement>(":scope [data-dag-quiz-grip]")?.focus();
  });

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

  /**
   * A question of `kind` at the end, written the moment its kind is chosen and not before (#257,
   * decision 2): an Add abandoned writes nothing. Two answers to fill in, neither ticked — a tick
   * already on the first left people wondering why it was green — or none, answered in words or a
   * flashcard.
   */
  const add = (kind: Kind) => {
    const id = mintQuestionId(new Set(quiz.questions.flatMap((q) => (q.id ? [q.id] : []))));
    write(null, (t) =>
      addQuestion(t, {
        id,
        prompt: "",
        options: wordsOnly(kind)
          ? []
          : [
              { text: "", correct: false },
              { text: "", correct: false },
            ],
        ...(kind === "several" ? { multi: true } : {}),
        ...(kind === "card" ? { card: true } : {}),
      }),
    );
    setFocus(id);
    openCard(id);
  };

  const description = quiz.questions.length ? quiz.diagnostics.filter((d) => d.line < quiz.questions[0]!.line) : quiz.diagnostics;
  const top = description.flatMap((d) => {
    const s = said(d);
    return s ? [s] : [];
  });
  const cards = () => Array.from(list.current?.querySelectorAll<HTMLElement>(":scope > .dag-quiz__card") ?? []);
  /* Which question each card is, for `enter`, and what each says is wrong: drawn afresh each time. */
  byKey.current.clear();
  const rows = quiz.questions.map((q, i) => {
    /* The second of two sharing an id is keyed by its line, so React keeps two cards apart. */
    const shared = q.id !== undefined && quiz.questions.findIndex((x) => x.id === q.id) !== i;
    const key = shared ? `line-${q.line}` : keyOf(q);
    byKey.current.set(key, q);
    const quietHere = blank(q) || quiet.has(key);
    const shown = problemsOf(quiz.diagnostics, quiz.questions, i).flatMap((d) => {
      const s = said(d, q);
      return s && !(quietHere && unfinished(s.code)) ? [s] : [];
    });
    return { q, i, key, shown };
  });
  const unfinishedRows = rows.filter((r) => r.shown.length > 0);
  /* *Show them*: the next unfinished question after the one open, round to the first. */
  const showNext = () => {
    const from = rows.findIndex((r) => r.key === openKey);
    const next = unfinishedRows.find((r) => r.i > from) ?? unfinishedRows[0];
    if (next) openCard(next.key, { prompt: false });
  };

  /* A search result or a `dag:` link: its card opened, scrolled to, the caret in its prompt. Once. */
  useEffect(() => {
    if (!target || quiz.questions.length === 0) return;
    const row = rows.find((r) => r.q.id === target || `L${r.q.line}` === target);
    if (!row) return;
    openCard(row.key, { prompt: true });
    onTargetShown?.();
  }, [target, quiz, onTargetShown]);

  return (
    <FieldHostContext.Provider value={host}>
      <div className="dag-quiz" data-dag-quiz-editor="" ref={root}>
        <div className="dag-quiz__bar">{children}</div>
        <RichField
          variant="block"
          label="Description"
          shown
          note="optional, shown beside each question in a run"
          placeholder="What this quiz is about"
          md={quiz.description}
          className="dag-quiz__description"
          attrs={{ "data-dag-quiz-description": "" }}
          onCommit={(md) => onChange(setDescription(text, md))}
        />
        <div className="dag-quiz__shuffle">
          <label className="dag-quiz__shuffle-label">
            <Switch
              checked={quiz.shuffle}
              data-dag-quiz-shuffle=""
              aria-describedby={shuffleNote}
              onChange={(e) => onChange(setShuffle(text, e.target.checked))}
            />
            Shuffle the answers
          </label>
          <p className="dag-quiz__shuffle-note" id={shuffleNote}>
            Each run shows a question's answers in a new order. While it does, an answer can be kept in place.
          </p>
        </div>
        {quiz.questions.length > 0 ? (
          <p className="dag-quiz__count" data-dag-quiz-count="">
            {quiz.questions.length} {quiz.questions.length === 1 ? "question" : "questions"}
            {unfinishedRows.length > 0 ? (
              <>
                {" · "}
                <span className="dag-quiz__count-unfinished">
                  <span className="dag-quiz__dot" aria-hidden="true" />
                  {unfinishedRows.length} unfinished
                </span>
                {" · "}
                <button type="button" className="dag-quiz__show" data-dag-quiz-show-unfinished="" onClick={showNext}>
                  Show them
                </button>
              </>
            ) : null}
          </p>
        ) : null}
        {/* Before the first question only a code block left open can be wrong: what it swallowed. */}
        <ProblemList
          list={top}
          name={name}
          onFix={(f) => {
            if (f.kind === "close-fence") onChange(closeFence(text, f.line));
          }}
        />
        {quiz.questions.length === 0 ? (
          /* An empty quiz opens on the choice itself: the four kinds, each saying what the learner does. */
          <section className="dag-quiz__first" data-dag-quiz-first="" aria-labelledby="dag-quiz-first-title">
            <h2 className="dag-quiz__first-title" id="dag-quiz-first-title">
              Add the first question
            </h2>
            <p className="dag-quiz__first-hint">Choose what the learner will do. You can change it later.</p>
            <div className="dag-quiz__first-kinds">
              {KINDS.map((k) => (
                <KindTile key={k.kind} kind={k.kind} attrs={{ "data-dag-quiz-add-kind": k.kind }} onPick={() => add(k.kind)} />
              ))}
            </div>
            {flashcards ? (
              <Button
                variant="quiet"
                className="dag-quiz__first-generate"
                data-dag-quiz-generate=""
                onClick={() => setGenerating(true)}
              >
                <Sparkles size={14} strokeWidth={2} aria-hidden="true" />
                Or generate flashcards from a topic or a note
              </Button>
            ) : null}
          </section>
        ) : null}
        <div className="dag-quiz__list" ref={list}>
          {rows.map(({ q, i, key, shown }) => {
            return (
              <QuestionCard
                key={key}
                q={q}
                index={i}
                count={quiz.questions.length}
                name={name}
                shown={shown}
                focus={q.id !== undefined && q.id === focus}
                shuffle={quiz.shuffle}
                open={key === openKey}
                onOpen={() => openCard(key)}
                onFold={() => openCard(null)}
                onEnter={() => enter(key)}
                refused={refused?.key === key ? refused.why : null}
                onEdit={(input) => write(key, (t, qs) => replaceQuestion(t, idAt(qs, i), { ...input, id: idAt(qs, i) }))}
                onMove={(to) => {
                  regrip.current = key;
                  write(null, (t) => atQuestion(t, i, (u, id) => moveQuestion(u, id, to)));
                }}
                onRemove={() => write(null, (t) => atQuestion(t, i, removeQuestion))}
                onDuplicate={() => {
                  const id = mintQuestionId(new Set(quiz.questions.flatMap((x) => (x.id ? [x.id] : []))));
                  write(null, (t, qs) => addQuestion(t, { ...inputOf(qs[i]!), id }, i + 1));
                  setFocus(id);
                  openCard(id);
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
        {quiz.questions.length > 0 ? (
          /* Two ways to add, and no more: the kind is chosen in the menu, where it says what each is. */
          <div className="dag-quiz__adds">
            <Menu
              label="Kind of question"
              buttonClass="dag-quiz__add"
              buttonAttrs={{ "data-dag-quiz-add": "" }}
              menuClass="dag-quiz__kinds"
              menuAttrs={{ "data-dag-quiz-add-menu": "" }}
              numbered
              button={
                <>
                  <Plus size={16} strokeWidth={2} aria-hidden="true" />
                  Add a question
                </>
              }
            >
              {(close) =>
                KINDS.map((k, n) => (
                  <KindTile
                    key={k.kind}
                    kind={k.kind}
                    role="menuitem"
                    number={n + 1}
                    attrs={{ "data-dag-quiz-add-kind": k.kind }}
                    onPick={() => {
                      close();
                      add(k.kind);
                    }}
                  />
                ))
              }
            </Menu>
            {flashcards ? (
              <button type="button" className="dag-quiz__add" data-dag-quiz-generate="" onClick={() => setGenerating(true)}>
                <Sparkles size={16} strokeWidth={2} aria-hidden="true" />
                Generate flashcards
              </button>
            ) : null}
          </div>
        ) : null}
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
