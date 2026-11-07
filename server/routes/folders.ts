/** Folders: made, moved to the trash — with everything in them only when asked — and moved whole. */

import type { Hono } from "hono";

import type { Session } from "../context";
import { bodyOf, err } from "../http";
import { folderFrom, folderMove } from "../names";
import { trashAnswer, trashDays } from "../trash";
import { relinking } from "../relink";
import { NotFound, Refused } from "../vault";

export function folderRoutes(app: Hono, s: Session): void {
  app.post("/__board/mkdir", async (c) => {
    const body = await bodyOf(c);
    const stem = folderFrom(body.name);
    if (stem === null) throw err(400, `\`${String(body.name)}\` is not a folder name`);
    if (!stem) throw err(400, "expected `name`");
    try {
      return c.json({ folder: await s.vault.mkdir(stem) });
    } catch (e) {
      if (e instanceof Refused) throw err(400, e.message);
      throw e;
    }
  });

  app.post("/__board/rmdir", async (c) => {
    const body = await bodyOf(c);
    const stem = folderFrom(body.name);
    if (!stem) throw err(400, "expected `name`");
    try {
      // To the trash, as one entry; empty only unless `recursive: true`, the boolean.
      const entry = await s.vault.trashFolder(stem, body.recursive === true);
      return c.json({ folder: stem, ...entry.holds, trash: trashAnswer(entry, trashDays()) });
    } catch (e) {
      if (e instanceof NotFound) throw err(404, `no folder \`${stem}\``);
      if (e instanceof Refused) throw err(409, `\`${stem}\` is not empty`);
      throw e;
    }
  });

  app.post("/__board/mvdir", async (c) => {
    const body = await bodyOf(c);
    const ends = folderMove(body.name, body.to);
    if (typeof ends === "string") throw err(400, ends);
    try {
      // Everything under the folder has a new name: the links to all of it are kept (`server/relink.ts`).
      const { result: folder, relinked } = await relinking(s, () => s.vault.moveFolder(...ends));
      return c.json({ folder, relinked });
    } catch (e) {
      if (e instanceof NotFound) throw err(404, `no folder \`${ends[0]}\``);
      if (e instanceof Refused) throw err(409, e.message);
      throw e;
    }
  });
}
