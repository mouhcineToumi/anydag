/**
 * The tag routes. `GET /__board/tags` is the vault's tag list with each tag's colour and count, and —
 * with `tag` — the documents carrying one. The four writes are `/apply` (one document's tags, any
 * kind), `/rename` and `/delete` (a tag across the vault) and `/color` (a tag's hue). See *Tags* in
 * `docs/architecture/tasks-projects-calendar.md`.
 *
 * **A document is changed only by an ordinary write under its sha1**, recomputed from the text that
 * beat it on a conflict (`recompute`, `server/relink.ts`'s pattern), so the page holding it open
 * adopts it through the change feed. **The tag list is changed only by a compare-and-set**
 * (`changeTags`). A rename or delete that cannot write some file rolls nothing back: it answers
 * `{files, missed}`, and sending it again finishes it.
 */

import type { Hono } from "hono";

import { defaultHue, tagKey, tagsOf, withTags } from "../../src/note/tags";
import { inTemplates } from "../../src/note/template";
import type { Session } from "../context";
import { Http, bodyAs, err, recompute } from "../http";
import { TEXT_KINDS, type TextKind } from "../names";
import {
  Unreadable,
  carrying,
  changeTags,
  readRegistry,
  register,
  renamedIn,
  respell,
  setHue,
  tagList,
  unregister,
} from "../tags";
import { byKind, type Tree } from "../vault";
import { ApplyTagsBody, ColorTagBody, DeleteTagBody, RenameTagBody, tagArg } from "../schema/tags";

/** Change the tag list, its refusals as a route's. */
function tagsChanged(s: Session, edit: Parameters<typeof changeTags>[1]): boolean {
  try {
    const wrote = changeTags(s.vault, edit);
    if (wrote) s.vault.emit({ type: "tags" });
    return wrote;
  } catch (e) {
    if (e instanceof Unreadable) throw err(409, e.message);
    throw e;
  }
}

/** Every tag a document carries or the tag list registers, by `tagKey` — what "the vault has seen". */
const knownTags = (tree: Tree, s: Session): Set<string> =>
  new Set(tagList(tree, readRegistry(s.vault)).map((t) => tagKey(t.name)));

interface Named {
  name: string;
  kind: TextKind;
}

/**
 * Every document a vault-wide change to `tag` must rewrite: the listed ones carrying it, and every
 * text in the templates folder — the listing leaves a template's tags out, and a template left saying
 * the old tag would bring it back in every note made from it.
 */
function reached(tree: Tree, tag: string, templates: string | null): Named[] {
  const out: Named[] = carrying(tree, tag).map(({ name, kind }) => ({ name, kind }));
  if (!templates) return out;
  const lists = byKind(tree);
  for (const kind of TEXT_KINDS) for (const name of lists[kind]) if (inTemplates(name, templates)) out.push({ name, kind });
  return out;
}

/** Rewrite `tag` to `to` (or off) in every document that has it: what landed, and what kept changing. */
async function across(s: Session, from: string, to: string | null): Promise<{ files: Named[]; missed: Named[] }> {
  const tree = await s.vault.tree();
  const files: Named[] = [];
  const missed: Named[] = [];
  for (const doc of reached(tree, from, s.vault.templatesFolder())) {
    let changed = false;
    try {
      await recompute(
        s.vault,
        doc.name,
        doc.kind,
        (t) => {
          const next = renamedIn(t, from, to, doc.kind === "board");
          changed = next !== t;
          return next;
        },
        "the tags",
      );
    } catch (e) {
      /* A file gone since the listing has nothing left to rename. */
      if (e instanceof Http && e.status === 404) continue;
      if (!(e instanceof Http)) throw e;
      missed.push(doc);
      continue;
    }
    if (changed) files.push(doc);
  }
  return { files, missed };
}

export function tagRoutes(app: Hono, s: Session): void {
  app.get("/__board/tags", async (c) => {
    const tree = await s.vault.tree();
    const tags = tagList(tree, readRegistry(s.vault));
    const asked = c.req.query("tag");
    if (asked === undefined) return c.json({ tags });
    const tag = tagArg(asked, "tag");
    return c.json({ tags, tag, docs: carrying(tree, tag) });
  });

  /* One document's tags: added and taken off, any kind. A tag the vault has never seen is created —
     registered, with `hue` or its default — as typing a new name in the page creates one. */
  app.post("/__board/tags/apply", async (c) => {
    const { name, kind, add, remove, hue } = await bodyAs(c, ApplyTagsBody);
    const tree = await s.vault.tree();
    const seen = knownTags(tree, s);
    const fresh = add.filter((t) => !seen.has(tagKey(t)));
    const text = await recompute(
      s.vault,
      name,
      kind,
      (t) => withTags(t, { add, remove }, { board: kind === "board" }),
      "the tags",
    );
    const created: string[] = [];
    if (fresh.length)
      tagsChanged(s, (raw) => {
        let changed = false;
        for (const t of fresh)
          if (register(raw, t, hue ?? defaultHue(t))) {
            created.push(t);
            changed = true;
          }
        return changed;
      });
    return c.json({ name, kind, tags: tagsOf(text), created });
  });

  /* Rename a tag in every document, or merge it into one that exists. The colour moves first, so a
     rename that misses a file does not repaint the rest in a default; the old entry goes once nothing
     was missed. */
  app.post("/__board/tags/rename", async (c) => {
    const { from, to } = await bodyAs(c, RenameTagBody);
    const tree = await s.vault.tree();
    const reg = readRegistry(s.vault);
    const same = tagKey(from) === tagKey(to);
    const merge = !same && knownTags(tree, s).has(tagKey(to));
    if (same) tagsChanged(s, (raw) => respell(raw, from, to));
    else if (!merge) {
      const hue = reg.get(tagKey(from))?.hue ?? defaultHue(from);
      tagsChanged(s, (raw) => register(raw, to, hue));
    }
    const { files, missed } = await across(s, from, to);
    if (!missed.length && !same) tagsChanged(s, (raw) => unregister(raw, from));
    return c.json({ from, to, merged: merge, files, missed });
  });

  /* Take a tag off every document, and out of the tag list once nothing was missed. The hue it had
     is answered, so *Undo* on an unused tag can put it back with `/color`. */
  app.post("/__board/tags/delete", async (c) => {
    const { tag } = await bodyAs(c, DeleteTagBody);
    const was = readRegistry(s.vault).get(tagKey(tag));
    const { files, missed } = await across(s, tag, null);
    if (!missed.length) tagsChanged(s, (raw) => unregister(raw, tag));
    return c.json({ tag, files, missed, registered: !!was, hue: was?.hue ?? null });
  });

  /* A tag's hue, which registers it: `null` is the default its name hashes to, still registered. */
  app.post("/__board/tags/color", async (c) => {
    const { tag, hue } = await bodyAs(c, ColorTagBody);
    tagsChanged(s, (raw) => setHue(raw, tag, hue));
    const info = readRegistry(s.vault).get(tagKey(tag))!;
    return c.json({ name: info.name, hue: info.hue ?? defaultHue(info.name), registered: true });
  });
}
