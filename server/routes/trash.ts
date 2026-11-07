/**
 * The trash: what a delete leaves, one entry per file or folder somebody deleted, kept for
 * `ANYDAG_TRASH_DAYS` and then gone for good. These are the only routes that delete a document for
 * good, which is what makes every other delete a thing that can be taken back.
 */

import type { Hono } from "hono";

import type { Session } from "../context";
import { bodyOf, err } from "../http";
import { live, trashAnswer, trashDays } from "../trash";
import { NotFound } from "../vault";

export function trashRoutes(app: Hono, s: Session): void {
  app.get("/__board/trash", async (c) => {
    const days = trashDays();
    const entries = await live(s.vault, days);
    return c.json({ days, entries: entries.map((e) => trashAnswer(e, days)) });
  });

  /** The 404 for an entry that is not in the trash — or has expired, which is the same answer. */
  const mustBeThere = async (id: string): Promise<void> => {
    if (!(await live(s.vault, trashDays())).some((e) => e.id === id)) throw err(404, "that is not in the trash any more");
  };

  app.post("/__board/trash/restore", async (c) => {
    const body = await bodyOf(c);
    const id = String(body.id ?? "");
    await mustBeThere(id);
    try {
      return c.json(trashAnswer(await s.vault.restore(id), trashDays()));
    } catch (e) {
      if (e instanceof NotFound) throw err(404, e.message);
      throw e;
    }
  });

  app.post("/__board/trash/delete", async (c) => {
    const body = await bodyOf(c);
    const id = String(body.id ?? "");
    await mustBeThere(id);
    try {
      await s.vault.forget(id);
    } catch (e) {
      if (e instanceof NotFound) throw err(404, "that is not in the trash any more");
      throw e;
    }
    return c.json({ id });
  });

  app.post("/__board/trash/empty", async (c) => {
    const ids: string[] = [];
    for (const entry of await live(s.vault, trashDays())) {
      try {
        await s.vault.forget(entry.id);
        ids.push(entry.id);
      } catch {
        /* gone already */
      }
    }
    return c.json({ ids });
  });
}
