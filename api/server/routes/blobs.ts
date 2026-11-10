/**
 * `HEAD/PUT/GET /v1/vaults/{v}/blobs/{id}` — sealed bytes in, sealed bytes out.
 *
 * Load-bearing:
 * - **An upload is counted before a commit names it.** With a `storage_bytes` plan, a PUT is
 *   refused `ES_QUOTA` when the account's live bytes, plus its pending ones (uploaded, never
 *   committed), plus this upload would pass the limit — once at its headers, before a byte is read,
 *   and once more as the row is written (`Meta.addBlob`, under the account's lock), so concurrent
 *   uploads cannot each take the last room. Superseded history is not counted here: it has an
 *   allowance of its own (`gc.ts`). Bytes refused at the second check are an orphan file, which
 *   the collector removes after the hour; deleting them here could delete another upload's copy of
 *   the same id. Without this, uploading and never committing kept any amount on the server.
 * - **The size is decided before a byte is read.** `Content-Length` is required (`ES_BAD_REQUEST`
 *   without it) and checked against the plan's `max_file_bytes` and the server's own cap
 *   (`ANYDAG_API_MAX_BODY_MB`) first, so an oversized upload is refused at its headers — a 413 for
 *   a gigabyte costs the server nothing. A body that is not the length it claimed is refused too.
 * - **The bytes land before the index learns of them** (`Blobs.put`, then `Meta.addBlob`): a crash
 *   in between leaves an orphan file, which the collector removes after an hour, and never an index
 *   row naming bytes that are not there — which a commit would then accept.
 * - **A blob the index already holds is answered without reading the body** (idempotent):
 *   the second of two devices uploading one id costs a request, not a
 *   transfer. It counts no `bytes_up`.
 * - **The index, not the directory, says whether a blob is here.** HEAD and GET answer from
 *   `Meta`, so an orphan nobody committed is not served, and a commit's `ES_NO_BLOB` agrees with
 *   what HEAD said.
 * - **Hono answers HEAD with the GET handler** (and drops the body), so the GET handler itself
 *   asks `c.req.method` and, for a HEAD, reads no bytes and counts no `bytes_down`.
 */

import { Hono } from "hono";

import { BLOB_ID } from "../../protocol/wire";
import { HttpError, type Deps, type Vars } from "./http";

function blobIdOf(raw: string | undefined): string {
  if (!raw || !BLOB_ID.test(raw)) throw new HttpError("ES_BAD_REQUEST", "a blob id is 43 base64url characters");
  return raw;
}

export function blobRoutes(deps: Deps): Hono<{ Variables: Vars }> {
  const app = new Hono<{ Variables: Vars }>();

  app.get("/v1/vaults/:v/blobs/:id", async (c) => {
    const v = c.get("vault");
    const id = blobIdOf(c.req.param("id"));
    const size = await deps.meta.blobSize(v.id, id);
    if (size === null) throw new HttpError("ES_NOT_FOUND", "no such blob");
    if (c.req.method === "HEAD")
      return c.body(null, 200, { "content-length": String(size), "content-type": "application/octet-stream" });
    const bytes = await deps.blobs.get(v.id, id);
    if (!bytes) throw new HttpError("ES_NOT_FOUND", "this blob's bytes are gone");
    await deps.usage.bump(v.account, v.id, "bytes_down", bytes.byteLength);
    return c.body(bytes as Uint8Array<ArrayBuffer>, 200, {
      "content-type": "application/octet-stream",
      "content-length": String(bytes.byteLength),
    });
  });

  app.put("/v1/vaults/:v/blobs/:id", async (c) => {
    const v = c.get("vault");
    const id = blobIdOf(c.req.param("id"));
    const header = c.req.header("content-length");
    if (header === undefined || !/^\d+$/.test(header.trim()))
      throw new HttpError("ES_BAD_REQUEST", "a blob upload needs a Content-Length");
    const length = Number(header.trim());
    const account = await deps.meta.account(v.account);
    const plan = await deps.meta.plan(account?.plan ?? "free");
    if (plan.max_file_bytes !== null && length > plan.max_file_bytes)
      throw new HttpError("ES_QUOTA", `this plan takes files up to ${plan.max_file_bytes} bytes; this one is ${length}`);
    if (length > deps.config.maxBodyBytes)
      throw new HttpError("ES_QUOTA", `this server takes uploads up to ${deps.config.maxBodyBytes} bytes; this one is ${length}`);

    const held = await deps.meta.blobSize(v.id, id);
    if (held !== null) return c.json({ ok: true, size: held });

    const quota = plan.storage_bytes === null ? undefined : { account: v.account, bytes: plan.storage_bytes };
    const over = (): HttpError =>
      new HttpError(
        "ES_QUOTA",
        `this plan holds ${quota!.bytes} bytes, counting uploads not yet committed; this upload of ${length} would pass it`,
      );
    if (quota) {
      const used = await deps.meta.storage(v.account);
      if (Number(used.live) + Number(used.pending) + length > quota.bytes) throw over();
    }

    const bytes = new Uint8Array(await c.req.arrayBuffer());
    if (bytes.byteLength !== length)
      throw new HttpError("ES_BAD_REQUEST", `the body was ${bytes.byteLength} bytes, not the ${length} Content-Length said`);
    await deps.blobs.put(v.id, id, bytes);
    if (!(await deps.meta.addBlob(v.id, id, length, deps.now().toISOString(), quota))) throw over();
    await deps.usage.bump(v.account, v.id, "bytes_up", length);
    return c.json({ ok: true, size: length });
  });

  return app;
}
