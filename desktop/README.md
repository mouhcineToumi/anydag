# The desktop shell

Electron around the one Node server and the built page.

**Run it**

```sh
npm run desktop:build   # page, server, CLI, then desktop/dist/main.cjs + preload.cjs
npm run desktop:dev     # rebuild the shell, then Electron on it, any vault folder as argv[2]
npm run desktop:dist    # release/: an AppImage, a .dmg + .zip, or an NSIS .exe — this system's, unsigned
npm run desktop:smoke   # the packaged app on a fresh vault; `-- --dev` for desktop/dist, `-- --app <path>` for one
```

`desktop:smoke` is what `.github/workflows/desktop.yml` runs on Linux, macOS and Windows. By hand,
the same check — load the first board of the folder given, wait for `data-dag-ready`, print one
line and quit:

```sh
ANYDAG_DESKTOP_SMOKE=1 ANYDAG_HOME=$(mktemp -d) npx electron desktop/dist/main.cjs <a vault folder> --ozone-platform=x11
```

`--ozone-platform=x11` for headless-ish checks: Electron's native Wayland backend does not get
frame callbacks for an unfocused window on some compositors, and the canvas publishes
`data-dag-ready` only after a frame has painted. In normal use the window is focused and the
native backend is fine.

**The security model.** The main process spawns the server with Electron's own binary as Node on
`127.0.0.1` behind a random per-launch token, and serves the built page itself through
`protocol.handle("anydag")`, forwarding `/__board/*` and `/api/*` with the token attached — so the
page, its `localStorage` and its `EventSource` all live on one stable origin and **the token is
never in the renderer**: it reaches the server in its environment, not on a command line `ps` can
read. A write must also carry the per-launch page key, which only the top frame of a window showing
the page is given, so an attachment opened as a document can read at most; and a window never
navigates to an api path, which is downloaded instead. The `BrowserWindow` is isolated and sandboxed with no node, `http(s)`
links go to the person's own browser, and the keys a provider reads live encrypted (`safeStorage`,
plain-encoded with a console warning on a keyring-less machine) in `$ANYDAG_HOME/keys.json` behind
an IPC surface that only ever says whether a key is set.
