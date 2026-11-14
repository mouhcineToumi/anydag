/**
 * The vault's listing on a thread of its own (`server/listing.ts`): the walk, every stat and every
 * frontmatter read, which on 50,000 files is seconds the server's one thread used to spend with every
 * other request waiting (#283). One `Lister` per vault folder, so a second listing reads only the
 * texts whose stat moved.
 *
 * Built beside each bundle that serves (`server/build.mjs`, `cli/build.mjs`), as the grammar's
 * worker is; where there is none, `listVault` lists inline.
 */

import { parentPort } from "node:worker_threads";

import { type ListAnswer, type ListAsk, type Listing, Lister, parts, walk } from "./listing";

const listers = new Map<string, Lister>();
/** The rest of each listing being sent, by its id: a part goes when the last one has been read. */
const sending = new Map<number, Generator<ListAnswer>>();

function send(id: number): void {
  const rest = sending.get(id);
  const part = rest?.next();
  if (!part || part.done) return;
  if (!("docs" in part.value)) sending.delete(id);
  parentPort!.postMessage(part.value);
}

parentPort?.on("message", (m: ListAsk) => {
  if ("forget" in m) {
    listers.delete(m.forget);
    return;
  }
  if ("next" in m) {
    send(m.next);
    return;
  }
  let listing: Listing;
  try {
    const types = new Set(m.types);
    if (m.walkOnly) {
      listing = { ...walk(m.root, types), found: [] };
    } else {
      let lister = listers.get(m.root);
      if (!lister) listers.set(m.root, (lister = new Lister(m.root)));
      listing = lister.list(types);
    }
  } catch (e) {
    parentPort!.postMessage({ id: m.id, error: (e as Error)?.stack ?? String(e) } satisfies ListAnswer);
    return;
  }
  sending.set(m.id, parts(m.id, listing));
  send(m.id);
});
