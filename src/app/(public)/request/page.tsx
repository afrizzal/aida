import { PublicPageShell } from "@/components/public/public-page-shell";
import { BRANDING_SETTING_KEYS } from "@/lib/branding/settings";
import { prisma } from "@/lib/db";
import { RequestForm } from "./request-form";

// Always server-render: no static prerender for a page whose form posts to a
// live Route Handler (avoids a stale export during `next build`).
export const dynamic = "force-dynamic";

export default async function RequestPage() {
  // Unauthenticated route — no session/scopedDb here. Single-org v1 resolution (mirrors the
  // public intake route's `prisma.organization.findFirst()` precedent).
  const org = await prisma.organization.findFirst({ select: { id: true, name: true } });
  const row = org
    ? await prisma.setting.findFirst({
        where: { organizationId: org.id, key: BRANDING_SETTING_KEYS.workspaceName },
      })
    : null;
  const brandName = (row?.value ?? "").trim() || org?.name || "AIDA";

  return (
    <PublicPageShell maxWidth={640} brandName={brandName}>
      <RequestForm />
    </PublicPageShell>
  );
}
