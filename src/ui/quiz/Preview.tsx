import { RotateCcw } from "lucide-react";
import { useState } from "react";

import { isRight, optionOrder, type Question } from "@/quiz/parse";
import { Button } from "@/ui/controls";

import { Asked } from "./Asked";

/**
 * The open card's Preview (#257): the question drawn by the runner's own `Asked`, answerable, with
 * the options in a fresh order where the quiz shuffles — a kept answer where it is — and **nothing
 * recorded or written**. Its round is its own and is thrown away with it: Edit goes back to the form
 * as it was, and *Try again* draws the order afresh.
 *
 * The parent keys it by what the order is drawn from (how many options, which are kept, whether the
 * quiz shuffles), so a write by another hand that changes those starts a new one rather than leaving
 * an order that points past the options.
 */
export function Preview({ name, q, shuffle, index }: { name: string; q: Question; shuffle: boolean; index: number }) {
  const draw = () => (shuffle ? optionOrder(q.options) : q.options.map((_, i) => i));
  const [order, setOrder] = useState(draw);
  const [picked, setPicked] = useState<number[]>([]);
  const [right, setRight] = useState<boolean | undefined>(undefined);
  const [shown, setShown] = useState(false);
  const [typed, setTyped] = useState("");
  const [round, setRound] = useState(0);

  const again = () => {
    setOrder(draw());
    setPicked([]);
    setRight(undefined);
    setShown(false);
    setTyped("");
    setRound((r) => r + 1);
  };
  const toggle = (i: number) => {
    if (right !== undefined) return;
    setPicked((was) => (q.multi ? (was.includes(i) ? was.filter((k) => k !== i) : [...was, i]) : [i]));
  };
  const words = q.open || q.card;
  const shuffled = shuffle && !words && q.options.length > 1;

  return (
    <div className="dag-quiz__preview" role="region" aria-label={`Preview of question ${index + 1}`} data-dag-quiz-preview="">
      <Asked
        name={name}
        q={q}
        order={order}
        picked={picked}
        right={right}
        shown={shown}
        typed={typed}
        group={`dag-quiz-preview-${q.id ?? q.line}-${round}`}
        onToggle={toggle}
        onType={setTyped}
        onReveal={() => setShown(true)}
        onStep={() => {}}
        onJudge={(r) => setRight(r)}
      />
      <div className="dag-quiz__preview-foot">
        {right !== undefined ? (
          <Button data-dag-quiz-preview-again="" onClick={again}>
            <RotateCcw size={14} strokeWidth={2} aria-hidden="true" />
            Try again
          </Button>
        ) : words ? (
          shown ? null : (
            <Button variant="primary" data-dag-quiz-preview-reveal="" onClick={() => setShown(true)}>
              {q.card ? "Show the back" : "Show the answer"}
            </Button>
          )
        ) : (
          <Button
            variant="primary"
            data-dag-quiz-preview-check=""
            disabled={picked.length === 0}
            onClick={() => setRight(isRight(q, picked))}
          >
            Check
          </Button>
        )}
        <span className="dag-quiz__preview-note">
          {shuffled ? "Shuffled, as in a run. Nothing is recorded." : "As in a run. Nothing is recorded."}
        </span>
      </div>
    </div>
  );
}
