/**
 * What syncs: one function the scan, the watcher filter and the harness
 * all ask, so "does this path sync" has exactly one answer.
 *
 * The vault as the app lists it — every document, every attachment of a type the vault lists, a
 * legacy `<name>.assets/` picture — and four things under `.anydag/`: the attachments' ids
 * (`files/*.json`), the vault's settings, saved components and the trash. Never `vault.json`, which
 * a device adopts once when it links; never what the walk ignores; never a writer's temp file.
 */

import { classify, ignored } from "../names";

/** `writeAtomic`'s temp file, `.<name>.<pid>.tmp`, and the blob store's — never content. */
const TEMP = /^\..+\.\d+(\.[A-Za-z0-9]+)?\.tmp$/;

const CHAT = /^c[0-9a-z]{17}$/;
const TURN = /^t[0-9a-z]{17}\.json$/;
const UNDO = /^u[0-9a-z]{17}\.json$/;

const ALLOWED_IN_ANYDAG = (rest: string[]): boolean => {
  const [head, ...tail] = rest;
  if (head === "settings.json") return tail.length === 0;
  if (head === "files") return tail.length === 1 && tail[0]!.endsWith(".json");
  // An Assistant chat: its `chat.json`, its turns and its undos — every one but
  // `chat.json` written once — and nothing else that might be left in its folder.
  if (head === "chats") {
    const [chat, a, b] = tail;
    if (!chat || !CHAT.test(chat)) return false;
    if (tail.length === 2) return a === "chat.json" || TURN.test(a!);
    return tail.length === 3 && a === "undo" && UNDO.test(b!);
  }
  return head === "components" || head === "trash";
};

/** Whether a segment outside `.anydag/` stops a path from syncing. A legacy picture folder does not. */
const stops = (segment: string): boolean => !segment.endsWith(".assets") && ignored(segment);

/** Whether the file at `rel` syncs. `types` are the attachment extensions this vault lists. */
export function syncs(rel: string, types: ReadonlySet<string>): boolean {
  const parts = rel.split("/");
  const leaf = parts[parts.length - 1]!;
  if (!leaf || TEMP.test(leaf)) return false;
  if (parts[0] === ".anydag") {
    if (!ALLOWED_IN_ANYDAG(parts.slice(1))) return false;
    // Inside the trash and the components the documents keep their own names, ignored rules and all.
    return parts.slice(1).every((p) => !p.includes(".sync-conflict-") && p !== "node_modules");
  }
  if (parts.some(stops)) return false;
  return classify(rel, types) !== null;
}

/** Whether a folder at `rel` syncs as an empty-folder marker when nothing in it does. */
export function dirSyncs(rel: string): boolean {
  const parts = rel.split("/");
  return parts.length > 0 && parts[0] !== ".anydag" && !parts.some((p) => !p || ignored(p));
}
