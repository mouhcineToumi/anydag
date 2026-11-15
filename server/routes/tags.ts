/**
 * The tag routes: `GET /__board/tags`, the vault's tag list with each tag's colour and count, and —
 * with `tag` — the documents carrying one. See *Tags* in `docs/architecture/tasks-projects-calendar.md`.
 */

import type { Hono } from "hono";

import { tagOf } from "../../src/note/tags";
import type { Session } from "../context";
import { err } from "../http";
import { carrying, readRegistry, tagList } from "../tags";

export function tagRoutes(app: Hono, s: Session): void {
  app.get("/__board/tags", async (c) => {
    const tree = await s.vault.tree();
    const tags = tagList(tree, readRegistry(s.vault));
    const asked = c.req.query("tag");
    if (asked === undefined) return c.json({ tags });
    const tag = tagOf(asked);
    if (!tag) throw err(400, `\`${asked}\` is not a tag: letters, digits, _, - and /, with a letter among them`);
    return c.json({ tags, tag, docs: carrying(tree, tag) });
  });
}
