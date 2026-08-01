import { createHash } from "node:crypto";
import { prisma } from "@/lib/db";

/**
 * Reads the pepper lazily, on every hash — not once at module load — so importing this module
 * (e.g. transitively, in a build or in tests that never call checkRateLimit) never fails just
 * because RATE_LIMIT_PEPPER happens to be unset; only actually hashing an IP requires it. This
 * mirrors src/lib/crypto/secret-box.ts's getKey(), which throws only when APP_ENCRYPTION_KEY is
 * needed, never at import time.
 *
 * `||`, not `??`, is required: docker-compose.yml injects
 * `RATE_LIMIT_PEPPER: ${RATE_LIMIT_PEPPER:-}`, so an operator who never sets it gets the
 * variable defined as `""` — `??` only falls back on null/undefined and would silently leave
 * `""` in place, making `ipHash` an unsalted sha256(ip) reversible over the IPv4 space in
 * minutes (07-09 GAP 3). Throwing here — rather than silently falling back to a public
 * placeholder pepper — is the only way to keep the "raw IPs are never persisted" claim
 * (docs/SECURITY.md) actually true in the shipped Compose path.
 */
function getPepper(): string {
  const pepper = process.env.RATE_LIMIT_PEPPER || "";
  if (!pepper) {
    throw new Error(
      "RATE_LIMIT_PEPPER is required to hash rate-limit identifiers (generate with: openssl rand -base64 32)",
    );
  }
  return pepper;
}

function hashIp(ip: string) {
  return createHash("sha256")
    .update(ip + getPepper())
    .digest("hex");
}

export async function checkRateLimit(
  scope: string,
  ip: string,
  opts?: { max?: number; windowMs?: number },
): Promise<boolean> {
  const max = opts?.max ?? 5;
  const windowMs = opts?.windowMs ?? 60 * 60 * 1000;
  const ipHash = hashIp(ip);
  const windowStart = new Date(Date.now() - windowMs);
  const recent = await prisma.rateLimitHit.count({
    where: { scope, ipHash, createdAt: { gte: windowStart } },
  });
  if (recent >= max) return false;
  await prisma.rateLimitHit.create({ data: { scope, ipHash } });
  return true;
}
