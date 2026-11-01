export const MAX_BYTES = 10 * 1024 * 1024;
export const ALLOWED_MIME = new Set<string>([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "application/pdf",
  "text/plain",
  "text/csv",
]);
export const MAX_TOTAL_REQUEST_BYTES = 30 * 1024 * 1024; // public intake and follow-up combined file-bytes cap
// D-24: route cap on raw body bytes, counted as received (readBoundedFormData): the combined
// file cap plus 1 MiB for multipart boundaries, part headers and the text fields.
export const MAX_REQUEST_BODY_BYTES = MAX_TOTAL_REQUEST_BYTES + 1024 * 1024;
// D-24: Next.js proxyClientMaxBodySize and Caddy request_body max_size, one MiB above the route
// cap so an oversized body reaches the route and gets the app's own 413. Must equal the
// Caddyfile value, which cannot import it (tests/unit/body-limit-lockstep.test.ts).
export const PROXY_BODY_LIMIT_BYTES = MAX_REQUEST_BODY_BYTES + 1024 * 1024;
// K128 (review b-WR-b2): files per public intake or follow-up request, checked before any file
// is read (validateUploadFiles). Neither shipped public form sets a count, so this is K128's
// default. The forms check it too, as a convenience; the server check is the bound.
export const MAX_FILES_PER_REQUEST = 10;
