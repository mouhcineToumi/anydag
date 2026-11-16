/**
 * **A vault's words index kept up to date as the vault changes**, not when somebody searches (#267).
 *
 * The index (`server/words.ts`) is brought up to date by the read every search starts with, which
 * reads and parses only the texts whose stamp moved. That alone keeps a search right: a file an agent
 * wrote a moment ago is in the very next answer. Done only then, though, the search that follows a
 * burst of writes pays for parsing them, and the first search on a new app home pays for the whole
 * vault — 23 s on 10,000 notes. So while a vault is watched (`anydag serve`, and so the desktop app)
 * the same read runs on its own:
 *
 * - **once the vault has opened**, after `FIRST_MS`, so it lands after the first page has drawn and
 *   behind the first listing it needs, and once the references index the page asked for (`/index`)
 *   has been answered and left alone for `QUIET_MS`. On a home that holds the index it reads nothing
 *   — it compares stamps — and on one that does not (a first launch, `parse.sqlite` deleted) it makes
 *   it again from the vault, on the grammar's worker, off the server's thread, giving way there to
 *   any question asked meanwhile (`drive` in `server/grammar-worker.ts`);
 * - **after every change the watcher or a write reports**, `QUIET_MS` after the last one, so a burst
 *   is one read, and one at a time: changes during a read make one more after it.
 *
 * It writes nothing into the vault — the index is in the app's home — and the CLI's in-process
 * session, which does not watch, keeps the lazy upkeep alone.
 */

import type { Over, Parsed } from "./grammar";
import type { TextKind } from "./names";
import { paced } from "./pace";
import { byKind, textKey, type Tree, type Vault } from "./vault";

/** How long after a vault opens its index is first brought up to date. */
const FIRST_MS = Number(process.env.ANYDAG_SEARCH_FIRST_MS) || 3_000;
/** How long the vault must be quiet after a change before the index is. */
const QUIET_MS = Number(process.env.ANYDAG_SEARCH_QUIET_MS) || 1_500;

export interface Listed {
  key: string;
  name: string;
  kind: TextKind;
  id: string;
}

/* Per tree, which a kept listing hands out again while nothing moved: sorting 50,000 names is not free. */
const listedOf = new WeakMap<Tree, Listed[]>();

/** Every listed text with an id, keyed the way `Vault.texts` keys them. Components are not listed. */
export function listed(tree: Tree): Listed[] {
  let had = listedOf.get(tree);
  if (!had) {
    const docs: Listed[] = [];
    for (const kind of ["board", "note", "quiz", "table"] as const) {
      for (const name of byKind(tree)[kind]) {
        const id = tree.ids[name];
        if (id) docs.push({ key: textKey(name, kind), name, kind, id });
      }
    }
    docs.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    listedOf.set(tree, (had = docs));
  }
  return had;
}

/**
 * What a corpus and a search are asked over: every listed text with an id — named, with its stamp
 * from the kept listing, its id and the title its listing gives it — and every attachment with an id.
 * Nothing here reads a text: the worker reads, parses and answers (`server/searching.ts`), and the
 * units and the index stay there (#279, #267).
 */
export async function overOfVault(vault: Vault): Promise<Over> {
  const tree = await vault.tree();
  const all = listed(tree);
  const stamps = vault.textStamps(tree);
  const over: Over = { entries: [], meta: [], files: [] };
  await paced(all, (d) => {
    const stamp = stamps?.get(d.key);
    over.entries.push(stamp === undefined ? [d.key, d.name, d.kind] : [d.key, d.name, d.kind, stamp]);
    over.meta.push([d.id, tree.titles[d.name] ?? null]);
  });
  for (const n of tree.files) if (tree.ids[n]) over.files.push([tree.ids[n], n, tree.titles[n] ?? null]);
  return over;
}

/**
 * Keep `corpus`'s index up to date with `vault` from now on; the function it answers stops it. Each
 * read waits for the references index's read in flight (`index`), which the page is waiting on and
 * which shares the grammar's worker — on a first launch both parse the whole vault — and then for
 * `quietMs` without one, since the page asks its next question as that answer lands.
 */
export function keepIndexed(
  vault: Vault,
  corpus: Parsed,
  index: Parsed | null = null,
  firstMs = FIRST_MS,
  quietMs = QUIET_MS,
): () => void {
  let stopped = false;
  let timer: NodeJS.Timeout | null = null;
  let running = false;
  let again = false;
  let off: (() => void) | null = null;
  const run = async () => {
    timer = null;
    if (stopped) return;
    if (running) {
      again = true;
      return;
    }
    running = true;
    try {
      await index?.settled();
      if (stopped) return;
      // The page asks its next question as the references index lands: let it, and come back.
      const wait = index ? quietMs - index.idleMs() : 0;
      if (wait > 0) {
        later(wait);
        return;
      }
      await corpus.warm(await overOfVault(vault));
    } catch (e) {
      if (!stopped)
        console.warn(
          `anydag: the search index of ${vault.root} is brought up to date at the next search: ${(e as Error)?.message ?? e}`,
        );
    } finally {
      running = false;
      if (again && !stopped) {
        again = false;
        later(quietMs);
      }
    }
  };
  const later = (ms: number) => {
    if (stopped) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void run(), ms);
    timer.unref();
  };
  later(firstMs);
  vault
    .subscribe((c) => {
      if (c.type === "gone") stop();
      else later(quietMs);
    })
    .then(
      (unsubscribe) => {
        if (stopped) unsubscribe();
        else off = unsubscribe;
      },
      () => undefined, // not watched: the next search brings the index up to date
    );
  const stop = () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    timer = null;
    off?.();
    off = null;
  };
  return stop;
}
