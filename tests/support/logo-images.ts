// Test-only image headers built byte by byte (Phase 9 plan 09-05, AIDA-34). No binary fixture is
// committed: each builder writes just enough of the format for byte sniffing (file-type) and the
// header dimension reader in src/lib/branding/logo-validate.ts, with the dimensions the test asks
// for. The pixel data is not a decodable image; the logo code never decodes pixels.
//
// Relative imports only.

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

/** A PNG: signature, IHDR with the given size, an empty IDAT and IEND. */
export function pngBytes(width: number, height: number): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width >>> 0, 0);
  ihdr.writeUInt32BE(height >>> 0, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type RGBA
  return Buffer.concat([
    Buffer.from(PNG_SIGNATURE),
    pngChunk("IHDR", ihdr),
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

/**
 * A JPEG: SOI, an APP0 (JFIF) segment, a DHT segment (marker 0xC4, which sits in the SOF range
 * and must be skipped), then the frame header `sof` (0xC0 baseline, 0xC2 progressive) with the
 * given size, then EOI.
 */
export function jpegBytes(width: number, height: number, sof = 0xc0): Buffer {
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
    Buffer.from([0xff, 0xd9]),
  ]);
}

function riffWebp(fourcc: string, data: Buffer): Buffer {
  const chunkHead = Buffer.alloc(8);
  chunkHead.write(fourcc, 0, "latin1");
  chunkHead.writeUInt32LE(data.length, 4);
  const body = Buffer.concat([Buffer.from("WEBP", "latin1"), chunkHead, data]);
  const head = Buffer.alloc(8);
  head.write("RIFF", 0, "latin1");
  head.writeUInt32LE(body.length, 4);
  return Buffer.concat([head, body]);
}

/** A lossy WebP (`VP8 `): key frame tag, start code 9D 01 2A, 14-bit width and height. */
export function webpVp8Bytes(width: number, height: number): Buffer {
  const data = Buffer.alloc(10);
  data.set([0x10, 0x02, 0x00, 0x9d, 0x01, 0x2a], 0);
  data.writeUInt16LE(width & 0x3fff, 6);
  data.writeUInt16LE(height & 0x3fff, 8);
  return riffWebp("VP8 ", data);
}

/** A lossless WebP (`VP8L`): signature 0x2F, then width - 1 and height - 1 in 14 bits each. */
export function webpVp8lBytes(width: number, height: number): Buffer {
  const data = Buffer.alloc(5);
  data[0] = 0x2f;
  const bits = ((width - 1) & 0x3fff) | (((height - 1) & 0x3fff) << 14);
  data.writeUInt32LE(bits >>> 0, 1);
  return riffWebp("VP8L", data);
}

/** An extended WebP (`VP8X`): flags, reserved, then width - 1 and height - 1 in 24 bits each. */
export function webpVp8xBytes(width: number, height: number): Buffer {
  const data = Buffer.alloc(10);
  data.writeUIntLE(width - 1, 4, 3);
  data.writeUIntLE(height - 1, 7, 3);
  return riffWebp("VP8X", data);
}
