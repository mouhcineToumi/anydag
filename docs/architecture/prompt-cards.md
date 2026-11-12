# Prompt cards and prompt to edit

> A model writes the DSL: the card, the providers (Claude Code, OpenCode, HTTP), the fix loop, rewriting an existing diagram, and flashcards for a quiz.

## Prompt cards

A person describes a diagram and a model draws it where the description was. The card is
`src/render/PromptItem.tsx`, the gesture `ctl.generate` in `useEditor`, the edit it makes
`src/edit/generate.ts`, and everything that talks to a model is `plugins/generate/` — server-side,
plain Node, no `@/` aliases, called in-process by `server/routes/meta.ts`.

    ```prompt {#ask x=80 y=240 w=420 as=arch}
    A browser talking to an API that stores orders in Postgres.
    ```

`prompt` is its own item family (`PROMPT_TYPES`, beside `LINK_TYPES`) rather than a flag on `md`:
nothing in it is prose to render or DSL to parse, and the one thing that happens to it is that it
goes away. It is a fence all the same, so an unrun prompt survives a reload, is undone and copied
like anything else, and is in the file Claude reads. `as=` asks for a type; an unknown one is
`WB_BAD_AS` and dropped, so the card still runs and the model chooses.

Nine things are load-bearing:

- **The server writes nothing; the client commits the answer.** Undo here is a version of the file,
  and an edit the history did not make drops the stack. So `/generate` returns a draft, and
  `replacement()` turns it into one patch — insert right after the card, remove the card — which is
  one history entry. The answer took seconds, so it is applied to the board as it is *then*: a card
  moved meanwhile is replaced where it now is, and a card deleted meanwhile drops the answer.
- **The diagram takes the card's place in every sense the file states** — `x`/`y` when the card had
  them, and its page and group *as written*, not `item.page`, which is derived and says `page-1` for
  a card that never named one — **and not its width**: a card's `w=` is a text box's, and on a
  diagram `w=` widens the frame and leaves the content where it was. A diagram usually comes out far
  bigger than the card it replaces and may overlap what is beside it; `T` is the answer, and doing
  it automatically was left out because tidying a whole board nobody asked to have tidied is a
  bigger edit than the one requested.
- **The system prompt is files, never a string in code.** `docs/generate/guide.md` (the answer's
  shape, which type answers which question, the house rules), then `docs/dsl/common.md` and every
  cheat sheet — or only the one `as=` names — then the library, rendered, as the house idiom to
  copy. The grammar changes in the commit that changes the parser; a prompt that restated it would
  be the one copy nobody updates. About 50 KB with every type in, 13–23 KB with one. The guide's
  *Which type* table is a closed set and `test/generate.test.ts` holds it to `DIAGRAM_TYPES`.
- **The fix loop branches on codes.** Find the first diagram fence in the answer (unwrapping a
  reply fenced whole in ````markdown), check it with `parseBoard` and the dialect's parser — the
  *exact* text that will be inserted, with only the allowed attributes left on it — and if anything
  is wrong, send back every error and every *fixable* warning as `line:col CODE message` counted
  from inside the fence, and ask for the whole block again. Fixable is a word the model got wrong:
  an unknown icon, hue, attribute or row, a retired flag, a chart's length. `W_CHART_MANY` is a
  design choice and is not retried. The best draft wins — fewest errors, then fewest warnings — and
  a draft in the wrong type for an `as=` counts as an error, `EG_WRONG_TYPE`.
- **Where the diagram goes is never the model's.** The allowed fence attributes are `title`,
  `subtitle`, `dir`, `aspect` and `frame`, plus `w`/`h` on a `chart` or `sketch`, whose size is a
  choice; anything else a model writes — `x=`, `#id`, `page=`, `hidden` — is dropped before the
  check, not after it.
- **How hard the model thinks is the person's, not the machine's.** Settings → AI and agents offers
  `none · low · medium · high` beside the provider, and the level rides with the request — so trying
  `high` on a dense description is a select, not an edit to `.env.local` and a restart. It outranks
  `ANYDAG_LLM_REASONING`, because the environment is how this machine is set up and the select is
  somebody choosing now; `default` is a choice too, and means the model's own. **The level is passed
  through rather than checked against a list**: which levels exist is the model's business — Gemini
  3.8 Flash takes those four and refuses `minimal` in so many words, and that refusal is worth
  showing on the card. The server checks only the shape, because it ends up in a request body. For
  `opencode` it becomes a variant written `model#variant`, which is the *model's* vocabulary — GLM
  5.3 Flash has `low`, `high` and `max`, Kimi K3 only `max` — so `variantFor()` maps none and low
  onto `low`, high onto `high`, and the middle of the range is "say nothing".
- **A provider is a row in a table** (`providers.ts`), resolved per request from `.env.local` and
  the process environment, so a key added mid-session counts; in the desktop app the person's own key
  is kept in the OS keychain and never in a file anybody syncs.
  `GET /__board/llm` reports which could answer and why not, and never a key; the page names a
  provider by id. `ANYDAG_LLM_MODEL` is the default provider's model only — a Gemini name sent to Z.ai
  because somebody picked Z.ai in the settings card is the bug that rule prevents.
- **A failure is a sentence and a next step, not a developer's note.** The server keeps its
  plain-text `error` — MCP tools and the CLI read it — and adds a machine-readable `reason`
  (`{ code, provider?, keyEnv? }`) beside it on `/__board/generate` and per provider on
  `/__board/llm`. `src/settings/llmReason.ts` is the one place the page turns a code into plain
  words and at most two actions; the prompt card, Rewrite, Generate flashcards and Settings → AI
  and agents all use it. It knows whether this is the desktop app (a key in the keyring) or a
  browser (the server's environment), and offers **Use Claude Code** or **Use OpenCode** only when
  that other provider is ready. A missing or unknown reason falls back to the server's `error`, so
  a newer server never leaves the page with nothing to say.
- **Two adapters and one interface.** `complete(messages, signal) → text`. HTTP is a bare `fetch`
  to `{base}/chat/completions` — no SDK — and scrubs the key out of anything a provider says back.
  **Gemini is sent `reasoning_effort: low`** (`ProviderSpec.defaults`): 3.x Flash thinks by default,
  and on a diagram the thinking is nearly all of the wait — one description took 42 s at the model's
  default, 14 s at `low`, 10 s at `none`, the same diagram each time, and round 2 came back ten for
  ten at `low` in 1.5–7 s. `ANYDAG_LLM_REASONING` overrides it; `default` sends none.
  The CLIs are `claude -p` and `opencode run --standalone`, each fenced off from the machine: see
  below for Claude and *Things that will bite* for OpenCode.
- **The route is the one here that spends money**, and the server's token and `Host` check are
  what keep a web page the person happens to have open from calling it. A description is at most 4000 characters, at most four run at once, each has a
  timeout (`ANYDAG_LLM_TIMEOUT`, 120 s), and the client going away cancels the call.

**A card made from the chrome is centred, not cornered.** `space P`, the dock's sparkle and
*Describe a diagram* on a new board have no pointer position to honour, so `add` puts the card's
*centre* on the middle of the view (`centerItem` in `Viewport`, `centeredBox` in
`canvas/geometry.ts`). A card wider than the view is kept against its top-left edge rather than
half outside it.

The card itself: its controls stop the press that would select and drag the item — the header strip
is what you grab it by — and its text is written through the editor under `body:<id>`, the key the
panel types under, a quarter of a second after the last keystroke. Its run state is its own
`useState`: `Item` is memoised and a generation in flight is nothing the board needs to know about.
An empty card that becomes selected takes the caret, which is why `add` and `place` do not open the
panel for one — the panel would take the focus straight back. `as` is in no hash and is added to
`Item`'s memo comparison, because the select draws it. Under `?snapshot=1` the card draws its
description read-only.

**`scripts/generate.mjs`** is the card without the card — the same route, the answer printed with
its attempts, time and every leftover diagnostic — and is how models are compared. The e2e spec mocks `/generate` in every check: what is under test is what the page does
with an answer, and a real model would make the suite slow, paid for and different every run.

**`claude` is the person's own Claude subscription**, through the Claude Code signed in on this
machine — no key anywhere in AnyDag. `claudeComplete` runs `claude -p`
in an empty directory with the system prompt as `--system-prompt-file` and the request on stdin, and
reads `result` out of `--output-format json`. **The default is the first provider that can answer
now** (`defaultProvider`, #179): in the desktop app (`ANYDAG_DESKTOP=1`, which the shell sets) Claude
Code, OpenCode, then the keyed rows; anywhere else Gemini first, so a `.env.local` with a Gemini key
answers as it always did, then the same. Only when nothing can answer is it Gemini, whose missing key
is then what the card says. A browser on a machine where Claude Code is signed in used to fail its
first card on a Gemini key nobody had set. Five things bit:

- **`--bare` is the wrong flag.** It reads like "answer and nothing else", and it reads only
  `ANTHROPIC_API_KEY` — never the subscription's login — so the one run that should work is the one it
  refuses. `--safe-mode` is the isolation: no CLAUDE.md, skills, plugins, hooks or MCP, and the login
  untouched. `--tools ""`, `--strict-mcp-config` with no config and `--no-session-persistence` go
  with it; a real run sees no tool and about 900 tokens of context besides ours.
- **A refusal is JSON and an exit of 1.** Signed out, the CLI prints `is_error: true` with "Not logged
  in · Please run /login" in `result`, so the object is read before the exit code is, and that
  sentence is what the card shows.
- **A GUI-launched app has no login shell's `PATH`**, so `~/.local/bin`, where the installer links
  `claude`, is usually missing from it. `findClaude` asks `ANYDAG_CLAUDE_BIN`, then `PATH`, then the
  installers' places. "Signed in" is `claude auth status`, 0.2 s, remembered a minute when yes and
  three seconds when no. **The Assistant finds both CLIs the same way** (`findClaude`,
  `findOpencode`), and its picker asks the same readiness: it used to look on the `PATH` alone, so a
  desktop app started from a menu drew prompt cards with Claude Code and said the Assistant could not
  find it.
- **The child's environment is cleaned** (`claudeEnv`): an `ANTHROPIC_API_KEY` in the server's would
  bill that key instead of the plan, and `CLAUDECODE` from a dev server started inside a Claude Code
  session makes the child think it is nested.
- **`ANYDAG_LLM_MODEL` is read against the provider the environment named**, never the desktop's
  implicit Claude: a Gemini model name is not one Claude Code knows. The models are its aliases
  (`sonnet`, `opus`, …), so the row does not go stale with a release; Thinking maps onto `--effort`,
  which has no `none`, so none is `low`. A diagram came back clean on the first attempt in about four
  seconds at both.

**`opencode` is the person's own OpenCode login** the same way — OpenCode Go, or any provider they
connected with `opencode auth login` — through `opencodeComplete`, and it is the default after Claude
Code when that cannot answer and it can. OpenCode **2 or later**: the run is the five things
in *Things that will bite*, and four more are this row's.

- **"Ready" is three questions, each answered by the CLI in well under a second**: found
  (`ANYDAG_OPENCODE_BIN`, `PATH`, then `~/.opencode/bin` and the shared installers' places — mise's
  shim among them); new enough (`opencode --version`); and signed in **to the provider the model
  names** (`opencode auth list --format json`), so `anthropic/…` on a machine signed in only to
  OpenCode Go says so in the settings card rather than on the card after a run.
- **A refusal is an event and an exit of 1** — `{type: "error", error: {message}}`, "Variant
  unavailable for opencode-go/kimi-k3: high", "Model unavailable: …" — so the events are read before
  the exit code, and that sentence is what the card shows.
- **The request is on stdin**, as Claude's is, and the run has `ANYDAG_LLM_TIMEOUT` too; 1.x took it
  as the last argument and had neither.
- **The environment is cleaned** (`opencodeEnv`): the server's token, and `OPENCODE_CONFIG` or
  `OPENCODE_CONFIG_DIR`, which would load a config beside the one handed to it.

**Deliberately out**: more than one item per card; streaming the answer into the card (a
half-written fence is nothing the parser can show); and OpenCode Go over HTTP, for the reason in
*Things that will bite*.

**Board context is not the card's job, and the answer is next door.** A prompt *card* still sees
only its own text and type — it is drawing something new, and there is nothing around it to know
about. Editing the diagram *beside* the card is a different gesture with a different answer: the ids
come from the board, not from the model. See *Prompt to edit*.

## Prompt to edit

A prompt card draws something **new** and disappears. This is the other half: select a diagram that
is already on the board, press ✨ in the selection toolbar, describe the change in the dialog it
opens, and a model rewrites that item in place. *"Make the cache
a Redis cluster"*, *"split the API into two services"* — all of which meant opening Source and typing
DSL by hand.

It is the same route (`POST /__board/generate`), which grew a `source`: the existing fence body. With
one, the run is a **rewrite** — a different user turn, a rewrite section in the system prompt, and
a `from` naming the item's type now. It used to send `as` instead, pinned to that type, on the
argument that `EG_WRONG_TYPE` then guarded type drift for nothing; what it guarded was the one
rewrite with no other route, and *"use another diagram type"* failed on every attempt.
`from` tells the model what it is changing from and forbids nothing: every grammar is in the system
prompt, the model keeps the type unless the change asks for another, and the answer is judged with
no `as`. It is a type word or nothing — the server drops anything else rather than quote it into a
prompt.
`SOURCE_MAX` is 16 000 and separate from the description's 4 000: a legitimate diagram body can
exceed a cap calibrated for "longer than anyone types". The provider table, both adapters, the caps,
the timeout, the cancel-on-disconnect and the fix loop are all untouched.

Six things are load-bearing:

- **`extract()` takes the *first* diagram fence, and in rewrite mode that is a defect with no
  symptom.** A model asked to rewrite often quotes the original before its corrected version, so the
  first fence is the *original* — which then checks clean, ends the loop on attempt 1, and silently
  replaces a diagram with itself. Rewrite mode takes the **last** fence, and refuses a draft
  byte-identical to the source outright. Both, because the last-fence rule is a heuristic and the
  echo check is the thing that actually holds. A live model walked straight into it: asked to return
  a diagram unchanged, it echoed, was refused, and came back changed on attempt 2.
- **The landing is one `SetOp`, never `replacement()`'s insert-and-remove.** `SetOp`'s own doc
  comment already made the argument for Convert: remove-and-insert costs a new id, which loses the
  selection, every link that named it, and the item's place in the file. Keeping the id *is* the
  whole of link safety. Several items would be one `SetOp` each in a single `commit`, which is what
  makes it one undo entry — `remove` and `restack` are the existing shape.
- **What the model may write is the item's, not its own.** `rewriteOps` merges only the allowed
  fence attributes and never `x`, `y`, `page`, `group` or `id`. With nothing to merge it
  omits `attrs` entirely rather than sending `{}`, which would still trip `applyPatch`'s
  anonymous-id pinning — a file change the rewrite did not ask for. **`type` is written when the
  draft's differs**, through `SetOp.type` as a Mermaid conversion is, so the id and every link
  naming it survive a retype; and `retyped()` takes off what only the old type meant — `layout=fixed`,
  whose coordinates the new body does not carry, and a chart's or a sketch's `w=`/`h=`, which on
  any other type widen an empty frame.
- **A dropped id removes the whole curve, not half of it.** `resolveLinks` pushes a link only when
  *both* ends resolve, so a rewrite that loses a referenced node makes a line vanish rather than
  dangle, which is far harder to notice. `src/board/survive.ts` answers which ids something else
  points at would stop existing, and `nodeIdsOf` was **lifted out of `resolveLinks`** rather than
  written twice — a second implementation that disagreed one parse later is the failure the module
  exists to prevent.
- **The preview is the item itself.** Nothing rendered a diagram from text that was not the board
  file, and nothing needed to: `Item` takes a `BoardItem`, so `App` substitutes a shallow copy
  carrying the draft's body — and its type, less what `retyped()` would take off — and the parse,
  the layout and the render run on it unchanged. `proposedItem` sits beside `rewriteOps` so the
  preview and what Accept writes are one rule. Its `hash` is rebuilt, or the layout cache hands back
  the old drawing. Not under `?snapshot=1`: a screenshot is a fact about the file.
- **Accept can be refused, and the proposal survives it.** A write against a version that moved
  answers `false`; clearing the preview then would take a draft that cost seconds and a paid call
  with it and say nothing. The proposal stands with the reason beside it.

**A rewrite that changes nothing cannot be asked for**, and it falls out of the echo rule — the model
invents a change on the retry rather than standing its ground. The right failure for a route whose
purpose is to change something, and a real edge all the same.

**Deliberately out**: rewriting more than one item at once — what one instruction means across three
bodies is a design question, and it is refused with a reason rather than half-done; and letting the
model rename an id, which `renameItemId` could carry across the board's `edges` fences but which
nothing yet asks it to.

## Flashcards from a model

The same route writes a deck of flashcards for a quiz (#140). The quiz page's *Generate flashcards*
opens a dialog: a topic typed, or a note of the vault chosen with what to focus on, and how many
(ten unless said, one to thirty). `POST /__board/generate {kind: "flashcards", prompt, source?, count}`
— `prompt` the topic, `source` the note's text with its frontmatter off — answers
`{ok, cards, problems, attempts, error?}`, and nothing is written until the person has seen the
cards and kept some. Where the kept ones land is *Quizzes*; this is the model's half.

It shares everything around the loop with a diagram's: the provider table and the person's choice in
Settings, both adapters, the four-at-once limit, the timeout per attempt and the cancel when the page
goes away (`spend` in `server/routes/meta.ts`). A topic is held to the description's 4 000 characters
and a note to 60 000 of its own, since a page of revision notes is the whole point. The MCP
`generate` tool takes the same `kind` and `count`, and an agent lands each card with
`quiz_question_set`.

Four things are load-bearing:

- **The check is the real quiz parser.** `plugins/generate/cards.ts` reads the reply with
  `parseQuiz` — the parser the quiz page runs — after unwrapping a deck fenced whole, and keeps only
  a question that is a flashcard (`card` on its heading, no checklist) and askable (a front and a
  `>` back). An open question without the word, or one with options, parses clean as a quiz and is
  still not a card: that is `EG_NOT_A_CARD`, the generator's own code, as `EG_WRONG_TYPE` is for a
  diagram in the wrong type. A preamble before the first `##` is dropped, and so are the id-shaped
  warnings (`WQ_NO_ID`, `EQ_DUPLICATE_ID`), since ids are not the model's.
- **The fix loop sends back problems by card and code** — `card 3 (“What is WAL?”) EQ_NO_OPTIONS —
  …`, never a line number the model would have to count — and asks for the whole deck again. The
  best attempt wins: the most cards, then the fewest problems. A deck the model never got whole
  still answers with the cards that passed and the problems of the ones that did not, which the
  dialog counts as *left out* rather than showing; only an answer with no card at all is `ok: false`,
  with what the model said instead, quoted, so a refusal reads as one.
- **Neither the id nor the form is the model's.** A card comes back as `renderQuestion` writes it,
  `## Front {card}` and the quote, with any id the model wrote dropped — the writer mints one against
  the quiz the card lands in, which the server never sees.
- **The system prompt is a file**, `docs/generate/flashcards.md`, served by the grammar's `/system`
  as `mode=flashcards` — the prompt card's rule. It says what a card is in the few lines a card
  needs rather than carrying the skill's quiz section; a sheet that drifted from the format would be
  caught by the parser on the first reply, and `test/generate-cards.test.ts` holds its own example to
  reading clean.

`e2e/quiz-generate.spec.ts` mocks `/generate`, as the prompt card's spec does.

**Deliberately out**: generating multiple-choice or open questions (the same loop could hold them,
with a different keep rule); telling the model which cards the quiz already has, so a second deck
on one topic may repeat the first and the person unticks the repeats; and a note's own menu item —
the quiz is where the cards land, so the quiz is where they are asked for, and a note is one of the
two things they can be made from.
