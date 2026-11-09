import { BookOpen, Sparkles, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { EmptyState } from "@/components/empty-state";
import { KbProposalStatusChip } from "@/components/kb/kb-proposal-status-chip";
import { TimeWithLocalTitle } from "@/components/tickets/local-date-time";
import { Button } from "@/components/ui/button";
import { formatRelativeTime } from "@/lib/format-relative-time";
import {
  BACK_TO_ARTICLES,
  LIST_AI_OFF_NOTICE,
  LIST_EMPTY_BODY,
  LIST_EMPTY_HEADING,
  MEMBERSHIP_ENDED,
  NOT_ALLOWED_BODY,
  NOT_ALLOWED_HEADING,
  PROPOSALS_PAGE_DESCRIPTION,
  PROPOSALS_PAGE_TITLE,
  proposalListRowText,
  sourceCount,
} from "@/lib/kb/proposal-copy";
import { loadProposalList } from "@/lib/kb/proposal-queries";
import { requirePageAccess } from "@/lib/page-access";
import { ProposalListRefresh } from "./proposal-list-refresh";

export const dynamic = "force-dynamic";

/**
 * The "Membership ended" row as an EmptyState heading (its first sentence) and body (the rest),
 * the split the ticket and contact pages use for the same sentence.
 */
function membershipEndedParts(): { heading: string; body: string } {
  const split = MEMBERSHIP_ENDED.indexOf(". ");
  if (split === -1) return { heading: MEMBERSHIP_ENDED, body: "" };
  return {
    heading: MEMBERSHIP_ENDED.slice(0, split + 1),
    body: MEMBERSHIP_ENDED.slice(split + 2),
  };
}

/**
 * The proposal list (UI-SPEC Surface 2, AIDA-18). loadProposalList checks the member row and
 * the owner or admin role before it reads any proposal (D-01): a plain member or an ended
 * membership gets its EmptyState and no proposal data is loaded.
 */
export default async function KbProposalsPage() {
  // The membership gate first, outside any try (Phase 10, V-27, C6): a non-member goes to /no-access.
  const { session, orgId } = await requirePageAccess();
  const result = await loadProposalList({ userId: session.user.id, orgId });

  if (result.kind === "NOT_ALLOWED") {
    return (
      <EmptyState
        icon={BookOpen}
        headingAs="h1"
        heading={NOT_ALLOWED_HEADING}
        body={NOT_ALLOWED_BODY}
      />
    );
  }
  if (result.kind === "MEMBERSHIP_ENDED") {
    const { heading, body } = membershipEndedParts();
    return <EmptyState icon={BookOpen} headingAs="h1" heading={heading} body={body} />;
  }

  const { rows, aiEnabled } = result;
  const idsWithStatus = (status: string) =>
    rows.filter((row) => row.status === status).map((row) => row.id);
  const generatingIds = idsWithStatus("GENERATING");
  const draftIds = idsWithStatus("DRAFT");

  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between gap-4 px-6 py-4">
        <div className="min-w-0 space-y-1">
          <h1 className="text-[18px] font-semibold tracking-tight text-foreground">
            {PROPOSALS_PAGE_TITLE}
          </h1>
          <p className="text-[13px] text-muted-foreground">{PROPOSALS_PAGE_DESCRIPTION}</p>
        </div>
        <Button asChild variant="outline" size="sm" className="shrink-0 text-[13px]">
          <Link href="/kb">{BACK_TO_ARTICLES}</Link>
        </Button>
      </div>

      {!aiEnabled && (
        <div className="mx-6 mb-4 flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 p-4 text-[13px] text-foreground">
          <TriangleAlert className="size-4 shrink-0 text-warning" aria-hidden="true" />
          <span>{LIST_AI_OFF_NOTICE}</span>
        </div>
      )}

      <ProposalListRefresh generatingIds={generatingIds} draftIds={draftIds} />

      {rows.length === 0 ? (
        <EmptyState icon={Sparkles} heading={LIST_EMPTY_HEADING} body={LIST_EMPTY_BODY} />
      ) : (
        <div className="divide-y divide-border">
          {rows.map((row) => {
            // Review b-WR-04: "Untitled (drafting…)" only for GENERATING; a FAILED row without a
            // title shows its short reason in the title column instead.
            const text = proposalListRowText(row);
            return (
              <Link
                key={row.id}
                href={`/kb/proposals/${row.id}`}
                className="flex flex-wrap items-center gap-2 px-6 py-3 transition-colors hover:bg-muted/50"
              >
                <KbProposalStatusChip status={row.status} />
                {text.title !== null ? (
                  <p className="min-w-0 flex-1 truncate text-[13px] font-semibold text-foreground">
                    {text.title}
                  </p>
                ) : (
                  <p className="min-w-0 flex-1 truncate text-[12px] text-muted-foreground">
                    {text.failureShort}
                  </p>
                )}
                {text.title !== null && text.failureShort && (
                  <span className="text-[12px] text-muted-foreground">{text.failureShort}</span>
                )}
                <span className="text-[12px] text-muted-foreground tabular-nums">
                  {sourceCount(row.sourceCount)}
                </span>
                {/* UI-SPEC Surface 2 "relative time (LocalDateTime title)" (review b-IN-08): the
                    relative text /kb rows use, the full local time in the title. */}
                <TimeWithLocalTitle
                  value={row.createdAt.toISOString()}
                  className="shrink-0 text-[12px] text-muted-foreground"
                >
                  {formatRelativeTime(row.createdAt)}
                </TimeWithLocalTitle>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
