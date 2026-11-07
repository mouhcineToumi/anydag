import fs from "node:fs";
import path from "node:path";

import { UsageError } from "./args";

/**
 * An image file as a data URL, and how many pixels wide it is — the two things the page learns by
 * decoding one, learnt here from its header, because a terminal has no `<img>` to ask.
 *
 * The width is what the placement rule divides (`src/edit/image.ts`), so an image comes onto the
 * board at the size the account's settings say, not at a literal — the defect `CLAUDE.md` records
 * the literal `w: 520` as having been for four milestones.
 */

const MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
};

export interface ImageFile {
  dataUrl: string;
  /** Pixel width from the header; `null` for an SVG or a header this does not read. */
  width: number | null;
  mime: string;
  bytes: number;
}

export function readImage(file: string): ImageFile {
  const ext = path.extname(file).slice(1).toLowerCase();
  const mime = MIME[ext];
  if (!mime) throw new UsageError(`${file} is not an image this app takes — ${Object.keys(MIME).join(", ")}`);
  let data: Buffer;
  try {
    data = fs.readFileSync(file);
  } catch (e) {
    throw new UsageError(`could not read ${file}: ${(e as Error).message}`);
  }
  return { dataUrl: `data:${mime};base64,${data.toString("base64")}`, width: widthOf(data, mime), mime, bytes: data.length };
}

/** The pixel width a raster image's header declares. */
function widthOf(b: Buffer, mime: string): number | null {
  if (mime === "image/png" && b.length >= 24 && b.readUInt32BE(12) === 0x49484452) return b.readUInt32BE(16);
  if (mime === "image/gif" && b.length >= 10) return b.readUInt16LE(6);
  if (mime === "image/webp" && b.length >= 30 && b.toString("ascii", 0, 4) === "RIFF") {
    const chunk = b.toString("ascii", 12, 16);
    if (chunk === "VP8 ") return b.readUInt16LE(26) & 0x3fff;
    if (chunk === "VP8L") return 1 + (((b[22]! & 0x3f) << 8) | b[21]!);
    if (chunk === "VP8X") return 1 + b.readUIntLE(24, 3);
  }
  if (mime === "image/jpeg") {
    /* Walk the segments to the first start-of-frame; its width is two bytes after the height. */
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) return null;
      const marker = b[i + 1]!;
      const len = b.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return b.readUInt16BE(i + 7);
      i += 2 + len;
    }
  }
  return null;
}
