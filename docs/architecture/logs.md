# Logs

> Opt-in anonymous logs: what a batch may hold and every hop that cleans it.

## Logs

Anonymous logs from installs whose person said yes, and from no other. Off
until answered; asked once per install, on the first page anybody opens; changed in Settings →
Privacy or with `anydag telemetry on|off|ask`.

| Where | Owns |
|---|---|
| `api/protocol/logs.ts` | what a log may hold: `EVENTS`, each prop a count, a duration, a boolean or one word of a list; `scrub`; `cleanEvent` and `cleanBatch`, which every hop runs |
| `src/telemetry/client.ts` | the page's half: the answer (`useTelemetry`), `track`, `fail`, the error listeners, a post every 30 s and on `pagehide` |
| `src/telemetry/Prompt.tsx` · `what.ts` | the first-run question, drawn by `Shell` · the two lists it and the Privacy tab both say |
| `server/telemetry.ts` · `server/routes/telemetry.ts` | the answer in the home's `kv`, the install id, what is held, the route summary, where it goes, the send |
| `api/server/routes/logs.ts` | `POST /v1/logs` on the api server: open, rate-limited, one JSONL file a day in `<data>/logs/` |

| Route | Does |
|---|---|
| `GET /api/telemetry` | `{consent, destination}`; `consent` is `null` until answered, `destination` a host or `null` |
| `PUT /api/telemetry` `{enabled}` | `true`, `false`, or `null` to be asked again — not on the Assistant's list, so a chat cannot answer it |
| `POST /api/telemetry/events` `{events}` | the page's events; `{accepted}`, `0` unless the answer is yes |
| `POST /v1/logs` (the api server) | a batch `{v, env, events}`; `202 {accepted}` always, `0` for what is over a rate or not describable |

What a batch holds: errors and crashes (page and server — message and stack, scrubbed), `app.open`
and `page.ready` (which *kind* of page, and in how many milliseconds), `board.open` (how many items,
pages and of each diagram type), `feature.use` (export, generate, tidy — one word of `FEATURES`),
`route.timing` (each route template's count, 5xx count, mean and max, summed per minute), and an
`env` of the version, desktop or browser, the system, the arch, the language, and a random install id.

Eight things are load-bearing:

- **No prop can hold a person's words.** Every prop is a number, a boolean, a route *template* or
  one word from a list in `logs.ts`; an unknown event or prop is dropped, not kept. The two free-text
  props are an error's `message` and `stack`, and `scrub` takes out every quoted run (the app quotes
  what it reports), every URL and path but a script's own file name and line, every email, every
  file name and every long token with a digit in it. `test/logs.test.ts` holds the cases.
- **Every hop cleans again.** The page runs `cleanEvent` before it holds anything, the app's server
  before it keeps anything, the api server before it writes anything — so a hop that forgot, or a
  sender somebody wrote by hand, cannot put more on disk than the vocabulary allows.
- **The answer is the install's, in the app's home** (`telemetry.consent` in `kv`), not a browser's
  and not a vault's: one question per machine, read by the page, the CLI and Settings alike. A no
  deletes the install id and drops everything held; a yes makes a new one. Nothing is measured
  before a yes — `record`, `routeDone`, `fail`, `track` all return first.
- **Never under `?snapshot=1` or `?view=1`.** `startTelemetry` does nothing there: no request, no
  question, no listener. `telemetry.spec.ts` asserts the page makes no `/api/telemetry` request at all.
- **Where it goes**: `ANYDAG_LOGS_URL` (an address, or `off`), else the address a release build
  baked in (`https://api.anydag.com/v1/logs`; a checkout's build bakes in none), else the api
  server of the first vault paired on this machine, else
  nowhere — and nowhere means nothing is kept for later. Only a server that stays up sends (`start`
  in `server/main.ts`); the CLI's in-process one never does.
- **The question is a modal the board cannot hear behind.** `useEditor`'s capture-phase key handler
  runs before any card can stop a key, so it skips targets inside `[data-dag-telemetry-ask]` as it
  skips `[data-dag-settings]`; Escape is *No*.
- **`/v1/logs` is open, and stands in for a token with limits**: 256 KB a batch, 30 a minute an
  address, 3000 a minute in all, and what is over is `{accepted: 0}` rather than an error a client
  would retry. Nothing about the request — no address, no header — is written. `ANYDAG_API_LOGS=off`
  makes it a 404; `ANYDAG_API_LOGS_DAYS` (30) is how long a day file stays. The address the rate
  limits count is the proxy's word only when `ANYDAG_API_TRUST_PROXY` names hops (`docs/architecture/api.md`) —
  otherwise the socket's.
- **The suite answers no.** `e2e/global-setup.ts` answers the dev home's question once, or a card
  over every page would take every click; `telemetry.spec.ts` stands in its own answer with
  `page.route`.

Names claimed, grepped first: `dag-telemetry*`, `data-dag-telemetry*`, `data-dag-setting-telemetry*`,
the Settings tab `privacy`, and the event `dag:telemetry` (in `test/prefs.test.ts`'s list).

**Not feedback.** The feedback card (`feedback.md`) is a separate, explicit channel: a person presses
Send, their own words go, and the result is public. It never rides a batch, and the answer here has
no say over it, either way.

**Out, and why:** a third-party SDK (a vendor, and a second place deciding what is sent); session
recordings, clicks, or anything with a coordinate; and a per-vault or per-browser answer — a person
says it once.
