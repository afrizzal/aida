"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";
import { toast } from "sonner";

// The welcome after joining a workspace (Phase 10, plan 10-08; UI-SPEC Surface 2 and the
// Copywriting row of the welcome toast). The invitation accept route answers 303 to
// /tickets?joined=1; this reads `joined`, shows the toast once, and removes the parameter from the
// URL without a navigation, so a reload or a shared link does not show it again. Mounted by the
// (app) layout, inside a Suspense boundary, with the workspace name the layout already read.

const TOAST_ID = "join-welcome";

export function JoinWelcomeToast({ workspaceName }: { workspaceName: string }) {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const shown = useRef(false);
  const joined = searchParams.get("joined") === "1";

  useEffect(() => {
    if (!joined || shown.current) return;
    shown.current = true;
    toast.success(`Welcome to ${workspaceName}.`, { id: TOAST_ID });
    const rest = new URLSearchParams(searchParams.toString());
    rest.delete("joined");
    const query = rest.toString();
    // Next.js keeps its router in step with the native history API, so no server round trip.
    window.history.replaceState(null, "", query ? `${pathname}?${query}` : pathname);
  }, [joined, pathname, searchParams, workspaceName]);

  return null;
}
