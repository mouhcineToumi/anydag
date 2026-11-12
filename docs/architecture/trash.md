# The trash

> Nothing is deleted at once: the vault's trash, restore, expiry, and its routes.

## The trash

Every delete a person or an agent makes — a file of any
kind, or a folder with everything in it — moves the thing to the vault's trash, where it stays for
`ANYDAG_TRASH_DAYS` and comes back as it was; only the trash deletes for good.

| Where | What it does |
|---|---|
| the sidebar | Delete on a row, a picked row's menu or the selection's bar: to the trash at once, nothing asked; a **Trash** row at the foot opens the page |
| the notice | *Moved “Plan” to the trash* · **Undo** (every entry the delete made, the open file reopened, a favourite a favourite again) · **View trash**; eight seconds, held while the pointer or the focus is on it |
| the Trash page, `?trash=1` | newest first: the mark, the title, where it was, what a folder held, *Deleted 3 days ago · 27 days left*; Restore; Delete forever, asked in its row; a filter; Empty trash, asked once |
| Settings → This vault → General | how many days, read-only — the server's |
| `anydag trash ls\|restore\|rm\|empty` · `trash_list`, `trash_restore`, `trash_delete`, `trash_empty` | the same four, by an entry's id or the name it had; the two that delete for good ask, or want a `confirm` |

| Route | Does |
|---|---|
| `POST /__board/delete` `{name, kind}` · `POST /__board/rmdir` `{name, recursive?}` | to the trash, answering `trash`: the entry |
| `GET /__board/trash` | `{days, entries: [{id, name, kind, title, deleted, expires, doc, holds}]}` — what has expired removed on the way |
| `POST /__board/trash/restore` `{id}` | the entry as it landed: its `name` numbered when the old one was taken since |
| `POST /__board/trash/delete` `{id}` · `POST /__board/trash/empty` | for good: `{id}` · `{ids}` |

`server/vault.ts` owns it (`trash`, `trashFolder`, `trashList`, `restore`, `forget`), `server/trash.ts`
the days and the answer's shape, `server/routes/trash.ts` the four routes. Nine things are
load-bearing:

- **A trashed document is not a document.** It is in no listing, the references index, the search
  corpus or any route that reads by name; its id resolves to nothing, so a reference to it draws as
  missing. Its file keeps its `id:` and the entry keeps its index row — `created`, an attachment's
  title, every image — so a restore puts it back as it was and every reference works again.
- **The manifest is untrusted.** `entry.json` travels with a synced or shared folder, so restore
  puts `name` through the vault's own naming rules, requires the `docs` key to be the file that name
  stores, and keeps the source under the entry's `files/` with no link on the way. Anything else is
  a damaged entry: a 404, and nothing moves.
- **One entry is one thing a person deleted**: a file, or a folder with what it held at that moment
  (`holds`, by kind, the folder itself among the folders). Several rows deleted at once are several
  entries, and the notice's Undo restores all of them, last first.
- **A restore never overwrites.** A name taken since is numbered, `/create`'s rule; a folder whose
  path exists now comes back as `work 2`, never merged, `/mvdir`'s; the folders above it are made
  again. An id a live document took in the meantime is that document's, and the restored one is
  given a fresh one, written into its frontmatter: stated, not guessed at.
- **The trash is in the vault and never among its documents**: `<vault>/.anydag/trash/<entry>/` —
  `entry.json`, and `files/` with what went exactly as it sat in the vault, moved there and back with
  `rename(2)`. Every dot-folder is unwalked, so nothing that lists had to learn to skip it, and a sync
  tool carries the trash with the vault — a delete on one machine is restorable on the other.
- **The manifest is written before the payload moves**, so a crash leaves an entry with nothing to
  restore, which Delete forever clears — never a payload nothing names.
- **Expiry is lazy.** `ANYDAG_TRASH_DAYS`, 30, anything but a whole number above zero read as 30. An
  entry past it is never listed and never restored from the moment it expires; its bytes go the next
  time the trash is listed. No scheduler: the app runs nothing while nobody opens it.
- **What stays permanent**: a saved component, the original a move to another vault leaves (a move,
  not a delete), and the unused-images sweep. `rmdir` kept its contract — a folder with anything in
  it is a 409 without `recursive: true`, the boolean.
- **The trash has its own event.** The watcher never looks in a dot-folder, so the vault emits
  `{type: "trash"}` itself and the feed sends `dag:trash`, which `onTrash` (`src/board/events.ts`)
  and the page's own calls dispatch on the window, `onBoards`' rule — so a Trash page open anywhere
  never offers to restore what another tab already has.

Deleting a file **on disk** — a file manager, an agent's own tools — is not a delete through the app,
and is for good: the trash is the app's. The skill says so.

Names claimed, grepped first: `dag-trash*`, `dag-trash-notice*`, `dag-app--trash`, `data-dag-trash*`,
`data-dag-sidebar-trash`, `data-dag-setting-trash-days`, `--trash-notice-left`, the event
`dag:trash` (in `test/prefs.test.ts`'s list), and the query key `trash`.

**Out, and why:** opening a trashed document read-only — the page lists, restores
and deletes; items deleted on a board's canvas (undo is a version of the file, and already brings
them back); a scheduled purge; restoring somewhere else (a restore puts a thing where it was, and
moving it after is one drag); and a reference that says *in the trash* rather than missing, which
wants the index to read the trash.
