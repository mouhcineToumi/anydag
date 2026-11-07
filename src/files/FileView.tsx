/**
 * An attachment's own page, below its toolbar: its title, which is where it is renamed,
 * what it is, and the file itself, drawn by `FilePreview`.
 *
 * Read-only under `?view=1`, where the title is a heading rather than a field.
 * `url` and `download` are the caller's to say; this page draws from `/__board/file`.
 */
import { useCallback, useEffect, useState } from "react";
import { Download } from "lucide-react";

import { NoteTitle, NoteTitleRead } from "@/ui/NoteTitle";

import { FileIcon } from "./FileIcon";
import { FilePreview } from "./Preview";
import { downloadName, fileWhat } from "./types";

export function FileView({
  name,
  title,
  bytes,
  url,
  download,
  onRetitle,
}: {
  name: string;
  title: string;
  bytes?: number | null;
  url: string;
  download: string;
  /** Call it something — `/retitle` with `follow`. Absent where nothing may change it. */
  onRetitle?(title: string): Promise<boolean>;
}) {
  /* `data-dag-ready` once the file is drawn — a picture loaded, a first page painted — which is what
     a snapshot of a file waits on, as a board's waits on its items. */
  const [ready, setReady] = useState(false);
  const onReady = useCallback(() => setReady(true), []);
  useEffect(() => {
    if (!ready) return;
    document.documentElement.dataset.dagReady = "1";
    return () => {
      delete document.documentElement.dataset.dagReady;
    };
  }, [ready]);
  return (
    <main className="dag-file" data-dag-file-view={name} data-dag-file-ready={ready ? "" : undefined}>
      <div className="dag-file__head">
        {onRetitle ? (
          <NoteTitle title={title} editable onCommit={onRetitle} onNext={() => undefined} />
        ) : (
          <NoteTitleRead title={title} />
        )}
        <p className="dag-file__meta" data-dag-file-meta="">
          <FileIcon name={name} size={14} strokeWidth={2} />
          <span>{fileWhat(name, bytes)}</span>
          <a className="dag-file__save" href={download} download={downloadName(name, title)} data-dag-file-save="">
            <Download size={14} strokeWidth={2} aria-hidden="true" />
            <span>Download</span>
          </a>
        </p>
      </div>
      <div className="dag-file__body">
        <FilePreview name={name} title={title} bytes={bytes} url={url} download={download} onReady={onReady} />
      </div>
    </main>
  );
}
