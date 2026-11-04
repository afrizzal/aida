import { getOrgRole } from "@/lib/authz";
import { getBrandingSettings, getLogoSetting, logoPublicUrl } from "@/lib/branding/settings";
import { prisma } from "@/lib/db";
import { isAdminRole } from "@/lib/membership";
import { getScopedDb } from "@/lib/session";
import { BrandingForm } from "./branding-form";
import { LogoCard } from "./logo-card";

// Reads DB at request time (org-scoped settings) — must never be statically prerendered.
export const dynamic = "force-dynamic";

export default async function BrandingSettingsPage() {
  const { db, orgId } = await getScopedDb();
  // organization is a Better Auth model and is NOT in scopedDb's DOMAIN_MODELS — bare prisma.
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { name: true },
  });
  const branding = await getBrandingSettings(db, org?.name ?? "AIDA");
  const logo = await getLogoSetting(db);
  const logoUrl = logo ? logoPublicUrl(orgId, logo.version) : null;
  const role = await getOrgRole();
  const canEdit = isAdminRole(role);

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-[18px] font-semibold">Branding</h1>
        <p className="text-[13px] text-muted-foreground">
          Your workspace name and logo. Shown in the sidebar, on your public request and status
          pages, and (name only) as the from-name on outbound email.
        </p>
      </div>
      <BrandingForm
        initialWorkspaceName={branding.workspaceName}
        orgName={org?.name ?? "AIDA"}
        canEdit={canEdit}
      />
      <LogoCard logoUrl={logoUrl} canEdit={canEdit} />
    </div>
  );
}
