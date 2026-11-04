// Phase 9 plan 09-05 (AIDA-34, D-08): the logo validator at every boundary. Every buffer is built
// byte by byte here (tests/support/logo-images.ts); no binary fixture is committed.
import { describe, expect, it } from "vitest";
import { LOGO_MAX_BYTES, LOGO_MAX_PIXELS, validateLogo } from "@/lib/branding/logo-validate";
import {
  jpegBytes,
  padTo,
  pngBytes,
  webpVp8Bytes,
  webpVp8lBytes,
  webpVp8xBytes,
} from "../support/logo-images";

function refusal(code: string) {
  return { ok: false, code };
}

describe("validateLogo: accepted types and header dimensions", () => {
  it("accepts a PNG with its IHDR width and height", async () => {
    expect(await validateLogo(pngBytes(64, 32))).toEqual({
      ok: true,
      mimeType: "image/png",
      width: 64,
      height: 32,
    });
  });

  it("accepts a baseline JPEG (SOF0) and reads the frame header after skipping DHT", async () => {
    expect(await validateLogo(jpegBytes(300, 200, 0xc0))).toEqual({
      ok: true,
      mimeType: "image/jpeg",
      width: 300,
      height: 200,
    });
  });

  it("accepts a progressive JPEG (SOF2)", async () => {
    expect(await validateLogo(jpegBytes(17, 999, 0xc2))).toEqual({
      ok: true,
      mimeType: "image/jpeg",
      width: 17,
      height: 999,
    });
  });

  it("accepts a lossy WebP (VP8) with 14-bit dimensions", async () => {
    expect(await validateLogo(webpVp8Bytes(640, 480))).toEqual({
      ok: true,
      mimeType: "image/webp",
      width: 640,
      height: 480,
    });
  });

  it("accepts a lossless WebP (VP8L) with dimensions stored minus one", async () => {
    expect(await validateLogo(webpVp8lBytes(1000, 3))).toEqual({
      ok: true,
      mimeType: "image/webp",
      width: 1000,
      height: 3,
    });
  });

  it("accepts an extended WebP (VP8X) with 24-bit canvas dimensions plus one", async () => {
    expect(await validateLogo(webpVp8xBytes(1, 777))).toEqual({
      ok: true,
      mimeType: "image/webp",
      width: 1,
      height: 777,
    });
  });
});

describe("validateLogo: refused content", () => {
  it("refuses SVG text as svg", async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>x()</script></svg>');
    expect(await validateLogo(svg)).toEqual(refusal("svg"));
  });

  it("refuses SVG with a UTF-8 BOM, leading whitespace and an upper-case XML declaration as svg", async () => {
    const svg = Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      Buffer.from(' \r\n\t <?XML version="1.0"?>\n<SVG xmlns="http://www.w3.org/2000/svg"/>'),
    ]);
    expect(await validateLogo(svg)).toEqual(refusal("svg"));
  });

  it("refuses an SVG whose root comes after a comment (not raster bytes) as not_image", async () => {
    const svg = Buffer.from('<!-- logo --><svg xmlns="http://www.w3.org/2000/svg"/>');
    expect(await validateLogo(svg)).toEqual(refusal("not_image"));
  });

  it("refuses a GIF as not_image", async () => {
    const gif = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 0, 1, 0, 0, 0, 0, 0x3b]);
    expect(await validateLogo(gif)).toEqual(refusal("not_image"));
  });

  it("refuses a PDF as not_image", async () => {
    expect(await validateLogo(Buffer.from("%PDF-1.7\n%\xe2\xe3\xcf\xd3\n1 0 obj\n"))).toEqual(
      refusal("not_image"),
    );
  });

  it("refuses bytes of no known type as not_image", async () => {
    const noise = Buffer.alloc(512);
    for (let i = 0; i < noise.length; i += 1) noise[i] = (i * 37 + 11) % 251;
    expect(await validateLogo(noise)).toEqual(refusal("not_image"));
  });

  it("refuses an animated PNG (APNG) as not_image", async () => {
    const png = pngBytes(10, 10);
    const actl = Buffer.from([
      0, 0, 0, 8, 0x61, 0x63, 0x54, 0x4c, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0,
    ]);
    // acTL goes right after IHDR (8-byte signature + 25-byte IHDR chunk).
    const apng = Buffer.concat([png.subarray(0, 33), actl, png.subarray(33)]);
    expect(await validateLogo(apng)).toEqual(refusal("not_image"));
  });
});

describe("validateLogo: unreadable input", () => {
  it("refuses an empty buffer as unreadable", async () => {
    expect(await validateLogo(Buffer.alloc(0))).toEqual(refusal("unreadable"));
  });

  it("refuses a truncated PNG header (IHDR cut inside the width) as unreadable", async () => {
    expect(await validateLogo(pngBytes(64, 32).subarray(0, 20))).toEqual(refusal("unreadable"));
  });

  it("refuses a PNG signature with nothing after it as unreadable", async () => {
    expect(await validateLogo(pngBytes(64, 32).subarray(0, 8))).toEqual(refusal("unreadable"));
  });

  it("refuses a PNG with a zero width as unreadable", async () => {
    expect(await validateLogo(pngBytes(0, 32))).toEqual(refusal("unreadable"));
  });

  it("refuses a JPEG whose scan starts before any frame header as unreadable", async () => {
    const sos = Buffer.from([0xff, 0xd8, 0xff, 0xda, 0x00, 0x08, 1, 1, 0, 0, 0x3f, 0, 0xff, 0xd9]);
    expect(await validateLogo(sos)).toEqual(refusal("unreadable"));
  });

  it("refuses a JPEG cut inside its frame header as unreadable", async () => {
    const jpeg = jpegBytes(300, 200);
    expect(await validateLogo(jpeg.subarray(0, jpeg.length - 12))).toEqual(refusal("unreadable"));
  });

  it("refuses a lossy WebP without the VP8 start code as unreadable", async () => {
    const webp = webpVp8Bytes(64, 64);
    webp[23] = 0x00;
    expect(await validateLogo(webp)).toEqual(refusal("unreadable"));
  });
});

describe("validateLogo: byte and pixel limits", () => {
  it("accepts exactly 1,048,576 bytes (a valid image followed by padding)", async () => {
    const bytes = padTo(pngBytes(64, 64), 1_048_576);
    expect(LOGO_MAX_BYTES).toBe(1_048_576);
    expect(bytes.length).toBe(LOGO_MAX_BYTES);
    expect(await validateLogo(bytes)).toMatchObject({ ok: true, mimeType: "image/png" });
  });

  it("refuses 1,048,577 bytes as too_large, counted in bytes", async () => {
    expect(await validateLogo(padTo(jpegBytes(64, 64), 1_048_577))).toEqual(refusal("too_large"));
    // An SVG that is too large is refused for its size first.
    expect(await validateLogo(padTo(Buffer.from("<svg>"), 1_048_577))).toEqual(
      refusal("too_large"),
    );
  });

  it("accepts 1024 x 1024 in every format", async () => {
    expect(LOGO_MAX_PIXELS).toBe(1024);
    for (const bytes of [
      pngBytes(1024, 1024),
      jpegBytes(1024, 1024),
      jpegBytes(1024, 1024, 0xc2),
      webpVp8Bytes(1024, 1024),
      webpVp8lBytes(1024, 1024),
      webpVp8xBytes(1024, 1024),
    ]) {
      expect(await validateLogo(bytes)).toMatchObject({ ok: true, width: 1024, height: 1024 });
    }
  });

  it("refuses 1025 x 1 and 1 x 1025 as too_many_pixels in every format", async () => {
    for (const [w, h] of [
      [1025, 1],
      [1, 1025],
    ] as const) {
      for (const bytes of [
        pngBytes(w, h),
        jpegBytes(w, h),
        webpVp8Bytes(w, h),
        webpVp8lBytes(w, h),
        webpVp8xBytes(w, h),
      ]) {
        expect(await validateLogo(bytes)).toEqual(refusal("too_many_pixels"));
      }
    }
  });

  it("reads PNG dimensions as 32-bit values (a huge width is too_many_pixels, never wrapped)", async () => {
    expect(await validateLogo(pngBytes(0x80000001, 1))).toEqual(refusal("too_many_pixels"));
  });
});
