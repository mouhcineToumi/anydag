import { describe, expect, it } from "vitest";

import { answerIn, goTo, judgeIn, pickIn, revealIn, skippedIn, startRound, tally, typeIn } from "@/ui/quiz/round";

/**
 * A round of a run, moving back and forth: a skip records nothing, an answer is given
 * once, and what is picked stays with its question.
 */
describe("a round of a run", () => {
  it("moves forward and back without answering, and the end is past the last question", () => {
    let r = startRound(3);
    r = goTo(r, r.at + 1);
    r = goTo(r, r.at + 1);
    expect(r).toMatchObject({ at: 2, finished: false });
    r = goTo(r, r.at - 1);
    expect(r.at).toBe(1);
    r = goTo(r, -4);
    expect(r.at).toBe(0);
    r = goTo(goTo(r, 2), 3);
    expect(r).toMatchObject({ at: 2, finished: true });
    expect(tally(r)).toEqual({ right: 0, wrong: 0, skipped: 3 });
    expect(skippedIn(r)).toEqual([0, 1, 2]);
  });

  it("keeps what was picked on a question left unanswered", () => {
    let r = pickIn(startRound(2), 1, false);
    r = goTo(r, 1);
    expect(r.picks[1]).toEqual([]);
    r = goTo(r, 0);
    expect(r.picks[0]).toEqual([1]);
  });

  it("picks one on a radio question and toggles on a checkbox one", () => {
    let r = startRound(1);
    r = pickIn(pickIn(r, 0, false), 2, false);
    expect(r.picks[0]).toEqual([2]);
    r = pickIn(pickIn(pickIn(startRound(1), 0, true), 2, true), 0, true);
    expect(r.picks[0]).toEqual([2]);
  });

  it("answers a question once, and an answered question takes no more picks", () => {
    let r = answerIn(startRound(2), true);
    expect(r.verdicts[0], "nothing picked, nothing answered").toBeUndefined();
    r = answerIn(pickIn(r, 0, false), false);
    expect(r.verdicts[0]).toBe(false);
    expect(answerIn(r, true).verdicts[0], "a second answer does not replace the first").toBe(false);
    expect(pickIn(r, 1, false).picks[0], "the picks it was answered with stay").toEqual([0]);
    /* Back to it from the next one: still answered, still wrong. */
    r = goTo(goTo(r, 1), 0);
    expect(r.verdicts[0]).toBe(false);
  });

  it("counts right, wrong and skipped, and names the skipped in order", () => {
    let r = startRound(4);
    r = goTo(answerIn(pickIn(r, 0, false), true), 1); // right
    r = goTo(r, 2); // skipped
    r = goTo(answerIn(pickIn(r, 1, false), false), 3); // wrong
    r = goTo(r, 4); // the last skipped, and the end
    expect(r.finished).toBe(true);
    expect(tally(r)).toEqual({ right: 1, wrong: 1, skipped: 2 });
    expect(skippedIn(r)).toEqual([1, 3]);
  });

  it("takes nothing once it is finished", () => {
    const r = goTo(startRound(1), 1);
    expect(pickIn(r, 0, false)).toBe(r);
    expect(answerIn(r, true)).toBe(r);
  });

  it("answers an open question by the person's verdict, once the model answer is showing", () => {
    let r = typeIn(startRound(2), "select *");
    expect(judgeIn(r, true).verdicts[0]).toBeUndefined();
    r = goTo(r, 1);
    expect(r.typed).toEqual(["select *", ""]);
    r = revealIn(goTo(r, 0));
    r = judgeIn(r, false);
    expect(r.verdicts[0]).toBe(false);
    expect(typeIn(r, "changed").typed[0]).toBe("select *");
    expect(judgeIn(r, true).verdicts[0]).toBe(false);
    /* Shown and left unjudged is a skip, as an unchecked pick is. */
    r = goTo(revealIn(goTo(r, 1)), 2);
    expect(tally(r)).toEqual({ right: 0, wrong: 1, skipped: 1 });
  });
});
