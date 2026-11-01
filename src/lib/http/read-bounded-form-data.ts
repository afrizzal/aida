// Bounded multipart reader (plan 08-13, D-24, AIDA-30).
//
// The body limit is enforced on the bytes actually received. Content-Length is client-supplied:
// it can be missing (chunked transfer), false (smaller than the body) or honest, so a value above
// the limit is only an early reject that saves reading the body. Every other request is read
// chunk by chunk, and the stream is cancelled as soon as the running total passes the limit, so
// the route never copies or parses more than `maxBytes`. That is a bound on the route, not on the
// process: Next's proxy has already buffered the body before the route runs, up to
// PROXY_BODY_LIMIT_BYTES (next.config.ts `proxyClientMaxBodySize`), and below the limit the
// chunks, the Blob and the parsed FormData are further copies (review b-IN-b2).
//
// No project imports: usable from any route without pulling in app modules.

export type BoundedFormDataResult =
  | { ok: true; form: FormData }
  | { ok: false; reason: "too_large" | "invalid" };

export async function readBoundedFormData(
  request: Request,
  maxBytes: number,
): Promise<BoundedFormDataResult> {
  const header = request.headers.get("content-length");
  if (header !== null && /^\d+$/.test(header.trim()) && Number(header.trim()) > maxBytes) {
    return { ok: false, reason: "too_large" };
  }

  const chunks: Uint8Array[] = [];
  if (request.body) {
    let received = 0;
    try {
      // Inside the try: a body that is already locked or disturbed is "invalid", never a throw.
      const reader = request.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.byteLength;
        if (received > maxBytes) {
          await reader.cancel().catch(() => {});
          return { ok: false, reason: "too_large" };
        }
        chunks.push(value);
      }
    } catch {
      return { ok: false, reason: "invalid" };
    }
  }

  try {
    const form = await new Response(new Blob(chunks as BlobPart[]), {
      headers: { "content-type": request.headers.get("content-type") ?? "" },
    }).formData();
    return { ok: true, form };
  } catch {
    return { ok: false, reason: "invalid" };
  }
}
