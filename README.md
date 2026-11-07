# AnyDag

A local desktop app for notes, boards, quizzes, tables, tasks and attachments, with no account and
no cloud. Open a folder — a **vault** — and everything in it is a plain file: AnyDag lists it,
edits it, links it and searches it, and keeps only rebuildable indexes outside it.

The heart of it is an infinite canvas that renders technical diagrams from a DSL — fourteen types:
`erd · flow · arch · state · activity · class · usecase · sequence · c4 · mindmap · timeline ·
gitgraph · sketch · chart` — twelve laid out for you, one where the coordinates are yours, and one
that draws data. **An agent drives it by writing a file**, `<vault>/<name>.board.md`, which the app
watches and re-renders. A person edits the same board on the canvas — select, move, resize, group,
connect, type into a card, drag a component from the library, tidy the board with one chord, undo —
and every one of those is written back to that same file: a board is a document, and both writers
edit it. `space ?` lists every key.

Beside the boards: **notes** (any `.md`, in a block editor that rewrites only the block it touched,
with `[[wikilinks]]` and `$equations$`), **quizzes** (`.quiz.md`), **tables** (`.table.md`),
**tasks**, **projects** and **events** (a note with a `status:`, a `project:` or a `start:`), and
**attachments** in `attachments/`. Every document has a permanent `id:` in its frontmatter, so a
link survives a rename, and nothing is deleted at once: it goes to the vault's trash for thirty days.

You need not write the DSL at all: a **prompt card** takes a description on the canvas and has a
model write it — your own Claude Code or OpenCode login, or your own API key — checked by the real
parser before it lands. And the **Assistant** is a chat about the vault, beside any page, on the
same logins. All styling lives in a swappable theme (`themes/<name>/theme.json`) — three of them,
one dark.

````md
```arch {#shop title="What runs where" dir=LR}
group cloud "Cloud" hue=indigo {
  service api "orders-api" "node · fastify" { content "orders · payments" }
  store db "Postgres" "orders"
}
client browser "Customer's browser" "react"
browser --> api "https"
api.content --> db
```
````

## Status

**0.1.0 shipped for Linux only; the next release ships for Linux, Windows and macOS.** Each release
has an AppImage for x64 Linux, an installer for x64 Windows, and a disk image (and a zip) for macOS
on Apple Silicon (`arm64`) and on Intel (`x64`). **None of them is signed with a certificate yet**,
so Windows and macOS each ask once before they open the app — the steps are below. The Linux and
Windows builds update themselves; an unsigned macOS build cannot (macOS refuses to install an
update to an app without a developer signature), so on a Mac you download the next release yourself.

## Install

Download the file for your system from [Releases](https://github.com/mouhcineToumi/anydag/releases).

**Linux** — `AnyDag-<version>.AppImage`:

```bash
chmod +x AnyDag-*.AppImage
./AnyDag-*.AppImage
```

**Windows** — `AnyDag-Setup-<version>.exe`. Run it. Because the installer is not signed, Windows
SmartScreen says *Windows protected your PC*: click **More info**, then **Run anyway**. It installs
for your user only, with no administrator prompt.

**macOS** — `AnyDag-<version>-arm64.dmg` on an Apple Silicon Mac (M1 and later),
`AnyDag-<version>-x64.dmg` on an Intel one. Open the disk image and drag AnyDag to Applications.
Because the app is not signed by an Apple developer, macOS will not open it with a double-click the
first time. Either:

- **right-click** (or control-click) AnyDag in Applications, choose **Open**, then **Open** again —
  on macOS 15 and later, if there is no Open button, go to **System Settings → Privacy & Security**,
  scroll down to the message about AnyDag and click **Open Anyway**; or
- in Terminal, take the download's quarantine flag off, then open it normally:

  ```bash
  xattr -dr com.apple.quarantine /Applications/AnyDag.app
  ```

Run it from Applications rather than from the disk image, or the `anydag` command below is not
written.

On first launch it puts an `anydag` command on your machine — `~/.local/bin/anydag` on Linux and
macOS, `%APPDATA%\AnyDag\bin\anydag.cmd` on Windows — so the CLI and the MCP server below work from
a terminal. Settings → AI and agents shows its exact path, for a folder that is not on your `PATH`.

## Use it from a terminal or an agent

```bash
anydag serve ~/Notes             # serve a vault to a browser on this machine
anydag ls --vault ~/Notes        # every command is a client of the app's own routes
anydag help                      # the whole table; `anydag help --json` for machines
anydag mcp --vault ~/Notes       # an MCP server over stdio
```

To give Claude Code the MCP tools:

```bash
claude mcp add anydag -- anydag mcp --vault ~/Notes
```

`skills/anydag/` is a skill that teaches an agent the board format and the DSL; link it into your
agent's skills folder (for Claude Code, `~/.claude/skills/anydag`).

## Build from source

Node 24.7 or later.

```bash
npm install

npm run dev                 # Vite + the local server on boards/local/:  http://localhost:3500/?board=demo
npm run desktop:dev         # the Electron app on the same code
npm run desktop:dist        # package it for the system you are on, into release/

npm run checks              # typechecks, the check:* scripts, the unit suite — what every commit runs
npm run gate                # the same, then the Playwright suite

npm link                    # puts `anydag` on the PATH from this checkout
```

## Where to look

| Path | For |
|---|---|
| `CLAUDE.md` (also `AGENTS.md`) | the contributor guide: layer boundaries, rules, and the things that will bite |
| `server/` | the one Node process: the vault store, every route, the MCP tools |
| `desktop/` | the Electron shell around it |
| `cli/` | `anydag`, the command line |
| `src/` | the page: the canvas, the editors, the grammar, the layouts |
| `docs/dsl/` | the grammar, one sheet per diagram type |
| `docs/parity.json` | every feature against its route, its command and its MCP tool |
| `boards/local/` | the development vault; `reference/` has one board per diagram type |
| `skills/anydag/` | the agent skill |
| `sync/` | an optional, end-to-end encrypted sync server you can run yourself |

## Contributing

Issues and pull requests are welcome. `npm install` sets up the git hooks: `npm run checks` runs
before every commit, and the Playwright suite before every push (`npm run e2e:local`). A new route,
CLI command or MCP tool needs a line in `docs/parity.json` — the checks say so if it is missing.
`CLAUDE.md` is long; read the section for the part you are changing.

## Releases

A release is a tag: bump `VERSION` and `package.json` together, merge, and push `v<version>`.
`.github/workflows/release.yml` checks, builds, smoke-tests and publishes it.

## Licence

[MIT](LICENSE). The vendored icon sets keep their own licences; see `icons/NOTICE`.
