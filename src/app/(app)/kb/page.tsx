import { BookOpen, Plus } from "lucide-react";
import Link from "next/link";
import { EmptyState } from "@/components/empty-state";
import { KbEmbeddingStatusChip } from "@/components/kb/kb-embedding-status-chip";
import { Button } from "@/components/ui/button";
import { prisma } from "@/lib/db";
import { formatRelativeTime } from "@/lib/format-relative-time";
import { PROPOSALS_LINK } from "@/lib/kb/proposal-copy";
import { findActiveMembership, isAdminRole } from "@/lib/membership";
import { getScopedDb } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function KbPage() {
  const { db, session, orgId } = await getScopedDb();

  // UI-SPEC Surface 2 (D-01, pattern finding C1): the Proposals link is for owners and admins
  // only, and the DRAFT count is read from kbProposal only for them. Members see no link.
  const membership = await findActiveMembership(prisma, session.user.id, orgId);
  const isAdmin = isAdminRole(membership?.role);
  const draftProposals = isAdmin
    ? await db.kbProposal.count({ where: { organizationId: orgId, status: "DRAFT" } })
    : 0;

  const articles = await db.kbArticle.findMany({
    orderBy: { updatedAt: "desc" },
    select: { id: true, title: true, slug: true, embeddingStatus: true, updatedAt: true },
  });

  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between px-6 py-4">
        <h1 className="text-[18px] font-semibold tracking-tight text-foreground">Knowledge Base</h1>
        <div className="flex items-center gap-2">
          {isAdmin && (
            <Button asChild variant="outline" size="sm" className="text-[13px]">
              <Link href="/kb/proposals">
                {PROPOSALS_LINK}
                {/* Review b-IN-03: a separator only screen readers get, so the link's name is
                    "Proposals, 3" rather than "Proposals3". Not verified with a screen reader. */}
                {draftProposals > 0 && <span className="sr-only">, </span>}
                {draftProposals > 0 && (
                  <span className="text-primary-emphasis tabular-nums">{draftProposals}</span>
                )}
              </Link>
            </Button>
          )}
          <Button asChild size="sm">
            <Link href="/kb/new">
              <Plus className="size-3.5" />
              New article
            </Link>
          </Button>
        </div>
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
