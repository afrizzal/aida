import { BookOpen, Plus } from "lucide-react";
import Link from "next/link";
import { EmptyState } from "@/components/empty-state";
import { KbEmbeddingStatusChip } from "@/components/kb/kb-embedding-status-chip";
import { Button } from "@/components/ui/button";
import { formatRelativeTime } from "@/lib/format-relative-time";
import { getScopedDb } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function KbPage() {
  const { db } = await getScopedDb();

  const articles = await db.kbArticle.findMany({
    orderBy: { updatedAt: "desc" },
    select: { id: true, title: true, slug: true, embeddingStatus: true, updatedAt: true },
  });

  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between px-6 py-4">
        <h1 className="text-[18px] font-semibold tracking-tight text-foreground">
          Knowledge Base
        </h1>
        <Button asChild size="sm">
          <Link href="/kb/new">
            <Plus className="size-3.5" />
            New article
          </Link>
        </Button>
      </div>

      {articles.length === 0 ? (
        <EmptyState
          icon={BookOpen}
          heading="No articles yet"
          body="Create knowledge base articles so AIDA can draft grounded, cited replies."
        />
      ) : (
        <div className="divide-y divide-border">
          {articles.map((article) => (
            <Link
              key={article.id}
              href={`/kb/${article.id}`}
              className="flex items-center gap-3 px-6 py-3 transition-colors hover:bg-muted/50"
            >
              <p className="min-w-0 flex-1 truncate text-[14px] font-medium text-foreground">
                {article.title}
              </p>
              <KbEmbeddingStatusChip status={article.embeddingStatus} />
              <span className="w-24 shrink-0 text-right text-[12px] text-muted-foreground">
                {formatRelativeTime(article.updatedAt)}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
