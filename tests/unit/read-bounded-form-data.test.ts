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
    | ((bytes: Uint8Array, contentType: string, limit: number) => number | null)
    | undefined;
  /** Far above every body these cases build, so the K137 early stop never applies here. */
  const NO_STOP = 1000;

  it("counts exactly the parts of a multipart body; the closing delimiter is not a part", async () => {
    expect(typeof countFormParts).toBe("function");
    for (const n of [0, 1, 5, 40]) {
      const { body, type } = await partsBody(n);
      expect(countFormParts?.(body, type, NO_STOP), `n=${n}`).toBe(n);
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
    expect(countFormParts?.(body, type, NO_STOP)).toBe(12);
    expect(countFormParts?.(body, `multipart/form-data; boundary="${boundary}"`, NO_STOP)).toBe(12);
  });

  it("counts the fields of a url-encoded body", () => {
    const body = new TextEncoder().encode("a=1&b=2&a=3");
    expect(countFormParts?.(body, "application/x-www-form-urlencoded", NO_STOP)).toBe(3);
    expect(countFormParts?.(new Uint8Array(), "application/x-www-form-urlencoded", NO_STOP)).toBe(
      0,
    );
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

// K137 (Codex diff critique round 2, item 2, and the boundary charset finding): the count's work
// is bounded, and only a boundary the count reads exactly as the parser does is accepted. Every
// bound below is an assertion on work done (`examined`: the delimiter or `&` matches the scan
// looked at), never on wall-clock time. Adversarial bodies are built in memory.
describe("part count work is bounded (K137)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const LIMIT = 17;
  const enc = (s: string) => new TextEncoder().encode(s);
  const typeFor = (boundary: string) => `multipart/form-data; boundary=${boundary}`;

  /** `n` text parts framed by hand with `boundary`, closed by `--boundary--` plus `tail`. */
  function framed(boundary: string, n: number, tail = "\r\n"): string {
    let s = "";
    for (let i = 0; i < n; i++) {
      s += `--${boundary}\r\nContent-Disposition: form-data; name="f${i}"\r\n\r\nv${i}\r\n`;
    }
    return `${s}--${boundary}--${tail}`;
  }

  /** What the platform's own multipart parser makes of a body: its entry count, or "failure". */
  async function parserEntries(body: Uint8Array, type: string): Promise<number | "failure"> {
    try {
      const form = await new Response(new Blob([body as Uint8Array<ArrayBuffer>]), {
        headers: { "content-type": type },
      }).formData();
      return [...form.keys()].length;
    } catch {
      return "failure";
    }
  }

  const scan = (bytes: Uint8Array, type: string, limit = LIMIT) =>
    bounded.scanFormParts(bytes, type, limit);

  it("stops at the first closing delimiter: a million fake closing delimiters after a real close are never examined, and the body is refused unparsed", async () => {
    const body = enc(framed("b", 2) + "--b--".repeat(1_000_000));
    const result = scan(body, typeFor("b"));
    // Two part delimiters and the real close: nothing after it is looked at.
    expect(result.examined).toBe(3);
    expect(result.parts).toBeNull();
    const parse = vi.spyOn(Response.prototype, "formData");
    expect(
      await readBoundedFormData(post(body, { "content-type": typeFor("b") }), 1 << 30, {
        maxParts: LIMIT,
      }),
    ).toEqual({ ok: false, reason: "invalid" });
    expect(parse).not.toHaveBeenCalled();
  });

  it("a closing delimiter followed by nothing, or by one line break, ends an exact count", () => {
    for (const tail of ["", "\r\n"]) {
      const result = scan(enc(framed("b", 5, tail)), typeFor("b"));
      expect(result, JSON.stringify(tail)).toEqual({ parts: 5, examined: 6 });
    }
  });

  it("a closing delimiter inside a part's headers, with more parts after it, is refused, never counted short", async () => {
    // The parser skips header lines, so it reads past this "--b--" and builds every later part.
    const head = `--b\r\nContent-Disposition: form-data; name="a"\r\n--b--: x\r\n\r\nv\r\n`;
    const body = enc(head + framed("b", 40));
    expect(await parserEntries(body, typeFor("b"))).toBe(41);
    const result = scan(body, typeFor("b"));
    expect(result.parts).toBeNull();
    expect(result.examined).toBe(2);
    const parse = vi.spyOn(Response.prototype, "formData");
    expect(
      await readBoundedFormData(post(body, { "content-type": typeFor("b") }), 1 << 20, {
        maxParts: LIMIT,
      }),
    ).toEqual({ ok: false, reason: "invalid" });
    expect(parse).not.toHaveBeenCalled();
  });

  it("stops as soon as the count passes the limit", async () => {
    const body = enc(framed("b", 10_000));
    const result = scan(body, typeFor("b"));
    expect(result).toEqual({ parts: LIMIT + 1, examined: LIMIT + 1 });
    const parse = vi.spyOn(Response.prototype, "formData");
    expect(
      await readBoundedFormData(post(body, { "content-type": typeFor("b") }), 1 << 20, {
        maxParts: LIMIT,
      }),
    ).toEqual({ ok: false, reason: "too_many_parts" });
    expect(parse).not.toHaveBeenCalled();
  });

  it("url-encoded: four million `&` stop at the limit", async () => {
    const body = new Uint8Array(4_000_000).fill(0x26);
    const result = scan(body, "application/x-www-form-urlencoded");
    expect(result).toEqual({ parts: LIMIT + 1, examined: LIMIT });
    expect(
      await readBoundedFormData(
        post(body, { "content-type": "application/x-www-form-urlencoded" }),
        1 << 30,
        { maxParts: LIMIT },
      ),
    ).toEqual({ ok: false, reason: "too_many_parts" });
  });

  it("a non-ASCII boundary is refused unparsed, quoted or not (the parser reads it as UTF-8)", async () => {
    const boundary = "ééé";
    const body = enc(framed(boundary, 30));
    // The parser accepts it and builds all 30 parts; a latin1 count would have found none.
    expect(await parserEntries(body, `multipart/form-data; boundary="${boundary}"`)).toBe(30);
    const parse = vi.spyOn(Response.prototype, "formData");
    for (const type of [
      `multipart/form-data; boundary="${boundary}"`,
      `multipart/form-data; boundary=${boundary}`,
      `multipart/form-data; boundary="ab${boundary}cd"`,
    ]) {
      expect(scan(body, type), type).toEqual({ parts: null, examined: 0 });
      expect(
        await readBoundedFormData(post(body, { "content-type": type }), 1 << 20, {
          maxParts: LIMIT,
        }),
        type,
      ).toEqual({ ok: false, reason: "invalid" });
    }
    expect(parse).not.toHaveBeenCalled();
  });

  it("a 71-character boundary is refused unparsed; 70 characters are counted", async () => {
    const long = "a".repeat(71);
    const body = enc(framed(long, 3));
    expect(await parserEntries(body, typeFor(long))).toBe(3);
    const parse = vi.spyOn(Response.prototype, "formData");
    for (const type of [typeFor(long), `multipart/form-data; boundary="${long}"`]) {
      expect(scan(body, type), type).toEqual({ parts: null, examined: 0 });
      expect(
        await readBoundedFormData(post(body, { "content-type": type }), 1 << 20, {
          maxParts: LIMIT,
        }),
      ).toEqual({ ok: false, reason: "invalid" });
    }
    expect(parse).not.toHaveBeenCalled();
    const max = "a".repeat(70);
    expect(scan(enc(framed(max, 3)), typeFor(max))).toEqual({ parts: 3, examined: 4 });
  });

  it("boundary characters outside RFC 2046 are refused; a trailing space is refused", () => {
    const body = enc(framed("x", 2));
    for (const type of [
      "multipart/form-data; boundary=a!b",
      "multipart/form-data; boundary=a#b",
      "multipart/form-data; boundary=a~b",
      'multipart/form-data; boundary="a!b"',
      'multipart/form-data; boundary="abc "',
      'multipart/form-data; boundary=""',
    ]) {
      expect(scan(body, type), type).toEqual({ parts: null, examined: 0 });
    }
  });

  it("a quoted boundary with RFC 2046 characters that need quoting is counted exactly and parsed", async () => {
    for (const boundary of ["a:b=c? d", "(x),y/z.w'+_-", " leading-space"]) {
      const type = `multipart/form-data; boundary="${boundary}"`;
      const body = enc(framed(boundary, 6));
      expect(await parserEntries(body, type), boundary).toBe(6);
      expect(scan(body, type), boundary).toEqual({ parts: 6, examined: 7 });
      const result = await readBoundedFormData(post(body, { "content-type": type }), 1 << 20, {
        maxParts: 6,
      });
      expect(result.ok, boundary).toBe(true);
      if (result.ok) expect(result.form.get("f5")).toBe("v5");
    }
  });
});
