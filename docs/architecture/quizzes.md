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

    ## What is MVCC? {#q3c9d2 card}

    > Multi-version concurrency control: each transaction reads a snapshot.

| Where | What it does with one |
|---|---|
| the sidebar | **Quizzes** (with the Mistakes count) opens the Quizzes page; **New** → *Quiz* makes `untitled` titled *Untitled* with no questions and names it in the top bar; a quiz's row wears a cap |
| the Quizzes page, `?quizzes=1` | Mistakes first, then a card per quiz — questions, how many in Mistakes, Practice — a filter, a folder (with *Practice the folder* once one is chosen), and a box that makes a quiz named after what is typed |
| a folder's menu in the sidebar | *Practice the quizzes*, when anything under it is a quiz |
| a quiz's page, `?quiz=` | a quiz builder, with no Markdown on it and no Source tab: a card per question — a grip to drag it, its kind (*One right answer*, *Several right answers*, *Answered in words*, *Flashcard* — a Front and a Back), the question as one rich line, *Add details*, the answers as rows (a grip, a round tick or a box, rich text, a pin while *Shuffle the options* is on), the explanation or model answer; what is wrong said in words on its card, each with a button that fixes it; *Add a flashcard* beside the other two adds; Practice, Export (the file) |
| a run, `&run=1` · `?quizzes=1&run=mistakes` · `?quizzes=1&run=folder:<path>` | one question at a time, `1`–`9` to pick and Enter to go on, ← → or Previous and Next to move without answering, the quiz's description beside it; an open question's box, ctrl+Enter to see the model answer and `1`/`2` to say whether it was had; a flashcard's front with no box, Space or Enter to see the back, and the same `1`/`2`; the end says the score, what was skipped and what went into Mistakes |
| a board, or a note, embedding one | a card: the title, the questions, how many in Mistakes, Practice |
| `?view=1` | a run that records nothing |
| a snapshot | the sheet: every question with its answers marked, a flashcard's back under it |
| Settings | how many right in a row take a question out of Mistakes, 1 to 10 |

Fifteen things are load-bearing:

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
- **The form shows no Markdown, and BlockNote never reads or writes a byte of it.** Every field is
  drawn read-only (`QuizMarkdown`) until it is clicked or tabbed to; then one `FieldEditor`
  (`src/blocks/FieldEditor.tsx`, lazy) is mounted in its place — one on the page at a time, so a
  quiz of fifty questions is not three hundred editors. The field's text goes through
  `src/note/markdown.ts` both ways (`load`, `settle`, `saved`), so the blocks nobody touched keep their
  bytes and a field opened and left hands back what it was given, which `sameQuestion` writes as
  nothing. While it is open the editor's document is the field, so a redraw from the file never eats
  what is being typed. Two more things keep typing whole: a letter typed while a field opens — the
  instant after *Add an answer* — is kept by `RichField` and handed to the editor when it binds, and
  a field opens at its drawing's height (no trailing block), because one that grew moved the button
  under the pointer and the press missed. A question is a `line` field (one paragraph: Enter goes on to the next
  field); details, answers and the explanation are `block` fields, whose schema (`FIELD_BLOCKS`) has
  no heading, task list, quote or rule — each of those is a quiz's own syntax, and a field that
  could make one could break its question. `promptLine` and `optionLine` escape what would read
  back as a heading's `{#id}` or a closing `#`, so any words a person types come back as those words.
- **A problem is said in words on its card, and has a fix there** (`src/ui/quiz/problems.ts`, a
  `switch` over `QuizCode` ending in `assertNever`). The parser's messages are unchanged, because
  agents read them through `quiz_check`; the page never shows them, a line number or a character of
  syntax. Each fix is a one-span writer: `resolveStray` (text after the answer becomes part of it,
  the question's details, or goes), `reidQuestion` (by index, since two share the id),
  `cleanHeading` (a setting the app does not know) and `closeFence` (a block left open swallowed the
  questions after it). A card holding text the form has no field for (`Question.stray`) is read-only
  until that text has a place, so an edit cannot rewrite it away. A write that would change the
  shape of the question list other than as asked is refused on its card.
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
- **A flashcard is `card` on an open question's heading** (#131): `{#q… card}`, the quote at its
  end the back, and a run shows the front with nothing to type, then the back, then the same
  verdict. A bare word, as `multi` is: `.card` is not an attribute word (`ATTR_WORD`), so the whole
  `{…}` would be read as the prompt and its id lost; and a build that does not know `card` reads an
  open question and warns, so the file still runs there. `Question.card` is the word on a question
  with no options — a new card with no back yet is still one, so the form shows it as one, but it
  is not `open` and says `EQ_NO_OPTIONS` until it has a back. **Every writer that rebuilds a
  heading's words keeps it** (`headingWords`: `stampIds` and the `set` op), or giving a card its id
  would make it an open question; `card` beside options is `WQ_UNKNOWN_ATTR` and is not written.
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
key `dag:quiz-about`, the events `dag:quiz` and `dag:practice`, and the query keys `quiz`, `quizzes`
and `run` — and `dag-run__option--block`, `dag-run__option-text--block`,
`dag-run__answer*`, `dag-run__judge*`, `dag-quiz-sheet__option--block`, `dag-quiz-sheet__open`,
`dag-quiz__option-text`, `dag-quiz__pin`, `dag-quiz__shuffle`, `dag-quiz__adds`,
`dag-quizzes__practice-folder`, `dag-quizzes__count`, `data-dag-run-place`, `data-dag-run-open`,
`data-dag-run-answer`, `data-dag-run-reveal`, `data-dag-run-judge`, `data-dag-run-model`,
`data-dag-quiz-open`, `data-dag-quiz-pin`, `data-dag-quiz-shuffle`, `data-dag-quiz-add-open`,
`data-dag-quiz-sheet-open`, `data-dag-quizzes-practice-folder`, and the menu pick `practise` — and,
for the builder, `dag-rich-field*` (not `dag-field`, the panel's labels), `dag-blocks--field`,
`data-dag-field-editor`, `dag-quiz__rich*`, `dag-quiz__placeholder`, `dag-quiz__grip`,
`dag-quiz__kind`, `dag-quiz__more`, `dag-quiz__fix`, `dag-quiz__stray*`, `dag-quiz__list`,
`dag-quiz__description`, `dag-quiz__problem-words`, `dag-check--round`, `data-dag-quiz-field`,
`data-dag-quiz-open-field`, `data-dag-quiz-kind*`, `data-dag-quiz-grip`, `data-dag-quiz-dragging`,
`data-dag-quiz-drop`, `data-dag-quiz-fix`, `data-dag-quiz-stray*`, `data-dag-quiz-refused`,
`data-dag-quiz-needs-answer`, `data-dag-quiz-add-details` and `data-dag-quiz-drop-answers*` — and, for
flashcards, `data-dag-quiz-add-flashcard`, `data-dag-run-flashcard`, `data-dag-run-flashcard-tag`,
`dag-run__flashcard-tag` and `data-dag-quiz-sheet-flashcard`. "Card" was taken three times over (the
form's `dag-quiz__card`, the Quizzes page's `dag-quizzes__card`, an embed's card), which is why every
name for a flashcard says `flashcard`.
Retired with the Source tab: `dag:quiz-mode`, `data-dag-quiz-mode`, `data-dag-quiz-source`,
`data-dag-quiz-multi`, `dag-quiz__mode`, `dag-quiz__source*`, `dag-quiz__field` and
`dag-quiz__problem-line`.

**Out, and why:** a button that asks a model to generate a quiz (an agent writes one with
`quiz_create` and `quiz_write`, and runs one in a conversation with `quiz_questions` and
`quiz_answer`; generating flashcards in the app is proposed in #140, not yet decided); a pick of questions as a preset (a preset is one quiz file); shuffling the
*questions* of a run
(the options shuffle, an author's order of questions being a course's order); grading an open
answer automatically (the person's verdict is the answer); a flashcard asked back to front, and
importing Anki decks; a recall schedule (records are kept, so
the counts one needs exist; when to ask again is a design decision); resetting a history, scores
over time and timers; a printed sheet; and practising on a
read-only view with a history, which has nowhere to keep it.
