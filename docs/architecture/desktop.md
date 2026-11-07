# The desktop app

> The Electron shell: the server child, the scheme, the token, signing, and the shim.

## The desktop app

`desktop/`. Electron around the one server and the built page:
`npm run desktop:dev` runs it on a checkout, `npm run desktop:dist` packages it for the
platform it runs on (`desktop/package.mjs`) — an AppImage for x64 Linux, an NSIS installer for x64
Windows, a `.dmg` and a `.zip` each for arm64 and x64 macOS — and `npm run desktop:smoke` opens the
packaged app on a fresh vault, waits for `data-dag-ready` (`ANYDAG_DESKTOP_SMOKE=1`) and passes on
one printed line; `-- --dev` runs it on `desktop/dist/` instead, `-- --app <exe>` names another
build. `.github/workflows/desktop.yml` builds and smokes all three systems on a pull request that
touches the app — on macOS both architectures, the x64 one under Rosetta — and keeps what it built
for a week.
`check:case`, in the fast tier, refuses two tracked files that are one file on their case-insensitive
disks — `src/ui/trash.ts` beside `Trash.tsx` was, and an import of `./Trash` built Linux clean and
failed on both.

| Where | Owns |
|---|---|
| `desktop/main.ts` | the server child, the `anydag://` scheme, windows, deep links, the shim, the keys, updates |
| `desktop/preload.ts` | `window.anydagDesktop`: the folder dialog, reveal, the keys (written, never read), the page's write key |
| `desktop/build.mjs` · `electron-builder.yml` | the two CJS bundles; what is packed, and what is unpacked for the child |
| `desktop/package.mjs` | electron-builder for this OS: whether to sign, and the second macOS architecture's watcher |
| `desktop/smoke.mjs` | the packaged app's one check, on all three systems |
| `src/vault/desktop.ts` | the page's side of the bridge — every use optional, so a browser on `anydag serve` works without it |

Eleven things are load-bearing:

- **The server is a child run by Electron's own binary as Node** (`ELECTRON_RUN_AS_NODE=1`), so the
  app ships one runtime. Its bundle and its one native module, `@parcel/watcher`, are unpacked from
  the asar: a child cannot `dlopen` out of one. The child's death ends the app, and the app's quit
  stops the child first — **by closing the IPC channel it was spawned with**, which the server
  answers with its own `quit` (`server/main.ts`). Windows has no SIGTERM: `kill()` there is
  TerminateProcess, which left `server.json` behind. A channel that closes because the app died
  takes the server with it on every system.
- **electron-builder packs every production dependency, whatever `files` lists.** The page and the
  server are bundles, so that was 238 MB of `node_modules` in the asar that nothing read, and the
  watcher's own package was packed rather than unpacked — it resolved only because a from-source
  rebuild happened to mark it native. `!node_modules/**/*` and then the five runtime modules by name
  is the list now (19 MB), and `npmRebuild: false`: the watcher is N-API and prebuilt, and a
  rebuild from its `binding.gyp` cannot cross-compile, which is what the macOS job does.
- **Each macOS architecture is its own build, from one job.** Not universal: that is both Electrons
  in one bundle for everybody. One job, so there is one `latest-mac.yml` naming both zips, and
  `electron-updater` picks the one whose name says its arch. `npm ci` installs only the runner's
  `@parcel/watcher-darwin-*`, so `package.mjs` fetches the other at the lockfile's version and
  checks it against the lockfile's integrity; `files` packs whichever are on the disk.
- **Signing is the environment's.** `package.mjs` signs macOS with `CSC_LINK` (notarising with
  `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`) and Windows with `WIN_CSC_LINK`,
  hands each OS only its own, and treats an empty variable as absent. Without a certificate,
  `CSC_IDENTITY_AUTO_DISCOVERY=false`, Windows is unsigned and macOS is signed **ad hoc**
  (`-c.mac.identity=-`) — an Apple Silicon Mac runs nothing unsigned, and the hardened runtime's
  default entitlements turn library validation off so the watcher loads. The shell is rebuilt with
  `ANYDAG_SIGNED`, because an ad-hoc macOS app cannot update itself (Squirrel.Mac checks the new
  version against a designated requirement an ad-hoc signature does not have), so it does not try.
  electron-builder skips signing on a pull request, ad hoc included, so `CSC_FOR_PULL_REQUEST` is
  set when there is no certificate to protect. `desktop.yml` is handed no secrets at all.
- **The token is the main process's alone.** It is minted per launch and handed to the child in its
  environment — never on its command line, which every user of the machine can read — and
  `protocol.handle("anydag")` adds it to every `/__board/*` and `/api/*` request it forwards to
  `127.0.0.1`. The page, its `localStorage` and its `EventSource` live on one stable origin,
  `anydag://app`, and no script in it ever sees the token.
- **Only the page writes.** Chromium gives a custom scheme's handler no `Origin` and runs no CORS
  preflight for it — measured: a sandboxed frame's `POST` with any header it liked reached the
  handler — so the handler asks every write for a per-launch **page key**, which the preload asks
  for synchronously and the main process gives only to **the top frame of a window showing the
  page** (`page:key`), and the page's `fetch` wrapper puts on every write (`marked` in
  `src/vault/current.ts`). And a window never shows an api path as a document: `will-navigate` and
  `window.open` to one download it instead. An SVG attachment can carry script; between the two, it
  can read at most.
- **The window is isolated and sandboxed with no Node**, no webviews, and only `http(s)://` and
  `mailto:` go to the OS (`shell.openExternal`): `file://`, `smb://` or a registered handler's
  scheme in a note is one click from running something, and a note is text anybody could write.
- **A key is kept by `safeStorage`** in the app's home (`keys.json`, mode 0600), and only the names
  in `PROVIDER_KEY_ENVS` are accepted. The page can store one and ask which are stored; it never
  reads one back. The server reads keys at spawn, so storing one **restarts the server**, reopening
  every vault it had open (each keeps its id, which is in the folder). A machine with no keyring
  gets the value encoded, not encrypted, and the console says so. **The server is spawned after
  `ready`**: its spawn reads the keys and the home secret, `safeStorage` throws before `ready`, and
  that throw read as "no keyring" — every first launch stored the home secret merely encoded. The
  macOS smoke log is what showed it.
- **A load always names `index.html`.** `anydag://app/?x` canonicalises to a pathname of `//`, and
  the page's own `history.replaceState` then resolves to an address with no host, which Chromium
  refuses as another origin — the smoke run's `ready=never` before it was found.
- **A deep link is `anydag://open?vault=<id>&board=…`** and a window is a vault: the link lands in
  that vault's window, or opens one. The single-instance lock hands a second launch's argv — a link
  or a folder — to the first. A tool's `url` is such a link. macOS hands a link over as `open-url`,
  never in argv, and a cold one arrives before the server has its port: it is kept (`coldLink`) for
  `whenReady`. The scheme is registered by the bundle's Info.plist on macOS and by
  `setAsDefaultProtocolClient` on Windows — the NSIS installer registers none of its own.
- **The `anydag` shim is `~/.local/bin/anydag`**, written on launch unless a file that is not ours is
  there — `anydag.cmd` under the app's home on Windows. From an AppImage it mounts the image
  (`--appimage-mount`, extracting when that fails) and runs the CLI inside it with the image's own
  Electron as Node; anywhere else it is one `exec`. The cmd shim is recognised as ours by the same
  `anydag shim —` the sh one carries, and says `setlocal`, or its `set` would outlive it in the
  shell that ran it. A Mac app running from its disk image or a translocated quarantine path writes
  none: that path is gone next launch. `~/.local/bin` is not on a Mac's PATH and
  Windows has no such folder, so the page is told where the shim is (`cli:path`) and Settings → AI
  and agents writes the MCP lines with that absolute path.

**Not yet, and why:** signing certificates, so the builds are unsigned and an unsigned Mac updates
by hand (the release workflow signs and notarises the moment the secrets exist); Windows on arm64
and Linux on arm64; a `.deb`; and registering
the `anydag://` scheme from an AppImage, which `appimaged` or the `.desktop` file it ships owns
rather than the app.
