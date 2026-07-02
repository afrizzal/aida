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
export const MAX_TOTAL_REQUEST_BYTES = 30 * 1024 * 1024; // public intake combined cap
