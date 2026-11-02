// Bounded multipart reader (plan 08-13, D-24, AIDA-30; part count K135).
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
// Part count (K135, Codex diff critique 1 item 5): with `maxParts`, the received bytes are scanned
// for the boundary delimiter before the parser runs, and a body with more parts is answered
// "too_many_parts" without being parsed, so many small parts (foreign field names included)
// cannot make the parser build an unbounded number of entries. A url-encoded body is counted by
// its `&`-separated fields. A content type the count cannot read exactly (a second boundary, an
// odd parameter) is answered "invalid" without parsing, so the parser never uses a boundary other
// than the counted one. The count never undercounts a body the parser accepts; it can overcount
// one that carries the delimiter inside a part without a line break before it, which a real
// client's random boundary never does.
//
// No project imports: usable from any route without pulling in app modules.

export type BoundedFormDataResult =
  | { ok: true; form: FormData }
  | { ok: false; reason: "too_large" | "invalid" | "too_many_parts" };

const MULTIPART = /^\s*multipart\/form-data\s*(;|$)/i;
const URLENCODED = /^\s*application\/x-www-form-urlencoded\s*(;|$)/i;
/**
 * The only multipart content type the count accepts: one `boundary` parameter, a token or a
 * plain quoted string, as browsers and fetch send it. Anything looser (a second boundary, spaces
 * around `=`, escapes) could make the parser pick a boundary other than the one counted, so it is
 * refused as invalid before the parse.
 */
const STRICT_MULTIPART =
  /^\s*multipart\/form-data\s*;\s*boundary=(?:([!#$%&'*+.^_`|~0-9A-Za-z-]+)|"([^"\\\r\n]+)")\s*$/i;
const URLENCODED_PARAMS =
  /^\s*application\/x-www-form-urlencoded\s*(;\s*charset=[A-Za-z0-9._-]+\s*)?$/i;

const DASH = 0x2d;
const AMP = 0x26;

/**
 * The number of parts in a form body, counted on the raw bytes (K135): for multipart, every
 * `--boundary` delimiter that is not the closing `--boundary--`; for url-encoded, the
 * `&`-separated fields. Null when the content type is not one the count can read exactly (see
 * STRICT_MULTIPART); readBoundedFormData then refuses the body as invalid without parsing it.
 */
export function countFormParts(bytes: Uint8Array, contentType: string): number | null {
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (URLENCODED_PARAMS.test(contentType)) {
    if (buf.byteLength === 0) return 0;
    let fields = 1;
    for (let i = buf.indexOf(AMP); i !== -1; i = buf.indexOf(AMP, i + 1)) fields++;
    return fields;
  }
  const m = contentType.match(STRICT_MULTIPART);
  const boundary = m ? (m[1] ?? m[2]) : undefined;
  if (!boundary) return null;
  const delimiter = Buffer.from(`--${boundary}`, "latin1");
  let parts = 0;
  for (let i = buf.indexOf(delimiter); i !== -1; i = buf.indexOf(delimiter, i + delimiter.length)) {
    const end = i + delimiter.length;
    const closing = buf[end] === DASH && buf[end + 1] === DASH;
    if (!closing) parts++;
  }
  return parts;
}

export async function readBoundedFormData(
  request: Request,
  maxBytes: number,
  opts?: { maxParts?: number },
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

  const contentType = request.headers.get("content-type") ?? "";
  // One contiguous copy for the scan; the chunks are dropped before the Blob copy is made.
  const bytes = Buffer.concat(chunks);
  chunks.length = 0;
  if (opts?.maxParts !== undefined) {
    // Only the two form types are parsed at all; one the count cannot read exactly is invalid.
    if (!MULTIPART.test(contentType) && !URLENCODED.test(contentType)) {
      return { ok: false, reason: "invalid" };
    }
    const parts = countFormParts(bytes, contentType);
    if (parts === null) return { ok: false, reason: "invalid" };
    if (parts > opts.maxParts) return { ok: false, reason: "too_many_parts" };
  }

  try {
    const form = await new Response(new Blob([bytes]), {
      headers: { "content-type": contentType },
    }).formData();
    return { ok: true, form };
  } catch {
    return { ok: false, reason: "invalid" };
  }
}
