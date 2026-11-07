# Remote access, and the mobile app

The phone app is a **thin client of the desktop app**. It holds no vault and runs nothing: it opens
the page the running desktop serves, over a door the person opened, and everything — the vault, the
Assistant, a prompt card on the person's own Claude Code or OpenCode — runs on the desktop. With the
desktop off, the phone says so and does nothing else.

Decisions:

- **Tailscale for v1.** `tailscale serve --bg 4319` puts the door on the person's tailnet with a real
  certificate. The server never listens on a network interface and never holds a certificate. A hosted
  bridge for people who will not install Tailscale comes later, as one more proxy of the same kind.
- **Every paired device is a full device.** No read-only pairing.
- **The desktop app must be running.** Closing it takes the phone offline; there is no tray mode.
- **The phone's page is the desktop's**: the app loads `https://<host>/` from the desktop, so the UI is
  always the server's own version and an app update is never needed for a UI change.

## Phases

| | What | State |
|---|---|---|
| 0 | `anydag serve` behind `tailscale serve`, opened on a phone: the list of what breaks on a small screen | to do — needs a phone |
| 1 | The remote door on the server: devices, pairing, the gate, the listener, the CLI, parity | **done** |
| 2 | Settings → Devices: the switch, Tailscale's steps, the QR code, the device list; detect the tailnet name | **done** |
| 3 | The page on a phone: whatever phase 0 found | **started** — a board opens readable, the week is three days; the rest waits on a real phone |
| 4 | The Capacitor app (`mobile/`): server list, QR scanner, the token in the Keychain/Keystore, an offline screen; App Store and Play | to do |
| 5 | Push notifications (an Assistant approval waiting), the hosted bridge | later |

## Phase 1, as built

`server/remote.ts` is the meaning, `server/routes/remote.ts` the routes, the gate is `remoteGate` in
`server/app.ts`, the listener `remoteDoor` in `server/main.ts`, the CLI `cli/commands/remote.ts`,
and `test/server/remote.test.ts` holds it.

| Route | Door | Does |
|---|---|---|
| `GET` · `PUT /api/remote` | local | `{enabled, port, url, listening, problem}`; the door opens, moves or closes at once |
| `POST /api/remote/pair` | local | a one-time code: `{code, expires, link}` — `link` is `<url>/?pair=<code>`, what the QR code holds |
| `GET /api/remote/devices` · `POST /api/remote/devices/revoke` | local | the paired devices · unpair one, cut off now |
| `POST /api/device/pair` `{code, name}` | remote | the native app spending a code: `{device, token}` |
| `GET /api/device` · `POST /api/device/forget` | remote | which device this is · unpair itself |
| `GET /?pair=<code>&name=` | remote | a browser spending a code: swapped for the `anydag_device` cookie |

On the desktop, from a terminal:

    anydag remote on          # the address is this machine's on its tailnet, when Tailscale is connected
    anydag remote serve       # tailscale serve --bg 4319
    anydag remote pair        # open the printed link on the phone, once, within five minutes

## Phase 2, as built

Settings → Devices (`src/settings/panes/Devices.tsx`), in the app's group:

| Row | Does |
|---|---|
| *Let paired phones reach this desktop* | `PUT /api/remote {enabled}`; with no address, Tailscale's is taken |
| State | on, off, or why the door is not answering — polled every 3 s, since `PUT` answers before the listener is up |
| Address | typed, or *This computer on Tailscale is …* — one click |
| Tailscale | not installed (with the download link), not connected, connected (*Serve with Tailscale*), or serving the door |
| Pair a phone | *Show code*: the QR code, the link, Copy link, New code, and the minutes left |
| Paired devices | name, paired, last seen, Unpair (asked in the row) |

On a phone the tab is *This device* and *Forget this device*.

| Route | Door | Does |
|---|---|---|
| `GET /api/remote/tailscale` | local | `{installed, running, address, serving}`, from `tailscale status --json` and `tailscale serve status --json`, kept five seconds |
| `POST /api/remote/tailscale/serve` | local | `tailscale serve --bg <port>`: `{ok, message}`, Tailscale's own words when it refuses |
| `GET /api/device` | local | `{device: null}`: the page asks which door it is on without a 4xx |

## Phase 3, so far

Found by opening the app at iPhone size through the remote door (Playwright):

- **A board opened too small to read** — a fit of a wide board on a 393px screen is 11%. On a window
  under 720px, a board that would fit below 60% opens on its first item instead (`openOn` in
  `src/canvas/geometry.ts`), at 60% or more; *F* still fits the whole. Desktop unchanged.
- **A week is seven columns of nothing.** On a phone *Week* is three days (`PHONE_WEEK`), labelled so.

What only a real phone will show — the on-screen keyboard over the note editor, touch on the canvas,
Safari's own chrome — waits for the first scan.

## Phase 4 notes

- The WebView loads the desktop's page; the native half pairs (`POST /api/device/pair`), keeps the
  token, and sets the `anydag_device` cookie for the WebView, since an `EventSource` and an `<img>`
  cannot send a header.
- Apple guideline 4.2 rejects a bare website wrapper; native pairing and push notifications are what
  make it more. Home Assistant's companion app is the precedent for a WebView onto a person's own server.
- Accounts: Apple Developer ($99 a year), Google Play ($25 once). iOS builds on the macOS runner the
  desktop workflow already uses.

## Before shipping

- ~~An SVG opened as a document on the remote origin must not be able to write.~~ Tested in Chromium
  through the remote door: `/__board/file` was safe (its CSP has no `script-src`, so nothing runs), and
  `/__board/assets/*` was not — a planted SVG's script created a folder in the vault. That route now
  sends the same headers, and `test/server/remote.test.ts` holds it.
- The packaged desktop reads `dist/` unpacked from the asar (`asarUnpack` in
  `desktop/electron-builder.yml`); `npm run desktop:smoke` on all three systems is what says the main
  process's page still loads from there.
