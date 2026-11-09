# Feedback

> Send feedback: a person's bug or idea, made a public GitHub issue through a stateless relay. How to
> run the relay.

## Feedback

The sidebar's **Send feedback** opens a card: a kind (*Something is wrong* or *An idea*), a text,
up to five files (paste or drop a screenshot, or pick a video or a file), and a tick that attaches
the board or note behind the card. Before Send, the card lists what leaves the machine. On Send it
shows the GitHub issue that was made, or why nothing was made. An agent can do the same through
the MCP `feedback` tool, but only when the person asked it to. The CLI has no `feedback` command:
sending feedback is not administering a vault.

| Where | Owns |
|---|---|
| `sync/protocol/feedback.ts` | the kinds, the caps (10 MB, 5 files, the text and document lengths), the MIME rule, `feedbackProblem`, which every hop runs |
| `src/feedback/FeedbackCard.tsx` | the card: kind, text, files, the tick, the consent list, the draft that survives a close or a failed send |
| `server/feedback.ts` · `server/routes/feedback.ts` | where it goes, the machine's `env`, reading the ticked documents, the forward |
| `sync/server/routes/feedback.ts` · `sync/server/github.ts` | `POST /v1/feedback`: rate, caps, the uploads, the issue |

| Route | Does |
|---|---|
| `GET /api/feedback` | `{destination, env}`: the relay's host or `null`, and the version, system and arch a send carries |
| `POST /api/feedback` `{kind, text, boards?, notes?, files?}` | `201 {url}`; `boards`/`notes` are names in the vault, `files` `{name, type, data}` in base64; a refusal is the relay's sentence at its status |
| `POST /v1/feedback` (the relay) | multipart `kind`, `text`, `boards`, `notes` (JSON `[{name, text}]`), `env` (JSON), `files`; `201 {url}` |

Eight things are load-bearing:

- **Exactly what the card lists, and nothing else.** That is the text, each file by name, the whole
  text of each ticked board or note, and `AnyDag <version>, <os>, <arch>`. A document goes under its
  own file name and not its folder (`plan.board.md`, not `clients/acme/plan`). There is no install
  id, no vault and no path. Nothing goes before Send.
- **Feedback is not telemetry.** A person sends it on purpose, it carries their own words, and it
  is public. It never rides a log batch, and the logs answer has no say over it (`logs.md`).
- **The app holds no GitHub token.** The page asks `POST /api/feedback`, the app's server forwards to
  the relay, and only the relay's environment holds the token. The page never calls the relay.
- **Where it goes**: `ANYDAG_FEEDBACK_URL` (a relay's address or the endpoint; `off` sends nowhere),
  else `ANYDAG_FEEDBACK_BUILD_URL` built in by `server/build.mjs`, else nowhere. With nowhere set,
  the card says feedback is not available. Unlike logs, a paired sync server is never assumed: a
  self-hoster's server forwarding to our tracker is not something they set up.
- **Every upload happens before the issue.** If any upload fails, no issue is made, the card keeps
  the draft and shows the relay's sentence. A file uploaded before the failure stays in GitHub's
  storage. The relay has no copy, and GitHub has no API to delete one. This is accepted, because the
  alternative is a store of our own.
- **The relay is stateless.** It buffers one request in memory and checks it again with
  `feedbackProblem`. It uploads each file, makes the issue and answers `{url}`. It writes no file,
  no database row and no log line holding a byte of the submission. A GitHub failure is logged by
  its status alone. The repository's numeric id is the only thing it remembers between requests.
- **Nobody is pinged.** An `@name` in the text is broken with a zero-width space, a document goes in
  a `<details>` inside a fence longer than any backtick run in it, and a file name is escaped.
  Without that, the relay would let anyone mention any GitHub account from the maintainer's token.
- **The card is a modal the board cannot hear behind.** `useEditor`'s capture-phase handler skips
  `[data-dag-feedback]` as it skips `[data-dag-settings]`. A paste stops at the card, and a pasted
  picture becomes an attachment. The draft lives in memory, one per tab. Closing the card or a
  failed send keeps it; only a send that became an issue clears it.

Names claimed, grepped first: `dag-feedback__*` (only `__text` existed, the rewrite dialog's
textarea), `data-dag-feedback*`, and the chrome request `feedback` on `dag:chrome`.

## Running the relay

The relay is a route of the sync server (`anydag-sync`), next to `/v1/logs`. It is open, and limits
stand in for a token.

| Variable | Means |
|---|---|
| `ANYDAG_FEEDBACK_GITHUB_TOKEN` | a **fine-grained personal access token** for the maintainer's account, limited to the one repository, with **Issues: read and write**. Unset, the route answers `503 ES_UNAVAILABLE` ("feedback not available"), and the card says so |
| `ANYDAG_FEEDBACK_REPO` | `owner/name`; `mouhcineToumi/anydag` by default |
| `ANYDAG_FEEDBACK` | `off` makes the route a `404` |

The token belongs to a person, not a GitHub App, because the user-attachments upload endpoint
(`POST https://uploads.github.com/user-attachments/assets?name=…&content_type=…&repository_id=…`) is
not part of GitHub's documented API and acts as the token's user. It is the endpoint the issue
editor's drag-and-drop uses, and the `https://github.com/user-attachments/assets/…` address it
answers with is the attachment: a picture is drawn inline (`![name](url)`), anything else is a link.
`attachmentUrl` looks for that address anywhere in the answer, so the key it comes under is not
something the relay depends on. Labels are set at creation (`status: triage`, `type: bug` or
`type: feature`, and `feedback`). GitHub drops labels silently from a token without push access,
so the token's user must be able to triage the repository.

Limits: **10 MB** a submission (read up to that plus 256 KB of multipart framing, and refused past it
with `413 ES_TOO_LARGE`, whether or not a length was declared), **5 files**, of `image/*`, `video/*`,
`application/pdf` and `text/*` only, **20,000 characters** of text, **5 documents** of at most
**200,000 characters** each. Rate: **5 a minute an address and 60 a minute in all**, the same
fixed window as `/v1/logs`, answered `429 ES_RATE`. A GitHub failure is `502 ES_UPSTREAM`.

**What is kept: nothing.** No object storage, no database row, no file on disk, no payload in a log.
The issue and its attachments are public on GitHub. On request we remove the issue or comment and
its links. GitHub has no API to delete the bytes of an uploaded attachment, so anyone who kept the
address can still reach it. The card says this before Send.

**Out, and why:** Linear (its GitHub sync goes from GitHub to Linear, and its attachments stay Linear
links), gists and any fallback storage (a link rather than an attachment, and a store to run), an
account or a reply thread in the app, sending anything automatically (crash reports stay logs),
and a CLI command.
