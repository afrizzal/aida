// readBoundedFormData counts the bytes actually received (plan 08-13, D-24, AIDA-30).
import { describe, expect, it } from "vitest";
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
