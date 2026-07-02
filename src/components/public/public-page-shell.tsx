import { Sparkles } from "lucide-react";
import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface PublicPageShellProps {
  children: ReactNode;
  /** 640 for the intake form (default), 720 for the wider status thread page. */
  maxWidth?: 640 | 720;
}

// Shared layout for every unauthenticated public page (intake form, status page).
// Brand mark reuses sidebar.tsx's brand-box markup verbatim (gap-2.5, size-7,
// Sparkles, text-[15px]) so unauthenticated visitors still feel the AIDA brand.
export function PublicPageShell({ children, maxWidth = 640 }: PublicPageShellProps) {
  return (
    <div className={cn("mx-auto w-full", maxWidth === 720 ? "max-w-[720px]" : "max-w-[640px]")}>
      <div className="mb-6 flex items-center justify-center gap-2.5">
        <div className="flex size-7 items-center justify-center rounded-md bg-sidebar-primary shadow-sm">
          <Sparkles className="size-4 text-sidebar-primary-foreground" />
        </div>
        <span className="text-[15px] font-semibold tracking-tight">AIDA</span>
      </div>
      <Card className="border-border/70 p-8 shadow-xl shadow-primary/5">{children}</Card>
    </div>
  );
}
