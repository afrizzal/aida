import { PublicPageShell } from "@/components/public/public-page-shell";
import { loadPublicBrand } from "@/lib/branding/public-brand";
import { prisma } from "@/lib/db";
import { RequestForm } from "./request-form";

// Always server-render: no static prerender for a page whose form posts to a
// live Route Handler (avoids a stale export during `next build`).
export const dynamic = "force-dynamic";

export default async function RequestPage() {
  // Unauthenticated route — no session/scopedDb here. Single-org v1 resolution (mirrors the
  // public intake route's `prisma.organization.findFirst()` precedent).
  // The brand (name and logo) of that organization, D-10.
  const org = await prisma.organization.findFirst({ select: { id: true, name: true } });
  const brand = await loadPublicBrand(org);

  return (
    <PublicPageShell maxWidth={640} brand={brand}>
      <RequestForm />
    </PublicPageShell>
  );
}
