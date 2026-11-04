import { prisma } from "@/lib/db";
import { BRANDING_SETTING_KEYS, logoPublicUrl, parseLogoSetting } from "./settings";

// The brand an unauthenticated page shows (Phase 9 plan 09-07, AIDA-34, D-10): one
// organization's display name and logo. The callers pick the organization: /request keeps the
// single-org organization.findFirst() resolution, and /status/[token] passes the ticket's own
// organization for a valid token and renders no brand at all for an invalid one. Public pages
// have no session, so the two Setting reads carry the organization id explicitly.

export interface PublicBrand {
  name: string;
  logoUrl: string | null;
}

/**
 * The name resolves as before (a stored `branding:workspaceName`, else the organization's name,
 * else "AIDA"), so a logo never appears without a name. The logo is the stored reference's
 * versioned public URL, or null for the Sparkles box. No organization (a fresh install) gives
 * "AIDA" with no logo.
 */
export async function loadPublicBrand(
  org: { id: string; name: string } | null,
): Promise<PublicBrand> {
  if (!org) return { name: "AIDA", logoUrl: null };
  const rows = await prisma.setting.findMany({
    where: {
      organizationId: org.id,
      key: { in: [BRANDING_SETTING_KEYS.workspaceName, BRANDING_SETTING_KEYS.logo] },
    },
    select: { key: true, value: true },
  });
  const value = (key: string) => rows.find((row) => row.key === key)?.value;
  const name = (value(BRANDING_SETTING_KEYS.workspaceName) ?? "").trim() || org.name || "AIDA";
  const logo = parseLogoSetting(value(BRANDING_SETTING_KEYS.logo));
  return { name, logoUrl: logo ? logoPublicUrl(org.id, logo.version) : null };
}
