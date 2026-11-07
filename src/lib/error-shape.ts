/**
 * The error's class and, when it has the shape of one, its code; never the message (review a-WR-2,
 * Codex diff critique round 1, finding 6). A message can quote a password, a database URL or an
 * email, so a boot or seed log line names only these two bounded tokens: the class when it is a
 * plain identifier of at most 64 characters, else "unknown error"; the code when it is upper-case
 * letters, digits and "_", at most 16 characters (Prisma's P2028, Postgres' 57014, ECONNREFUSED).
 */
export function describeErrorShape(err: unknown): string {
  const name =
    err instanceof Error && /^[A-Za-z0-9_]{1,64}$/.test(err.name) ? err.name : "unknown error";
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === "string" && /^[A-Z0-9_]{1,16}$/.test(code) ? `${name}, ${code}` : name;
}
