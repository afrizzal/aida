"use client";

// The review page's client part (UI-SPEC Surface 3, AIDA-18, D-06, D-15). The server page has
// already checked the member row and the owner or admin role (D-01) and rendered the header and
// notices; this component renders the status-specific content, the Sources card and the action
// bar.
//
// Every action outcome (save, restart, retry indexing) goes through resolveActionOutcome of plan 12.2-06: the
// component applies the message, the disabled state and the focus target it returns and never
// compares a result code itself (UI-SPEC amendment A4, review C6). A rejected call is caught as
// { rejected: true } and resolves to the same view as an unexpected server error.
//
// The preview is the stored body rendered by renderMarkdown on the server (T-12.2-40); the raw
// body is only ever shown inside the Textarea. The client check validateDraftFields renders the
// body only to read its URL attribute values and never inserts that HTML (review P8).

import { Check, CircleAlert, Loader2, RotateCw, TriangleAlert, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import {
  restartGenerationAction,
  retryIndexingAction,
  saveProposalAction,
} from "@/app/(app)/kb/proposals/actions";
import { KbEmbeddingStatusChip } from "@/components/kb/kb-embedding-status-chip";
import { StartProposalDialog } from "@/components/kb/start-proposal-dialog";
import { LocalDateTime } from "@/components/tickets/local-date-time";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { PROPOSAL_POLL_INTERVAL_MS, type ProposalStatus } from "@/lib/kb/proposal-contract";
import {
  APPROVE_AND_PUBLISH_CTA,
  BODY_HELP,
  BODY_LABEL,
  ENTRY_UNAVAILABLE_AI_OFF,
  FAILURE_UNKNOWN,
  failureFullCopy,
  fieldRefusalCopy,
  GENERATING_BODY,
  GENERATION_FINISHED_ANNOUNCEMENT,
  NEW_PROPOSAL_BUTTON,
  OPEN_ARTICLE,
  PREVIEW_TOGGLE,
  PUBLISH_UNAVAILABLE_UNSAVED,
  publishedNotice,
  REJECT_TRIGGER,
  RELOAD_BUTTON,
  RESTART_GENERATION,
  RESTART_RECORDED_NOT_STARTED,
  RETRY_INDEXING,
  RETRY_INDEXING_PENDING_HINT,
  RETRY_INDEXING_PENDING_LABEL,
  rejectedNotice,
  SAVE_DRAFT_CTA,
  SAVE_PENDING,
  STUCK_NOTICE,
  TITLE_HELP,
  TITLE_LABEL,
} from "@/lib/kb/proposal-copy";
import {
  type ActionOutcome,
  type OutcomeTone,
  type OutcomeView,
  resolveActionOutcome,
} from "@/lib/kb/proposal-outcome";
import type { ProposalReviewData } from "@/lib/kb/proposal-queries";
import { type DraftField, validateDraftFields } from "@/lib/kb/proposal-schema";
import { cn } from "@/lib/utils";
import { ProposalSourcesCard } from "./proposal-sources-card";

export interface ProposalReviewProps {
  proposal: ProposalReviewData;
  /** The stored body rendered by renderMarkdown on the server; empty when there is no body. */
  previewHtml: string;
  /** The id of the page h1 (tabIndex -1) that takes focus after save, publish, reject, reload. */
  headingId: string;
}

const FOCUS_RING =
  "rounded-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none";

export function ProposalReview({ proposal, previewHtml, headingId }: ProposalReviewProps) {
  const router = useRouter();
  const [reloadCount, setReloadCount] = useState(0);
  const headingFocusPending = useRef(false);

  const focusHeading = useCallback(() => {
    document.getElementById(headingId)?.focus();
  }, [headingId]);

  /** UI-SPEC 3i: the h1 now, and again once the refresh has rendered the new state. */
  const requestHeadingFocus = useCallback(() => {
    headingFocusPending.current = true;
    focusHeading();
  }, [focusHeading]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the refreshed proposal or a reload arrives
  useEffect(() => {
    if (!headingFocusPending.current) return;
    headingFocusPending.current = false;
    focusHeading();
  }, [proposal.status, proposal.version, reloadCount, focusHeading]);

  /** "Reload proposal": reads the proposal again and drops the local edits (UI-SPEC 3h). */
  const reload = useCallback(() => {
    setReloadCount((count) => count + 1);
    router.refresh();
    requestHeadingFocus();
  }, [router, requestHeadingFocus]);

  let content: ReactNode;
  switch (proposal.status) {
    case "DRAFT":
      content = (
        <DraftEditor
          // A new version (after a save, or another admin's save picked up by a reload) or a
          // reload starts the editor again from the stored title and body.
          key={`${proposal.version}:${reloadCount}`}
          proposal={proposal}
          previewHtml={previewHtml}
          onFocusHeading={requestHeadingFocus}
          onReload={reload}
        />
      );
      break;
    case "GENERATING":
      content = <GeneratingView proposal={proposal} onFocusHeading={focusHeading} />;
      break;
    case "FAILED":
      content = <FailedView proposal={proposal} />;
      break;
    case "REJECTED":
      content = <RejectedView proposal={proposal} previewHtml={previewHtml} />;
      break;
    case "PUBLISHED":
      content = <PublishedView proposal={proposal} previewHtml={previewHtml} />;
      break;
  }

  return (
    <>
      <GenerationFinishedAnnouncer status={proposal.status} />
      {content}
    </>
  );
}

/** The two-column grid of UI-SPEC 3b: status content on the left, the Sources card right. */
function ReviewGrid({
  sources,
  children,
}: {
  sources: ProposalReviewData["sources"];
  children: ReactNode;
}) {
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="min-w-0 space-y-4">{children}</div>
      <div className="min-w-0 lg:self-start">
        <ProposalSourcesCard sources={sources} />
      </div>
    </div>
  );
}

/** The sticky action bar of UI-SPEC 3b and 3e. */
function ActionBar({ children }: { children: ReactNode }) {
  return (
    <div className="sticky bottom-0 -mx-6 -mb-6 border-t border-border/70 bg-background/80 px-6 py-4 backdrop-blur-sm">
      {children}
    </div>
  );
}

/**
 * UI-SPEC 3i "Generation finished (polling)": focus is not moved; a polite live region
 * announces it when the proposal leaves GENERATING while the page is open.
 */
function GenerationFinishedAnnouncer({ status }: { status: ProposalStatus }) {
  const previous = useRef(status);
  const [announcement, setAnnouncement] = useState("");

  useEffect(() => {
    const was = previous.current;
    previous.current = status;
    if (was === "GENERATING" && status !== "GENERATING") {
      setAnnouncement(GENERATION_FINISHED_ANNOUNCEMENT);
    }
  }, [status]);

  return (
    <div aria-live="polite" aria-atomic="true" className="sr-only">
      {announcement}
    </div>
  );
}

const TIME_MARK = "\u0000time\u0000";
const NAME_MARK = "\u0000name\u0000";

/**
 * A copy row with a name and a time (Rejected notice, Published notice) rendered verbatim with
 * the time through LocalDateTime. A user without a row has a null name, which is omitted (plan
 * 12.2-08 decision); a missing time is omitted too. No copy is invented for either case.
 */
function NameTimeCopy({
  make,
  name,
  at,
}: {
  make(name: string, time: string): string;
  name: string | null;
  at: Date | null;
}) {
  let text = make(name ?? NAME_MARK, TIME_MARK);
  if (name === null) text = text.replace(` by ${NAME_MARK}`, "");
  if (at === null) text = text.replace(` · ${TIME_MARK}`, "");
  const [before = "", after = ""] = text.split(TIME_MARK);
  return (
    <span>
      {before}
      {at && <LocalDateTime value={at} />}
      {after}
    </span>
  );
}

/** The server-rendered body (renderMarkdown output only, never the raw body; T-12.2-40). */
function RenderedBody({ html }: { html: string }) {
  return (
    <div
      className="min-w-0 space-y-3 text-[13px] leading-relaxed text-foreground"
      // biome-ignore lint/security/noDangerouslySetInnerHtml: renderMarkdown output from the server, sanitized there
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

// --- DRAFT ---------------------------------------------------------------------------------------

interface DraftValues {
  title: string;
  bodyMarkdown: string;
}

interface DraftEditorProps {
  proposal: ProposalReviewData;
  previewHtml: string;
  onFocusHeading(): void;
  onReload(): void;
}

/**
 * UI-SPEC 3c, 3e DRAFT, 3h: the editor and its action bar. Save never publishes (D-15); "Approve
 * and publish…" is disabled while the form is dirty, so only the saved version is published
 * (Assumption 5).
 */
function DraftEditor({ proposal, previewHtml, onFocusHeading, onReload }: DraftEditorProps) {
  const router = useRouter();
  const form = useForm<DraftValues>({
    defaultValues: { title: proposal.title ?? "", bodyMarkdown: proposal.bodyMarkdown ?? "" },
  });
  const { errors, isDirty, dirtyFields } = form.formState;
  const [version, setVersion] = useState(proposal.version);
  const [saving, setSaving] = useState(false);
  const [callout, setCallout] = useState<OutcomeView | null>(null);
  const [saveLocked, setSaveLocked] = useState(false);
  const [preview, setPreview] = useState(false);
  const [fieldToFocus, setFieldToFocus] = useState<DraftField | null>(null);
  const calloutRef = useRef<HTMLDivElement>(null);

  const formId = useId();
  const titleId = useId();
  const titleHelpId = useId();
  const titleErrorId = useId();
  const bodyId = useId();
  const bodyHelpId = useId();
  const bodyErrorId = useId();
  const unsavedReasonId = useId();

  // UI-SPEC 3i "Save refusal / conflict / rejected call": the callout takes focus.
  useEffect(() => {
    if (callout) calloutRef.current?.focus();
  }, [callout]);

  // UI-SPEC 3i "Field error": the first invalid field, once the Textarea is shown again.
  useEffect(() => {
    if (!fieldToFocus || (fieldToFocus === "bodyMarkdown" && preview)) return;
    form.setFocus(fieldToFocus);
    setFieldToFocus(null);
  }, [fieldToFocus, preview, form]);

  function showFieldError(field: DraftField, message: string) {
    form.setError(field, { type: "refusal", message });
    if (field === "bodyMarkdown") setPreview(false);
    setFieldToFocus(field);
  }

  async function onSave(values: DraftValues) {
    setCallout(null);
    form.clearErrors();
    // The client check (the server re-validates): the same validator save and publish use, so a
    // title marker or title ticket link shows under Title and a body marker or ticket link under
    // Body (amendment A2, reviews C7 and R2-2, run decision K51).
    const check = validateDraftFields(values);
    if (!check.ok) {
      showFieldError(check.field, fieldRefusalCopy(check.field, check.code));
      return;
    }

    setSaving(true);
    let outcome: ActionOutcome;
    let savedVersion: number | null = null;
    try {
      const result = await saveProposalAction({
        proposalId: proposal.id,
        expectedVersion: version,
        title: values.title,
        bodyMarkdown: values.bodyMarkdown,
      });
      outcome = result;
      if (result.ok) savedVersion = result.version;
    } catch {
      outcome = { rejected: true };
    }
    setSaving(false);

    const view = resolveActionOutcome("save", outcome);
    if (view.kind === "success") {
      if (view.message) toast.success(view.message);
      if (savedVersion !== null) setVersion(savedVersion);
      form.reset(values);
      router.refresh();
      // "Save draft" is disabled now (the form is clean), so focus goes to the h1 (UI-SPEC 3i).
      onFocusHeading();
      return;
    }
    if (view.kind === "field" && view.field && view.message) {
      showFieldError(view.field, view.message);
      return;
    }
    // Conflict, other refusals, a rejected call and an unexpected error: the callout, with Save
    // disabled until reload when the resolver says so; the local edits stay in the fields.
    if (view.disableSubmit) setSaveLocked(true);
    setCallout(view);
  }

  const bodyDirty = dirtyFields.bodyMarkdown === true;
  const saveDisabled = !isDirty || saving || saveLocked;
  const publishDisabled = isDirty || saving;

  return (
    <>
      <ReviewGrid sources={proposal.sources}>
        <form id={formId} onSubmit={form.handleSubmit(onSave)} className="min-w-0 space-y-4">
          <div className="space-y-1">
            <Label htmlFor={titleId} className="text-[13px] font-semibold">
              {TITLE_LABEL}
            </Label>
            <Input
              id={titleId}
              className="text-[13px]"
              readOnly={saving}
              aria-invalid={errors.title ? true : undefined}
              aria-describedby={errors.title ? `${titleHelpId} ${titleErrorId}` : titleHelpId}
              {...form.register("title")}
            />
            <p id={titleHelpId} className="text-[12px] text-muted-foreground">
              {TITLE_HELP}
            </p>
            {errors.title?.message && (
              <p id={titleErrorId} className="text-[12px] text-destructive">
                {errors.title.message}
              </p>
            )}
          </div>

          <div className="space-y-1">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Label htmlFor={bodyId} className="text-[13px] font-semibold">
                {BODY_LABEL}
              </Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="text-[13px]"
                aria-pressed={preview}
                // The preview shows the stored body, so it waits for a save while the body has
                // unsaved edits.
                disabled={bodyDirty || saving}
                aria-describedby={bodyDirty ? unsavedReasonId : undefined}
                onClick={() => setPreview((on) => !on)}
              >
                {PREVIEW_TOGGLE}
              </Button>
            </div>
            <div hidden={preview}>
              <Textarea
                id={bodyId}
                className="min-h-[360px] max-h-[640px] overflow-y-auto font-mono text-[13px]"
                readOnly={saving}
                aria-invalid={errors.bodyMarkdown ? true : undefined}
                aria-describedby={errors.bodyMarkdown ? `${bodyHelpId} ${bodyErrorId}` : bodyHelpId}
                {...form.register("bodyMarkdown")}
              />
            </div>
            {preview && (
              <div className="min-h-[360px] rounded-lg border border-border/70 p-4">
                <RenderedBody html={previewHtml} />
              </div>
            )}
            <p id={bodyHelpId} className="text-[12px] text-muted-foreground">
              {BODY_HELP}
            </p>
            {errors.bodyMarkdown?.message && (
              <p id={bodyErrorId} className="text-[12px] text-destructive">
                {errors.bodyMarkdown.message}
              </p>
            )}
          </div>
        </form>
      </ReviewGrid>

      {callout?.message && (
        <div
          ref={calloutRef}
          role="alert"
          tabIndex={-1}
          className={cn(
            FOCUS_RING,
            "space-y-2 rounded-lg border border-destructive/20 bg-destructive/10 p-4 text-[13px] text-destructive",
          )}
        >
          <p>{callout.message}</p>
          {callout.offerReload && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="text-[13px]"
              onClick={onReload}
            >
              {RELOAD_BUTTON}
            </Button>
          )}
        </div>
      )}

      <ActionBar>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="submit"
            form={formId}
            variant={isDirty && !saveLocked ? "default" : "outline"}
            size="sm"
            className="text-[13px]"
            disabled={saveDisabled}
          >
            {saving ? (
              <>
                <Loader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />
                {SAVE_PENDING}
              </>
            ) : (
              SAVE_DRAFT_CTA
            )}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="text-[13px]"
            disabled={saving}
          >
            <X className="size-4" aria-hidden="true" />
            {REJECT_TRIGGER}
          </Button>
          <Button
            type="button"
            size="sm"
            className="text-[13px]"
            disabled={publishDisabled}
            aria-describedby={isDirty ? unsavedReasonId : undefined}
          >
            {APPROVE_AND_PUBLISH_CTA}
          </Button>
        </div>
        {isDirty && (
          <p id={unsavedReasonId} className="mt-1 text-[12px] text-muted-foreground">
            {PUBLISH_UNAVAILABLE_UNSAVED}
          </p>
        )}
      </ActionBar>
    </>
  );
}

// --- Read-only views -----------------------------------------------------------------------------

/** The stored title and the server-rendered body, read-only (REJECTED, PUBLISHED). */
function ReadOnlyArticle({ title, previewHtml }: { title: string | null; previewHtml: string }) {
  return (
    <div className="space-y-2">
      {title && (
        <h2 className="text-[15px] font-semibold tracking-tight text-foreground">{title}</h2>
      )}
      {previewHtml && (
        <div className="rounded-lg border border-border/70 p-4">
          <RenderedBody html={previewHtml} />
        </div>
      )}
    </div>
  );
}

/**
 * "Start a new proposal" (UI-SPEC 3e FAILED and REJECTED, D-16): opens the Start dialog with the
 * same tickets; regeneration always creates a new proposal. Disabled with the AI-off reason when
 * AI is off (D-09). The dialog returns focus to this button when it closes without starting.
 */
function NewProposalAction({ proposal }: { proposal: ProposalReviewData }) {
  const [open, setOpen] = useState(false);
  const reasonId = useId();
  const ticketIds = proposal.sources.map((source) => source.ticketId);

  return (
    <ActionBar>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="text-[13px]"
          disabled={!proposal.aiEnabled}
          aria-describedby={proposal.aiEnabled ? undefined : reasonId}
          onClick={() => setOpen(true)}
        >
          {NEW_PROPOSAL_BUTTON}
        </Button>
      </div>
      {!proposal.aiEnabled && (
        <p id={reasonId} className="mt-1 text-[12px] text-muted-foreground">
          {ENTRY_UNAVAILABLE_AI_OFF}
        </p>
      )}
      <StartProposalDialog open={open} onOpenChange={setOpen} ticketIds={ticketIds} />
    </ActionBar>
  );
}

/** UI-SPEC 3e FAILED: the destructive "Failure: …" row for its code; read-only, no editor. */
function FailedView({ proposal }: { proposal: ProposalReviewData }) {
  return (
    <>
      <ReviewGrid sources={proposal.sources}>
        <div className="flex items-start gap-2 rounded-lg border border-destructive/20 bg-destructive/10 p-4 text-[13px] text-destructive">
          <CircleAlert className="size-4 shrink-0" aria-hidden="true" />
          <span>
            {proposal.failureCode ? failureFullCopy(proposal.failureCode) : FAILURE_UNKNOWN}
          </span>
        </div>
      </ReviewGrid>
      <NewProposalAction proposal={proposal} />
    </>
  );
}

/** UI-SPEC 3e REJECTED: the neutral notice and the read-only draft; never a publish control. */
function RejectedView({
  proposal,
  previewHtml,
}: {
  proposal: ProposalReviewData;
  previewHtml: string;
}) {
  return (
    <>
      <ReviewGrid sources={proposal.sources}>
        <div className="flex items-start gap-2 rounded-lg border border-border bg-muted p-4 text-[13px] text-foreground">
          <X className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <NameTimeCopy
            make={rejectedNotice}
            name={proposal.rejectedByName}
            at={proposal.rejectedAt}
          />
        </div>
        <ReadOnlyArticle title={proposal.title} previewHtml={previewHtml} />
      </ReviewGrid>
      <NewProposalAction proposal={proposal} />
    </>
  );
}

// --- GENERATING ----------------------------------------------------------------------------------

interface StatusLine {
  message: string;
  tone: OutcomeTone;
}

/** A role=status outcome line that can take focus (UI-SPEC 3i [RL] rule, review P5). */
function OutcomeStatusLine({
  line,
  lineRef,
}: {
  line: StatusLine;
  lineRef: RefObject<HTMLParagraphElement | null>;
}) {
  return (
    <p
      ref={lineRef}
      role="status"
      tabIndex={-1}
      className={cn(FOCUS_RING, "flex items-start gap-2 text-[13px] text-foreground")}
    >
      {line.tone === "warning" ? (
        <TriangleAlert className="size-4 shrink-0 text-warning" aria-hidden="true" />
      ) : (
        <Check className="size-4 shrink-0 text-success" aria-hidden="true" />
      )}
      <span>{line.message}</span>
    </p>
  );
}

/**
 * UI-SPEC 3e GENERATING (Assumptions 3 and 6, D-13, review C5): skeleton lines with aria-busy,
 * router.refresh() every PROPOSAL_POLL_INTERVAL_MS, and the stuck notice with "Restart
 * generation" while the loader reports isStuck (from generationClaimedAt, else
 * generationQueuedAt). The restart outcome comes from resolveActionOutcome('restart', …).
 */
function GeneratingView({
  proposal,
  onFocusHeading,
}: {
  proposal: ProposalReviewData;
  onFocusHeading(): void;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [locked, setLocked] = useState(false);
  const [alertLine, setAlertLine] = useState<string | null>(null);
  // Amendment A3: kept here, outside the stuck notice, until the proposal leaves GENERATING
  // (this view unmounts) or the page reloads.
  const [restartLine, setRestartLine] = useState<StatusLine | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const lineRef = useRef<HTMLParagraphElement>(null);
  const pressed = useRef(false);
  const wasStuck = useRef(proposal.stuck);

  useEffect(() => {
    const timer = setInterval(() => router.refresh(), PROPOSAL_POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [router]);

  // UI-SPEC 3i [RL] rule: when a poll refresh removes the pressed "Restart generation" (the
  // proposal is no longer stuck, generationQueuedAt was just reset) and focus went with it, focus
  // moves to the outcome line or, with no line, to the h1; never to a removed or disabled control.
  useEffect(() => {
    const was = wasStuck.current;
    wasStuck.current = proposal.stuck;
    if (!was || proposal.stuck || !pressed.current) return;
    const active = document.activeElement;
    if (active && active !== document.body) return;
    if (lineRef.current) lineRef.current.focus();
    else onFocusHeading();
  }, [proposal.stuck, onFocusHeading]);

  async function handleRestart() {
    if (pending || locked) return;
    pressed.current = true;
    setPending(true);
    setAlertLine(null);
    let outcome: ActionOutcome;
    try {
      outcome = await restartGenerationAction({
        proposalId: proposal.id,
        expectedVersion: proposal.version,
      });
    } catch {
      outcome = { rejected: true };
    }
    setPending(false);

    const view = resolveActionOutcome("restart", outcome);
    if (view.kind === "success") {
      // A queued restart has no row; a restart whose send failed shows the A3 row
      // (RESTART_RECORDED_NOT_STARTED, review C5) in the role=status line.
      setRestartLine(
        view.tone === "warning"
          ? { message: view.message ?? RESTART_RECORDED_NOT_STARTED, tone: view.tone }
          : null,
      );
    } else {
      setRestartLine(null);
      setAlertLine(view.message);
      if (view.disableSubmit) setLocked(true);
    }
    // UI-SPEC 3i: the pressed button keeps focus (it stays focusable while aria-disabled).
    buttonRef.current?.focus();
  }

  const unavailable = pending || locked;

  return (
    <ReviewGrid sources={proposal.sources}>
      <div aria-busy="true" className="space-y-3 rounded-lg border border-border/70 p-4">
        <p className="text-[13px] text-muted-foreground">{GENERATING_BODY}</p>
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
        <Skeleton className="h-4 w-1/2" />
      </div>

      {proposal.stuck && (
        <div className="space-y-2 rounded-lg border border-warning/30 bg-warning/10 p-4 text-[13px] text-foreground">
          <div className="flex items-start gap-2">
            <TriangleAlert className="size-4 shrink-0 text-warning" aria-hidden="true" />
            <span>{STUCK_NOTICE}</span>
          </div>
          <Button
            ref={buttonRef}
            type="button"
            variant="outline"
            size="sm"
            className="text-[13px] aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
            aria-disabled={unavailable ? true : undefined}
            onClick={handleRestart}
          >
            {pending ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <RotateCw className="size-4" aria-hidden="true" />
            )}
            {RESTART_GENERATION}
          </Button>
          {alertLine && (
            <p role="alert" className="text-[12px] text-destructive">
              {alertLine}
            </p>
          )}
        </div>
      )}

      {restartLine && <OutcomeStatusLine line={restartLine} lineRef={lineRef} />}
    </ReviewGrid>
  );
}

// --- PUBLISHED -----------------------------------------------------------------------------------

/**
 * UI-SPEC 3e PUBLISHED with amendments A1 and A5 (reviews C2, R3-2, P5): the Published notice,
 * "Open article" and the embedding chip; "Retry indexing" while the article's embedding is not
 * COMPLETED (FAILED or PENDING), with the pending hint above it while PENDING.
 */
function PublishedView({
  proposal,
  previewHtml,
}: {
  proposal: ProposalReviewData;
  previewHtml: string;
}) {
  const router = useRouter();
  const { article } = proposal;
  const [pending, setPending] = useState(false);
  const [locked, setLocked] = useState(false);
  const [alertLine, setAlertLine] = useState<string | null>(null);
  // Review P5: kept in client state and rendered outside the button's block, so the line survives
  // the router.refresh() after a successful retry, also once the article is COMPLETED and the
  // button is gone, until the page reloads.
  const [retryOutcomeLine, setRetryOutcomeLine] = useState<StatusLine | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const lineRef = useRef<HTMLParagraphElement>(null);

  // Review P5: the line takes focus at once, because the refresh may remove the pressed button.
  useEffect(() => {
    if (retryOutcomeLine) lineRef.current?.focus();
  }, [retryOutcomeLine]);

  async function handleRetry() {
    if (pending || locked) return;
    setPending(true);
    setAlertLine(null);
    let outcome: ActionOutcome;
    try {
      outcome = await retryIndexingAction({ proposalId: proposal.id });
    } catch {
      outcome = { rejected: true };
    }
    setPending(false);

    const view = resolveActionOutcome("retryIndexing", outcome);
    if (view.kind === "success" && view.message) {
      // "Indexing restarted." for a queued send, RETRY_RECORDED_NOT_STARTED otherwise (A5).
      setRetryOutcomeLine({ message: view.message, tone: view.tone });
      router.refresh();
      return;
    }
    // A refusal, a rejected call and an unexpected error: the alert line under the pressed
    // button, which keeps focus; after an unknown outcome it stays disabled until reload. No
    // refresh.
    setAlertLine(view.message);
    if (view.disableSubmit) setLocked(true);
    buttonRef.current?.focus();
  }

  const showRetry = article !== null && article.embeddingStatus !== "COMPLETED";
  const unavailable = pending || locked;

  return (
    <ReviewGrid sources={proposal.sources}>
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2 text-[13px] text-foreground">
          <Check className="size-4 shrink-0 text-success" aria-hidden="true" />
          <NameTimeCopy
            make={publishedNotice}
            name={proposal.publishedByName}
            at={proposal.publishedAt}
          />
          {article && (
            <Link href={`/kb/${article.id}`} className="text-primary-emphasis hover:underline">
              {OPEN_ARTICLE}
            </Link>
          )}
          {article && <KbEmbeddingStatusChip status={article.embeddingStatus} />}
        </div>

        {showRetry && (
          <div className="space-y-1">
            {article.embeddingStatus === "PENDING" && (
              <p className="text-[12px] text-muted-foreground">{RETRY_INDEXING_PENDING_HINT}</p>
            )}
            <Button
              ref={buttonRef}
              type="button"
              variant="outline"
              size="sm"
              className="text-[13px] aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
              aria-disabled={unavailable ? true : undefined}
              onClick={handleRetry}
            >
              {pending ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  {RETRY_INDEXING_PENDING_LABEL}
                </>
              ) : (
                <>
                  <RotateCw className="size-4" aria-hidden="true" />
                  {RETRY_INDEXING}
                </>
              )}
            </Button>
            {alertLine && (
              <p role="alert" className="text-[12px] text-destructive">
                {alertLine}
              </p>
            )}
          </div>
        )}

        {retryOutcomeLine && <OutcomeStatusLine line={retryOutcomeLine} lineRef={lineRef} />}
      </div>

      <ReadOnlyArticle title={proposal.title} previewHtml={previewHtml} />
    </ReviewGrid>
  );
}
