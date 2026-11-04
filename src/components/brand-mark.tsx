"use client";

import { Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

interface BrandMarkProps {
  /** The workspace display name; always shown next to the logo or the Sparkles box. */
  name: string | null;
  /** The versioned public logo URL (logoPublicUrl), or null for the Sparkles box. */
  logoUrl: string | null;
  /** "sidebar": 72px logo cap and sidebar tokens; "public": 120px cap, centred public row. */
  variant: "sidebar" | "public";
}

// The one brand mark for the sidebar, the Branding preview and PublicPageShell (Phase 9 plan
// 09-07, AIDA-34, D-11, UI-SPEC Surface 2), so all three render the same markup. With no logo,
// or once the logo fails to load, it renders the Sparkles brand box. A plain <img>, not the
// Next.js Image component, so no image-optimizer route is added; alt="" because the visible name
// next to it already names the brand. The logo is never tinted, cropped, padded or framed.
export function BrandMark({ name, logoUrl, variant }: BrandMarkProps) {
  // The URL that failed to load. Tracked per URL, so a replaced logo (a new versioned URL) gets
  // its own attempt while a failed one stays on the Sparkles box for the component's lifetime.
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const showLogo = logoUrl !== null && failedUrl !== logoUrl;

  // A server-rendered image can fail before hydration attaches onError; a completed image with
  // no natural width is a failed one.
  useEffect(() => {
    const img = imgRef.current;
    if (img && logoUrl && img.complete && img.naturalWidth === 0) setFailedUrl(logoUrl);
  }, [logoUrl]);

  return (
    <div
      data-slot="brand-mark"
      data-state={showLogo ? "logo" : "fallback"}
      className="flex min-w-0 items-center gap-2"
    >
      {showLogo ? (
        <div
          className={cn(
            "flex h-7 shrink-0 items-center",
            variant === "sidebar" ? "max-w-[72px]" : "max-w-[120px]",
          )}
        >
          {/* biome-ignore lint/performance/noImgElement: a plain img by contract (UI-SPEC Surface 2); the Next.js Image component would add an optimizer route */}
          <img
            ref={imgRef}
            src={logoUrl}
            alt=""
            height={28}
            className="h-7 w-auto max-w-full object-contain"
            onError={() => setFailedUrl(logoUrl)}
          />
        </div>
      ) : (
        <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-sidebar-primary shadow-sm">
          <Sparkles className="size-4 text-sidebar-primary-foreground" />
        </div>
      )}
      {name ? (
        <span
          className={
            variant === "sidebar"
              ? "min-w-0 truncate text-[15px] font-semibold tracking-tight text-sidebar-foreground"
              : "min-w-0 break-words text-[15px] font-semibold tracking-tight"
          }
        >
          {name}
        </span>
      ) : null}
    </div>
  );
}
