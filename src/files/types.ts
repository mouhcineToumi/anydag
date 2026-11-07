/**
 * What an attachment is, read off its name.
 *
 * An attachment's name carries its extension (`specs/q3-report.pdf`), and the extension is all the
 * page needs: which icon a row wears, what a card says it is, whether the app can draw it or only
 * offer it to save. The server decides the same thing the same way (`server/uploads.ts`)
 * and is the one that counts — this copy only chooses how to draw what the server already sent.
 *
 * No React here, and no DOM: the CLI reads it to describe a file in a terminal.
 */

/** The ten kinds of file a person can tell apart by their icon — the issue's list, and a generic one. */
export type FileSort = "pdf" | "image" | "doc" | "sheet" | "slide" | "audio" | "video" | "archive" | "text" | "other";

const SORT_OF: Readonly<Record<string, FileSort>> = {
  pdf: "pdf",
  png: "image",
  jpg: "image",
  jpeg: "image",
  gif: "image",
  webp: "image",
  avif: "image",
  svg: "image",
  bmp: "image",
  heic: "image",
  tif: "image",
  tiff: "image",
  doc: "doc",
  docx: "doc",
  odt: "doc",
  rtf: "doc",
  pages: "doc",
  epub: "doc",
  xls: "sheet",
  xlsx: "sheet",
  ods: "sheet",
  numbers: "sheet",
  csv: "sheet",
  tsv: "sheet",
  ppt: "slide",
  pptx: "slide",
  odp: "slide",
  key: "slide",
  mp3: "audio",
  wav: "audio",
  ogg: "audio",
  m4a: "audio",
  aac: "audio",
  flac: "audio",
  mp4: "video",
  webm: "video",
  mov: "video",
  m4v: "video",
  mkv: "video",
  avi: "video",
  zip: "archive",
  gz: "archive",
  tgz: "archive",
  tar: "archive",
  "7z": "archive",
  rar: "archive",
  txt: "text",
  md: "text",
  json: "text",
  log: "text",
};

/** What each sort is called where a card says what a file is: `PDF · 2.3 MB`. */
export const SORT_LABEL: Readonly<Record<FileSort, string>> = {
  pdf: "PDF",
  image: "Image",
  doc: "Document",
  sheet: "Spreadsheet",
  slide: "Slides",
  audio: "Audio",
  video: "Video",
  archive: "Archive",
  text: "Text",
  other: "File",
};

/** A name's extension, lower case and without its dot; `""` when it has none. */
export function extOf(name: string): string {
  const leaf = name.slice(name.lastIndexOf("/") + 1);
  const dot = leaf.lastIndexOf(".");
  return dot > 0 ? leaf.slice(dot + 1).toLowerCase() : "";
}

/** Which of the ten a file is, by its name or its extension. */
export const sortOf = (nameOrExt: string): FileSort => SORT_OF[nameOrExt.includes(".") ? extOf(nameOrExt) : nameOrExt.toLowerCase()] ?? "other";

/**
 * How the app draws a file itself, or `null` when all it can do is offer it to save. The pictures a
 * browser draws, a PDF through pdf.js, what `<audio>` and `<video>` play in every browser, and plain
 * text. A HEIC or a TIFF is a picture no browser but Safari draws, so it is a card and a download.
 */
export type Preview = "image" | "pdf" | "audio" | "video" | "text";

const PREVIEW: Readonly<Record<string, Preview>> = {
  png: "image",
  jpg: "image",
  jpeg: "image",
  gif: "image",
  webp: "image",
  avif: "image",
  svg: "image",
  bmp: "image",
  pdf: "pdf",
  mp3: "audio",
  wav: "audio",
  ogg: "audio",
  m4a: "audio",
  aac: "audio",
  flac: "audio",
  mp4: "video",
  webm: "video",
  mov: "video",
  m4v: "video",
  txt: "text",
  md: "text",
  csv: "text",
  tsv: "text",
  json: "text",
  log: "text",
};

export const previewOf = (name: string): Preview | null => PREVIEW[extOf(name)] ?? null;

/** Whether a file is a picture the page draws in place — inline in a note, as an image on a board. */
export const isPicture = (name: string): boolean => previewOf(name) === "image";

/** A size as a person reads it: `812 B`, `14 KB`, `2.3 MB`. */
export function sizeWords(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes)) return "";
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
  return `${(mb / 1024).toFixed(1)} GB`;
}

/** What a card says under a file's title: its sort and its size, `PDF · 2.3 MB`. */
export const fileWhat = (name: string, bytes?: number | null): string =>
  [SORT_LABEL[sortOf(name)], sizeWords(bytes)].filter(Boolean).join(" · ");

/** What a download is offered as: the title, with the file's own extension when the title lacks it. */
export function downloadName(name: string, title?: string | null): string {
  const ext = extOf(name);
  const said = (title ?? "").trim() || name.slice(name.lastIndexOf("/") + 1);
  return ext && !said.toLowerCase().endsWith(`.${ext}`) ? `${said}.${ext}` : said;
}
