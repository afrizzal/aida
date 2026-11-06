// Logo validation (Phase 9 plan 09-05, AIDA-34, D-08). Pure: bytes in, a result union out.
//
// Order: empty bytes are unreadable; more than LOGO_MAX_BYTES bytes is too_large (the byte count
// of the buffer, never a declared size); text that starts with `<?xml` or `<svg` (case-insensitive,
// after an optional UTF-8 BOM and whitespace) is svg; then the bytes are sniffed with file-type and
// only PNG, JPEG and WebP pass (anything else, SVG detected as XML, APNG and GIF included, is
// not_image). The MIME type comes from the sniff only, never from a file name or a client header.
// Last, the width and height are read from the image header by hand (no image package and no
// decode): PNG IHDR, the first JPEG frame header (SOF0 to SOF15 except DHT, JPG and DAC), WebP
// `VP8 `, `VP8L` and `VP8X`. A header that cannot be read is unreadable, and either side above
// LOGO_MAX_PIXELS is too_many_pixels. Then the file must hold image data consistent with its
// format (review c-WR-01), still without decoding a pixel: a PNG's chunks are framed within the
// file, start with IHDR and reach IEND after at least one non-empty IDAT (an `acTL` chunk, APNG,
// is not_image); a JPEG has a start of scan after its frame header, scan data, then an end of image;
// a WebP's chunks fit inside its RIFF size, which fits in the file, a `VP8 ` chunk holds its whole
// first partition, a `VP8L` chunk holds data after its header, and `VP8X` is followed by an image
// chunk. A file cut after its header (a partial download or an interrupted export) is unreadable,
// so the user sees the "could not be read" copy instead of a logo that renders as an empty box.
// No pixel is decoded, so a decompression bomb costs nothing here; the browser decodes at most a
// 1024 x 1024 image.
//
// Relative imports only.
import { fileTypeFromBuffer } from "file-type";
import { isLogoMimeType, type LogoMimeType } from "./settings";

/** 1 MiB, counted in bytes. */
export const LOGO_MAX_BYTES = 1_048_576;
/** The largest width and the largest height, in pixels, each. */
export const LOGO_MAX_PIXELS = 1024;

export type LogoRefusalCode = "unreadable" | "too_large" | "svg" | "not_image" | "too_many_pixels";

export type LogoValidation =
  | { ok: true; mimeType: LogoMimeType; width: number; height: number }
  | { ok: false; code: LogoRefusalCode };

/** The storage-key extension for each logo type. */
export const LOGO_EXTENSIONS: Readonly<Record<LogoMimeType, string>> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

type Size = { width: number; height: number };

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function ascii(b: Buffer, start: number, text: string): boolean {
  if (start + text.length > b.length) return false;
  return b.toString("latin1", start, start + text.length) === text;
}

/** `<?xml` or `<svg` after an optional UTF-8 BOM and ASCII whitespace, case-insensitive. */
function looksLikeSvgText(b: Buffer): boolean {
  let i = 0;
  if (b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) i = 3;
  while (i < b.length && (b[i] === 0x20 || b[i] === 0x09 || b[i] === 0x0a || b[i] === 0x0d)) i++;
  const head = b.toString("latin1", i, i + 5).toLowerCase();
  return head.startsWith("<?xml") || head.startsWith("<svg");
}

/** The start of one of the three formats whose sniff failed: a truncated file, not another type. */
function startsLikeAllowedImage(b: Buffer): boolean {
  const pngPrefix = Math.min(PNG_SIGNATURE.length, b.length);
  if (pngPrefix >= 4 && b.subarray(0, pngPrefix).equals(PNG_SIGNATURE.subarray(0, pngPrefix))) {
    return true;
  }
  if (b[0] === 0xff && b[1] === 0xd8) return true;
  return ascii(b, 0, "RIFF");
}

function pngSize(b: Buffer): Size | null {
  if (b.length < 24 || !b.subarray(0, 8).equals(PNG_SIGNATURE) || !ascii(b, 12, "IHDR")) {
    return null;
  }
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}

function isFrameHeader(marker: number): boolean {
  return marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
}

function jpegSize(b: Buffer): Size | null {
  if (b[0] !== 0xff || b[1] !== 0xd8) return null;
  let i = 2;
  while (i < b.length) {
    if (b[i] !== 0xff) return null;
    while (i < b.length && b[i] === 0xff) i++; // fill bytes
    if (i >= b.length) return null;
    const marker = b[i] as number;
    i++;
    // Standalone markers carry no length: SOI, TEM and RST0 to RST7.
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    // A stuffed zero, the end of the image or the start of scan data before any frame header.
    if (marker === 0x00 || marker === 0xd9 || marker === 0xda) return null;
    if (i + 2 > b.length) return null;
    const length = b.readUInt16BE(i);
    if (length < 2 || i + length > b.length) return null;
    if (isFrameHeader(marker)) {
      // Length, precision, then height and width (big-endian).
      if (length < 7) return null;
      return { width: b.readUInt16BE(i + 5), height: b.readUInt16BE(i + 3) };
    }
    i += length;
  }
  return null;
}

function webpSize(b: Buffer): Size | null {
  if (!ascii(b, 0, "RIFF") || !ascii(b, 8, "WEBP")) return null;
  if (ascii(b, 12, "VP8 ")) {
    // Frame tag (3 bytes), start code 9D 01 2A, then 14-bit width and height, little-endian.
    if (b.length < 30 || b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return null;
    return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
  }
  if (ascii(b, 12, "VP8L")) {
    // Signature 0x2F, then width - 1 and height - 1 in 14 bits each.
    if (b.length < 25 || b[20] !== 0x2f) return null;
    const bits = b.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  if (ascii(b, 12, "VP8X")) {
    // Flags and reserved (4 bytes), then canvas width - 1 and height - 1 in 24 bits each.
    if (b.length < 30) return null;
    return { width: b.readUIntLE(24, 3) + 1, height: b.readUIntLE(27, 3) + 1 };
  }
  return null;
}

type Structure = "complete" | "incomplete" | "animated";

/** PNG chunks framed within the file: IHDR first, a non-empty IDAT, then IEND. */
function pngStructure(b: Buffer): Structure {
  let i = PNG_SIGNATURE.length;
  let first = true;
  let sawImageData = false;
  while (i + 12 <= b.length) {
    const length = b.readUInt32BE(i);
    const type = b.toString("latin1", i + 4, i + 8);
    const end = i + 12 + length; // length, type, data, CRC
    if (length > 0x7fffffff || end > b.length) return "incomplete";
    if (first && type !== "IHDR") return "incomplete";
    first = false;
    if (type === "acTL") return "animated";
    if (type === "IDAT" && length > 0) sawImageData = true;
    if (type === "IEND") return sawImageData ? "complete" : "incomplete";
    i = end;
  }
  return "incomplete";
}

/** A JPEG frame header, then a start of scan with scan data, then an end of image (FF D9). */
function jpegStructure(b: Buffer): Structure {
  let i = 2;
  let sawFrame = false;
  while (i < b.length) {
    if (b[i] !== 0xff) return "incomplete";
    while (i < b.length && b[i] === 0xff) i++; // fill bytes
    if (i >= b.length) return "incomplete";
    const marker = b[i] as number;
    i++;
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (marker === 0x00 || marker === 0xd9) return "incomplete";
    if (i + 2 > b.length) return "incomplete";
    const length = b.readUInt16BE(i);
    if (length < 2 || i + length > b.length) return "incomplete";
    if (marker === 0xda) {
      if (!sawFrame) return "incomplete";
      // Inside scan data an FF byte is followed by a stuffed 00 or a restart marker, so the first
      // FF D9 after at least one byte of scan data is the end of the image.
      const scanStart = i + length;
      const eoi = b.indexOf(Buffer.from([0xff, 0xd9]), scanStart + 1);
      return eoi === -1 ? "incomplete" : "complete";
    }
    if (isFrameHeader(marker)) sawFrame = true;
    i += length;
  }
  return "incomplete";
}

/** WebP chunks inside a RIFF size that fits the file, with image data in a `VP8 ` or `VP8L` chunk. */
function webpStructure(b: Buffer): Structure {
  if (b.length < 12) return "incomplete";
  const riffEnd = 8 + b.readUInt32LE(4);
  if (riffEnd > b.length || riffEnd < 12) return "incomplete";
  let i = 12;
  let sawImage = false;
  while (i + 8 <= riffEnd) {
    const fourcc = b.toString("latin1", i, i + 4);
    const size = b.readUInt32LE(i + 4);
    const data = i + 8;
    if (data + size > riffEnd) return "incomplete";
    if (fourcc === "VP8 ") {
      // Frame tag: bit 0 clear for a key frame, bits 5 to 23 the first partition size, which
      // follows the 10-byte frame header.
      if (size < 10) return "incomplete";
      const tag =
        (b[data] as number) | ((b[data + 1] as number) << 8) | ((b[data + 2] as number) << 16);
      const firstPartition = tag >>> 5;
      if ((tag & 1) !== 0 || firstPartition === 0 || 10 + firstPartition > size)
        return "incomplete";
      sawImage = true;
    } else if (fourcc === "VP8L") {
      if (size <= 5) return "incomplete"; // signature and dimensions only
      sawImage = true;
    } else if (fourcc === "ANMF") {
      if (size <= 16) return "incomplete"; // frame header only (animation policy: review c-IN-04)
      sawImage = true;
    }
    i = data + size + (size % 2); // chunks are padded to an even length
  }
  return sawImage ? "complete" : "incomplete";
}

function structure(mimeType: LogoMimeType, b: Buffer): Structure {
  if (mimeType === "image/png") return pngStructure(b);
  if (mimeType === "image/jpeg") return jpegStructure(b);
  return webpStructure(b);
}

function headerSize(mimeType: LogoMimeType, b: Buffer): Size | null {
  const size =
    mimeType === "image/png" ? pngSize(b) : mimeType === "image/jpeg" ? jpegSize(b) : webpSize(b);
  if (!size || size.width < 1 || size.height < 1) return null;
  return size;
}

export async function validateLogo(bytes: Uint8Array): Promise<LogoValidation> {
  const b = Buffer.isBuffer(bytes)
    ? bytes
    : Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (b.length === 0) return { ok: false, code: "unreadable" };
  if (b.length > LOGO_MAX_BYTES) return { ok: false, code: "too_large" };
  if (looksLikeSvgText(b)) return { ok: false, code: "svg" };

  let sniffed: Awaited<ReturnType<typeof fileTypeFromBuffer>>;
  try {
    sniffed = await fileTypeFromBuffer(b);
  } catch {
    return { ok: false, code: "unreadable" };
  }
  if (!sniffed) return { ok: false, code: startsLikeAllowedImage(b) ? "unreadable" : "not_image" };
  if (!isLogoMimeType(sniffed.mime)) return { ok: false, code: "not_image" };

  const size = headerSize(sniffed.mime, b);
  if (!size) return { ok: false, code: "unreadable" };
  if (size.width > LOGO_MAX_PIXELS || size.height > LOGO_MAX_PIXELS) {
    return { ok: false, code: "too_many_pixels" };
  }
  const shape = structure(sniffed.mime, b);
  if (shape === "animated") return { ok: false, code: "not_image" };
  if (shape === "incomplete") return { ok: false, code: "unreadable" };
  return { ok: true, mimeType: sniffed.mime, width: size.width, height: size.height };
}
