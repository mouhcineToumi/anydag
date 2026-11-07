# Tasks, projects and the calendar

> A note with a `status:`, a folder with a `project:`, an event with a `start:`, and the calendar that draws them; the time-zone rules.

## Tasks

A **task** is a note whose frontmatter has a `status:` — `todo`, `in-progress` or `done` — with an
optional `due:` date, `YYYY-MM-DD`. Nothing else marks one. Three
design points: a task is a note with a status rather than a third kind of file, its card
on a board changes the task's file, and a sidebar row dropped on the canvas places it.

    ---
    title: Ship the pricing page
    status: in-progress
    due: 2026-10-03
    ---
    The copy is in [Pricing draft](dag:7q2m9xk4tb).

| Where | What it does with one |
|---|---|
| the sidebar | **Tasks** (with the open count) opens the Tasks page; **New task** makes `untitled` with `status: todo` and names it in its title; a task's row wears its status; a row's menu makes a note a task, marks it done or to do, or makes it a note again |
| the Tasks page, `?tasks=1` | a list — *In progress*, *To do*, *Done*, each by due date then title — or a board of three columns a card is dragged between; a filter, and a box in every group that makes a task named after what is typed |
| the task's own page | its title at the top, then its properties as a list over the text — status as three choices, *Starts*, *Due*, an empty date saying *Empty*; the top bar's `⋯` has *Not a task*, and a plain note's has *Make it a task* |
| a board, or a note, embedding one | a card — status as a button, title, due date — that writes the task's file; on a board, the one fixed-size card every placed document is, with a button that opens the task; read-only under `?view=1` and a snapshot |
| `?view=1`, a snapshot, the PDF | the status and date on a line above the text |

Seven things are load-bearing:

- **Everything a note is, a task is**, because it is one: the file is `.note.md`, the kind is `note`,
  and the editor, the references in its description, backlinks, search, export
  and the `anydag note` commands needed no case. A note becomes a task by gaining the line and
  stops being one by losing it, and nothing else in the file is touched to do either.
- **One parser reads a task.** The server imports the page's own `taskOf` and `withTask` from
  `src/note/task.ts` (`server/vault.ts` for the listing, `server/routes/docs.ts` for the write), so
  the list route, the page, the index and the CLI cannot disagree. `test/fixtures/tasks.json` is an
  ordinary unit test with one reader. Lenient in spelling only — case, and
  a space or an underscore for the hyphen — never in meaning: `doing` or `blocked` is not a status,
  and a note saying one is not a task. A `due:` alone is not one either.
- **A write touches one line of the frontmatter**, `withTitle`'s rule (`server/frontmatter.ts`): replaced where it is, added
  after the block's last line, or taken out — and a block a removal leaves empty goes altogether,
  because `---` twice with nothing between is not a frontmatter to any reader here and draws as two
  rules.
- **There are two ways to write one, and which is which matters.** On the task's own page the bar
  rewrites the frontmatter `NoteView` already holds and saves through the note's `put`, so the page
  is never an outside writer to itself and a status change and a paragraph being typed are one
  write. Everywhere else — the Tasks page, a card, a row's menu, the CLI — it is
  `POST /__board/task {name, status?, due?}`, which recomputes from the text that beat it on a
  conflict, as `/retitle` does.
- **The list, the feed and the index carry it**, as they carry a title: `/__board/list`'s `tasks`
  and `ids`, `task` on a note's `dag:note` event so a row is redrawn in place, and `task` on
  `/__board/index`'s docs, which is what a card reads. The vault keeps
  it in the stat-keyed cache the titles were already in.
- **A card shows its own write at once** and takes what the server wrote when it answers: the index
  is a wait behind the change feed, and a button that sat on the old status for most of a second
  would read as a press that did not land. The Tasks page does the same with `pending`, let go of
  when the list agrees.
- **The drop is an event, `dag:place-file`**, for `dag:chrome`'s reason — the sidebar is above both
  pages and knows neither. The board page answers with the library's own `place` and `noteCard`, so
  a row lands exactly as the library's *Your notes* entry would; the open board cannot be dropped on
  itself. **A card that only embeds a document opens no panel**: `place` opens the editor for an `md`
  because its body is prose, and a card's body is one line of `dag:` syntax.

Which layout the Tasks page shows is `dag:tasks-view`, this browser's and not the app's — view
state, like which folders are open — written with `writeLocal`. The list reads what is being worked
on first and the board's columns run the way work moves, so the three statuses come in two orders.

Names claimed, grepped first: `dag-task-*`, `dag-tasks*`, `dag-taskbar*`, `dag-embed--task`,
`dag-embed__task*`, `dag-toolbar__make-task`, `dag-sidebar__badge`, `data-dag-task*`,
`data-dag-tasks*`, `data-dag-taskbar*`, `data-dag-taskline`, `data-dag-embed-task`,
`data-dag-sidebar-task`, `data-dag-sidebar-tasks`, `data-dag-sidebar-tasks-open`,
`data-dag-sidebar-new-task`, `data-dag-note-make-task`, `data-dag-drop-file`, the storage key
`dag:tasks-view`, the event `dag:place-file` (in `test/prefs.test.ts`'s list), and the query key
`tasks`.

**Out, and why:** assignees, priorities, labels and reminders (each is a
decision about who does what); a status set of a person's own (three fixed words are what the
columns are and what both parsers can be held to); sub-tasks as files (a check item in the
description is one); and a manual order within a column (nothing stores one). Tasks are reached
over MCP too: `task_list`, `task_create`, `task_set`.

## Projects

A **project** is a folder holding a note whose frontmatter has a `project:` — `active`, `paused` or
`done` — with an optional `hue:`, one of the ten. Four
design points: a project note rather than store-side folder metadata, a status and a colour,
tagging as a link only, and the note with a bar as the project's page.

    work/pricing/pricing.note.md      ---
                                      title: Pricing relaunch
                                      project: active
                                      hue: coral
                                      ---
                                      Why we are doing this.

| Where | What it does with one |
|---|---|
| the sidebar | a project's folder wears a kanban folder in its hue (dimmed when paused or done), its note a briefcase; a plain folder's menu has *Make it a project*, a project's *Open project* and *Not a project* |
| the project's own page | a bar under the title: the status as three choices, the colour, how many of its tasks are in each status, *Open tasks*, *Not a project* |
| the Tasks page | a project filter — every project, one project, or none — carried as `project=<id>`, or `project=none`; a row names its project with a chip; a task typed in while filtered is made in the project's folder |
| a board, a note's `@` | the placed card says *Project · Active*; the reference picker labels a project as one |
| `?view=1`, a snapshot, the PDF | the status on a line above the text |

Six things are load-bearing:

- **Membership is a path.** A document is in a project when its name is under the project's folder,
  subfolders included — `within()` — so moving a file in or out is the only way to join or leave, a
  folder moved carries its project, and nothing anywhere has to be kept in step. `projectFolders()`
  maps each folder to the note directly in it, the first by name when there are two; a project note
  at the top level makes nothing a project.
- **Nested projects name a document by the innermost**, and a project's filter still includes them:
  "only the tasks inside that project" is everything under its folder. `projectFor()` is the name,
  `within()` the filter.
- **One parser reads it** — `projectOf` in `src/note/project.ts`, which the server imports rather
  than restating, held to `test/fixtures/projects.json`. Lenient in case and blanks only: `project: yes` is not a project.
- **A write touches two lines**, `withTask`'s rule — which is `withKeys` now, one function for both
  pairs of keys, on both sides. The project's page writes through the note's own save; the sidebar
  and the CLI through `POST /__board/project {name, status?, hue?}`, recomputed on a conflict.
- **The list, the feed and the index carry `project`** beside `task`, so a folder
  is redrawn in place and a card knows what it is. Membership is computed wherever it is needed —
  the sidebar, the Tasks page, the bar, the CLI — from names the listing already has.
- **A task and a project are independent keys.** A note may carry both; nothing on the page makes
  one, and *Make it a task* is not offered on a project's page.

Names claimed, grepped first: `dag-project*`, `dag-projectbar*`, `dag-sidebar__project`,
`dag-tasks__project`, `data-dag-project*`, `data-dag-projectbar*`, `data-dag-projectline`,
`data-dag-sidebar-project`, `data-dag-tasks-project`, and the query key `project`.

**Out, and why:** tagging as membership (a reference links and does not enrol);
store-side folder metadata and a folder id (a note already is both); a project page beyond the note
and its bar; and dates, owners and priorities. Projects are reached
over MCP too: `project_list`, `project_create`, `project_set`.

## The calendar

Tasks, events and notes on one timeline, at `?calendar=month`, `week`
or `days` — `1` for the view this browser used last — with `date=` and `days=` beside it. **Not
`view=`**, which is the read-only page's key.

    ---
    title: Team offsite
    start: 2026-10-03T09:00+02:00
    end: 2026-10-03T17:00+02:00
    ---
    Agenda, the address, who is bringing what.

| Where | What it does |
|---|---|
| the sidebar | **Calendar** opens the page; **New event** makes `untitled` at the next whole hour, an hour long, and names it in its title; an event's row wears a calendar clock; a row's menu makes a plain note an event, or an event a note |
| the Calendar page | a month of week rows whose bars span days, or a week or a run of 1–14 days as an all-day row over an hour grid; Tasks, Events and Notes switched on and off; the Tasks page's project filter; a click opens a thing, a drag or a click on empty time makes an event, a drag on an event or a task moves it, pulls one of its ends, or takes it between the all-day row and the hour grid |
| an event's own page | its properties under the title — all day, the start, the end and the zone they are shown in; the top bar's `⋯` has *Not an event*, and a plain note's has *Make it an event* |
| a task's own page | a *Starts* date beside *Due* |
| a board | a placed event's card says *Event* and when |
| a project's bar | *Open calendar*, filtered to it |
| `?view=1`, a snapshot, the PDF | the event's time on a line above the text, in the reader's zone |
| Settings | *Weeks start on*, the person's |

Nine things are load-bearing:

- **An event is a note with a `start:` and no `status:`.** A date is all day and a time is a time —
  there is no `all-day:` key, a second key that could disagree with the first. An all-day `end:` is
  the last day, inclusive; a timed one the moment it stops; an end in the other form is none; with no
  end an all-day event is a day and a timed one an hour. `status:` decides first: a note with one is a
  task, whose `start:` is its start date, so the page never offers *Make it a task* on an event.
- **One parser reads it**, `eventOf` from `src/note/event.ts`, which the server imports, held to
  `test/fixtures/events.json` — the moments too (`whenOf`), lenient in spelling only: a space or a `t` for the `T`,
  `+0200` and `+02` for `+02:00`. **They check the form and never the order**: whether an end comes
  before a start in two zones is the calendar's arithmetic, done in the viewer's zone.
- **A time carries its offset, and every writer the app owns writes one** — `timeOf` on the page and
  in the CLI, **the chosen zone's** offset for that date (see *The time zone*
  below). The route and the MCP tools take a time without one and put that zone's on
  (`placed` in `server/frontmatter.ts`); a file written by
  hand without one is read as that wall-clock time wherever it is viewed, because refusing it would
  take an agent's `09:00` off the calendar with nothing anywhere to say so.
- **A note's created date is the index's**, `Tree.created`, beside the id: the SQLite row's
  `created`, an instant in UTC, never a line in the file. A rename, a folder move and a
  transfer between vaults carry it; a copy is new. A file the index has never seen is dated at its
  birth time, else its last modification, and that is kept; if the index is rebuilt the dates fall
  back the same way.
- **`src/calendar/model.ts` is all of the arithmetic and none of the drawing.** Days are strings in
  the viewer's zone and a step is `setDate` (see *Things that will bite*); `itemsOf` places every task,
  event and note of the kinds shown; `lanes` packs a run of days' bars lowest-lane-first; `blocks`
  cuts timed events to a day and splits overlapping ones into columns; `fieldsOf`, `eventFrom`,
  `withStart` (which keeps an event's length), `withEnd` and `withAllDay` are what the event bar
  writes.
- **A timed event of a day or more goes in the all-day row**, as every calendar draws a trip; shorter,
  it is in the hour grid, cut at midnight into each day it touches. A month caps a week at four lanes
  and says how many more a day holds, which opens that day on its own.
- **A drag on empty time makes an event, and a drag on an event or a task moves it**. A
  press anywhere but on an item starts a range, snapped to a quarter of an hour in the grid and to days
  in the all-day row and a month, and a small card asks for the title; the file is named after it, in
  the project's folder when the page shows one — the Tasks page's rule. A press on an item that does
  not move is a click that opens it (a real link, so a modifier opens a tab). One that does picks it
  up: along the days in a month and the all-day row, where the days it would land on wear the mark a
  range does, and in the hour grid by quarter hours and across the columns, where a ghost says the
  time it would start and end. It keeps how long it is — `shiftEvent` is `withStart` with the start
  carried past midnight, and a task's start and due move together (`shiftTask`). **The last few
  pixels at either end pull that end** — a bar's sides, a block's top and bottom — the other end kept
  and never passed (`withEdge`, `taskEdge`); an end off the page or cut at midnight has none. **In a
  week or a run of days one gesture covers both halves**, so a timed event let go on the all-day row
  is all day there over the days it touched (`asAllDay`), and an all-day one let go in the grid is an
  hour at that time (`asTimed`); a task is dates, and only follows the day. `useGrab` is all of it,
  and what it previews is exactly what it writes. Four things about it: **the move is measured from
  where it was pressed**, never from the item's top, so a block cut at midnight moves its real start;
  **an `end:` nobody wrote stays unwritten** by a move; **a note does not move**, because its day is
  the store's and no line of its file says it; and **a finger scrolls** — a touch press is never
  picked up, so the phone's week is as it was. Escape while it is held puts it back. The page shows
  the change at once and lets go once the list agrees (`pending`, the Tasks page's), because the
  change feed is a wait behind the write.
- **The toggles and the week start are the person's**, `dag:calendar-hide` (what is *off*, so a new
  kind is shown) and `dag:week-start` in `PREF_KEYS`, read through `useWeekStart`/`useCalendarHidden`
  (`src/calendar/usePrefs.ts`) — the Calendar page and Settings' Calendar tab both — so either
  redraws a calendar that is open. Which view a bare `?calendar=1` opens is this browser's
  (`dag:calendar-view`).
- **The event bar writes through the note's own save**, `changeTask`'s path, and a time is shown and
  written in the chosen zone — so an event written in Paris and moved in New York is written in
  New York's offset, naming the moment the person saw.

Names claimed, grepped first: `dag-calendar*`, `dag-cal-*`, `dag-app--calendar`, `dag-eventbar*`,
`dag-eventline`, `dag-sidebar__event`, `data-dag-calendar*`, `data-dag-cal-*`, `data-dag-eventbar*`,
`data-dag-eventline`, `data-dag-sidebar-calendar`, `data-dag-sidebar-new-event`,
`data-dag-sidebar-event`, `data-dag-note-make-event`, `data-dag-projectbar-calendar`, and for the
drag `data-dag-cal-moving`, `data-dag-cal-moving-to`, `data-dag-cal-moving-end`, `dag-cal-ghost--move`,
`dag-calendar__edge`, `data-dag-cal-edge`, `data-dag-cal-pulling` on the root, and `data-movable` and
`data-axis` on an item,
`data-dag-setting-week-start`, the storage keys `dag:calendar-hide`, `dag:week-start` and
`dag:calendar-view`, and the query keys `calendar`, `date` and `days`.

### The time zone

A time carries its offset, and **an offset is a fact about the day, not a constant**: Casablanca's
has been `+00` since tzdata 2026c, and the browser honouring it is what correctly drew an event
written `08:00+01:00` at seven. That is why every time is read and written in a time zone the
person can change, **defaulting to theirs**, used everywhere — the writer asks for the zone and
gets that date's offset.

- **`dag:time-zone` is the choice, `dag:time-zone-seen` the default**, both in `PREF_KEYS`' app-wide
  half. The first is Settings → Calendar's select, absent for *Automatic*; the second is written by
  the page (`watchZone`, from `main.tsx`) whenever the browser's zone differs
  from what it holds, because the server has no browser to ask and "the default is theirs" has to
  reach it. Two browsers in two zones take turns; the one used last wins.
- **One zone for the page, held in `src/note/zone.ts`**, not threaded through forty call sites: it
  plays exactly the part the machine's zone plays, a global nobody passed. `setZone` is called by
  `watchZone` and by the CLI; unset it is the machine's, which is what the server, a snapshot
  (which reads no preference) and a read-only view read. A test that sets it puts it back
  (`isolate: false`).
- **Nothing reads a `Date`'s local getters any more.** A moment becomes a wall clock through `Intl`
  with the zone named (`wallOf`, `offsetOf`), and a wall clock becomes a moment through `instantOf`,
  which is `Temporal`'s `compatible` by hand: the earlier of two in an overlap, an hour on in a gap.
  **A day is a calendar square**, `calendarDate` — noon UTC — and its arithmetic and its words are
  in UTC, so a zone fourteen hours from the machine's still calls 2026-10-03 a Saturday. `Date.UTC`
  reads a year under a hundred as 19xx, so `utc()` sets the full year.
- **The server reads the preferences, never writes them.** `zoneIn` in `server/frontmatter.ts`: the
  vault's choice, else the app's, else the seen zone, each checked against `Intl`.
  `/api/auth/me` answers `zone` and `event_list` answers `time_zone`.

Names claimed, grepped first: `data-dag-setting-time-zone` and the storage keys `dag:time-zone` and
`dag:time-zone-seen`.

**Out, and why:** Google Calendar sync, reminders and notifications; recurring events (a small
language of its own, and the first thing that would need a time zone per event rather than an
offset); attendees and a location (the description holds them);
a colour per event (a project's is the colour); and quizzes and boards on the calendar
(a board's created date is already in the listing).
