import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  CARDS_DEFAULT,
  CARDS_MAX,
  cardCount,
  cardsFeedback,
  cardsRequest,
  generateCards,
  readCards,
} from "../plugins/generate/cards";
import type { Complete, Message } from "../plugins/generate/llm";
import { cardsSystemPrompt } from "../plugins/generate/system";
import { askable, parseQuiz } from "../src/quiz/parse";
import { addCards } from "../src/ui/quiz/generate";

/**
 * Flashcards from a model (#140): the parse-and-check step, the loop around it with a scripted
 * model, and the write that lands the cards a person kept.
 *
 * What is under test is what happens to an answer — read by `parseQuiz`, only askable flashcards
 * kept, the problems sent back by code — so the model is a list of replies. Nothing here reaches a
 * network; `e2e/quiz-generate.spec.ts` holds the page's half with `/generate` mocked.
 */

const DOCS = path.resolve(__dirname, "../docs");

function scripted(...replies: string[]): { complete: Complete; calls: Message[][] } {
  const calls: Message[][] = [];
  const complete: Complete = async (messages) => {
    calls.push(messages.map((m) => ({ ...m })));
    const next = replies.shift();
    if (next === undefined) throw new Error("the script ran out of replies");
    return next;
  };
  return { complete, calls };
}

const MVCC = "## What is MVCC? {card}\n\n> Multi-version concurrency control: each transaction reads a snapshot.\n";
const VACUUM = "## What does VACUUM reclaim? {card}\n\n> The space held by dead tuples.\n";
const GOOD = `${MVCC}\n${VACUUM}`;

describe("readCards", () => {
  it("keeps every askable flashcard, in the house form and with no id", () => {
    const read = readCards(GOOD);
    expect("cards" in read && read.problems).toEqual([]);
    expect("cards" in read && read.cards.map((c) => c.front)).toEqual(["What is MVCC?", "What does VACUUM reclaim?"]);
    expect("cards" in read && read.cards[0]).toEqual({
      front: "What is MVCC?",
      body: "",
      back: "Multi-version concurrency control: each transaction reads a snapshot.",
      markdown: MVCC,
    });
  });

  it("reads past a chatty preamble, and unwraps a deck fenced whole", () => {
    const chatty = readCards(`Sure! Here are your cards:\n\n${GOOD}`);
    expect("cards" in chatty && chatty.cards).toHaveLength(2);
    const fenced = readCards("```markdown\n" + GOOD + "```");
    expect("cards" in fenced && fenced.cards).toHaveLength(2);
  });

  it("drops an id the model wrote, so the quiz it lands in mints its own", () => {
    const read = readCards("## What is MVCC? {#qtaken card}\n\n> A snapshot per transaction.\n");
    expect("cards" in read && read.cards[0]!.markdown).toBe("## What is MVCC? {card}\n\n> A snapshot per transaction.\n");
  });

  it("keeps more of the front between the heading and the back", () => {
    const read = readCards(
      "## What does this print? {card}\n\n```js\nconsole.log(1 + '1')\n```\n\n> `11`: the number is coerced.\n",
    );
    expect("cards" in read && read.cards[0]!.body).toBe("```js\nconsole.log(1 + '1')\n```");
    expect("cards" in read && read.cards[0]!.back).toBe("`11`: the number is coerced.");
  });

  it("refuses a question with a checklist, a heading with no `card`, and a card with no back — each by code", () => {
    const read = readCards(
      [
        "## Which reclaims space? {card}\n\n- [x] VACUUM\n- [ ] ANALYZE\n",
        "## What is a tuple?\n\n> A row version.\n",
        "## What is WAL? {card}\n",
        MVCC,
      ].join("\n"),
    );
    if (!("cards" in read)) throw new Error("expected cards");
    expect(read.cards.map((c) => c.front)).toEqual(["What is MVCC?"]);
    expect(read.problems.map((p) => [p.card, p.code])).toEqual([
      [1, "EG_NOT_A_CARD"],
      [2, "EG_NOT_A_CARD"],
      [3, "EQ_NO_OPTIONS"],
    ]);
    expect(read.problems[0]!.front).toBe("Which reclaims space?");
  });

  it("refuses a card with something after its back", () => {
    const read = readCards("## What is MVCC? {card}\n\n> A snapshot.\n\nAnd then some prose.\n");
    if (!("cards" in read)) throw new Error("expected cards");
    expect(read.cards).toEqual([]);
    expect(read.problems.map((p) => p.code)).toContain("EQ_NO_OPTIONS");
  });

  it("is `none`, and says what the model said, when there is no card at all", () => {
    const read = readCards("I can't help with that request.");
    expect(read).toEqual({ none: "The model answered without a single flashcard: “I can't help with that request.”" });
    expect(readCards("   ")).toEqual({ none: "The model gave an empty answer." });
  });

  it("keeps no more cards than were asked for", () => {
    const read = readCards(GOOD, 1);
    expect("cards" in read && read.cards.map((c) => c.front)).toEqual(["What is MVCC?"]);
  });

  it("only ever keeps what `parseQuiz` reads as an askable flashcard", () => {
    const read = readCards(`${GOOD}\n## Front only {card}\n\n## {card}\n\n> A back with no front.\n`);
    if (!("cards" in read)) throw new Error("expected cards");
    for (const c of read.cards) {
      const q = parseQuiz(c.markdown).questions;
      expect(q).toHaveLength(1);
      expect(q[0]!.card && askable(q[0]!)).toBe(true);
    }
    expect(read.problems.map((p) => p.code)).toEqual(["EQ_NO_OPTIONS", "EQ_NO_PROMPT"]);
  });
});

describe("cardCount", () => {
  it("holds a count to the range, and gives the default for anything that is not one", () => {
    expect(cardCount(undefined)).toBe(CARDS_DEFAULT);
    expect(cardCount("twelve")).toBe(CARDS_DEFAULT);
    expect(cardCount(0)).toBe(1);
    expect(cardCount(500)).toBe(CARDS_MAX);
    expect(cardCount(7.4)).toBe(7);
    expect(cardCount("12")).toBe(12);
  });
});

describe("cardsRequest", () => {
  it("asks for a topic, starting with a word", () => {
    expect(cardsRequest({ topic: "--help", count: 5 })).toBe("Write 5 flashcards about this topic:\n\n--help");
  });

  it("fences a note off as material, and puts what to focus on after it", () => {
    const asked = cardsRequest({ note: "# Postgres\n\nMVCC keeps versions.", topic: "only MVCC", count: 1 });
    expect(asked).toMatch(/^Write 1 flashcard from the note below, focusing on/);
    expect(asked).toContain("<note>\n# Postgres\n\nMVCC keeps versions.\n</note>");
    expect(asked.endsWith("What to focus on:\n\nonly MVCC")).toBe(true);
  });
});

describe("cardsFeedback", () => {
  it("names each problem by card, front and code", () => {
    const said = cardsFeedback([{ card: 2, front: "What is WAL?", code: "EQ_NO_OPTIONS", message: "no back" }]);
    expect(said).toContain("- card 2 (“What is WAL?”) EQ_NO_OPTIONS — no back");
    expect(said).toContain("answer with the whole deck again");
  });
});

describe("generateCards", () => {
  const system = "the guide";

  it("takes the first answer when every card in it is one", async () => {
    const model = scripted(GOOD);
    const got = await generateCards({ topic: "Postgres", count: 2, system, complete: model.complete });
    expect(got.ok).toBe(true);
    expect(got.cards).toHaveLength(2);
    expect(got.attempts).toBe(1);
    expect(model.calls[0]![0]).toEqual({ role: "system", content: system });
  });

  it("sends the problems back by code, and takes the fixed deck", async () => {
    const model = scripted(
      `${MVCC}\n## What is WAL?\n\n> The write-ahead log.\n`,
      `${MVCC}\n## What is WAL? {card}\n\n> The write-ahead log.\n`,
    );
    const got = await generateCards({ topic: "Postgres", count: 2, system, complete: model.complete });
    expect(got.attempts).toBe(2);
    expect(got.problems).toEqual([]);
    expect(got.cards.map((c) => c.front)).toEqual(["What is MVCC?", "What is WAL?"]);
    const second = model.calls[1]!;
    expect(second[second.length - 1]!.content).toContain("card 2 (“What is WAL?”) EG_NOT_A_CARD");
  });

  it("keeps the best attempt's good cards, and says what was left out, when the model never gets it whole", async () => {
    const half = `${MVCC}\n## What is WAL? {card}\n`;
    const model = scripted(half, half, half);
    const got = await generateCards({ topic: "Postgres", system, complete: model.complete });
    expect(got.ok).toBe(true);
    expect(got.attempts).toBe(3);
    expect(got.cards.map((c) => c.front)).toEqual(["What is MVCC?"]);
    expect(got.problems.map((p) => p.code)).toEqual(["EQ_NO_OPTIONS"]);
  });

  it("is not ok, and says why, when a refusal is all there ever is", async () => {
    const model = scripted("I can't do that.", "Still no.", "No.");
    const got = await generateCards({ topic: "x", system, complete: model.complete });
    expect(got).toMatchObject({ ok: false, cards: [], attempts: 3 });
    expect(got.error).toBe("The model answered without a single flashcard: “No.”");
  });

  it("is not ok, and names the problem, when no card in any answer can be read", async () => {
    const model = scripted("## What is WAL?\n\n- [x] A log\n- [ ] A lock\n");
    const got = await generateCards({ topic: "x", system, complete: model.complete, attempts: 1 });
    expect(got.ok).toBe(false);
    expect(got.error).toMatch(/^None of the model's cards could be read as a flashcard: this card has answers to choose between/);
  });

  it("stops when cancelled", async () => {
    const stop = new AbortController();
    stop.abort(new Error("gone"));
    await expect(generateCards({ topic: "x", system, complete: scripted(GOOD).complete, signal: stop.signal })).rejects.toThrow(
      "gone",
    );
  });
});

describe("cardsSystemPrompt", () => {
  it("is the flashcards guide, and nothing about diagrams", () => {
    const system = cardsSystemPrompt({ docsRoot: DOCS });
    expect(system).toMatch(/^# Writing flashcards for AnyDag/);
    expect(system).toContain("{card}");
    expect(system).not.toContain("# The grammar");
  });

  it("shows the model an answer the reader takes whole", () => {
    const example = /```\n(## [\s\S]*?)```/.exec(cardsSystemPrompt({ docsRoot: DOCS }))![1]!;
    const read = readCards(example);
    expect("cards" in read && read.problems).toEqual([]);
    expect("cards" in read && read.cards).toHaveLength(2);
  });
});

describe("addCards", () => {
  const QUIZ = "---\ntitle: Postgres\n---\n\nThe description.\n\n## Untouched, with no id\n\n* [x]   one\n* [ ] two\n";

  it("adds each kept card at the end, one span each, with an id minted, and no other byte moves", () => {
    const read = readCards(GOOD);
    if (!("cards" in read)) throw new Error("expected cards");
    const done = addCards(
      QUIZ,
      read.cards.map((c) => c.markdown),
    );
    if (!done.ok) throw new Error(done.error);
    expect(done.text.startsWith(QUIZ)).toBe(true);
    expect(done.text.slice(QUIZ.length)).toMatch(
      /^\n## What is MVCC\? \{#q[0-9a-z]{6} card\}\n\n> Multi-version concurrency control: each transaction reads a snapshot\.\n\n## What does VACUUM reclaim\? \{#q[0-9a-z]{6} card\}\n\n> The space held by dead tuples\.\n$/,
    );
    const quiz = parseQuiz(done.text);
    expect(quiz.questions.slice(1).every((q) => q.card && q.open && askable(q))).toBe(true);
  });

  it("writes nothing when any card is refused", () => {
    const done = addCards(QUIZ, [MVCC, "## Not a question at all\n"]);
    expect(done).toEqual({ ok: false, error: expect.stringMatching(/^that question cannot be asked/) });
  });
});
