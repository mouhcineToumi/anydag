# Attachments

> Any file kept in the vault: ids, previews, what the server serves inline, the zip export.

## Attachments

An **attachment** is any file a person keeps: `<vault>/<name>.<ext>`,
by default in the vault's one `attachments/` folder. It is listed,
foldered, moved, favourited, searched and carried between vaults as a note is, with a permanent id
(`<vault>/.anydag/files/<id>.json` holds `{path, title}`, since a PDF has no frontmatter), and it is
opened at `?file=<name>`.

| Where | What it does with one |
|---|---|
| the sidebar | Upload (the actions, or a folder's `+`) and files dropped from the computer onto a folder; a row wears an icon for its sort — PDF, picture, sheet, slides, document, audio, video, archive, text |
| its own page, `?file=` | its title at the top, which renames it; the file drawn — a picture, a PDF through pdf.js, audio and video in the browser's players, text as text — or a card with its type, size and Download |
| a note | `/` *Upload file*, or a file dropped from the computer: kept beside the note and embedded at the caret; `![Title](dag:<id>)` draws a picture inline and anything else as a card that previews in place |
| a board | a file dropped on the canvas, Import, or a sidebar row let go over it: a picture is an `image` fence with `src="dag:<id>"`, anything else the placed card every document is |
| `?view=1` | the page read-only; a note or board draws the files it names |
| Export | a board or a note that names an attachment or a pasted picture saves as `<name>.zip` |
| Settings → Import and export | the largest file and the types this server takes, read-only |

Nine things are load-bearing:

- **A pasted image is an attachment too.** It is kept in
  the vault's attachments folder like any upload (`storePasted` in `server/routes/files.ts`), so one
  picture pasted into two notes is two references to one file — a screenshot belongs to the vault
  rather than to the document it was pasted into. `<name>.assets/` is read, so every
  existing document still draws, and never written again.
- **The name keeps its extension and nothing else's does.** `specs/Q3 report.pdf`: a portable stem
  (`cleanSegment` in `server/names.ts`), then an extension of `[a-z0-9]{1,12}` the vault lists —
  `md` and `assets` refused, so no attachment is ever a document or a picture folder. A move keeps
  the extension whatever `to` says (`fileTarget`): renaming a PDF does not change what it is.
- **The title is the index's**, because a PDF has no frontmatter: its `.anydag/files/<id>.json`.
  It starts as what the file was called on the uploader's disk, and
  `/retitle` with `follow` moves the name to the title's stem, extension kept.
- **The server decides what a file is, off the extension** (`server/uploads.ts`), and ignores the
  `Content-Type` the browser sent. It serves inline only what a browser draws safely — a picture, a
  PDF, audio, video, plain text — and everything else as a download; always `nosniff`, and a
  `sandbox` CSP on everything but a PDF, which Chrome will not draw under one. An `.html` uploaded
  here is a download and never a page on the app's origin; an `.svg` is drawn only as an `<img>`.
- **The bytes are the request body**, `POST /__board/file?name=&folder=&title=`: twenty-five
  megabytes are thirty-three as base64, and a multipart form wants a dependency the server does not
  need. The size is checked as it streams in, so an oversized file is refused at its first megabyte
  over. The page checks the same two limits before it sends anything (`refusal` in
  `src/files/upload.ts`, the server's sentences word for word), and a board says a refused drop in
  `UploadNotice`, off the `dag:upload-problem` document event.
- **A reference is an id**, as to anything: a rename or a move changes no file that names it, and one
  stored file serves every note and board that does. `attachmentOf` in `src/render/assets.ts` is how
  an image fence's `src` becomes `/__board/file?id=`; `ownAssets` is the one place a page decides
  where a picture is.
- **Deleting one moves it to the trash**. `anydag file rm` and `file_delete` still read
  the references index and name the documents that use it; the embeds in them draw as missing until
  it is restored, under the same id, and then draw it again.
- **The zip is the page's and the CLI's one function**, `src/export/bundle.ts`, pure and DOM-free:
  every `dag:` naming an attachment rewritten to its path in the zip (a board or a note stays a
  `dag:`), the files beside the Markdown, a pasted picture at the path its text already gives it. A
  document that names nothing still exports as the `.md` it was.

**An attachment is a file of a type this server knows** (the vault's `types`: `DEFAULT_TYPES` and
whatever `ANYDAG_UPLOAD_TYPES` adds), so a page or a script somebody
left in a folder is not listed or served. Both file routes answer a
`Range` with a 206 (`byteRange` in `server/uploads.ts`): a `<video>` will not seek without one, and
Safari will not play one at all. The size limit is `ANYDAG_UPLOAD_MAX_MB`, 512 by default.

The change feed says `dag:file` for an attachment, carrying its title, so a row is redrawn in place;
`useFiles` keeps the page's list of them, and the file's page draws nothing until that list says the
file exists — an `<img>` pointed at a missing file is a 404 on the console, which fails the suite.

Names claimed, grepped first: `dag-file*`, `dag-pdf*`, `dag-embed--file`, `dag-embed--picture`,
`dag-embed__filerow`, `dag-embed__preview`, `dag-embed__title`, `dag-embed__chev--open`,
`dag-upload-notice*`, `dag-blocks-drop`, `dag-sidebar-files`, `data-dag-file*`, `data-dag-pdf*`,
`data-dag-embed-download`, `data-dag-embed-kind`, `data-dag-embed-picture`, `data-dag-embed-preview`,
`data-dag-embed-previewing`, `data-dag-note-drop`, `data-dag-note-upload-problem`,
`data-dag-sidebar-upload*`, `data-dag-sidebar-uploading`, `data-dag-unlink*`,
`data-dag-upload-problem`, `data-dag-ref-kind`, `data-dag-setting-upload-max`,
`data-dag-setting-upload-types`, the events `dag:file` and `dag:upload-problem` (in
`test/prefs.test.ts`'s list), and the query key `file`.

**Out, and why:** text search inside a PDF, annotation, OCR, link previews;
importing an exported zip back; a new version of a file under its old id (an upload is a new file,
and replacing one is a decision about what every reference then means); and a thumbnail of a PDF's first page on its card, which would load
pdf.js on every page that shows one, for a picture of a page the preview is one click from.
