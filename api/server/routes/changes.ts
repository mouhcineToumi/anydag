/**
 * Reading a vault back: `GET /v1/vaults/{v}/changes?since=&limit=` and
 * `GET /v1/vaults/{v}/heads?after=&limit=`.
 *
 * Load-bearing:
 * - **The horizon rule**: the horizon is the lowest `seq` still in the log, so a cursor at
 *   `horizon − 1` has missed nothing and one below it has — those rows were compacted — and is
 *   answered `410 ES_HORIZON` with the horizon, so the client reads the heads instead. Decided
 *   against the horizon read with the page, in one call, so a collector
 *   running in between cannot make a page claim to be complete.
 * - **`next` is the last seq returned, or `since`; `more` is `next < head`.** The log has gaps
 *   after compaction, so "a page came back full" is not the test — the vault's own last seq is,
 *   and its row always survives (it is the newest of its key).
 * - **Heads page by key**, deletes included, with the vault's `seq` at the time of the page, which
 *   is where a device that read every page resumes `changes` from.
 */

import { Hono } from "hono";

import { MAX_PAGE, type ChangesResponse, type HeadsResponse } from "../../protocol/wire";
import { HttpError, qint, type Deps, type Vars } from "./http";

export function changeRoutes(deps: Deps): Hono<{ Variables: Vars }> {
  const app = new Hono<{ Variables: Vars }>();

  app.get("/v1/vaults/:v/changes", async (c) => {
    const v = c.get("vault");
    const since = qint(c.req.query("since"), "since", 0, 0);
    const limit = qint(c.req.query("limit"), "limit", MAX_PAGE, 1, MAX_PAGE);
    const page = await deps.meta.changes(v.id, since, limit);
    const head = Number(page.head);
    const horizon = Number(page.horizon);
    if (since < horizon - 1)
      throw new HttpError("ES_HORIZON", `the log before seq ${horizon} was compacted: read the heads`, { horizon });
    const changes = page.changes.map((e) => ({
      ...e,
      seq: Number(e.seq),
      parent: e.parent === null ? null : Number(e.parent),
      size: Number(e.size),
    }));
    const next = changes.length ? changes[changes.length - 1]!.seq : since;
    return c.json({ changes, next, more: next < head, head, horizon } satisfies ChangesResponse);
  });

  app.get("/v1/vaults/:v/heads", async (c) => {
    const v = c.get("vault");
    const after = c.req.query("after") ?? "";
    if (after.length > 64) throw new HttpError("ES_BAD_REQUEST", "after must be a key");
    const limit = qint(c.req.query("limit"), "limit", MAX_PAGE, 1, MAX_PAGE);
    const page = await deps.meta.heads(v.id, after, limit);
    const heads = page.heads.map((h) => ({ ...h, seq: Number(h.seq), size: Number(h.size) }));
    const next = heads.length === limit ? heads[heads.length - 1]!.key : null;
    return c.json({ heads, next, seq: Number(page.seq) } satisfies HeadsResponse);
  });

  return app;
}
