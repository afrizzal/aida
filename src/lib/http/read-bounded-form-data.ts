// Bounded multipart reader (plan 08-13, D-24, AIDA-30).
//
// The body limit is enforced on the bytes actually received. Content-Length is client-supplied:
// it can be missing (chunked transfer), false (smaller than the body) or honest, so a value above
// the limit is only an early reject that saves reading the body. Every other request is read
// chunk by chunk, and the stream is cancelled as soon as the running total passes the limit, so
// an oversized body is never buffered whole and never reaches the multipart parser.
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
    const reader = request.body.getReader();
    let received = 0;
    try {
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
