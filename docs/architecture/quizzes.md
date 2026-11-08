# Quizzes

> The `.quiz.md` format, the runner, Mistakes and the practice record.

## Quizzes

A **quiz** is a file of its own: `<vault>/<name>.quiz.md`, listed and foldered beside the
boards and notes, opened at `?quiz=<name>`. A quiz is its own kind
(not a note with a key), its body is strict Markdown, a preset is one
quiz file, and a question leaves Mistakes after N right answers in a row inside the Mistakes run.

    ---
    title: Postgres internals
    ---

    Anything before the first question is the description.

    ## What does VACUUM reclaim? {#q7f3a2}

    - [ ] Index bloat only
    - [x] The space of dead tuples

    > The explanation, shown once it is answered.

    ## Which query lists every member? {#q5d3a1}

    - [x] The one with no filter
      ```sql
      select * from cd.members;
      ```
    - [ ] None of the above

    ## Write the query for members who joined after September {#q8e1f0}

    > ```sql
    > select * from cd.members where joindate >= '2012-09-01';
    > ```

| Where | What it does with one |
|---|---|
| the sidebar | **Quizzes** (with the Mistakes count) opens the Quizzes page; **New** → *Quiz* makes `untitled` titled *Untitled* with no questions and names it in the top bar; a quiz's row wears a cap |
| the Quizzes page, `?quizzes=1` | Mistakes first, then a card per quiz — questions, how many in Mistakes, Practice — a filter, a folder (with *Practice the folder* once one is chosen), and a box that makes a quiz named after what is typed |
| a folder's menu in the sidebar | *Practice the quizzes*, when anything under it is a quiz |
| a quiz's page, `?quiz=` | **Questions** (a card per question, every field Markdown source, an option a text area that grows; *Shuffle the options* and a pin on each option; *Add an open question*) or **Source** (the file and its problems); Practice, Export (the file) |
| a run, `&run=1` · `?quizzes=1&run=mistakes` · `?quizzes=1&run=folder:<path>` | one question at a time, `1`–`9` to pick and Enter to go on, ← → or Previous and Next to move without answering, the quiz's description beside it; an open question's box, ctrl+Enter to see the model answer and `1`/`2` to say whether it was had; the end says the score, what was skipped and what went into Mistakes |
| a board, or a note, embedding one | a card: the title, the questions, how many in Mistakes, Practice |
| `?view=1` | a run that records nothing |
| a snapshot | the sheet: every question with its answers marked |
| Settings | how many right in a row take a question out of Mistakes, 1 to 10 |

Thirteen things are load-bearing:

- **A question is a `##` heading and everything up to the next one**, and only `##` delimits. Fences
  are tracked across the whole file, so a `##` or a `- [ ]` in a code sample is code; and a line that
  opens a fence outside one always opens it, which is the one rule that keeps the server's
  heading ids (it imports `parseQuiz` rather than restating it) the ones the page finds.
  `test/fixtures/quizzes.json` holds the parser to that.
- **A write rewrites one question and no other byte.** Every writer in `src/quiz/write.ts` parses the
  text it is handed and splices one question's span; a rewrite whose meaning is unchanged writes
  nothing (`sameQuestion`), so an agent's wrapping survives a field focused and left.
- **A question's id is the file's and is minted by whatever first needs it** — `{#q…}` on its
  heading, written by the form on any write and by a run before it starts. Practice history is keyed
  by the quiz's store id and that, so a rename, a move and an edit keep it, and a duplicate does not.
- **What was answered is the person's, never the file's**: `server/practice.ts` keeps it in the
  app's home (`~/.anydag/anydag.sqlite`, through `server/home.ts`), keyed by the vault and the quiz's
  id, so a synced vault never carries somebody's mistakes. `server/practice.ts` owns the meaning —
  a record is folded in, never rewritten by hand. A record is never deleted; Mistakes leaves out
  a quiz or a question that is gone, off the listing's ids, and keeps it.
- **The threshold is read, never stored in a stat.** `inPool(stat, graduate)` takes it, so moving it puts
  questions back or takes them out on the next read. It lives with the record rather than in
  `PREF_KEYS`, because the server decides with it (`practice.graduate` in the same SQLite file).
- **An answer is an event.** The page queues a list, never a map, flushes on a debounce, at a run's
  end and on `pagehide`, and a landed flush says `dag:practice`; every reader of Mistakes on a page
  shares one fetch, so a board of quiz cards is one request.
- **A run asks what the quiz said when it started**, and the Mistakes run reads the pool once and
  again only on Again — both move under every answer, and a run that followed them would restart
  itself.
- **A field keeps what is being typed while it has the caret.** The form redraws from the file on
  every keystroke and the file's prompt is trimmed, so a field showing the file's answer would eat
  the space before the next word.
- **A question in a run is answered once, and a skip is no answer** (`src/ui/quiz/round.ts`).
  Going back to an answered question shows it read-only, because its answer was recorded the moment
  it was given and a second would count twice; a question left unanswered records nothing, never a
  miss, and the end offers the skipped ones as a round of their own.
- **An option is block Markdown, read the CommonMark way**: a line indented at least the
  item's content indent — two spaces for `- [x] ` — is the option's, whatever it looks like, blank
  lines kept when an indented line follows them, and a fence it opens runs to its close. The text is
  the lines with their common indent off (`optionMarkdown`, which the writers compare and write in
  too); the house form indents by two, and puts a first line that would open a block on a line of
  its own. A fence opened inside an option still opens a fence — the one rule `parseQuiz`'s
  heading ids on the server keep.
- **An open question is no checklist and a quote at its end**: `Question.open`, `why` the
  model answer. Of two quotes only the last is the answer, a `>` in a code block is code, and prose
  after the quote means there is none — still `EQ_NO_OPTIONS`. Its verdict is the person's, given
  once the answer is showing (`revealIn`, `judgeIn`), and a read-only box takes no typing, so `1`
  and `2` reach the run.
- **A shuffle is a run's, never the file's**: `optionOrder` draws one order per question
  when a run starts — pinned options at their own index — and the runner keeps it until Again or a
  new list; answering the skipped ones keeps the order seen. A pick is the file's index, so grading
  and what is recorded never see the order. The sheet is the written order.
- **One question over the wire is a route**: `src/quiz/ops.ts` through the grammar,
  `POST /__board/quiz` with the table's recompute-on-conflict loop. `set` writes the
  Markdown *as given*, minting an id only for a heading with none, and refuses anything that is not
  exactly one askable question; no other question is stamped or rewritten.

`POST /api/practice` is refused by the CLI with its reason — a command that posted answers would
clear Mistakes without anybody knowing anything — and `anydag quiz check`, `ls`, `mistakes` and
`threshold` are the rest, alongside `quiz question set|rm|mv` and `quiz practice <folder>`.
`check:skill`'s ninth set holds the skill's code table to `QUIZ_CODES`.

Names claimed, grepped first: `dag-quiz*`, `dag-quizzes*`, `dag-run*`, `dag-quiz-sheet*`,
`dag-quiz-page`, `dag-embed--quiz`, `dag-embed__quiz*`, `dag-toolbar__practice`, `data-dag-quiz`
(a search row), `data-dag-quiz-*`, `data-dag-quizzes*`, `data-dag-run*`, `data-dag-embed-practice`,
`data-dag-setting-graduate`, `data-dag-sidebar-quizzes*`, `data-dag-sidebar-new-quiz`, the storage
keys `dag:quiz-mode` and `dag:quiz-about`, the events `dag:quiz` and `dag:practice`, and the query keys `quiz`, `quizzes`
and `run` — and `dag-run__option--block`, `dag-run__option-text--block`,
`dag-run__answer*`, `dag-run__judge*`, `dag-quiz-sheet__option--block`, `dag-quiz-sheet__open`,
`dag-quiz__option-text`, `dag-quiz__pin`, `dag-quiz__shuffle`, `dag-quiz__adds`,
`dag-quizzes__practice-folder`, `dag-quizzes__count`, `data-dag-run-place`, `data-dag-run-open`,
`data-dag-run-answer`, `data-dag-run-reveal`, `data-dag-run-judge`, `data-dag-run-model`,
`data-dag-quiz-open`, `data-dag-quiz-pin`, `data-dag-quiz-shuffle`, `data-dag-quiz-add-open`,
`data-dag-quiz-sheet-open`, `data-dag-quizzes-practice-folder`, and the menu pick `practise`.

**Out, and why:** a button that asks a model to generate a quiz (an agent writes one with
`quiz_create` and `quiz_write`, and runs one in a conversation with `quiz_questions` and
`quiz_answer`); a pick of questions as a preset (a preset is one quiz file); shuffling the
*questions* of a run
(the options shuffle, an author's order of questions being a course's order); grading an open
answer automatically (the person's verdict is the answer); a recall schedule (records are kept, so
the counts one needs exist; when to ask again is a design decision); resetting a history, scores
over time and timers; a printed sheet; and practising on a
read-only view with a history, which has nowhere to keep it.
