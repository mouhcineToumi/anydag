import { Check, X } from "lucide-react";

import type { Question } from "@/quiz/parse";

import { QuizMarkdown } from "./QuizMarkdown";

/**
 * One question as a run asks it: the prompt and its details, the line on what to do, the options
 * (or the box an open question is answered in), and the verdict once there is one (#257).
 *
 * **The runner and the builder's Preview both draw this**, so the preview is the run's own drawing
 * and not a copy that drifts from it. It holds no state: the runner keeps its round in `round.ts`,
 * the preview a throwaway one, and each hands down what is picked, shown and decided. What is around
 * the question — the runner's head, its description, Previous and Next, the keys — stays with
 * whoever draws it. The runner's screenshot baselines are what prove it draws the same.
 */

/** An option of more than one line is block Markdown — a code block, a list — and drawn as one. */
export const isBlock = (md: string): boolean => md.includes("\n");

/**
 * An option's words: one line inline in its row, as it always was; more, a block — a `<div>`, which
 * a code block's `<pre>` and its copy button can sit in. The copy button inside the label does not
 * pick the option: a click on interactive content in a label is that content's, not the label's.
 */
export function OptionText({ name, md, block }: { name: string; md: string; block: boolean }) {
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

export function Asked({
  name,
  q,
  order,
  picked,
  right,
  shown,
  typed,
  group,
  onToggle,
  onType,
  onReveal,
  onStep,
  onJudge,
}: {
  /** The quiz's name, which its pictures are found by. */
  name: string;
  q: Question;
  /** Where each option is shown: `order[k]` is the file's index of the option in place `k`. */
  order: number[];
  /** The file's indices of the options picked. */
  picked: number[];
  /** The verdict, once there is one. */
  right: boolean | undefined;
  /** An open question's model answer, or a card's back, is showing. */
  shown: boolean;
  /** What was written in an open question's box. */
  typed: string;
  /** The options' radio group, one per question asked. */
  group: string;
  onToggle(i: number): void;
  onType(text: string): void;
  onReveal(): void;
  onStep(by: -1 | 1): void;
  onJudge(right: boolean): void;
}) {
  const multi = q.multi;
  const checked = right !== undefined;
  return (
    <>
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
        <OpenAnswer text={typed} code={CODE.test(q.why)} shown={shown} onType={onType} onReveal={onReveal} onStep={onStep} />
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
                  name={group}
                  checked={on}
                  disabled={checked}
                  onChange={() => onToggle(i)}
                />
                <span className="dag-run__key" aria-hidden="true">
                  {place < 9 ? place + 1 : ""}
                </span>
                <OptionText name={name} md={o.text} block={block} />
                {mark === "right" ? <Check className="dag-run__mark" size={16} strokeWidth={2.5} aria-label="Correct" /> : null}
                {mark === "wrong" ? <X className="dag-run__mark" size={16} strokeWidth={2.5} aria-label="Not correct" /> : null}
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
              <button type="button" className="dag-run__button" data-dag-run-judge="right" onClick={() => onJudge(true)}>
                <span className="dag-run__key" aria-hidden="true">
                  1
                </span>
                I got it
              </button>
              <button type="button" className="dag-run__button" data-dag-run-judge="wrong" onClick={() => onJudge(false)}>
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
    </>
  );
}
