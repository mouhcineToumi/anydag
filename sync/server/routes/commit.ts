/**
 * `POST /v1/vaults/{v}/commit` — a list of changes, accepted whole or refused whole.
 *
 * Load-bearing:
 * - **The shape is checked here and the meaning in `Meta.commit`.** Here: at most `MAX_CHANGES`, a
 *   key and a blob id each the wire's 43 characters, a parent a whole number or `null`, a sealed
 *   `meta` string, and **no key twice** — two changes to one key in one commit would each name the
 *   same parent, and which one wins is not a question the server answers. There: every parent is
 *   that key's head (a delete's head included), every blob is held, and the seqs are gapless.
 * - **A refusal names what to do next**: `ES_STALE` carries every conflicting key and its head, so
 *   the client pulls exactly those; `ES_NO_BLOB` carries the missing ids, so it uploads exactly
 *   those. Nothing was written in either case.
 * - **The storage quota is a projection of live storage after the commit**: the account's live
 *   bytes, less the heads this commit replaces, plus the blobs it names. Blobs shared between
 *   heads are counted per head, so the projection errs high by the size of a duplicate — a limit
 *   that refuses a little early, never one that lets the account past it. It is only computed when
 *   the plan has a limit, because it reads the vault's heads (every limit is null by default).
 * - **The poke goes after the transaction**, with the last seq: a client woken by it reads
 *   `changes` and finds the commit there.
 */

import { Hono } from "hono";

import { BLOB_ID, KEY, MAX_CHANGES, MAX_PAGE, type CommitResponse } from "../../protocol/wire";
import type { NewChange } from "../meta/types";
import { body, HttpError, isObject, type Deps, type Vars } from "./http";

const META_MAX = 64 * 1024;

export function parseChanges(raw: unknown): NewChange[] {
  if (!Array.isArray(raw)) throw new HttpError("ES_BAD_REQUEST", "changes must be a list");
  if (raw.length === 0) throw new HttpError("ES_BAD_REQUEST", "a commit needs at least one change");
  if (raw.length > MAX_CHANGES) throw new HttpError("ES_BAD_REQUEST", `a commit holds at most ${MAX_CHANGES} changes; send several`);
  const seen = new Set<string>();
  return raw.map((ch, i): NewChange => {
    if (!isObject(ch)) throw new HttpError("ES_BAD_REQUEST", `change ${i} must be an object`);
    const { key, parent, blob, meta } = ch;
    if (typeof key !== "string" || !KEY.test(key)) throw new HttpError("ES_BAD_REQUEST", `change ${i}: a key is 43 base64url characters`);
    if (seen.has(key)) throw new HttpError("ES_BAD_REQUEST", `change ${i}: key ${key} is changed twice in one commit`);
    seen.add(key);
    if (parent !== null && (typeof parent !== "number" || !Number.isSafeInteger(parent) || parent < 1)) throw new HttpError("ES_BAD_REQUEST", `change ${i}: parent must be a seq or null`);
    if (blob !== null && (typeof blob !== "string" || !BLOB_ID.test(blob))) throw new HttpError("ES_BAD_REQUEST", `change ${i}: blob must be a blob id or null`);
    if (typeof meta !== "string" || meta.length > META_MAX) throw new HttpError("ES_BAD_REQUEST", `change ${i}: meta must be a sealed string of at most ${META_MAX} characters`);
    return { key, parent: parent as number | null, blob: blob as string | null, meta };
  });
}

export function commitRoutes(deps: Deps): Hono<{ Variables: Vars }> {
  const app = new Hono<{ Variables: Vars }>();

  app.post("/v1/vaults/:v/commit", async (c) => {
    const v = c.get("vault");
    const device = c.get("device");
    const changes = parseChanges((await body(c)).changes);

    const account = await deps.meta.account(v.account);
    const plan = await deps.meta.plan(account?.plan ?? "free");
    if (plan.storage_bytes !== null) {
      const touched = new Map(changes.map((ch) => [ch.key, ch]));
      let projected = Number((await deps.meta.storage(v.account)).live);
      for (let after = ""; ; ) {
        const page = await deps.meta.heads(v.id, after, MAX_PAGE);
        for (const h of page.heads) if (touched.has(h.key) && h.blob !== null) projected -= Number(h.size);
        if (page.heads.length < MAX_PAGE) break;
        after = page.heads[page.heads.length - 1]!.key;
      }
      for (const ch of changes) if (ch.blob !== null) projected += (await deps.meta.blobSize(v.id, ch.blob)) ?? 0;
      if (projected > plan.storage_bytes) throw new HttpError("ES_QUOTA", `this commit would hold ${projected} bytes; the plan allows ${plan.storage_bytes}`);
    }

    const result = await deps.meta.commit(v.id, device.id, changes, deps.now().toISOString());
    if (!result.ok) {
      if ("stale" in result) {
        await deps.usage.bump(v.account, v.id, "conflicts_stale", 1);
        throw new HttpError("ES_STALE", `${result.stale.length} of these changes are not based on the current head: pull, then commit again`, { conflicts: result.stale });
      }
      throw new HttpError("ES_NO_BLOB", `${result.missing.length} blob${result.missing.length === 1 ? " is" : "s are"} not uploaded: upload, then commit again`, { missing: result.missing });
    }
    await deps.usage.bump(v.account, v.id, "commits", 1);
    await deps.usage.bump(v.account, v.id, "changes", changes.length);
    const seqs = result.seqs.map(Number);
    deps.hub.notify(v.id, seqs[seqs.length - 1]!);
    return c.json({ seqs } satisfies CommitResponse);
  });

  return app;
}
