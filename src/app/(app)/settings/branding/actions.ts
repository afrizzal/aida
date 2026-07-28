"use server";

import { revalidatePath } from "next/cache";
import { requireOrgAdmin } from "@/lib/authz";
import { MAX_WORKSPACE_NAME_LENGTH, saveBrandingSettings } from "@/lib/branding/settings";
import { getScopedDb } from "@/lib/session";

/**
 * Persists the workspace display name. Admin-gated (SECURITY.md: server-side authz on every
 * mutating Settings Server Action). Revalidates both the branding tab and the whole (app)
 * layout — the sidebar brand block is resolved in src/app/(app)/layout.tsx, not this route.
 */
export async function saveBranding(input: {
  workspaceName: string;
}): Promise<{ ok: boolean; error?: string }> {
  await requireOrgAdmin();
  const { db, orgId } = await getScopedDb();

  const workspaceName = input.workspaceName.trim();
  if (workspaceName.length > MAX_WORKSPACE_NAME_LENGTH) {
    return {
      ok: false,
      error: `Workspace name must be ${MAX_WORKSPACE_NAME_LENGTH} characters or fewer.`,
    };
  }

  try {
    await saveBrandingSettings(db, orgId, { workspaceName });
    revalidatePath("/settings/branding");
    revalidatePath("/", "layout"); // the sidebar brand block lives in the (app) layout
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not save branding settings." };
  }
}
