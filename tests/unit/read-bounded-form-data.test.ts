// readBoundedFormData counts the bytes actually received (plan 08-13, D-24, AIDA-30).
import { afterEach, describe, expect, it, vi } from "vitest";
import * as bounded from "@/lib/http/read-bounded-form-data";
import { readBoundedFormData } from "@/lib/http/read-bounded-form-data";

const URL_ = "http://localhost/upload";

/** Serializes a FormData through Request so the exact multipart byte length is known. */
async function multipart(
  fields: Record<string, string>,
): Promise<{ body: Uint8Array<ArrayBuffer>; type: string }> {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  const req = new Request(URL_, { method: "POST", body: form });
  return {
    body: new Uint8Array(await req.arrayBuffer()),
    type: req.headers.get("content-type") ?? "",
  };
}

/** A multipart body of exactly `size` bytes, padding the single text field. */
async function multipartOfSize(
  size: number,
): Promise<{ body: Uint8Array<ArrayBuffer>; type: string }> {
  const base = await multipart({ message: "" });
  return multipart({ message: "x".repeat(size - base.body.byteLength) });
}

function streamOf(
  bytes: Uint8Array,
  chunk = 256,
): { stream: ReadableStream<Uint8Array>; cancelled: () => boolean } {
  let offset = 0;
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.byteLength) {
        controller.close();
        return;
      }
      controller.enqueue(bytes.slice(offset, offset + chunk));
      offset += chunk;
    },
    cancel() {
      cancelled = true;
    },
  });
  return { stream, cancelled: () => cancelled };
}

function post(body: BodyInit, headers: Record<string, string>): Request {
  return new Request(URL_, { method: "POST", body, headers, duplex: "half" } as RequestInit);
}

describe("readBoundedFormData", () => {
  it("parses a body of exactly maxBytes", async () => {
    const { body, type } = await multipartOfSize(1024);
    expect(body.byteLength).toBe(1024);
    const result = await readBoundedFormData(post(body, { "content-type": type }), 1024);
    expect(result.ok).toBe(true);
    if (result.ok) expect((result.form.get("message") as string).length).toBeGreaterThan(0);
  });

  it("rejects a body of maxBytes + 1", async () => {
    const { body, type } = await multipartOfSize(1025);
    expect(body.byteLength).toBe(1025);
    const result = await readBoundedFormData(post(body, { "content-type": type }), 1024);
    expect(result).toEqual({ ok: false, reason: "too_large" });
  });

  it("rejects early on a Content-Length above maxBytes without reading the body", async () => {
    const { body, type } = await multipartOfSize(1024);
    const { stream, cancelled } = streamOf(body);
    let pulled = false;
    const watched = stream.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform(c, ctl) {
          pulled = true;
          ctl.enqueue(c);
        },
      }),
    );
    const result = await readBoundedFormData(
      post(watched, { "content-type": type, "content-length": "2048" }),
      1024,
    );
    expect(result).toEqual({ ok: false, reason: "too_large" });
    expect(pulled).toBe(false);
    expect(cancelled()).toBe(false);
  });

  it("does not early-reject a Content-Length of exactly maxBytes", async () => {
    const { body, type } = await multipartOfSize(1024);
    const result = await readBoundedFormData(
      post(body, { "content-type": type, "content-length": "1024" }),
      1024,
    );
    expect(result.ok).toBe(true);
  });

  it("rejects a chunked stream with no Content-Length over maxBytes and cancels it", async () => {
    const { body, type } = await multipartOfSize(4096);
    const { stream, cancelled } = streamOf(body);
    const result = await readBoundedFormData(post(stream, { "content-type": type }), 1024);
    expect(result).toEqual({ ok: false, reason: "too_large" });
    expect(cancelled()).toBe(true);
  });

  it("ignores a false small Content-Length and counts the bytes", async () => {
    const { body, type } = await multipartOfSize(4096);
    const { stream } = streamOf(body);
    const result = await readBoundedFormData(
      post(stream, { "content-type": type, "content-length": "10" }),
      1024,
    );
    expect(result).toEqual({ ok: false, reason: "too_large" });
  });

  it("answers invalid for a non-multipart body", async () => {
    const result = await readBoundedFormData(
      post("not a form", { "content-type": "application/json" }),
      1024,
    );
    expect(result).toEqual({ ok: false, reason: "invalid" });
  });
});

// Review b-IN-b2: getReader() sits inside the try, so a body that cannot be read (here, already
// locked by another reader) is "invalid", answered 400 by the routes, never a thrown 500.
describe("readBoundedFormData on an unreadable body (b-IN-b2)", () => {
  it("a body that is already locked resolves to invalid instead of throwing", async () => {
    const { body, type } = await multipart({ message: "hello" });
    const request = new Request(URL_, {
      method: "POST",
      headers: { "content-type": type },
      body,
    });
    request.body?.getReader();
    await expect(readBoundedFormData(request, 1024)).resolves.toEqual({
      ok: false,
      reason: "invalid",
    });
  });
});

// K135 (Codex diff critique 1, item 5): the parts are counted on the raw bytes, by the boundary
// delimiter, before the multipart parser runs. A body over `maxParts` is "too_many_parts" and is
// never parsed.
describe("part count before the parse (K135)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** A multipart body with `n` text parts, serialized by the platform's own FormData encoder. */
  async function partsBody(n: number, name = (i: number) => `f${i}`) {
    const form = new FormData();
    for (let i = 0; i < n; i++) form.append(name(i), `v${i}`);
    const req = new Request(URL_, { method: "POST", body: form });
    return {
      body: new Uint8Array(await req.arrayBuffer()),
      type: req.headers.get("content-type") ?? "",
    };
  }

  const countFormParts = (bounded as Record<string, unknown>).countFormParts as
    | ((bytes: Uint8Array, contentType: string) => number | null)
    | undefined;

  it("counts exactly the parts of a multipart body; the closing delimiter is not a part", async () => {
    expect(typeof countFormParts).toBe("function");
    for (const n of [0, 1, 5, 40]) {
      const { body, type } = await partsBody(n);
      expect(countFormParts?.(body, type), `n=${n}`).toBe(n);
    }
  });

  it("reads a quoted boundary and counts file parts, empty ones included", async () => {
    const form = new FormData();
    form.set("message", "m");
    for (let i = 0; i < 11; i++) form.append("file", new File([], ""));
    const req = new Request(URL_, { method: "POST", body: form });
    const body = new Uint8Array(await req.arrayBuffer());
    const type = req.headers.get("content-type") ?? "";
    const boundary = type.split("boundary=")[1];
    expect(countFormParts?.(body, type)).toBe(12);
    expect(countFormParts?.(body, `multipart/form-data; boundary="${boundary}"`)).toBe(12);
  });

  it("counts the fields of a url-encoded body", () => {
    const body = new TextEncoder().encode("a=1&b=2&a=3");
    expect(countFormParts?.(body, "application/x-www-form-urlencoded")).toBe(3);
    expect(countFormParts?.(new Uint8Array(), "application/x-www-form-urlencoded")).toBe(0);
  });

  it("over maxParts answers too_many_parts and never runs the parser", async () => {
    const { body, type } = await partsBody(30);
    const parse = vi.spyOn(Response.prototype, "formData");
    const result = await readBoundedFormData(post(body, { "content-type": type }), 1 << 20, {
      maxParts: 29,
    });
    expect(result).toEqual({ ok: false, reason: "too_many_parts" });
    expect(parse).not.toHaveBeenCalled();
  });

  it("at maxParts the body is parsed as before", async () => {
    const { body, type } = await partsBody(29);
    const result = await readBoundedFormData(post(body, { "content-type": type }), 1 << 20, {
      maxParts: 29,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.form.get("f28")).toBe("v28");
  });

  it("with maxParts, a content type the count cannot read exactly is invalid and never parsed", async () => {
    const { body, type } = await partsBody(3);
    const boundary = type.split("boundary=")[1];
    const parse = vi.spyOn(Response.prototype, "formData");
    for (const odd of [
      `multipart/form-data; boundary=zzz; boundary=${boundary}`,
      `multipart/form-data; boundary= ${boundary}`,
      `multipart/form-data; charset=utf-8; boundary=${boundary}`,
      "multipart/form-data",
      "text/plain",
    ]) {
      const result = await readBoundedFormData(post(body, { "content-type": odd }), 1 << 20, {
        maxParts: 100,
      });
      expect(result, odd).toEqual({ ok: false, reason: "invalid" });
    }
    expect(parse).not.toHaveBeenCalled();
  });

  it("over maxParts in a url-encoded body is too_many_parts", async () => {
    const fields = Array.from({ length: 50 }, (_, i) => `x${i}=1`).join("&");
    const result = await readBoundedFormData(
      post(fields, { "content-type": "application/x-www-form-urlencoded" }),
      1 << 20,
      { maxParts: 10 },
    );
    expect(result).toEqual({ ok: false, reason: "too_many_parts" });
  });
});
