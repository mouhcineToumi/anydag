import { createContext } from "react";

import { scopeUrl } from "@/vault/current";

/**
 * Where an image a board or a note names is fetched from.
 *
 * Two answers, and which one holds is a fact about who is looking rather than about the drawing.
 * The signed-in page reads `/__board/assets/…`, a route behind their session, with the `src` joined to
 * the document's folder in the browser. A visitor holding a share link has no session and must not
 * learn the folder, so their page asks `/__share/<token>/asset?src=…` and the server does
 * the joining. A context rather than a prop because the one reader on a board, `ImageItem`, is
 * drawn by `Item`, which is memoised and knows nothing about who is looking; an embed inside a shared
 * note provides its own, for the document it draws.
 *
 * `doc` is the document's name, which only the session's answer uses.
 */
export type AssetUrl = (doc: string, src: string) => string;

/** A `src` that already says where it is — a URL, a data URL, a path from the root — is left alone. */
const external = (src: string): boolean => /^(https?:|data:|blob:|\/)/.test(src);

/** The folder a document is in, with its slash, or `""` at the top level. */
const folderOf = (name: string): string => (name.includes("/") ? `${name.slice(0, name.lastIndexOf("/"))}/` : "");

/**
 * The attachment an image is drawn from, when its `src` is one — `dag:<id>` — or `null`.
 * The id rather than a name, so a picture on a board survives the file being renamed or moved.
 */
const attachmentOf = (src: string): string | null => /^dag:([0-9a-z]{10})$/.exec(src.trim())?.[1] ?? null;

/** The session's: the document's own folder, through the route behind it. An empty `src` is an upload still in flight and asks for nothing. */
export const ownAssets: AssetUrl = (doc, src) => {
  if (!src || external(src)) return src;
  /* In the workspace this tab is in: an `<img src>` cannot carry a header either. */
  const id = attachmentOf(src);
  if (id) return scopeUrl(`/__board/file?id=${id}`);
  return scopeUrl(`/__board/assets/${encodeURI(folderOf(doc) + src)}`);
};

export const AssetUrlContext = createContext<AssetUrl>(ownAssets);
