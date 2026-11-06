// Test-only images built byte by byte (Phase 9 plan 09-05, AIDA-34; complete since review c-WR-01).
// No binary fixture is committed. Each default builder writes a structurally complete file with the
// dimensions the test asks for, the shape src/lib/branding/logo-validate.ts requires:
// - PNG: IHDR, one non-empty IDAT and IEND. The IDAT is real zlib data for every scanline (filter
//   byte plus transparent RGBA pixels), so the PNG decodes, up to 4,194,304 pixels; above that a
//   one-byte stream stands in, because the validator refuses on the IHDR dimensions first.
// - JPEG: SOI, APP0, DHT, the frame header, a start of scan with scan data, then EOI. The tables and
//   the scan bytes are placeholders: complete in structure, not decodable to pixels.
// - WebP: the RIFF size equals the file length minus 8, every chunk fits in the file, a `VP8 `
//   chunk holds its whole first partition, a `VP8L` chunk holds data after its header, and `VP8X`
//   is followed by an image chunk. The compressed bytes are placeholders, as for JPEG.
// The `...HeaderOnlyBytes` builders keep the earlier header-only shapes, which the validator refuses.
//
// Relative imports only.
import { deflateSync } from "node:zlib";

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const CRC_TABLE = (() => {
  const table: number[] = [];
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table.push(c >>> 0);
  }
  return table;
})();

function crc32(bytes: Buffer): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = (CRC_TABLE[(c ^ byte) & 0xff] as number) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function u32be(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n >>> 0);
  return b;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const typed = Buffer.concat([Buffer.from(type, "latin1"), data]);
  return Buffer.concat([u32be(data.length), typed, u32be(crc32(typed))]);
}

/** Pads a buffer with zero bytes up to `total` bytes (no-op when already that long). */
export function padTo(bytes: Buffer, total: number): Buffer {
  if (bytes.length >= total) return bytes;
  return Buffer.concat([bytes, Buffer.alloc(total - bytes.length)]);
}

function pngIhdr(width: number, height: number): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width >>> 0, 0);
  ihdr.writeUInt32BE(height >>> 0, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type RGBA
  return pngChunk("IHDR", ihdr);
}

const PNG_REAL_PIXEL_LIMIT = 4_194_304;

/** A complete PNG: signature, IHDR with the given size, one IDAT with pixel data, IEND. */
export function pngBytes(width: number, height: number): Buffer {
  const pixels = width * height;
  const raw =
    width > 0 && height > 0 && pixels <= PNG_REAL_PIXEL_LIMIT
      ? Buffer.alloc(height * (1 + width * 4)) // filter 0 and transparent pixels on every row
      : Buffer.alloc(1);
  return Buffer.concat([
    Buffer.from(PNG_SIGNATURE),
    pngIhdr(width, height),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

/** The earlier header-only PNG: signature, IHDR, an EMPTY IDAT and IEND (no image data). */
export function pngHeaderOnlyBytes(width: number, height: number): Buffer {
  return Buffer.concat([
    Buffer.from(PNG_SIGNATURE),
    pngIhdr(width, height),
    pngChunk("IDAT", Buffer.alloc(0)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function jpegSegment(marker: number, payload: Buffer): Buffer {
  const head = Buffer.alloc(4);
  head[0] = 0xff;
  head[1] = marker;
  head.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([head, payload]);
}

function jpegHead(width: number, height: number, sof: number): Buffer {
  const app0 = Buffer.from([0x4a, 0x46, 0x49, 0x46, 0x00, 1, 1, 0, 0, 1, 0, 1, 0, 0]);
  // A DHT payload whose bytes would read as a frame header if the walker did not skip it.
  const dht = Buffer.from([0x00, 0x00, 0x05, 0x00, 0x05, 0x01, 0x01, 0x01, 0x01]);
  const frame = Buffer.alloc(15);
  frame[0] = 8; // precision
  frame.writeUInt16BE(height, 1);
  frame.writeUInt16BE(width, 3);
  frame[5] = 3; // components
  frame.set([1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1], 6);
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    jpegSegment(0xe0, app0),
    jpegSegment(0xc4, dht),
    jpegSegment(sof, frame),
  ]);
}

/**
 * A complete JPEG: SOI, an APP0 (JFIF) segment, a DHT segment (marker 0xC4, which sits in the SOF
 * range and must be skipped), the frame header `sof` (0xC0 baseline, 0xC2 progressive) with the
 * given size, a start of scan for the three components with scan data (a stuffed `FF 00` included,
 * which is not a marker), then EOI.
 */
export function jpegBytes(width: number, height: number, sof = 0xc0): Buffer {
  const sos = Buffer.from([3, 1, 0x00, 2, 0x11, 3, 0x11, 0, 63, 0]);
  const scanData = Buffer.from([0x12, 0x34, 0xff, 0x00, 0x56, 0x78]);
  return Buffer.concat([
    jpegHead(width, height, sof),
    jpegSegment(0xda, sos),
    scanData,
    Buffer.from([0xff, 0xd9]),
  ]);
}

/** The earlier header-only JPEG: SOI, APP0, DHT, the frame header, then EOI (no start of scan). */
export function jpegHeaderOnlyBytes(width: number, height: number, sof = 0xc0): Buffer {
  return Buffer.concat([jpegHead(width, height, sof), Buffer.from([0xff, 0xd9])]);
}

function riffChunk(fourcc: string, data: Buffer): Buffer {
  const chunkHead = Buffer.alloc(8);
  chunkHead.write(fourcc, 0, "latin1");
  chunkHead.writeUInt32LE(data.length, 4);
  // RIFF chunks are padded to an even length; the size field excludes the pad byte.
  const pad = data.length % 2 === 1 ? Buffer.alloc(1) : Buffer.alloc(0);
  return Buffer.concat([chunkHead, data, pad]);
}

function riffWebp(chunks: Buffer[]): Buffer {
  const body = Buffer.concat([Buffer.from("WEBP", "latin1"), ...chunks]);
  const head = Buffer.alloc(8);
  head.write("RIFF", 0, "latin1");
  head.writeUInt32LE(body.length, 4);
  return Buffer.concat([head, body]);
}

/** Size of the first partition named in the fixture's VP8 frame tag (10 02 00: 16 bytes). */
const VP8_FIRST_PARTITION = 16;

/** VP8 chunk data: key frame tag, start code 9D 01 2A, 14-bit sizes, then the partition bytes. */
function vp8Data(width: number, height: number, partitionBytes: number): Buffer {
  const data = Buffer.alloc(10 + partitionBytes);
  data.set([0x10, 0x02, 0x00, 0x9d, 0x01, 0x2a], 0);
  data.writeUInt16LE(width & 0x3fff, 6);
  data.writeUInt16LE(height & 0x3fff, 8);
  return data;
}

/** A complete lossy WebP (`VP8 `): the frame header and the whole first partition. */
export function webpVp8Bytes(width: number, height: number): Buffer {
  return riffWebp([riffChunk("VP8 ", vp8Data(width, height, VP8_FIRST_PARTITION + 4))]);
}

/** The earlier header-only lossy WebP: a `VP8 ` chunk of only its 10 header bytes. */
export function webpVp8HeaderOnlyBytes(width: number, height: number): Buffer {
  return riffWebp([riffChunk("VP8 ", vp8Data(width, height, 0))]);
}

/** A complete lossless WebP (`VP8L`): signature 0x2F, width - 1 and height - 1, then data. */
export function webpVp8lBytes(width: number, height: number): Buffer {
  const data = Buffer.alloc(9);
  data[0] = 0x2f;
  const bits = ((width - 1) & 0x3fff) | (((height - 1) & 0x3fff) << 14);
  data.writeUInt32LE(bits >>> 0, 1);
  return riffWebp([riffChunk("VP8L", data)]);
}

function vp8xChunk(width: number, height: number): Buffer {
  const data = Buffer.alloc(10);
  data.writeUIntLE(width - 1, 4, 3);
  data.writeUIntLE(height - 1, 7, 3);
  return riffChunk("VP8X", data);
}

/** A complete extended WebP (`VP8X`): the canvas header, then a `VP8 ` image chunk. */
export function webpVp8xBytes(width: number, height: number): Buffer {
  return riffWebp([
    vp8xChunk(width, height),
    riffChunk("VP8 ", vp8Data(width, height, VP8_FIRST_PARTITION + 4)),
  ]);
}

/** The earlier header-only extended WebP: a `VP8X` chunk and no image chunk. */
export function webpVp8xHeaderOnlyBytes(width: number, height: number): Buffer {
  return riffWebp([vp8xChunk(width, height)]);
}
