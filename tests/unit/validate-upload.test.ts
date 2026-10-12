// Phase 14, plan 14-03 (contract C10, D-14): the shared upload validator. Size before reading,
// a magic-byte sniff against ALLOWED_MIME, and a display name that is metadata only.
import { describe, expect, it } from "vitest";
import { MAX_BYTES } from "../../src/lib/attachments/constants";
import { validateUpload } from "../../src/lib/attachments/validate-upload";

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
