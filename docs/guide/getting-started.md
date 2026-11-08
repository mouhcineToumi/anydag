# Getting started

## Install

Download the file for your computer from
[Releases](https://github.com/mouhcineToumi/anydag/releases). The latest release is the stable
one. 0.1.0 shipped for Linux only; the next release adds Windows and macOS. Pre-releases named `X.Y.Z-nightly.YYYYMMDDHHmm` are nightly builds: newer, and sometimes broken.

> **The builds are not signed with a certificate yet**, so Windows and macOS each ask once before
> they open the app. The steps below get you past that. The Linux and Windows builds update
> themselves. On a Mac you download each new release yourself, because macOS will not install an
> update to an unsigned app.

### Linux

Download `AnyDag-<version>.AppImage`, then:

```bash
chmod +x AnyDag-*.AppImage
./AnyDag-*.AppImage
```

### Windows

Download and run `AnyDag-Setup-<version>.exe`. Windows SmartScreen says *Windows protected your PC*:
click **More info**, then **Run anyway**. It installs for your user only, with no administrator
prompt.

### macOS

Download `AnyDag-<version>-arm64.dmg` for an Apple Silicon Mac (M1 and later) or
`AnyDag-<version>-x64.dmg` for an Intel Mac. Open the disk image and drag AnyDag to
**Applications**. The first time, macOS will not open it with a double-click. Either:

- **right-click** (or control-click) AnyDag in Applications, choose **Open**, then **Open** again. On
  macOS 15 and later, if there is no Open button, go to **System Settings → Privacy & Security**,
  scroll to the message about AnyDag and click **Open Anyway**; or
- in Terminal, remove the download's quarantine flag, then open it normally:

  ```bash
  xattr -dr com.apple.quarantine /Applications/AnyDag.app
  ```

Run it from Applications, not from the disk image.

## Open a folder

AnyDag works on **a folder on your computer**. The app calls it a **vault**. Pick an empty folder to
start fresh, or a folder you already keep Markdown notes in: AnyDag lists what is there and changes
nothing until you edit something.

Everything you make is an ordinary file in that folder:

| You make | It is saved as |
|---|---|
| a note, a task, an event | `Name.md` (or `Name.note.md`) |
| a board | `Name.board.md` |
| a quiz | `Name.quiz.md` |
| a table | `Name.table.md` |
| a picture or a file you upload | the file itself, in `attachments/` |

Because these are plain text files, you can back them up, put them in git, or open them in any
other editor. You can open several vaults and switch between them from the name at the top of the
sidebar.

## Find your way around

The **sidebar** on the left holds everything:

- **Search** finds any note, board, quiz or table by its name *and* by the words inside it.
- **Tasks**, **Calendar**, **Quizzes** and **Assistant** are pages that gather things from the whole
  vault.
- **Files** is your folder, as a tree. Use **+** to make a note, board, quiz, table or task, or drag
  files from your computer onto a folder to upload them.
- **Trash** holds what you deleted, for thirty days.
- **Settings** has the theme (light, dark or neutral), the calendar's time zone, the AI provider
  and more.

## Keyboard

Most shortcuts start with **Space**: tap it, then a letter.

| Keys | Does |
|---|---|
| `space O` | search |
| `space A` | open the Assistant beside the page |
| `space ?` | list every shortcut |
| `ctrl+,` | Settings |
| `ctrl+shift+L` | lock the app read-only, so nothing changes by accident |

On a board, `space N` adds a note card, `space L` opens the component library, `space P` adds a
prompt card and `space T` tidies the layout. See [Boards and diagrams](boards.md).

## Next

- [Notes](notes.md): start writing.
- [Boards and diagrams](boards.md): draw a mind map or a plan.
- [AI and agents](ai.md): bring your own AI.
