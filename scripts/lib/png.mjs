/**
 * Just enough PNG for the visual review (#528): read a screenshot into RGBA, compare two, and write
 * a picture of where they differ. No dependency: Playwright compares its own screenshots with a
 * comparator it does not export, and a PNG from Chromium is one shape — 8 bits a channel, RGB or
 * RGBA, not interlaced — which `node:zlib` and the five row filters cover.
 */
import zlib from "node:zlib";

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** `{ width, height, data }`, `data` RGBA, four bytes a pixel. Throws on a PNG it does not read. */
export function decode(buf) {
  if (!buf.subarray(0, 8).equals(SIGNATURE)) throw new Error("not a PNG");
  let at = 8;
  let width = 0;
  let height = 0;
  let type = 0;
  const idat = [];
  while (at < buf.length) {
    const len = buf.readUInt32BE(at);
    const kind = buf.toString("latin1", at + 4, at + 8);
    const body = buf.subarray(at + 8, at + 8 + len);
    if (kind === "IHDR") {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      const depth = body[8];
      type = body[9];
      if (depth !== 8 || (type !== 2 && type !== 6) || body[12] !== 0)
        throw new Error(`a PNG this reader does not take (depth ${depth}, type ${type}, interlace ${body[12]})`);
    } else if (kind === "IDAT") idat.push(body);
    else if (kind === "IEND") break;
    at += 12 + len;
  }
  const bpp = type === 6 ? 4 : 3;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * bpp;
  const rows = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const out = rows.subarray(y * stride, (y + 1) * stride);
    const up = y > 0 ? rows.subarray((y - 1) * stride, y * stride) : null;
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? out[i - bpp] : 0;
      const b = up ? up[i] : 0;
      const c = up && i >= bpp ? up[i - bpp] : 0;
      let v = line[i];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      } else if (filter !== 0) throw new Error(`row filter ${filter}`);
      out[i] = v & 0xff;
    }
  }
  if (bpp === 4) return { width, height, data: rows };
  const data = Buffer.alloc(width * height * 4);
  for (let p = 0; p < width * height; p++) {
    data[p * 4] = rows[p * 3];
    data[p * 4 + 1] = rows[p * 3 + 1];
    data[p * 4 + 2] = rows[p * 3 + 2];
    data[p * 4 + 3] = 255;
  }
  return { width, height, data };
}

function chunk(kind, body) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length, 0);
  head.write(kind, 4, "latin1");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(Buffer.concat([head.subarray(4), body])) >>> 0, 0);
  return Buffer.concat([head, body, crc]);
}

/** An RGBA image as a PNG. */
export function encode({ width, height, data }) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) data.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  return Buffer.concat([SIGNATURE, chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

/**
 * How two screenshots differ: `pixels` that moved by more than `tolerance` in any channel (a hair of
 * rasterisation is not a change), their share of the picture, and an image of where — the after
 * picture faded, with each changed pixel marked. Two sizes are a change by definition, and have no
 * image.
 */
export function compare(before, after, { tolerance = 8 } = {}) {
  if (before.width !== after.width || before.height !== after.height)
    return { sized: false, pixels: before.width * before.height, ratio: 1, image: null };
  const { width, height } = after;
  const data = Buffer.alloc(width * height * 4);
  let pixels = 0;
  for (let p = 0; p < width * height; p++) {
    const i = p * 4;
    let moved = false;
    for (let k = 0; k < 4; k++) if (Math.abs(before.data[i + k] - after.data[i + k]) > tolerance) moved = true;
    if (moved) {
      pixels++;
      data[i] = 230;
      data[i + 1] = 0;
      data[i + 2] = 60;
      data[i + 3] = 255;
    } else {
      /* Faded toward white, so the marks are what the eye finds. */
      for (let k = 0; k < 3; k++) data[i + k] = 255 - Math.round((255 - after.data[i + k]) * 0.25);
      data[i + 3] = 255;
    }
  }
  return { sized: true, pixels, ratio: pixels / (width * height), image: { width, height, data } };
}
