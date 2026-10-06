import { BookOpen, Sparkles, TriangleAlert } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { KbProposalStatusChip } from "@/components/kb/kb-proposal-status-chip";
import { LocalDateTime } from "@/components/tickets/local-date-time";
import {
  AI_NOTICE,
  CUSTOMER_CONTENT_NOTICE,
  MEMBERSHIP_ENDED,
  NOT_ALLOWED_BODY,
  NOT_ALLOWED_HEADING,
  NOT_FOUND_BODY,
  NOT_FOUND_HEADING,
  REVIEW_PAGE_TITLE,
  requestedByLine,
  sourceChangedNotice,
  TRUNCATION_NOTICE,
} from "@/lib/kb/proposal-copy";
import { loadProposalReview } from "@/lib/kb/proposal-queries";
import { renderMarkdownPreview } from "@/lib/markdown/render";
import { getSessionActor } from "@/lib/session";
import { ProposalReview } from "./proposal-review";

export const dynamic = "force-dynamic";

/** The page h1; the client component moves focus to it after save, publish, reject and reload. */
const REVIEW_HEADING_ID = "proposal-review-heading";

const TIME_MARK = "\u0000time\u0000";
const NAME_MARK = "\u0000name\u0000";

/**
 * The "Requested by line" around its time, so the time renders through LocalDateTime and the
 * row stays verbatim. A requester without a user row has a null name; the name is then omitted
 * (plan 12.2-08 decision), never replaced by invented copy.
 */
function requestedByParts(name: string | null): { before: string; after: string } {
  let text = requestedByLine(name ?? NAME_MARK, TIME_MARK);
  if (name === null) text = text.replace(` by ${NAME_MARK}`, "");
  const [before = "", after = ""] = text.split(TIME_MARK);
  return { before, after };
}

/** The "Membership ended" row as an EmptyState heading (first sentence) and body (the rest). */
function membershipEndedParts(): { heading: string; body: string } {
  const split = MEMBERSHIP_ENDED.indexOf(". ");
  if (split === -1) return { heading: MEMBERSHIP_ENDED, body: "" };
  return {
    heading: MEMBERSHIP_ENDED.slice(0, split + 1),
    body: MEMBERSHIP_ENDED.slice(split + 2),
  };
}

interface ProposalReviewPageProps {
  params: Promise<{ id: string }>;
}

/**
 * The review page (UI-SPEC Surface 3, AIDA-18). loadProposalReview checks the member row and the
 * owner or admin role before it reads the proposal (D-01): a plain member, an ended membership,
 * a missing id and another organization's id each get their EmptyState and no proposal data.
 * The preview HTML comes only from renderMarkdownPreview here on the server (T-12.2-40): the
 * renderMarkdown pipeline that also strips every image source that is not same-origin relative
 * (run decision K54), so a stored body can never make the browser fetch another host; the loader's
 * sources are passed to the client component as returned (review P3), and this page never
 * queries sources or tickets itself.
 */
export default async function ProposalReviewPage({ params }: ProposalReviewPageProps) {
  const { id } = await params;
  const result = await loadProposalReview(await getSessionActor(), id, { now: new Date() });

  if (result.kind === "NOT_ALLOWED") {
    return <EmptyState icon={BookOpen} heading={NOT_ALLOWED_HEADING} body={NOT_ALLOWED_BODY} />;
  }
  if (result.kind === "MEMBERSHIP_ENDED") {
    const { heading, body } = membershipEndedParts();
    return <EmptyState icon={BookOpen} heading={heading} body={body} />;
  }
  if (result.kind === "NOT_FOUND") {
    return <EmptyState icon={BookOpen} heading={NOT_FOUND_HEADING} body={NOT_FOUND_BODY} />;
  }

  const { proposal } = result;
  const isDraft = proposal.status === "DRAFT";
  const previewHtml = proposal.bodyMarkdown ? renderMarkdownPreview(proposal.bodyMarkdown) : "";
  const requested = requestedByParts(proposal.requestedByName);
  const changedList = proposal.changedSourceNumbers.map((number) => `#${number}`).join(", ");

  return (
    <div className="flex flex-col gap-6 px-6 py-6">
      <div className="flex flex-wrap items-center gap-2">
        <h1
          id={REVIEW_HEADING_ID}
          tabIndex={-1}
          className="rounded-sm text-[18px] font-semibold tracking-tight text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          {REVIEW_PAGE_TITLE}
        </h1>
        <KbProposalStatusChip status={proposal.status} />
        <p className="text-[12px] text-muted-foreground">
          {requested.before}
          <LocalDateTime value={proposal.createdAt} />
          {requested.after}
        </p>
      </div>

      {isDraft && (
        <div className="flex items-start gap-2 rounded-lg border border-primary/15 bg-primary/5 p-4 text-[13px] text-foreground">
          <Sparkles className="size-4 shrink-0 text-primary-emphasis" aria-hidden="true" />
          <span>{AI_NOTICE}</span>
        </div>
      )}

      {isDraft && (
        <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 p-4 text-[13px] text-foreground">
          <TriangleAlert className="size-4 shrink-0 text-warning" aria-hidden="true" />
          <span>{CUSTOMER_CONTENT_NOTICE}</span>
        </div>
      )}

      {proposal.changedSourceNumbers.length > 0 && (
        <div
          role="status"
          className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 p-4 text-[13px] text-foreground"
        >
          <TriangleAlert className="size-4 shrink-0 text-warning" aria-hidden="true" />
          <span>{sourceChangedNotice(changedList)}</span>
        </div>
      )}

      {proposal.inputTruncated && (
        <div
          role="status"
          className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 p-4 text-[13px] text-foreground"
        >
          <TriangleAlert className="size-4 shrink-0 text-warning" aria-hidden="true" />
          <span>{TRUNCATION_NOTICE}</span>
        </div>
      )}

      <ProposalReview proposal={proposal} previewHtml={previewHtml} headingId={REVIEW_HEADING_ID} />
    </div>
  );
}
