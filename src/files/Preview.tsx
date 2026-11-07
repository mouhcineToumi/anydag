/**
 * An attachment, drawn. One component for every place a file is shown whole: its own
 * page, the read-only view, and a card opened in a note.
 *
 * What it draws is `previewOf` the name: a picture as a picture, a PDF through pdf.js, audio and
 * video in the browser's own players, plain text as text — and anything else as a card with its
 * type, its size and a download, which is all a page can honestly do with a spreadsheet.
 *
 * `url` is where the bytes are and is the caller's to say — `/__board/file?id=` on this server.
 * Nothing here signs in.
 */
import { lazy, Suspense, useEffect, useState, type ReactNode } from "react";
import { Download } from "lucide-react";

import { SORT_ICON } from "./FileIcon";
import { downloadName, fileWhat, previewOf, sortOf } from "./types";

/* A chunk of its own, with pdf.js and its worker behind it: nothing else on any page needs them. */
const PdfViewer = lazy(() => import("./PdfViewer"));

/** How much of a text file is shown: past this it is a download, not a page to scroll. */
const TEXT_SHOWN = 512 * 1024;

export interface PreviewProps {
  /** The file's name, whose extension says what it is. */
  name: string;
  title: string;
  bytes?: number | null;
  /** Where its bytes are; `download` is the same with `download=1`. */
  url: string;
  download: string;
  /** Said once the file is drawn — a picture loaded, a first page painted — for a print or a check. */
  onReady?(): void;
}

/** The file, as the app can draw it. */
export function FilePreview(props: PreviewProps) {
  const { name, title, url, onReady } = props;
  switch (previewOf(name)) {
    case "image":
      return (
        <figure className="dag-file__figure">
          <img className="dag-file__image" src={url} alt={title} data-dag-file-image="" onLoad={onReady} onError={onReady} />
        </figure>
      );
    case "pdf":
      return (
        <Suspense fallback={<div className="dag-pdf" data-dag-pdf="loading" />}>
          <PdfViewer url={url} title={title} onReady={onReady} />
        </Suspense>
      );
    case "audio":
      return (
        <Played onReady={onReady}>
          <audio
            className="dag-file__audio"
            controls
            preload="metadata"
            src={url}
            data-dag-file-audio=""
            onLoadedMetadata={onReady}
            onError={onReady}
          />
        </Played>
      );
    case "video":
      return (
        <Played onReady={onReady}>
          <video
            className="dag-file__video"
            controls
            preload="metadata"
            src={url}
            data-dag-file-video=""
            onLoadedMetadata={onReady}
            onError={onReady}
          />
        </Played>
      );
    case "text":
      return <TextPreview {...props} />;
    default:
      return <FileBlock {...props} />;
  }
}

/** A player, with the file's card above it — a recording has no picture of its own to say what it is. */
function Played({ children }: { children: ReactNode; onReady?(): void }) {
  return <div className="dag-file__played">{children}</div>;
}

/** A text file's words, read once and shown as they are. */
function TextPreview(props: PreviewProps) {
  const { url, bytes, onReady } = props;
  const [text, setText] = useState<string | null | undefined>(undefined);
  const tooBig = (bytes ?? 0) > TEXT_SHOWN;
  useEffect(() => {
    if (tooBig) return;
    let live = true;
    void fetch(url)
      .then(async (r) => (r.ok ? await r.text() : null))
      .catch(() => null)
      .then((t) => {
        if (!live) return;
        setText(t);
        onReady?.();
      });
    return () => {
      live = false;
    };
  }, [url, tooBig, onReady]);
  if (tooBig || text === null) return <FileBlock {...props} />;
  return (
    <pre className="dag-file__text" data-dag-file-text="">
      {text ?? ""}
    </pre>
  );
}

/** A file the app cannot draw: what it is, how big, and the way to save it. */
function FileBlock({ name, title, bytes, download, onReady }: PreviewProps) {
  useEffect(() => onReady?.(), [onReady]);
  const Icon = SORT_ICON[sortOf(name)];
  return (
    <div className="dag-file__block" data-dag-file-block={sortOf(name)}>
      <Icon size={48} strokeWidth={1.5} aria-hidden="true" />
      <span className="dag-file__block-name">{title}</span>
      <span className="dag-file__block-what">{fileWhat(name, bytes)}</span>
      <a className="dag-file__download" href={download} download={downloadName(name, title)} data-dag-file-download="">
        <Download size={14} strokeWidth={2} aria-hidden="true" />
        <span>Download</span>
      </a>
    </div>
  );
}
