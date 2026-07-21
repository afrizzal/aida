"use server";

import { revalidatePath } from "next/cache";
import { requireOrgAdmin } from "@/lib/authz";
import { createKbArticle, updateKbArticle } from "@/lib/kb/create-article";
import { getScopedDb } from "@/lib/session";

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
): Promise<{ ok: boolean; id?: string }> {
  await requireOrgAdmin();
  const { orgId } = await getScopedDb();

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
): Promise<{ ok: boolean }> {
  await requireOrgAdmin();
  const { orgId } = await getScopedDb();

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
