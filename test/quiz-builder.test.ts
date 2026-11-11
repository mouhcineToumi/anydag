/**
 * The quiz builder's half of the format: what the form writes when a person never sees the file.
 *
 * - **Escapes**: a prompt or an option is words, so whatever the heading's or the option's own
 *   syntax would read back as something else is escaped, and the file's form passes through.
 * - **Repairs**: every problem the parser names has a writer the form can offer instead of the
 *   source, and each touches one question (or, for a fence, one line).
 * - **The field bridge**: a rich field is a span map over one field's Markdown (`src/note/markdown.ts`),
 *   so a field opened and left writes nothing, and blocks the editor can make never read back as
 *   another part of the question.
 */
import { describe, expect, it } from "vitest";

import { blocksToMd, load, saved, settle, type NoteBlock } from "../src/note/markdown";
import { parseQuiz } from "../src/quiz/parse";
import {
  cleanHeading,
  closeFence,
  inputOf,
  promptLine,
  reidQuestion,
  renderQuestion,
  replaceQuestion,
  resolveStray,
} from "../src/quiz/write";

const codes = (text: string) => parseQuiz(text).diagnostics.map((d) => d.code);

describe("escapes", () => {
  it("keeps a prompt's closing hashes and trailing braces as words", () => {
    for (const prompt of ["Learn C #", "Fill in {name}", "Which {is} it", "Pick one {#q7}", "Count ###"]) {
      const text = renderQuestion({
        id: "qa",
        prompt,
        options: [
          { text: "a", correct: true },
          { text: "b", correct: false },
        ],
      });
      const q = parseQuiz(text).questions[0]!;
      expect(q.id).toBe("qa");
      expect(codes(text)).toEqual([]);
      /* What the file holds is the escaped form, and comparing it with what was typed means no change. */
      expect(replaceQuestion(text, "qa", { ...inputOf(q), prompt })).toBe(text);
    }
  });

  it("leaves a prompt that needs nothing alone, and never escapes twice", () => {
    expect(promptLine("What does C# compile to?")).toBe("What does C# compile to?");
    expect(promptLine("Use {a, b} here, please")).toBe("Use {a, b} here, please");
    expect(promptLine("Learn C \\#")).toBe("Learn C \\#");
    expect(promptLine("Fill in \\{name}")).toBe("Fill in \\{name}");
  });

  it("keeps an option ending in the words {pin} unpinned", () => {
    const text = renderQuestion({
      id: "qa",
      prompt: "Which",
      options: [
        { text: "write {pin}", correct: true },
        { text: "b", correct: false, pin: true },
      ],
    });
    const [a, b] = parseQuiz(text).questions[0]!.options;
    expect(a!.pin).toBe(false);
    expect(b!.pin).toBe(true);
  });
});

describe("repairs", () => {
  const STRAY = "## Q {#qa}\n\n- [x] a\n- [ ] b\n\n> Why.\n\nA stray paragraph.\n\n## Next {#qb}\n\n- [x] c\n- [ ] d\n";

  it("move stray text into the explanation, above the options, or drop it — that question only", () => {
    expect(codes(STRAY)).toContain("EQ_STRAY");
    expect(parseQuiz(STRAY).questions[0]!.stray).toBe("A stray paragraph.");
    const tail = STRAY.slice(STRAY.indexOf("## Next"));
    for (const to of ["why", "body", "drop"] as const) {
      const out = resolveStray(STRAY, "qa", to);
      expect(codes(out)).toEqual([]);
      expect(out.endsWith(tail)).toBe(true);
      const q = parseQuiz(out).questions[0]!;
      expect(q.why).toBe(to === "why" ? "Why.\n\nA stray paragraph." : "Why.");
      expect(q.body).toBe(to === "body" ? "A stray paragraph." : "");
    }
  });

  it("take a second quote's marks off when it joins the explanation", () => {
    const out = resolveStray("## Q {#qa}\n- [x] a\n- [ ] b\n\n> One.\n\n> Two.\n", "qa", "why");
    expect(parseQuiz(out).questions[0]!.why).toBe("One.\n\nTwo.");
  });

  it("give the second of two questions sharing an id one of its own, and touch only its heading", () => {
    const text = "## A {#qa}\n- [x] a\n- [ ] b\n\n## B {#qa multi}\n- [x] c\n- [ ] d\n";
    expect(codes(text)).toContain("EQ_DUPLICATE_ID");
    const out = reidQuestion(text, 1, () => "qnew");
    expect(out).toBe("## A {#qa}\n- [x] a\n- [ ] b\n\n## B {#qnew multi}\n- [x] c\n- [ ] d\n");
    expect(codes(out)).toEqual([]);
  });

  it("take words a heading does not know off it, and multi off an open question", () => {
    expect(cleanHeading("## Q {#qa multi wide}\n- [x] a\n- [ ] b\n", "qa")).toBe("## Q {#qa multi}\n- [x] a\n- [ ] b\n");
    const open = "## Q {#qa multi}\n\n> The answer.\n";
    expect(codes(open)).toContain("WQ_UNKNOWN_ATTR");
    expect(codes(cleanHeading(open, "qa"))).toEqual([]);
  });

  it("close a fence before the question it swallowed, or at the end", () => {
    const text = "## Q {#qa}\n\n```sql\nselect 1;\n\n## R {#qb}\n- [x] a\n- [ ] b\n";
    const d = parseQuiz(text).diagnostics.find((x) => x.code === "WQ_OPEN_FENCE")!;
    const out = closeFence(text, d.line);
    expect(out).toBe("## Q {#qa}\n\n```sql\nselect 1;\n```\n\n## R {#qb}\n- [x] a\n- [ ] b\n");
    expect(parseQuiz(out).questions.map((q) => q.id)).toEqual(["qa", "qb"]);
    expect(closeFence("Intro\n\n~~~\ncode", 3)).toBe("Intro\n\n~~~\ncode\n~~~\n");
  });
});

/** One field through the span map, untouched: the bytes the field was opened with. */
function untouched(md: string): string {
  const { blocks, loaded } = load(md);
  return saved(settle(loaded, blocks), blocks).body.replace(/\n+$/, "");
}

const run = (text: string, bold = false): Record<string, unknown>[] => [
  { type: "text", text, styles: bold ? { bold: true } : {} },
];

describe("the field bridge", () => {
  const QUIZ = `## What does \`VACUUM\` reclaim?   {#qvac}

Some **context**, wrapped
over two lines.

* [ ] Index bloat only
* [x] The space of dead tuples
  \`\`\`sql
  select 1;
  \`\`\`

> Dead tuples stay until VACUUM
marks their space reusable.

## Open {#qo}

> $x^2$ and a [[link]].
`;

  it("writes nothing for a field opened and left, whatever its author's wrapping", () => {
    for (const q of parseQuiz(QUIZ).questions) {
      const input = inputOf(q);
      const again = {
        ...input,
        prompt: untouched(input.prompt),
        body: untouched(input.body ?? ""),
        why: untouched(input.why ?? ""),
        options: input.options.map((o) => ({ ...o, text: untouched(o.text) })),
      };
      expect(replaceQuestion(QUIZ, q.id!, again)).toBe(QUIZ);
    }
  });

  it("never lets a field's blocks read back as another part of the question", () => {
    /* What the field schema allows: paragraphs, lists, code. A list item that reads like a task, a
       paragraph that reads like a heading or a quote — each is escaped by the writer, and stays text. */
    const tricky: NoteBlock[] = [
      { type: "bulletListItem", content: run("[ ] not an option") as never },
      { type: "paragraph", content: run("## not a question") as never },
      { type: "paragraph", content: run("> not the answer") as never },
      { type: "codeBlock", props: { language: "md" }, content: run("## code stays code\n- [x] and this") as never },
    ];
    const md = blocksToMd(tricky);
    for (const where of ["body", "why", "option"] as const) {
      const input = {
        id: "qa",
        prompt: "Q",
        body: where === "body" ? md : "",
        why: where === "why" ? md : "",
        options: [
          { text: where === "option" ? md : "a", correct: true },
          { text: "b", correct: false },
        ],
      };
      const text = `${renderQuestion(input)}\n## Next {#qb}\n- [x] c\n- [ ] d\n`;
      const quiz = parseQuiz(text);
      expect(
        quiz.questions.map((q) => q.id),
        where,
      ).toEqual(["qa", "qb"]);
      expect(quiz.questions[0]!.options.length, where).toBe(2);
      expect(quiz.diagnostics, where).toEqual([]);
    }
  });

  it("writes a prompt typed with marks as one inline line", () => {
    const md = blocksToMd([
      { type: "paragraph", content: [...run("Why is "), ...run("this", true), ...run(" {slow}")] as never },
    ]);
    const text = renderQuestion({
      id: "qa",
      prompt: md,
      options: [
        { text: "a", correct: true },
        { text: "b", correct: false },
      ],
    });
    expect(text.split("\n")[0]).toBe("## Why is **this** \\{slow} {#qa}");
    expect(codes(text)).toEqual([]);
  });
});
