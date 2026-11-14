/**
 * A page or a card that is a chunk of its own, loaded without `React.lazy`.
 *
 * The canvas is the first page of most sessions, and the Calendar, the Tasks list, a table, the
 * quizzes, the Trash, the Assistant, Settings and the search card are code a board never draws. So
 * each is a chunk the first load does not wait for, and a page asks for its chunk as it mounts.
 *
 * **Not `React.lazy`**, for `src/blocks/`'s reason: a lazy component suspends the first time it
 * renders even when its module has long since loaded, and React then holds the content back until
 * 300 ms after its fallback went up (*`React.lazy` costs 300 ms the first time it renders*). So the
 * module is kept here once it has loaded and {@link useChunk} hands it over in the very render that
 * asks for it — and every chunk is fetched once the first page says it is ready
 * ({@link preloadChunks}), so a click that opens one finds it already here.
 */
import { useEffect, useState } from "react";

export interface Chunk<T> {
  /** The module, asked for once; every later call is the one already on its way. A failed load is asked for again next time. */
  preload(): Promise<T>;
  /** The module if it has come, at once. */
  readonly loaded: T | null;
}

const every: Chunk<unknown>[] = [];

/** A module behind a dynamic `import()`, named once at module scope. */
export function chunk<T>(load: () => Promise<T>): Chunk<T> {
  let loaded: T | null = null;
  let loading: Promise<T> | null = null;
  const made: Chunk<T> = {
    preload: () =>
      (loading ??= load().then(
        (m) => (loaded = m),
        (e: unknown) => {
          loading = null;
          throw e;
        },
      )),
    get loaded() {
      return loaded;
    },
  };
  every.push(made);
  return made;
}

/**
 * The chunk's module, or `null` while it is still coming — at once when it has already come.
 * `wanted: false` asks for nothing. A chunk that fails to load is thrown from render, for the page's
 * error boundary, as a lazy's was.
 */
export function useChunk<T>(of: Chunk<T>, wanted = true): T | null {
  const [got, setGot] = useState<{ module: T } | { failed: unknown } | null>(() => (of.loaded ? { module: of.loaded } : null));
  useEffect(() => {
    if (!wanted || got) return;
    let live = true;
    void of.preload().then(
      (module) => live && setGot({ module }),
      (failed: unknown) => live && setGot({ failed }),
    );
    return () => {
      live = false;
    };
  }, [of, wanted, got]);
  if (got && "failed" in got) throw got.failed;
  return wanted && got ? got.module : null;
}

let asked = false;

/**
 * Every chunk, fetched once the first page is drawn — `data-dag-ready`, or ten seconds in for a page
 * that never says so — and then only when the main thread is idle, so none of it is on the path of
 * what that page was waiting for. A snapshot asks for none: it is one picture and nothing after it.
 */
export function preloadChunks(): void {
  if (asked || new URLSearchParams(location.search).get("snapshot") === "1") return;
  asked = true;
  const root = document.documentElement;
  const go = () => {
    ready.disconnect();
    clearTimeout(timer);
    const idle = (f: () => void) => (typeof requestIdleCallback === "function" ? requestIdleCallback(f) : setTimeout(f, 0));
    idle(() => {
      for (const c of every) c.preload().catch(() => undefined);
    });
  };
  const ready = new MutationObserver(() => root.dataset.dagReady === "1" && go());
  ready.observe(root, { attributes: true, attributeFilter: ["data-dag-ready"] });
  const timer = setTimeout(go, 10_000);
  if (root.dataset.dagReady === "1") go();
}
