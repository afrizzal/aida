"use server";

import { revalidatePath } from "next/cache";
import { requireOrgAdminScope } from "@/lib/authz";
import { createKbArticle, updateKbArticle } from "@/lib/kb/create-article";
import { type MembershipEndedRefusal, membershipEnded, nullOnAccessDenied } from "@/lib/membership";

/** Shared shape for the create/update Server Actions below (mirrors kb-article-form's fields). */
export interface KbArticleActionInput {
  title: string;
  bodyMarkdown: string;
}

/**
 * Admin-gated KB article creation. Delegates all chunking/embedding/slug logic to
 * createKbArticle (05-03) — this action never touches lib/rag or Prisma directly.
 */
export async function createKbArticleAction(
  input: KbArticleActionInput,
): Promise<{ ok: boolean; id?: string } | MembershipEndedRefusal> {
  const scope = await requireOrgAdminScope().catch(nullOnAccessDenied);
  if (!scope) return membershipEnded();
  const { orgId } = scope;

  if (!input.title.trim()) {
    return { ok: false };
  }

  try {
    const { id } = await createKbArticle(orgId, input);
    revalidatePath("/kb");
    return { ok: true, id };
  } catch {
    return { ok: false };
  }
}

/**
 * Admin-gated KB article update. Delegates to updateKbArticle (05-03), which re-renders
 * bodyHtml and flips embeddingStatus back to PENDING + re-enqueues the embed job.
 */
export async function updateKbArticleAction(
  articleId: string,
  input: KbArticleActionInput,
): Promise<{ ok: boolean } | MembershipEndedRefusal> {
  const scope = await requireOrgAdminScope().catch(nullOnAccessDenied);
  if (!scope) return membershipEnded();
  const { orgId } = scope;

  if (!input.title.trim()) {
    return { ok: false };
  }

  try {
    await updateKbArticle(orgId, articleId, input);
    revalidatePath("/kb");
    revalidatePath(`/kb/${articleId}`);
    return { ok: true };
  } catch {
    return { ok: false };
  }
}
