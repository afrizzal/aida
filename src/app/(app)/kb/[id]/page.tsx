import { BookOpen } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { KbArticleForm } from "@/components/kb/kb-article-form";
import { KbEmbeddingStatusChip } from "@/components/kb/kb-embedding-status-chip";
import { getScopedDb } from "@/lib/session";

export const dynamic = "force-dynamic";

interface KbArticleDetailPageProps {
  params: Promise<{ id: string }>;
}

/**
 * View/edit surface — editing the raw Markdown is the v1 view/edit surface; a rendered
 * preview is optional and out of scope for this plan.
 */
export default async function KbArticleDetailPage({ params }: KbArticleDetailPageProps) {
  const { db } = await getScopedDb();
  const { id } = await params;

  const article = await db.kbArticle.findFirst({ where: { id } });

  if (!article) {
    return (
      <EmptyState
        icon={BookOpen}
        heading="Article not found"
        body="This article may have been removed or belongs to a different workspace."
      />
    );
  }

  return (
    <div className="flex flex-col gap-6 px-6 py-6">
      <div className="flex items-center gap-3">
        <h1 className="text-[18px] font-semibold tracking-tight text-foreground">
          {article.title}
        </h1>
        <KbEmbeddingStatusChip status={article.embeddingStatus} />
      </div>
      <KbArticleForm
        mode="edit"
        articleId={article.id}
        initial={{ title: article.title, bodyMarkdown: article.bodyMarkdown }}
      />
    </div>
  );
}
