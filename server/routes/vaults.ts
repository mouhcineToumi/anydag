/**
 * Vaults (decision 4): the recent list, opening a folder, making one, closing one, and moving a
 * document from one vault to another. **No route here removes a folder from disk**, and none can:
 * `close` stops serving a vault and `forget` takes it off the list.
 *
 * A path is a path on this machine, which is what a local server is for. The desktop shell asks for
 * one with the system's folder dialog; a browser on `anydag serve` types it.
 */

import os from "node:os";

import type { Hono } from "hono";

import type { Session } from "../context";
import { anyKind, bodyOf, err, mustExist } from "../http";
import { folderFrom, PLURAL, type Kind } from "../names";
import { byKind, NotFound, Refused, type Vault } from "../vault";

const describe = (v: Vault) => ({ id: v.id, name: v.root.split(/[\\/]/).pop() ?? v.root, path: v.root });

/** A path as the person typed it: `~` is their home. */
const expand = (p: string) => (p === "~" || p.startsWith("~/") ? os.homedir() + p.slice(1) : p);

/** Carry one document into another vault — its id and created date with it — and remove it here. */
async function carry(from: Vault, to: Vault, name: string, kind: Kind, created: string | undefined): Promise<string> {
  const id = (await from.peekId(name, kind)) ?? undefined;
  let settled: string;
  if (kind === "file") {
    const data = await from.getFile(name);
    if (!data) throw new NotFound(`no file \`${name}\``);
    const info = await from.fileInfo(name);
    settled = await to.putFile(name, data, info?.title ?? null, { id, created });
  } else {
    const got = await from.read(name, kind);
    if (!got) throw new NotFound(`no ${kind} \`${name}\``);
    settled = await to.create(name, kind, got.text, { id, created });
  }
  await from.delete(name, kind);
  return settled;
}

export function vaultRoutes(app: Hono, s: Session): void {
  app.get("/api/vaults", (c) => c.json({ vaults: s.recent(), home: os.homedir() }));

  app.post("/api/vaults/open", async (c) => {
    const body = await bodyOf(c);
    if (typeof body.path !== "string" || !body.path.trim()) throw err(400, "expected `path`: the folder to open");
    try {
      return c.json({ vault: describe(s.openFolder(expand(body.path.trim()))) });
    } catch (e) {
      if (e instanceof Refused) throw err(400, e.message);
      throw e;
    }
  });

  app.post("/api/vaults/create", async (c) => {
    const body = await bodyOf(c);
    if (typeof body.parent !== "string" || typeof body.name !== "string") throw err(400, "expected `parent` and `name`");
    try {
      return c.json({ vault: describe(s.createVault(expand(body.parent.trim()), body.name)) });
    } catch (e) {
      if (e instanceof Refused) throw err(400, e.message);
      throw e;
    }
  });

  app.post("/api/vaults/close", async (c) => {
    const body = await bodyOf(c);
    if (typeof body.id !== "string") throw err(400, "expected `id`");
    // Closing says `gone` on its feed, so every tab on it goes to the picker rather than writing
    // into nothing.
    await (body.forget === true ? s.forget(body.id) : s.close(body.id));
    return c.json({ vaults: s.recent() });
  });

  /**
   * Move a document `{name, kind, to}`, or a folder with everything in it `{folder, to}`, from this
   * request's vault to the open vault `to` names. Ids travel with the files; a name taken there is
   * numbered; a folder taken there is a 409. Copy, then delete — a failure leaves two copies, never none.
   */
  app.post("/__board/transfer", async (c) => {
    const body = await bodyOf(c);
    if (typeof body.to !== "string" || !body.to) throw err(400, "expected `to`: the vault to move it to");
    const from = s.vault;
    const to = s.other(body.to);
    if (to.id === from.id) throw err(400, "it is already in that vault");
    const tree = await from.tree();

    if (body.folder === undefined || body.folder === null) {
      const name = String(body.name ?? "");
      const kind = anyKind(body.kind);
      await mustExist(from, name, kind);
      const settled = await carry(from, to, name, kind, tree.created[name]);
      return c.json({ name: settled, kind, id: await to.peekId(settled, kind), to: body.to });
    }

    const stem = folderFrom(body.folder);
    if (!stem) throw err(400, "expected `folder`");
    if (!tree.folders.includes(stem)) throw err(404, `no folder \`${stem}\``);
    if ((await to.tree()).folders.includes(stem)) throw err(409, `\`${stem}\` exists in that vault`);
    const inside = `${stem}/`;
    const subfolders = tree.folders.filter((f) => f.startsWith(inside)).sort();
    for (const f of [stem, ...subfolders]) await to.mkdir(f);
    const moved: Record<string, string[]> = Object.fromEntries(Object.values(PLURAL).map((p) => [p, []]));
    for (const [kind, names] of Object.entries(byKind(tree)) as [Kind, string[]][]) {
      for (const name of names) if (name.startsWith(inside)) moved[PLURAL[kind]]!.push(await carry(from, to, name, kind, tree.created[name]));
    }
    // Not recursive, deepest first: a file written into the folder meanwhile keeps its folder.
    for (const f of [stem, ...subfolders].sort((a, b) => b.split("/").length - a.split("/").length)) {
      try {
        await from.rmdir(f);
      } catch (e) {
        if (!(e instanceof NotFound) && !(e instanceof Refused)) throw e;
      }
    }
    return c.json({ folder: stem, folders: [stem, ...subfolders], ...moved, to: body.to });
  });
}
