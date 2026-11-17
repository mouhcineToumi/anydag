/**
 * The Graph page's view — colour by, the filters, group by, the sliders — remembered per vault on
 * this machine (#459).
 *
 * **Where: the app's home, never the vault**, as the tabs are (#381, `src/ui/tabs/saved.ts`): which
 * way one person likes to look at the graph is not one of the vault's documents, and a sync would
 * carry it to a machine that looks at it another way. `/api/graph-view` keeps it in the home's
 * database under the vault's id. With the settings' sync switched off (`syncs()`) the app keeps
 * nothing of this browser's in the home, and it is kept in this browser's storage instead.
 *
 * Read leniently (`viewOf`): a view from an older page, or one edited by hand, still opens.
 */
import { DEFAULT_VIEW, viewOf, type GraphView } from "@/graph/view";
import { syncs } from "@/settings/prefs";
import { scopedKey } from "@/vault/current";

/** Where the view is kept in this browser when the settings do not sync. */
export const SAVED_VIEW = "dag:graph-view";

/** This run's copy: what the page last showed, so coming back to the tab is not a round trip. */
let memo: GraphView | null = null;

export async function loadView(): Promise<GraphView> {
  if (memo) return memo;
  let raw: unknown = null;
  if (!syncs()) {
    try {
      const text = localStorage.getItem(scopedKey(SAVED_VIEW));
      raw = text ? (JSON.parse(text) as unknown) : null;
    } catch {
      raw = null;
    }
  } else {
    try {
      const r = await fetch("/api/graph-view");
      raw = r.ok ? ((await r.json()) as { view?: unknown }).view : null;
    } catch {
      raw = null;
    }
  }
  memo ??= raw ? viewOf(raw) : viewOf(DEFAULT_VIEW);
  return memo;
}

let timer: ReturnType<typeof setTimeout> | undefined;
let pending: GraphView | null = null;
let last = "";

function flush(keepalive = false): void {
  if (timer) clearTimeout(timer);
  timer = undefined;
  const view = pending;
  pending = null;
  if (!view) return;
  const text = JSON.stringify(view);
  if (text === last) return;
  last = text;
  if (!syncs()) {
    try {
      localStorage.setItem(scopedKey(SAVED_VIEW), text);
    } catch {
      /* Storage full or refused: the view is not kept, which a private window expects. */
    }
    return;
  }
  void fetch("/api/graph-view", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ view }),
    keepalive,
  }).catch(() => undefined);
}

/** Keep the view, a moment after the last change: a slider dragged end to end is one write. */
export function saveView(view: GraphView): void {
  memo = view;
  pending = view;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => flush(), 500);
}

/** Whatever is waiting goes now: the page or the window is going. */
export const flushView = (keepalive = false): void => flush(keepalive);
