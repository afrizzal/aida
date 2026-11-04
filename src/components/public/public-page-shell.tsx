import type { ReactNode } from "react";
import { BrandMark } from "@/components/brand-mark";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface PublicPageShellProps {
  children: ReactNode;
  /** 640 for the intake form (default), 720 for the wider status thread page. */
  maxWidth?: 640 | 720;
  /**
   * The organization's display name (D-16 fallback to the organization name) and logo URL, or
   * null to render no brand row at all (an invalid status token, D-10).
   */
  brand: { name: string; logoUrl: string | null } | null;
}

// Shared layout for every unauthenticated public page (intake form, status page). The brand row
// is the shared BrandMark (src/components/brand-mark.tsx, public variant): the workspace logo or
// the Sparkles box, always with the name, so visitors still see the workspace brand.
export function PublicPageShell({ children, maxWidth = 640, brand }: PublicPageShellProps) {
  return (
    <div className={cn("mx-auto w-full", maxWidth === 720 ? "max-w-[720px]" : "max-w-[640px]")}>
      {brand ? (
        <div className="mb-6 flex justify-center">
          <BrandMark variant="public" name={brand.name} logoUrl={brand.logoUrl} />
        </div>
      ) : null}
      <Card className="border-border/70 p-8 shadow-xl shadow-primary/5">{children}</Card>
    </div>
  );
}
