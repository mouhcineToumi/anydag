/**
 * What an attachment may be, and how one is sent back — `app/uploads.py`, ported.
 *
 * **One table, read by extension, and never the client's word.** The type a file goes out as is its
 * extension's, through `MIME`, on the way in and on the way out. What is drawn inline is what a
 * browser draws safely; everything else is a download; every answer carries `nosniff`, and all but a
 * PDF a `sandbox` CSP, because an SVG is a document that can carry script.
 *
 * `md` is not here, unlike the hosted table: in a vault a `.md` is a note (decision 7), never an
 * attachment.
 */

export const MIME: Readonly<Record<string, string>> = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  odt: "application/vnd.oasis.opendocument.text",
  rtf: "application/rtf",
  pages: "application/vnd.apple.pages",
  epub: "application/epub+zip",
  txt: "text/plain",
  csv: "text/csv",
  tsv: "text/tab-separated-values",
  json: "application/json",
  log: "text/plain",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ods: "application/vnd.oasis.opendocument.spreadsheet",
  numbers: "application/vnd.apple.numbers",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  odp: "application/vnd.oasis.opendocument.presentation",
  key: "application/vnd.apple.keynote",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  svg: "image/svg+xml",
  bmp: "image/bmp",
  heic: "image/heic",
  tif: "image/tiff",
  tiff: "image/tiff",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  m4a: "audio/mp4",
  aac: "audio/aac",
  flac: "audio/flac",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  m4v: "video/mp4",
  mkv: "video/x-matroska",
  avi: "video/x-msvideo",
  zip: "application/zip",
  gz: "application/gzip",
  tgz: "application/gzip",
  tar: "application/x-tar",
  "7z": "application/x-7z-compressed",
  rar: "application/vnd.rar",
};

/** What a vault lists as an attachment when the person's settings say nothing: every type above. */
export const DEFAULT_TYPES: readonly string[] = Object.keys(MIME);

/** The largest upload when the settings say nothing. A local app has no bill to protect, so this is
 *  about a drop that was a mistake rather than about cost. */
export const DEFAULT_MAX_MB = 512;

const INLINE = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/avif",
  "image/svg+xml",
  "image/bmp",
  "audio/mpeg",
  "audio/wav",
  "audio/ogg",
  "audio/mp4",
  "audio/aac",
  "audio/flac",
  "video/mp4",
  "video/webm",
  "video/quicktime",
  "text/plain",
  "text/markdown",
  "text/csv",
  "text/tab-separated-values",
]);

const SANDBOX = "default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'; sandbox";

export const mimeOf = (ext: string): string => MIME[ext.toLowerCase()] ?? "application/octet-stream";

/** Extensions separated by commas or spaces, dots optional, case ignored; empty is the default. */
export function parseTypes(raw: string | undefined | null): readonly string[] {
  if (!raw || !raw.trim()) return DEFAULT_TYPES;
  const seen: string[] = [];
  for (const part of raw.replace(/,/g, " ").split(/\s+/)) {
    const ext = part.trim().replace(/^\.+/, "").toLowerCase();
    if (ext && /^[a-z0-9]+$/.test(ext) && ext !== "md" && !seen.includes(ext)) seen.push(ext);
  }
  return seen.length ? seen : DEFAULT_TYPES;
}

/** A size as a person reads it in a refusal: `25 MB`, `1.5 MB`, `300 KB`. */
export function megabytes(n: number): string {
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  const mb = n / (1024 * 1024);
  return mb >= 10 || mb === Math.trunc(mb) ? `${mb.toFixed(0)} MB` : `${mb.toFixed(1)} MB`;
}

/** What a file goes out with: its type, inline or a download and under what name, and the guards. */
export function fileHeaders(ext: string, title: string, download: boolean): Record<string, string> {
  const mime = mimeOf(ext);
  const inline = INLINE.has(mime) && !download;
  const leaf = title.toLowerCase().endsWith(`.${ext.toLowerCase()}`) ? title : `${title}.${ext}`;
  const plain = [...leaf].map((c) => (c.charCodeAt(0) >= 32 && c.charCodeAt(0) < 127 && c !== '"' && c !== "\\" ? c : "_")).join("");
  const out: Record<string, string> = {
    "Content-Type": mime,
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "no-cache",
    "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${plain}"; filename*=UTF-8''${encodeURIComponent(leaf)}`,
  };
  if (mime !== "application/pdf") out["Content-Security-Policy"] = SANDBOX;
  return out;
}

/**
 * The span a `Range` header asks of a file `size` bytes long, inclusive — what a `<video>` asks
 * before it will seek. `null` for no header or one this does not read (the whole file is then a
 * fine answer); `false` for a span past the end, which is a 416.
 */
export function byteRange(header: string | null | undefined, size: number): [number, number] | null | false {
  if (!header) return null;
  const m = /^\s*bytes\s*=\s*(\d*)\s*-\s*(\d*)\s*$/.exec(header);
  if (!m || (!m[1] && !m[2])) return null;
  if (!m[1]) {
    const n = Number(m[2]);
    if (n === 0 || size === 0) return false;
    return [Math.max(0, size - n), size - 1];
  }
  const first = Number(m[1]);
  const last = m[2] ? Number(m[2]) : size - 1;
  if (first >= size || last < first) return false;
  return [first, Math.min(last, size - 1)];
}
