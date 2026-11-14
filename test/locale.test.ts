import { afterEach, describe, expect, it } from "vitest";

import { clock, dayLabel } from "../src/assistant/words";
import { collation, locale, setLocale } from "../src/locale";
import { folderQuizzes } from "../src/quiz/folder";

/* The unit suite shares modules between files: every test here leaves the locale as it found it. */
afterEach(() => setLocale(undefined));

describe("the system's locale (#304)", () => {
  it("is the runtime's own until the shell names one", () => {
    expect(locale()).toBeUndefined();
    setLocale("de-DE");
    expect(locale()).toBe("de-DE");
    setLocale(null);
    expect(locale()).toBeUndefined();
  });

  it("takes only a language tag, in its canonical form", () => {
    setLocale("de-de");
    expect(locale()).toBe("de-DE");
    for (const bad of ["", "not a tag!", "en-US@posix", 42, {}]) {
      setLocale(bad);
      expect(locale()).toBeUndefined();
    }
  });

  it("formats the Assistant's times and dates in it", () => {
    const at = "2026-03-09T15:05:00";
    setLocale("de-DE");
    expect(clock(at)).toBe("15:05");
    expect(dayLabel(at, new Date("2026-11-14T12:00:00"))).toBe("9. März");
    setLocale("en-US");
    expect(clock(at)).toBe("03:05 PM");
    expect(dayLabel(at, new Date("2026-11-14T12:00:00"))).toBe("Mar 9");
  });

  it("sorts words in it, and a collator made before the change is not kept", () => {
    const names = ["z", "ä", "a"];
    setLocale("en");
    expect([...names].sort(collation().compare)).toEqual(["a", "ä", "z"]);
    setLocale("sv");
    expect([...names].sort(collation().compare)).toEqual(["a", "z", "ä"]);
  });

  it("orders a shared module's lists by it: a folder's quizzes", () => {
    const quizzes = ["c/z.quiz.md", "c/ae.quiz.md"];
    const titles = { "c/z.quiz.md": "Z", "c/ae.quiz.md": "Ä" };
    setLocale("sv");
    expect(folderQuizzes(quizzes, titles, "c")).toEqual(["c/z.quiz.md", "c/ae.quiz.md"]);
    setLocale("en");
    expect(folderQuizzes(quizzes, titles, "c")).toEqual(["c/ae.quiz.md", "c/z.quiz.md"]);
  });
});
