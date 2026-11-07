/**
 * Every route that changes a document's name keeps the vault's `[[wikilinks]]` naming it — Obsidian's
 * *Automatically update internal links*, on by default and switched off per vault in Settings → Vault
 * (`dag:update-links` in `<vault>/.anydag/settings.json`, `"0"` for off).
 *
 * `relinking(s, change)` takes the vault's list, runs `change` — a rename, a retitle, a folder moved —
 * takes the list again, and rewrites every text whose links the change broke (`src/refs/relink.ts`).
 * Each rewrite is an ordinary write under the text's sha1 base, recomputed from the text that beat it
 * on a conflict, so a page holding one of those notes open adopts it through the change feed like any
 * other outside write. It runs inside the request, which is what puts the rewrites in the same
 * recorded op as the rename when a chat makes it (`chat/record.ts`): undoing the rename undoes them.
 *
 * The list is the one `/__board/index` resolves against — every document with an id, under its name
 * and its title — so a link this rewrites is one the index said named the moved document.
 */

import { changeOf, relinkText, type LinkKind } from "../src/refs/relink";
import type { WikiCandidate } from "../src/refs/wikilinks";
import type { Session } from "./context";
import { Http, recompute } from "./http";
import { readPrefs } from "./routes/prefs";
import { TEXT_KINDS } from "./names";
import { byKind, textKey, type Tree } from "./vault";

/** The vault preference that turns it off. Anything but `"0"` (or `false`) is on. */
const UPDATE_LINKS = "dag:update-links";

function updatesLinks(s: Session): boolean {
  const v = readPrefs(s, "vault")?.[UPDATE_LINKS];
  return !(v === "0" || v === false);
}

/** What a rename did to the vault's links: how many it rewrote, and in which files. */
export interface Relinks {
  links: number;
  files: { name: string; kind: LinkKind }[];
  /** Files whose links could not be written — changing under every attempt. */
  missed: { name: string; kind: LinkKind }[];
}

/** Every document as resolution sees it: its name, its kind and its title. */
function candidatesOf(tree: Tree): WikiCandidate[] {
  const out: WikiCandidate[] = [];
  for (const [kind, names] of Object.entries(byKind(tree))) {
    for (const name of names) {
      const id = tree.ids[name];
      if (id) out.push({ id, name, kind, title: tree.titles[name] ?? null });
    }
  }
  return out;
}

const NONE = (): Relinks => ({ links: 0, files: [], missed: [] });

/**
 * Run `change` and keep the links it would break. `null` when the vault does not update links; the
 * answer `change` gave either way.
 */
export async function relinking<T>(s: Session, change: () => Promise<T>): Promise<{ result: T; relinked: Relinks | null }> {
  if (!updatesLinks(s)) return { result: await change(), relinked: null };
  const before = candidatesOf(await s.vault.tree());
  const result = await change();
  return { result, relinked: await relink(s, before) };
}

/** Rewrite every text whose links resolved differently in `before` than in the vault now. */
async function relink(s: Session, before: readonly WikiCandidate[]): Promise<Relinks> {
  const tree = await s.vault.tree();
  const change = changeOf(before, candidatesOf(tree));
  const out = NONE();
  if (!change) return out;
  const texts = await s.vault.texts(tree);
  for (const kind of TEXT_KINDS) {
    for (const name of byKind(tree)[kind]) {
      const text = texts[textKey(name, kind)];
      if (text === undefined || !text.includes("[[")) continue;
      if (relinkText(text, kind, change).links === 0) continue;
      let links = 0;
      try {
        await recompute(
          s.vault,
          name,
          kind,
          (t) => {
            const got = relinkText(t, kind, change);
            links = got.links;
            return got.text;
          },
          "its links",
        );
      } catch (e) {
        if (!(e instanceof Http)) throw e;
        out.missed.push({ name, kind });
        continue;
      }
      if (links) {
        out.links += links;
        out.files.push({ name, kind });
      }
    }
  }
  return out;
}
