/**
 * The change feed: one `EventSource` per page, `GET /__board/events`, in the shape the hosted feed
 * spoke — `dag:board`, `dag:note`, `dag:quiz`, `dag:table`, `dag:file` for a document, `dag:boards`
 * when the folders changed, `dag:trash` when the trash did, `dag:vault-sync` with a `SyncStatus` when a
 * linked vault's sync moved, and `dag:vault-gone` when the vault this tab is in was closed.
 *
 * One watcher per vault however many tabs listen (`Vault.subscribe`), and a comment every twenty
 * seconds so a proxy, or the page's own timer, never takes a quiet vault for a dead connection.
 */

import type { Hono } from "hono";
import { streamSSE } from "hono/streaming";

import type { Session } from "../context";
import { leafOf } from "../names";
import type { Change } from "../vault";

const EVENT = { board: "dag:board", note: "dag:note", quiz: "dag:quiz", table: "dag:table", file: "dag:file" } as const;

export function eventRoutes(app: Hono, s: Session): void {
  app.get("/__board/events", (c) =>
    streamSSE(c, async (stream) => {
      const queue: Change[] = [];
      let wake: (() => void) | null = null;
      const off = await s.vault.subscribe((ch) => {
        queue.push(ch);
        wake?.();
      });
      stream.onAbort(() => {
        off();
        wake?.();
      });
      await stream.write(": open\n\n");
      while (!stream.aborted) {
        const ch = queue.shift();
        if (!ch) {
          let timer: NodeJS.Timeout | undefined;
          await new Promise<void>((r) => {
            wake = r;
            timer = setTimeout(r, 20_000);
          });
          clearTimeout(timer);
          wake = null;
          if (!queue.length && !stream.aborted) await stream.write(": ping\n\n");
          continue;
        }
        if (ch.type === "gone") {
          await stream.writeSSE({ event: "dag:vault-gone", data: "null" });
          off();
          return;
        }
        if (ch.type === "trash") {
          await stream.writeSSE({ event: "dag:trash", data: "null" });
          continue;
        }
        if (ch.type === "sync") {
          await stream.writeSSE({ event: "dag:vault-sync", data: JSON.stringify(ch.status) });
          continue;
        }
        if (ch.type === "tree") {
          await stream.writeSSE({ event: "dag:boards", data: "null" });
          continue;
        }
        // A file with no `title:` is called by its name (decision 14) — what the listing says too.
        const said: Record<string, unknown> = { name: ch.name, sha1: ch.sha1, title: ch.sha1 === null ? null : (ch.title ?? leafOf(ch.name)) };
        if (ch.kind === "note") Object.assign(said, { task: ch.task ?? null, project: ch.project ?? null, event: ch.event ?? null });
        if (ch.kind === "quiz") said.questions = ch.questions ?? null;
        await stream.writeSSE({ event: EVENT[ch.kind], data: JSON.stringify(said) });
      }
    }),
  );
}
