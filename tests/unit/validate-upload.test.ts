// Phase 14, plan 14-03 (contract C10, D-14): the shared upload validator. Size before reading,
// a magic-byte sniff against ALLOWED_MIME, and a display name that is metadata only.
import { describe, expect, it } from "vitest";
import { MAX_BYTES } from "../../src/lib/attachments/constants";
import { cleanDisplayName, validateUpload } from "../../src/lib/attachments/validate-upload";

const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

function fileOf(name: string, data: Buffer) {
  return {
    name,
    size: data.length,
    arrayBuffer: async (): Promise<ArrayBuffer> =>
      data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer,
  };
}

describe("validateUpload", () => {
  it("accepts a valid PNG with its sniffed type, size and display name", async () => {
    const result = await validateUpload(fileOf("pic.png", PNG_1X1));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.mimeType).toBe("image/png");
    expect(result.sizeBytes).toBe(PNG_1X1.length);
    expect(result.originalFilename).toBe("pic.png");
    expect(Buffer.compare(result.buffer, PNG_1X1)).toBe(0);
  });

  it("refuses a file over MAX_BYTES without reading it", async () => {
    let read = false;
    const result = await validateUpload({
      name: "big.png",
      size: MAX_BYTES + 1,
      arrayBuffer: async () => {
        read = true;
        throw new Error("arrayBuffer must not be called for an oversized file");
      },
    });
    expect(result).toEqual({ ok: false, code: "FILE_TOO_LARGE" });
    expect(read).toBe(false);
  });

  it("accepts a file of exactly MAX_BYTES as far as the size check goes", async () => {
    const result = await validateUpload({ ...fileOf("pic.png", PNG_1X1), size: MAX_BYTES });
    expect(result.ok).toBe(true);
  });

  it.each([
    ["a text file renamed to .png", "evil.png", Buffer.from("just some text, not an image\n")],
    ["an empty file", "empty.png", Buffer.alloc(0)],
    [
      "an HTML file",
      "page.html",
      Buffer.from("<!doctype html><html><body><script>alert(1)</script></body></html>"),
    ],
  ])("refuses %s as UNSUPPORTED_FILE_TYPE", async (_kind, name, data) => {
    expect(await validateUpload(fileOf(name, data))).toEqual({
      ok: false,
      code: "UNSUPPORTED_FILE_TYPE",
    });
  });

  it("drops control characters from the display name", async () => {
    const result = await validateUpload(fileOf("re\u0000po\u001f\u007frt\n.png", PNG_1X1));
    expect(result.ok && result.originalFilename).toBe("report.png");
  });

  it("keeps a path-like name as plain display text only, never as a storage path", async () => {
    const result = await validateUpload(fileOf("../../etc/passwd.png", PNG_1X1));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.originalFilename).toBe("../../etc/passwd.png");
    // The validator returns no storage key or path: keys come from buildStorageKey only.
    expect(Object.keys(result).sort()).toEqual([
      "buffer",
      "mimeType",
      "ok",
      "originalFilename",
      "sizeBytes",
    ]);
  });

  it("cuts a long name to 255 code points", async () => {
    const result = await validateUpload(fileOf(`${"a".repeat(296)}.png`, PNG_1X1));
    expect(result.ok && [...result.originalFilename].length).toBe(255);
    const emoji = await validateUpload(fileOf("\u{1F600}".repeat(300), PNG_1X1));
    expect(emoji.ok && [...emoji.originalFilename].length).toBe(255);
    expect(emoji.ok && emoji.originalFilename).toBe("\u{1F600}".repeat(255));
  });

  it.each([
    "",
    "   ",
    "\u0001\u0002",
    " \t ",
  ])("falls back to 'file' for an empty or whitespace name (%j)", async (name) => {
    const result = await validateUpload(fileOf(name, PNG_1X1));
    expect(result.ok && result.originalFilename).toBe("file");
  });
});

// Review b-WR-04: invisible characters are built from code points, so no file holds one literally.
const cp = (...points: number[]): string => String.fromCodePoint(...points);

describe("cleanDisplayName (review b-WR-04)", () => {
  it("removes a right-to-left override, so an executable cannot pose as a PDF", () => {
    expect(cleanDisplayName(`invoice${cp(0x202e)}fdp.exe`)).toBe("invoicefdp.exe");
  });

  it.each([
    ["ARABIC LETTER MARK", 0x061c],
    ["LEFT-TO-RIGHT MARK", 0x200e],
    ["RIGHT-TO-LEFT MARK", 0x200f],
    ["LEFT-TO-RIGHT EMBEDDING", 0x202a],
    ["RIGHT-TO-LEFT EMBEDDING", 0x202b],
    ["POP DIRECTIONAL FORMATTING", 0x202c],
    ["LEFT-TO-RIGHT OVERRIDE", 0x202d],
    ["RIGHT-TO-LEFT OVERRIDE", 0x202e],
    ["LEFT-TO-RIGHT ISOLATE", 0x2066],
    ["RIGHT-TO-LEFT ISOLATE", 0x2067],
    ["FIRST STRONG ISOLATE", 0x2068],
    ["POP DIRECTIONAL ISOLATE", 0x2069],
  ])("removes the bidi control %s", (_name, point) => {
    expect(cleanDisplayName(`re${cp(point)}port.png`)).toBe("report.png");
  });

  it.each([
    ["NULL", 0x00],
    ["UNIT SEPARATOR", 0x1f],
    ["DELETE", 0x7f],
    ["first C1 control", 0x80],
    ["NEXT LINE", 0x85],
    ["last C1 control", 0x9f],
  ])("removes the C0 or C1 control %s", (_name, point) => {
    expect(cleanDisplayName(`re${cp(point)}port.png`)).toBe("report.png");
  });

  it.each([
    ["ZERO WIDTH SPACE", 0x200b],
    ["ZERO WIDTH NON-JOINER", 0x200c],
    ["ZERO WIDTH JOINER", 0x200d],
    ["WORD JOINER", 0x2060],
    ["ZERO WIDTH NO-BREAK SPACE", 0xfeff],
    ["LINE SEPARATOR", 0x2028],
    ["PARAGRAPH SEPARATOR", 0x2029],
  ])("removes the zero-width or separator character %s", (_name, point) => {
    expect(cleanDisplayName(`re${cp(point)}port.png`)).toBe("report.png");
  });

  it("falls back to 'file' when only invisible characters are given", () => {
    expect(cleanDisplayName(cp(0x202e, 0x2066, 0x0085, 0x200b, 0xfeff))).toBe("file");
  });

  it("keeps visible non-ASCII letters and emoji", () => {
    const name = `${cp(0x00e9)}t${cp(0x00e9)} ${cp(0x0645, 0x0644, 0x0641)} ${cp(0x1f600)}.png`;
    expect(cleanDisplayName(name)).toBe(name);
  });

  it("cleans the name returned by validateUpload the same way", async () => {
    const result = await validateUpload(
      fileOf(`invoice${cp(0x202e)}gnp.exe${cp(0x2066, 0x0085)}.png`, PNG_1X1),
    );
    expect(result.ok && result.originalFilename).toBe("invoicegnp.exe.png");
  });
});
