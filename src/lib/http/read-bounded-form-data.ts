// Bounded multipart reader (plan 08-13, D-24, AIDA-30; part count K135, K137).
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
// odd parameter, a boundary outside RFC 2046) is answered "invalid" without parsing, so the
// parser never uses a boundary other than the counted one. The count never undercounts a body
// the parser accepts; it can overcount one that carries a delimiter-like line inside a part,
// which a real client's random boundary never does.
//
// Line start (K140, Codex diff critique 3 item 2): a delimiter is recognised only at the start of
// the body or right after a line feed (`\n--boundary`, which covers CRLF and bare LF), where the
// parser looks for it. `--boundary--` in the middle of a line, in a value or a file, is content.
//
// Bounded work (K137, K140): every line-start occurrence is examined, closing ones included. The
// scan stops as soon as the count passes the limit, and at the first closing delimiter, so it
// looks at no more than `maxParts + 1` occurrences (or `maxParts` ampersands) whatever the body
// holds, and it refuses outright past `maxParts + 2`. A closing delimiter ends the count only
// when it is the last occurrence, at the end of the body (nothing after it but one line break).
// Anything after it, a later delimiter or an epilogue, makes the body "invalid": the parser
// either ignores an epilogue (newer undici) or fails (Node 22's undici), and a "closing
// delimiter" that sits inside a part's headers is skipped by the parser, which then reads on and
// builds every later part. Stopping there and accepting the count would undercount, so such a
// body is refused unparsed instead.
//
// No project imports: usable from any route without pulling in app modules.

export type BoundedFormDataResult =
  | { ok: true; form: FormData }
  | { ok: false; reason: "too_large" | "invalid" | "too_many_parts" };

const MULTIPART = /^\s*multipart\/form-data\s*(;|$)/i;
const URLENCODED = /^\s*application\/x-www-form-urlencoded\s*(;|$)/i;
/**
 * The only multipart content type the count accepts: one `boundary` parameter, as browsers and
 * fetch send it. The boundary is 1 to 70 RFC 2046 boundary characters, ASCII only (K137): digits,
 * letters and `'()+_,-./:=?` and space, the last one not a space. Unquoted, only those that are
 * also HTTP token characters (`'+_-.`, digits, letters); quoted, all of them, with no escapes.
 * Anything else (a second boundary, spaces around `=`, escapes, a non-ASCII or over-long
 * boundary) could make the parser use a boundary other than the one counted: the parser reads
 * the boundary as UTF-8, so a non-ASCII one would not match the counted bytes. Such a content
 * type is refused as invalid before the parse. Only space and tab count as whitespace, as in the
 * parser.
 */
const STRICT_MULTIPART =
  /^[ \t]*multipart\/form-data[ \t]*;[ \t]*boundary=(?:([0-9A-Za-z'+_.-]{1,70})|"([0-9A-Za-z'()+_,./:=? -]{0,69}[0-9A-Za-z'()+_,./:=?-])")[ \t]*$/i;
const URLENCODED_PARAMS =
  /^\s*application\/x-www-form-urlencoded\s*(;\s*charset=[A-Za-z0-9._-]+\s*)?$/i;

const DASH = 0x2d;
const AMP = 0x26;
const CR = 0x0d;
const LF = 0x0a;
/** After the closing delimiter, at most one line break may follow. */
const MAX_CLOSE_TAIL_BYTES = 2;

/** The parts of a form body (see countFormParts) and the work the scan did to count them. */
export type FormPartScan = {
  /** The count, `limit + 1` once it passed the limit, or null when the body is refused. */
  parts: number | null;
  /** Delimiter matches (multipart) or `&` matches (url-encoded) the scan looked at. */
  examined: number;
};

function onlyLineBreakAfter(buf: Buffer, from: number): boolean {
  if (buf.byteLength - from > MAX_CLOSE_TAIL_BYTES) return false;
  for (let i = from; i < buf.byteLength; i++) {
    if (buf[i] !== CR && buf[i] !== LF) return false;
  }
  return true;
}

/**
 * countFormParts with the work it did (K137). Exported for the tests, which bound the scan by
 * `examined`, never by time.
 */
export function scanFormParts(bytes: Uint8Array, contentType: string, limit: number): FormPartScan {
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let examined = 0;
  if (URLENCODED_PARAMS.test(contentType)) {
    if (buf.byteLength === 0) return { parts: 0, examined };
    let fields = 1;
    let at = -1;
    while (fields <= limit) {
      at = buf.indexOf(AMP, at + 1);
      if (at === -1) break;
      examined++;
      fields++;
    }
    return { parts: fields, examined };
  }
  const m = contentType.match(STRICT_MULTIPART);
  const boundary = m ? (m[1] ?? m[2]) : undefined;
  if (!boundary) return { parts: null, examined };
  // ASCII only, so these are exactly the bytes the parser looks for.
  const delimiter = Buffer.from(`--${boundary}`, "utf8");
  // K140: a delimiter only at the start of the body or right after a line feed (CRLF or bare LF).
  const lineDelimiter = Buffer.from(`\n--${boundary}`, "utf8");
  const nextAfterLineFeed = (from: number) => {
    const lf = buf.indexOf(lineDelimiter, from);
    return lf === -1 ? -1 : lf + 1;
  };
  let parts = 0;
  let at = buf.subarray(0, delimiter.length).equals(delimiter) ? 0 : nextAfterLineFeed(0);
  for (;;) {
    if (at === -1) return { parts, examined };
    examined++;
    if (examined > limit + 2) return { parts: null, examined };
    const end = at + delimiter.length;
    if (buf[end] === DASH && buf[end + 1] === DASH) {
      // A closing delimiter followed by at most one line break is the last occurrence (no room
      // for another). Anything else after it, a later delimiter or an epilogue, is refused.
      return { parts: onlyLineBreakAfter(buf, end + 2) ? parts : null, examined };
    }
    parts++;
    if (parts > limit) return { parts, examined };
    at = nextAfterLineFeed(end);
  }
}

/**
 * The number of parts in a form body, counted on the raw bytes (K135): for multipart, every
 * `--boundary` delimiter at the start of a line (K140) before the closing `--boundary--`; for
 * url-encoded, the `&`-separated
 * fields. The count stops once it passes `limit` and then returns `limit + 1` (K137). Null when
 * the content type is not one the count can read exactly (see STRICT_MULTIPART), or when
 * anything but one line break follows the first closing delimiter; readBoundedFormData then
 * refuses the body as invalid without parsing it.
 */
export function countFormParts(
  bytes: Uint8Array,
  contentType: string,
  limit: number,
): number | null {
  return scanFormParts(bytes, contentType, limit).parts;
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
    const parts = countFormParts(bytes, contentType, opts.maxParts);
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
