# The lock

> Read-only mode, in two layers, and what it keeps.

## The lock

Read only, so nothing changes by accident: `ctrl+shift+L`, or the switch at
the end of every page's top bar, and the notice under it says when it switched and when it refused
something.

| Where | Holds |
|---|---|
| `src/settings/lock.ts` | `dag:locked` (`writeLocal`, never `PREF_KEYS`), `isLocked`, `setLocked`, `toggleLock`, `useLocked`, `refuseLocked`, `mayEdit`, `LOCK_HINT`, `lockedAffordance`, `lockNoticeText`, and the events `dag:lock` and `dag:lock-refused` |
| `src/ui/Lock.tsx` | `LockButton` (in `Toolbar`), `LockNotice`, `useLockKey` and `useLockedRoot` (in `Shell`), which paints `html[data-dag-locked]` |

Seven things are load-bearing:

- **Two layers, and both are needed.** Each page draws its read-only half — no dock, no handles, an
  editor not `editable`, a grid `readOnly`, a quiz drawn as its sheet, the sidebar's menus without the
  rows that write, a Trash page with nothing to restore or delete — and each write asks `isLocked()` again where it happens: `useEditor`'s `commit`,
  `put`, every `/create` and the paste's `/asset`, the methods on `ctl` (wrapped by `held`), the
  note's title and bars, the table's `write` and `restore`, the Shell's `files` (wrapped the same
  way, `trash` among them), the sidebar's bulk moves, the Vault pane's delete and sweep, and the
  trash's restore, delete for good and empty (`post` in `src/ui/trashApi.ts`, which the notice's Undo goes
  through too). The drawing is what a
  person sees; the floor is what holds when a key, a menu or a test reaches a write anyway.
- **A refusal is said, never silent — and said where it can be seen.** `refuseLocked()` is the call,
  and it returns `false` so a write that answers with whether it landed can return it. `LockNotice`
  turns it into a banner under the top bar with **Unlock** on it, and **a refusal stays up for as long
  as the app is locked**: it used to flash for 2.6 s at the top right, which the person who pressed a
  button elsewhere did not see, and read as a broken page. The *unlocked* line is the only one that
  leaves on a timer, and that timer holds while the pointer or the focus is on the notice, so its
  Unlock cannot vanish under a click. The notice's own `Unlock` and the `Nothing open` card's are the
  same `setLocked(false)`: nothing reloads, and every control comes back because each page draws from
  `useLocked()`.
- **A control that writes looks read-only before it is pressed.** `lockedAffordance(locked)` gives it
  `aria-disabled`, the `data-dag-readonly-blocked` hook that `chrome.css` dims, and the one hover
  sentence `LOCK_HINT` — *Read only — unlock (Ctrl+Shift+L)*. It keeps its click, because the notice
  answers it; the point is that it no longer *looks* like a button that will work. `Welcome` and
  `EmptyBoard` take `locked` as a prop, say the app is read-only, keep New board/New note/A note/the
  library/describe visibly unavailable, and offer Unlock in place; the empty-board card is no longer
  hidden when locked, which used to leave an empty page with no explanation at all. The Tasks
  quick-add, the calendar's New event card, the note's title and the Trash's restore/delete/empty
  controls wear the same hook and sentence (#74 and #80 own their own layouts and only use this).
- **It is this browser's.** The point is a phone locked against a finger brushing a board while a
  laptop edits. `writeLocal`, and every other tab follows through the `storage` event — so
  `useLocked` subscribes to both `dag:lock` and `storage`. A snapshot reads none of it, as it reads no
  preference.
- **A lock is heard past `Item`'s memo by a hook, and by a prop where the page draws.** The board page
  passes `locked` to `useEditor`, `Item` (in its comparator) and `SelectionBar`; a task card on a board
  sits inside a memoised item and reads `useLocked()` itself, which a URL test like `mayWrite()` could
  not do on a switch.
- **A locked board keeps what reads.** A click selects and returns before a drag is armed; a finger
  always pans; the arrows pan rather than nudge; select all, copy, Escape, the search, help, Settings,
  the select and hand tools and a selected item's Export all stay. The chords that make something are
  refused (`READS` in `useEditor` is the four that may run), and a drop is still cancelled — or the
  browser would open the file in place of the app.
- **A locked quiz is practised, and records only what has an id.** Starting a run stamps ids into a
  quiz that lacks them, which is a write; locked, the stamp is skipped, so such a question is asked
  and not recorded.
- **The key is ctrl+shift+L, in the capture phase and stopped**, so it works with the caret in a note
  and with the table's grid focused, which stops every key it handles. Nothing in BlockNote or TipTap
  binds it; Obsidian's own ctrl+E is the note editor's inline code.

Names claimed, grepped first: `dag-readonly*` (not `dag-lock*`: the logo owns `dag-lockup`),
`data-dag-readonly`, `data-dag-readonly-notice`, `data-dag-readonly-unlock`,
`data-dag-readonly-blocked`, `data-dag-locked`, `data-dag-welcome-locked`,
`data-dag-welcome-unlock`, `data-dag-empty-board-unlock`, `data-dag-calendar-new-locked`,
`data-dag-calendar-new-unlock`, `data-dag-trash-unlock`, `dag-sidebar__menu-locked`,
`data-dag-sidebar-menu-locked`, `data-dag-quiz-locked`, `data-dag-trash-locked`, the storage key
`dag:locked`, and the events `dag:lock` and `dag:lock-refused` (in `test/prefs.test.ts`'s list).

**Out, and why:** a lock that follows the vault (it would lock every machine that opens the
folder); a lock per document (a property of the file, which every writer would have to honour); a
refusal in the api (an agent over MCP or the CLI is a deliberate writer, not an accident); and
practice records, which are not files.
