/**
 * The page's half of an export with its files: where an attachment's bytes and a pasted
 * picture's are fetched from for the account that owns them, handed to `bundle` — the half the CLI
 * shares — and the one file saved. A document that names nothing saves as the Markdown it always was.
 */
import { bundle, zipBundle } from "@/export/bundle";
import { saveFile } from "@/export/save";
import { readIndex } from "@/refs/useIndex";
import { ownAssets } from "@/render/assets";

import { fileUrl } from "./upload";

const bytesOf = async (url: string): Promise<Uint8Array | null> => {
  try {
    const r = await fetch(url);
    return r.ok ? new Uint8Array(await r.arrayBuffer()) : null;
  } catch {
    return null;
  }
};

/**
 * Save `text` as `mdPath` — or, when it names an attachment or a pasted picture, as `<stem>.zip`
 * holding it and them. `doc` is the document's name, which a pasted picture's path is relative to.
 */
export async function saveWithFiles(doc: string, mdPath: string, text: string): Promise<void> {
  const index = await readIndex();
  const made = await bundle(
    mdPath,
    text,
    async (id) => {
      const d = index.byId.get(id);
      if (d?.kind !== "file") return null;
      const data = await bytesOf(fileUrl({ id }));
      return data ? { name: d.name, data } : null;
    },
    (path) => bytesOf(ownAssets(doc, path)),
  );
  if (!made.files.length) return saveFile(mdPath, text, "text/markdown");
  const zip = zipBundle(mdPath, made);
  saveFile(
    `${mdPath.replace(/\.(?:board|note|quiz)\.md$|\.md$/, "")}.zip`,
    new Blob([zip as BlobPart], { type: "application/zip" }),
  );
}
