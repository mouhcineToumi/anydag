/**
 * The part of a document a link asked for — the text after the `#` — until the page has shown it.
 *
 * `dag:<id>#part` has named a block or an item since references
 * landed, and `?ref=` carried the part through
 * to the page; but only the read-only note view ever looked at it. A search result is the
 * same kind of link to a place inside a document, so the two share this: whoever opens a document
 * at a part sets it, and the page that draws the document shows it and lets it go.
 *
 * **It lives in the URL's hash**, which is where a reference already puts it and where
 * `useQuery` already keeps it across a change of board. **It is let go once shown**, or opening
 * another board from the sidebar would look for the same item id there, and `md-1` is on most boards.
 *
 * Setting it does not fire `hashchange` — `replaceState` never does — so a change is announced as
 * `dag:target`, which is how a result on the board already open gets it to move.
 */
import { useSyncExternalStore } from "react";

const EVENT = "dag:target";

/** What the hash names, decoded, or `null` when there is none. */
function readTarget(): string | null {
  const raw = location.hash.slice(1);
  if (!raw) return null;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/** Point the page at a part of whatever it opens next — or at nothing. */
export function setTarget(part: string | null): void {
  const hash = part ? `#${encodeURIComponent(part)}` : "";
  if (location.hash === hash) return;
  history.replaceState(history.state, "", `${location.pathname}${location.search}${hash}`);
  dispatchEvent(new Event(EVENT));
}

/** The part has been shown, or cannot be: nothing else should go looking for it. */
export const clearTarget = (): void => setTarget(null);

function subscribe(listen: () => void): () => void {
  addEventListener(EVENT, listen);
  addEventListener("hashchange", listen);
  addEventListener("popstate", listen);
  return () => {
    removeEventListener(EVENT, listen);
    removeEventListener("hashchange", listen);
    removeEventListener("popstate", listen);
  };
}

export function useTarget(): string | null {
  return useSyncExternalStore(subscribe, readTarget);
}
