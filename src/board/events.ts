/**
 * The live channel: one `EventSource` for the page, fanned out to whoever is listening.
 *
 * Until now this was Vite's HMR socket — `import.meta.hot.on("dag:board")` — which is `undefined` in
 * a production build. The guard above the subscription meant a built app did not crash: it went
 * **quietly stale**, which is worse. An agent writing a board and the browser re-rendering is the
 * premise of the whole tool, and it was a dev-server feature.
 *
 * Three things about the shape:
 *
 * - **One connection, not one per hook.** `useBoard`, `useBoardList` and `useSavedComponents` all
 *   want this, and three `EventSource`s would be three of the six connections a browser allows an
 *   origin over HTTP/1.1 — spent on one page, for one stream.
 * - **A change carries `{name, sha1}` and never the text.** The sha1 is what lets a client ignore
 *   the echo of its *own* write: it compares against the version it holds and does nothing. Sending
 *   the text would push every board's bytes to every tab on every change, including boards nobody
 *   is looking at; sending only a name would force a refetch to discover the change was its own.
 * - **`EventSource` reconnects by itself.** That is why it is this and not a WebSocket: a proxy or
 *   a server ending a long stream is not an error the client has to handle — the reconnect is free.
 *
 * And **a tab hidden for a minute lets go of it**. An open stream is a request in flight for as
 * long as the tab lives, and a screen left untouched in the background for a day was holding one
 * that whole day. When the tab is shown again the stream is opened again and
 * every listener is handed a {@link BoardChange} with `resume` set — "something may have changed
 * while nobody was listening" — so whatever holds a file asks for it again, through the same
 * sha1 comparison that drops an echo, and every list refetches.
 */

import type { NoteEvent } from "../note/event";
import type { Project } from "../note/project";
import type { Task } from "../note/task";
import { GONE, scopeUrl } from "../vault/current";
import type { SyncStatus as SyncStatusPayload } from "../sync/types";

/** A board changed. `sha1` is `null` when it was deleted. */
export interface BoardChange {
  name: string;
  sha1: string | null;
  /**
   * What the file is called after the change, `null` for no title — what the list needs
   * to redraw one row without asking for the whole list again. Absent from a server that predates
   * it, which the list treats as "ask".
   */
  title?: string | null;
  /**
   * What makes a note a task after the change, `null` for a note that is not one — the
   * Tasks page's and the sidebar's copy of `title`. Only a note's change carries it; absent from a
   * server that predates it, which the list treats as "ask".
   */
  task?: Task | null;
  /**
   * What makes a note a project after the change, `null` for one that is not — carried
   * for `task`'s reason. Only a note's change carries it; absent from an older server, which is "ask".
   */
  project?: Project | null;
  /**
   * What makes a note an event after the change, `null` for one that is not — carried for
   * `task`'s reason: a start moved anywhere is a day redrawn on every open calendar.
   */
  event?: NoteEvent | null;
  /**
   * How many questions a quiz asks after the change — the gallery's count, carried for
   * `title`'s reason. Only a quiz's change carries it; absent from an older server, which is "ask".
   */
  questions?: number | null;
  /**
   * Not one file's change: the channel was closed while the tab was hidden and has just been opened
   * again, so any file may have changed. `name` is `""` and `sha1` is `""` — never `null`,
   * which would read as a deletion — and a listener holding a file checks it with {@link concerns}.
   */
  resume?: true;
}

/** Whether a change is about the file `name` — or is a resume, which is about every file. */
export function concerns(change: BoardChange, name: string): boolean {
  return change.resume === true || change.name === name;
}

/** How long a hidden tab keeps the channel, in milliseconds: a glance at another tab costs nothing. */
export const DOZE = 60_000;

type BoardListener = (change: BoardChange) => void;
type TreeListener = () => void;

const boardListeners = new Set<BoardListener>();
/* A note is its own event: nothing listening for boards had to learn to ignore
   anything, and a note deleted under the name of an open board cannot put an error on that board. */
const noteListeners = new Set<BoardListener>();
/* And a quiz its own again, for the same reason one kind later. */
const quizListeners = new Set<BoardListener>();
/* And an attachment: its `sha1` is of its bytes, and its title is the store's. */
const fileListeners = new Set<BoardListener>();
/* And a table, one kind later still. */
const tableListeners = new Set<BoardListener>();
const treeListeners = new Set<TreeListener>();
/* The trash changed — kept where no watcher looks, so the store says so on the feed. */
const trashListeners = new Set<TreeListener>();
/* A linked vault's sync status changed: `dag:vault-sync`, with a `SyncStatus`. Not
   `dag:sync`, which is the old preference sync's key. */
const vaultSyncListeners = new Set<(status: SyncStatusPayload) => void>();
let source: EventSource | null = null;
/* Closed because the tab was hidden, with listeners still waiting: opened again, and every one of
   them told, when it is shown. */
let dozing = false;
let dozeTimer: ReturnType<typeof setTimeout> | null = null;

/* Opened on the first subscriber and closed after the last one goes. A page with no board open —
   which is what the snapshot script and every `?snapshot=1` check are — never connects at all. */
function open(): void {
  /* A listener added while dozing waits for the tab to be shown, and is told then like the rest. */
  if (source || dozing || typeof EventSource === "undefined") return;
  watchVisibility();
  /* The workspace's feed: an `EventSource` cannot be handed a header, which is why a
     workspace is named in the query string everywhere — see `workspace/current.ts`. */
  source = new EventSource(scopeUrl("/__board/events"));
  source.addEventListener("dag:board", (e) => {
    let change: BoardChange;
    try {
      change = JSON.parse((e as MessageEvent<string>).data) as BoardChange;
    } catch {
      return;
    }
    for (const listen of [...boardListeners]) listen(change);
  });
  source.addEventListener("dag:note", (e) => {
    let change: BoardChange;
    try {
      change = JSON.parse((e as MessageEvent<string>).data) as BoardChange;
    } catch {
      return;
    }
    for (const listen of [...noteListeners]) listen(change);
  });
  source.addEventListener("dag:quiz", (e) => {
    let change: BoardChange;
    try {
      change = JSON.parse((e as MessageEvent<string>).data) as BoardChange;
    } catch {
      return;
    }
    for (const listen of [...quizListeners]) listen(change);
  });
  source.addEventListener("dag:file", (e) => {
    let change: BoardChange;
    try {
      change = JSON.parse((e as MessageEvent<string>).data) as BoardChange;
    } catch {
      return;
    }
    for (const listen of [...fileListeners]) listen(change);
  });
  source.addEventListener("dag:table", (e) => {
    let change: BoardChange;
    try {
      change = JSON.parse((e as MessageEvent<string>).data) as BoardChange;
    } catch {
      return;
    }
    for (const listen of [...tableListeners]) listen(change);
  });
  source.addEventListener("dag:boards", () => {
    for (const listen of [...treeListeners]) listen();
  });
  source.addEventListener("dag:trash", () => {
    for (const listen of [...trashListeners]) listen();
  });
  source.addEventListener("dag:vault-sync", (e) => {
    let status: SyncStatusPayload;
    try {
      status = JSON.parse((e as MessageEvent<string>).data) as SyncStatusPayload;
    } catch {
      return;
    }
    for (const listen of [...vaultSyncListeners]) listen(status);
  });
  /* This tab's workspace was deleted. Closed before the server's end of the stream can
     make it reconnect — into a 404 the console would print — and told to the page, which goes home. */
  source.addEventListener(GONE, () => {
    source?.close();
    source = null;
    dispatchEvent(new Event(GONE));
  });
  /* No handler for `error`. `EventSource` retries on its own, and logging each retry would fail
     `npm run e2e`, which treats any console output as a failure. */
  /* A tab opened hidden — a reference modifier-clicked into a new tab, a session restored, a phone
     bringing its tabs back — has had no `visibilitychange` to arm the doze, so it is asked here,
     once the stream exists for it to close. */
  onVisibility();
}

function idle(): boolean {
  return (
    boardListeners.size === 0 &&
    noteListeners.size === 0 &&
    quizListeners.size === 0 &&
    fileListeners.size === 0 &&
    tableListeners.size === 0 &&
    treeListeners.size === 0 &&
    trashListeners.size === 0 &&
    vaultSyncListeners.size === 0
  );
}

function closeIfIdle(): void {
  if (!idle()) return;
  dozing = false;
  if (source) {
    source.close();
    source = null;
  }
}

let watching = false;

/* Installed with the first connection, and never taken off: one listener for the page's life. */
function watchVisibility(): void {
  if (watching || typeof document === "undefined") return;
  watching = true;
  document.addEventListener("visibilitychange", onVisibility);
}

function onVisibility(): void {
  if (typeof document === "undefined") return;
  if (document.hidden) {
    if (source && dozeTimer === null) dozeTimer = setTimeout(doze, DOZE);
    return;
  }
  if (dozeTimer !== null) {
    clearTimeout(dozeTimer);
    dozeTimer = null;
  }
  if (dozing) wake();
}

function doze(): void {
  dozeTimer = null;
  if (!source || !document.hidden) return;
  source.close();
  source = null;
  dozing = true;
}

/* Every listener is told, because nobody knows what changed while the stream was shut. A file a page
   holds is asked for again only if its sha1 moved, so a quiet hour costs one small read per file. */
function wake(): void {
  dozing = false;
  if (idle()) return;
  open();
  const change: BoardChange = { name: "", sha1: "", resume: true };
  for (const set of [boardListeners, noteListeners, quizListeners, fileListeners, tableListeners])
    for (const listen of [...set]) listen(change);
  for (const listen of [...treeListeners]) listen();
  for (const listen of [...trashListeners]) listen();
}

/** Listen for board changes. Returns the unsubscribe. */
export function onBoard(listen: BoardListener): () => void {
  boardListeners.add(listen);
  open();
  return () => {
    boardListeners.delete(listen);
    closeIfIdle();
  };
}

/** Listen for note changes — a separate stream from boards' on the same connection. Returns the unsubscribe. */
export function onNote(listen: BoardListener): () => void {
  noteListeners.add(listen);
  open();
  return () => {
    noteListeners.delete(listen);
    closeIfIdle();
  };
}

/** Listen for quiz changes — a third stream on the same connection. Returns the unsubscribe. */
export function onQuiz(listen: BoardListener): () => void {
  quizListeners.add(listen);
  open();
  return () => {
    quizListeners.delete(listen);
    closeIfIdle();
  };
}

/** Listen for attachment changes — a fourth stream on the same connection. Returns the unsubscribe. */
export function onFile(listen: BoardListener): () => void {
  fileListeners.add(listen);
  open();
  return () => {
    fileListeners.delete(listen);
    closeIfIdle();
  };
}

/** Listen for table changes — a fifth stream on the same connection. Returns the unsubscribe. */
export function onTable(listen: BoardListener): () => void {
  tableListeners.add(listen);
  open();
  return () => {
    tableListeners.delete(listen);
    closeIfIdle();
  };
}

/**
 * Listen for the board list changing — a board or folder appearing or going away.
 *
 * Also fired on the window as a `dag:boards` `CustomEvent`, because a directory created and
 * populated in one burst is precisely the case a filesystem watcher can miss, and the call that
 * made it says so directly. Harmless when the server did report it: a refetch is idempotent.
 */
export function onBoards(listen: TreeListener): () => void {
  treeListeners.add(listen);
  open();
  const viaWindow = () => listen();
  addEventListener("dag:boards", viaWindow);
  return () => {
    treeListeners.delete(listen);
    removeEventListener("dag:boards", viaWindow);
    closeIfIdle();
  };
}

/**
 * Listen for the trash changing: something deleted, restored or deleted for good — here,
 * in another tab, by the CLI or by an agent. Also fired on the window as a `dag:trash` `CustomEvent`
 * by this tab's own calls, `onBoards`' rule, so a page never waits on the feed for its own change.
 */
export function onTrash(listen: TreeListener): () => void {
  trashListeners.add(listen);
  open();
  const viaWindow = () => listen();
  addEventListener("dag:trash", viaWindow);
  return () => {
    trashListeners.delete(listen);
    removeEventListener("dag:trash", viaWindow);
    closeIfIdle();
  };
}

/** Listen for the open vault's sync status changing. The feed alone carries it; there is no window twin. */
export function onVaultSync(listen: (status: SyncStatusPayload) => void): () => void {
  vaultSyncListeners.add(listen);
  open();
  return () => {
    vaultSyncListeners.delete(listen);
    closeIfIdle();
  };
}
