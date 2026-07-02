// Pure string helpers for the `?cf=` URL param, deliberately kept dependency-free
// (no Prisma/db imports). filter-chip-row.tsx is a Client Component that needs these —
// importing them from list-query.ts would pull that module's `searchTickets` -> `db.ts`
// -> `pg` server-only chain into the client bundle and break the build.

/**
 * Splits the `?cf=` URL param (`{definitionId}:{value}`) on the FIRST colon only, so
 * values that themselves contain colons (e.g. a Date value) survive intact.
 */
export function parseCfParam(raw: string): { definitionId: string; value: string } {
  const separatorIndex = raw.indexOf(":");
  if (separatorIndex === -1) return { definitionId: raw, value: "" };
  return {
    definitionId: raw.slice(0, separatorIndex),
    value: raw.slice(separatorIndex + 1),
  };
}

export function serializeCfParam(definitionId: string, value: string): string {
  return `${definitionId}:${value}`;
}
