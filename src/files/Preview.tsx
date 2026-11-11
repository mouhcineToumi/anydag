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
import { useEffect, useState, type ReactNode } from "react";
import { Download } from "lucide-react";

import { SORT_ICON } from "./FileIcon";
import { downloadName, fileWhat, previewOf, sortOf } from "./types";

type Viewer = typeof import("./PdfViewer").default;

/* A chunk of its own, with pdf.js and its worker behind it: nothing else on any page needs them.
   Kept here once it has come, and handed over in the render that asks for it — **not
   `React.lazy`**, whose first render suspends even for a loaded module and is then held back by
   React's 300 ms reveal throttle (`FALLBACK_THROTTLE_MS`). That throttle was most of the first PDF
   of a session taking 430 ms to draw in the packaged desktop app; the page itself was up in 10
   (#129, and the same for a note in #120). */
let viewer: Viewer | null = null;
let loading: Promise<Viewer> | null = null;

/** The viewer's chunk; every later call is the one already on its way, and a failed load is asked
    for again next time. */
export function preloadPdfViewer(): Promise<Viewer> {
  loading ??= import("./PdfViewer").then(
    (m) => (viewer = m.default),
    (e: unknown) => {
      loading = null;
      throw e;
    },
  );
  return loading;
}

/** The viewer, or `null` while its chunk is coming — at once when it has come. A chunk that fails
    to load is thrown from render, for the page's error boundary, as a lazy's was. */
function usePdfViewer(): Viewer | null {
  const [got, setGot] = useState<{ viewer: Viewer } | { failed: unknown } | null>(() => (viewer ? { viewer } : null));
  useEffect(() => {
    if (got) return;
    let live = true;
    void preloadPdfViewer().then(
      (v) => live && setGot({ viewer: v }),
      (failed: unknown) => live && setGot({ failed }),
    );
    return () => {
      live = false;
    };
  }, [got]);
  if (got && "failed" in got) throw got.failed;
  return got ? got.viewer : null;
}

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
      return <PdfPreview url={url} title={title} onReady={onReady} />;
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

/** A PDF: an empty box of the viewer's class while its chunk comes, then the viewer. */
function PdfPreview({ url, title, onReady }: { url: string; title: string; onReady?(): void }) {
  const PdfViewer = usePdfViewer();
  if (!PdfViewer) return <div className="dag-pdf" data-dag-pdf="loading" />;
  return <PdfViewer url={url} title={title} onReady={onReady} />;
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
