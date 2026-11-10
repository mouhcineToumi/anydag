# AI and agents

AnyDag works without AI. When you want it, it uses **your own** AI: the Claude Code or OpenCode you
are already signed in to on this computer, or an API key you provide. AnyDag has no AI service of its
own and sends nothing anywhere unless you ask it to.

Choose the provider and model in **Settings → AI and agents**.

## The Assistant

The Assistant is a chat about your vault, run on your Claude Code or OpenCode sign-in. Open it beside any page with `space A` (or the sparkle
icon in the top bar), or full-window from **Assistant** in the sidebar.

It answers questions from your notes and cites the documents it used, as links you can click. It can
also make and reorganise documents in the vault the chat belongs to: "turn my notes on chapter 3 into
a quiz", "make a reading-list table from these links", "draw a mind map of this note". Every change it
makes is listed and can be undone, and a delete still waits for your yes.

Other vaults are closed to it until you grant them from the chat's vault menu, either **Read** or
**Read and change**. A vault granted Read refuses writes; the Assistant can ask you for more. It
only works through AnyDag itself: it cannot run commands or read other files on your computer.

## Prompt cards

On a board, `space P` adds a **prompt card**. Describe the diagram you want ("a timeline of the
French Revolution", "a flowchart of how a bill becomes law") and run it. The model writes the
diagram, AnyDag checks it, and it replaces the card. One undo takes it back. Prompt cards work with
Claude Code, OpenCode, or an API key for a model such as Gemini or any OpenAI-compatible service.

## Let an AI agent work in your folder

Because everything is a plain file, any AI agent that can edit files can write notes, boards and
quizzes in your vault, and the app shows each change as it happens.

For a richer connection, AnyDag includes an **MCP server**, so an agent such as Claude Code can use
every feature of the app: search, notes, boards, tables, quizzes, tasks, the trash. On first launch
the desktop app installs an `anydag` command (Settings → AI and agents shows where). Then, for
Claude Code:

```bash
claude mcp add anydag -- anydag mcp --vault ~/Notes
```

[`skills/anydag/`](../../skills/anydag/) is a skill that teaches an agent the board format and the
diagram language. Link it into your agent's skills folder (for Claude Code, `~/.claude/skills/anydag`).

## From a terminal

The `anydag` command also manages vaults, files, the trash and exports:

```bash
anydag serve ~/Notes        # open a vault in a browser on this computer
anydag ls --vault ~/Notes   # list what is in it
anydag help                 # every command
```

---

[← Tasks, projects and the calendar](tasks-and-calendar.md) · [Guide](README.md) · [Your files →](files.md)
