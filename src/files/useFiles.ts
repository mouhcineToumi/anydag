/**
 * Every attachment the account has, described — `GET /__board/files` — kept in step with the change
 * feed. What a file's own page reads to know it exists before it draws a single byte of
 * it: an `<img>` or a player pointed at a file that is not there is a 404 on the console, which the
 * e2e suite fails on and a person would see as a broken picture.
 */
import { useEffect, useState } from "react";

import { onBoards, onFile } from "@/board/events";

import type { Limits, Uploaded } from "./upload";

export interface Files {
  loaded: boolean;
  files: readonly Uploaded[];
  limits: Limits | null;
}

const NONE: Files = { loaded: false, files: [], limits: null };

export function useFiles(): Files {
  const [got, setGot] = useState<Files>(NONE);
  useEffect(() => {
    let live = true;
    let out = false;
    let again = false;
    /* One request out at a time and one behind it, `useBoardList`'s rule and for its reason. */
    const load = (): void => {
      if (out) {
        again = true;
        return;
      }
      out = true;
      void fetch("/__board/files")
        .then(async (r) => (r.ok ? ((await r.json()) as { files?: Uploaded[]; limits?: Limits }) : null))
        .catch(() => null)
        .then((d) => {
          if (live && d) setGot({ loaded: true, files: d.files ?? [], limits: d.limits ?? null });
        })
        .finally(() => {
          out = false;
          if (again && live) {
            again = false;
            load();
          }
        });
    };
    load();
    const offFile = onFile(() => load());
    const offTree = onBoards(() => load());
    return () => {
      live = false;
      offFile();
      offTree();
    };
  }, []);
  return got;
}
