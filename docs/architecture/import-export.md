# Import and export

> SVG, PNG, `.board.md`, the note PDF, and file import.

### Import and export

`src/export/` grew two files beside `svg.ts`: `png.ts` rasterises an SVG through an `<img>` and a
canvas, and `save.ts` hands the browser a file. `boardToSvg()` is the board-level export — one
`<foreignObject>` per item at its board position, the paper as a `<rect>`, the fonts once. Import
lives in `useEditor.importFiles()`, reached by a file drop on the board or Import in the dock's `⋯`.

**Export is at the end of the top bar** — `src/ui/Export.tsx`, on a board and
on a note — and not in the `⋯` any more: it was found there by nobody, and a note has no dock. A board
saves as SVG, as PNG at the export scale the menu states, or as its `.board.md`;
a note as **a PDF** or its `.note.md`. Four things about the PDF:

- **It is the browser's own print** (`src/export/print.ts`, `printAs`; Electron's `printToPDF` in the
  desktop app), which is the only way a page can make a PDF whose text is text. The title is the document's for the length of the dialog,
  because it is what the dialog offers as the file name.
- **What is printed is the file, drawn read-only** — `NotePrint` in `src/view/`, `react-markdown`
  with the embeds and references `?view=1` draws, and the frontmatter's title as its first line,
  since on screen the title is in a top bar paper does not have. Never BlockNote's DOM, which is an
  editor's: handles, placeholders, a caret. The text comes from `NoteView`'s `handle`, after a
  pending save has been sent, off the editor's blocks — so a save that could not land still exports
  what the person was looking at.
- **It is paper, so it is light.** `paperTheme()` is the screen's theme when that is light and the
  default otherwise, applied to the sheet's own element — `applyTheme` takes one — so the app behind
  keeps its own. The dark theme shares the default's metrics, so nothing is measured twice.
- **It prints once it is drawn**, and gives up waiting at twenty seconds rather than never printing.
  Laid out but hidden at 170mm — inside A4's margins and Letter's — so an embedded board is fitted,
  once, to the width it prints at; `content-visibility` is off inside it, because it is never on the
  glass.

`anydag note export --format pdf` is the same sheet through Chromium's own PDF writer: the note page
answers `dag:export` with `kind: "pdf"` by setting the sheet out and replying with its title once it
is drawn, and leaves it up for the script to print. Names claimed, grepped first: `dag-export*`,
`data-dag-export-menu`, `data-dag-export-as`, `data-dag-export-failed` — and `data-dag-export`
itself, which was the `⋯` menu's `<select>` and is the button's hook now — `dag-print*`,
`data-dag-print`, `data-dag-printing` and `data-dag-embed-ready`.

Two things that will bite:

- **An SVG with `<foreignObject>` must reach the canvas as a data URL.** Loaded from a blob URL,
  Chrome taints the canvas it is drawn on and `toBlob` throws `SecurityError`; the same bytes as
  `data:image/svg+xml;charset=utf-8,…` draw clean. Every HTML-to-image library does the same,
  and this is why.
- **`dragover` has to be cancelled**, or the browser opens the dropped file itself — and only over
  the board, so a drop on the chrome around it still does nothing.
