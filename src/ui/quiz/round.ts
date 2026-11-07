/**
 * A round of a run, with no React in it: which question is showing, what is picked on
 * each, and which have been answered — so moving back and forth is arithmetic a unit test can hold.
 *
 * **A question is answered once.** Its verdict is set by a check and never cleared, because the
 * answer was recorded the moment it was given and a second one would count twice; going back to it
 * shows what was picked and what it meant. **A skip is no answer at all**: nothing is recorded, and
 * the end counts it on its own, never as a miss.
 *
 * **What is picked and not yet checked stays with its question**, so leaving one half-answered and
 * coming back finds the picks where they were — and so does what was typed into an open question
 *, and whether its model answer is showing. An open question is answered by the person's
 * own verdict once the model answer is shown, which is `judgeIn`; until then leaving it skips it.
 */

export interface Round {
  /** The question showing, `0` to `count - 1`. */
  at: number;
  /** Per question, the options picked, 0-based. */
  picks: number[][];
  /** Per question: right, wrong, or not answered yet. */
  verdicts: (boolean | undefined)[];
  /** Per open question, what was written as the answer. */
  typed: string[];
  /** Per open question, whether the model answer is showing. */
  shown: boolean[];
  /** The end has been reached: the last question was left forwards. */
  finished: boolean;
}

export function startRound(count: number): Round {
  return {
    at: 0,
    picks: Array.from({ length: count }, () => []),
    verdicts: Array(count).fill(undefined),
    typed: Array(count).fill(""),
    shown: Array(count).fill(false),
    finished: false,
  };
}

/** Pick or unpick an option on the question showing. Nothing once it is answered. */
export function pickIn(r: Round, option: number, multi: boolean): Round {
  if (r.finished || r.verdicts[r.at] !== undefined) return r;
  const was = r.picks[r.at] ?? [];
  const next = multi ? (was.includes(option) ? was.filter((x) => x !== option) : [...was, option]) : [option];
  const picks = r.picks.slice();
  picks[r.at] = next;
  return { ...r, picks };
}

/** Answer the question showing. Nothing if it is answered, or nothing is picked. */
export function answerIn(r: Round, right: boolean): Round {
  if (r.finished || r.verdicts[r.at] !== undefined || (r.picks[r.at] ?? []).length === 0) return r;
  const verdicts = r.verdicts.slice();
  verdicts[r.at] = right;
  return { ...r, verdicts };
}

/** Write into the open question showing. Nothing once it is answered. */
export function typeIn(r: Round, text: string): Round {
  if (r.finished || r.verdicts[r.at] !== undefined) return r;
  const typed = r.typed.slice();
  typed[r.at] = text;
  return { ...r, typed };
}

/** Show the open question's model answer. Shown stays shown: what was seen cannot be unseen. */
export function revealIn(r: Round): Round {
  if (r.finished || r.shown[r.at]) return r;
  const shown = r.shown.slice();
  shown[r.at] = true;
  return { ...r, shown };
}

/** The person's own verdict on the open question showing, once its model answer is. */
export function judgeIn(r: Round, right: boolean): Round {
  if (r.finished || !r.shown[r.at] || r.verdicts[r.at] !== undefined) return r;
  const verdicts = r.verdicts.slice();
  verdicts[r.at] = right;
  return { ...r, verdicts };
}

/**
 * Go to question `to`. Before the first is the first; past the last is the end. Going back from the
 * end is the last question again.
 */
export function goTo(r: Round, to: number): Round {
  const count = r.verdicts.length;
  if (to >= count) return { ...r, at: Math.max(0, count - 1), finished: true };
  return { ...r, at: Math.max(0, to), finished: false };
}

/** How the round went: answered right, answered wrong, and never answered. */
export function tally(r: Round): { right: number; wrong: number; skipped: number } {
  let right = 0;
  let wrong = 0;
  for (const v of r.verdicts) {
    if (v === true) right++;
    else if (v === false) wrong++;
  }
  return { right, wrong, skipped: r.verdicts.length - right - wrong };
}

/** The questions never answered, in the order they were asked. */
export function skippedIn(r: Round): number[] {
  return r.verdicts.flatMap((v, i) => (v === undefined ? [i] : []));
}
