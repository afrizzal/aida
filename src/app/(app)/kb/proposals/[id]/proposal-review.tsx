"use client";

// The review page's client part (UI-SPEC Surface 3, AIDA-18, D-06, D-15). The server page has
// already checked the member row and the owner or admin role (D-01) and rendered the header and
// notices; this component renders the status-specific content, the Sources card and the action
// bar.
//
// Every action outcome (save, restart, retry indexing here; publish and reject in their dialogs)
// goes through resolveActionOutcome of plan 12.2-06: the component applies the message, the
// disabled state and the focus target it returns and never compares a result code itself (UI-SPEC
// amendment A4, review C6). A rejected call is caught as { rejected: true } and resolves to the
// same view as an unexpected server error.
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
import { takeStartedProposal } from "@/lib/kb/proposal-arrival";
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
import { classifyVersionChange, isAwaitingSavedVersion } from "@/lib/kb/proposal-editor";
import {
  type ActionOutcome,
  finishedAsDraft,
  type OutcomeTone,
  type OutcomeView,
  resolveActionOutcome,
} from "@/lib/kb/proposal-outcome";
import type { ProposalReviewData } from "@/lib/kb/proposal-queries";
import { type DraftField, validateDraftFields } from "@/lib/kb/proposal-schema";
import { cn } from "@/lib/utils";
import { ProposalSourcesCard } from "./proposal-sources-card";
import { PublishDialog } from "./publish-dialog";
import { RejectDialog } from "./reject-dialog";

export interface ProposalReviewProps {
  proposal: ProposalReviewData;
  /**
   * The stored body rendered on the server by renderMarkdownPreview (renderMarkdown plus the
   * removal of every image source that is not same-origin relative, run decision K54); empty when
   * there is no body.
   */
  previewHtml: string;
  /** The distinct link targets of previewHtml, for the publish dialog (amendment A7, b-WR-07). */
  linkTargets: readonly string[];
  /** The id of the page h1 (tabIndex -1) that takes focus after save, publish, reject, reload. */
  headingId: string;
}

const FOCUS_RING =
  "rounded-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none";

/**
 * Review b-IN-04: a control that is unavailable for a stated reason stays focusable
 * (aria-disabled, never native disabled) so its aria-describedby reason is announced; its onClick
 * returns early. The look matches a natively disabled button.
 */
const ARIA_DISABLED = "aria-disabled:cursor-not-allowed aria-disabled:opacity-50";

export function ProposalReview({
  proposal,
  previewHtml,
  linkTargets,
  headingId,
}: ProposalReviewProps) {
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

  // UI-SPEC 3i "Start success → the review page <h1> after navigation" (review b-WR-05): only
  // when the Start dialog marked this proposal; a normal visit keeps document order.
  useEffect(() => {
    if (takeStartedProposal(proposal.id)) focusHeading();
  }, [proposal.id, focusHeading]);

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
          // Review b-WR-02: only a reload starts the editor again. The editor's own save keeps
          // the instance, so typing after a save survives the refresh; another version arriving
          // with a reload is taken over inside the editor.
          key={reloadCount}
          proposal={proposal}
          previewHtml={previewHtml}
          linkTargets={linkTargets}
          onFocusHeading={requestHeadingFocus}
          onFocusHeadingNow={focusHeading}
          onReload={reload}
        />
      );
      break;
    case "GENERATING":
      content = (
        <GeneratingView
          // A reload starts the view again, which clears a lock left by an unknown outcome.
          key={reloadCount}
          proposal={proposal}
          onFocusHeading={focusHeading}
          onReload={reload}
        />
      );
      break;
    case "FAILED":
      content = <FailedView proposal={proposal} />;
      break;
    case "REJECTED":
      content = <RejectedView proposal={proposal} previewHtml={previewHtml} />;
      break;
    case "PUBLISHED":
      content = (
        <PublishedView
          key={reloadCount}
          proposal={proposal}
          previewHtml={previewHtml}
          onReload={reload}
        />
      );
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
 * announces it when the proposal goes from GENERATING to DRAFT while the page is open. A proposal
 * that ended FAILED did not finish drafting and is not announced (review b-IN-05).
 */
function GenerationFinishedAnnouncer({ status }: { status: ProposalStatus }) {
  const previous = useRef(status);
  const [announcement, setAnnouncement] = useState("");

  useEffect(() => {
    const was = previous.current;
    previous.current = status;
    if (finishedAsDraft(was, status)) {
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
  linkTargets: readonly string[];
  /** The h1 now and again after the refresh (publish, reject: the editor goes away). */
  onFocusHeading(): void;
  /** The h1 now only (save success: the editor stays, review b-WR-02). */
  onFocusHeadingNow(): void;
  onReload(): void;
}

/**
 * UI-SPEC 3c, 3e DRAFT, 3h: the editor and its action bar. Save never publishes (D-15); "Approve
 * and publish…" is disabled while the form is dirty, so only the saved version is published
 * (Assumption 5).
 */
function DraftEditor({
  proposal,
  previewHtml,
  linkTargets,
  onFocusHeading,
  onFocusHeadingNow,
  onReload,
}: DraftEditorProps) {
  const router = useRouter();
  const form = useForm<DraftValues>({
    defaultValues: { title: proposal.title ?? "", bodyMarkdown: proposal.bodyMarkdown ?? "" },
  });
  const { errors, isDirty, dirtyFields } = form.formState;
  const [version, setVersion] = useState(proposal.version);
  const seenVersion = useRef(proposal.version);
  const [saving, setSaving] = useState(false);
  const [callout, setCallout] = useState<OutcomeView | null>(null);
  const [saveLocked, setSaveLocked] = useState(false);
  const [preview, setPreview] = useState(false);
  const [fieldToFocus, setFieldToFocus] = useState<DraftField | null>(null);
  const calloutRef = useRef<HTMLDivElement>(null);
  const [publishOpen, setPublishOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const publishTriggerRef = useRef<HTMLButtonElement>(null);
  const rejectTriggerRef = useRef<HTMLButtonElement>(null);

  const formId = useId();
  const titleId = useId();
  const titleHelpId = useId();
  const titleErrorId = useId();
  const bodyId = useId();
  const bodyHelpId = useId();
  const bodyErrorId = useId();
  const unsavedReasonId = useId();

  // Review b-WR-02: the server props of a new version. When they are the version this editor
  // just saved, the stored (trimmed) values become the form's defaults and any field typed since
  // the save keeps its value. Any other version (another admin's save, read by a reload) replaces
  // the form, as the reload asked.
  useEffect(() => {
    const change = classifyVersionChange({
      seen: seenVersion.current,
      incoming: proposal.version,
      local: version,
    });
    if (change === "none") return;
    seenVersion.current = proposal.version;
    const stored = { title: proposal.title ?? "", bodyMarkdown: proposal.bodyMarkdown ?? "" };
    if (change === "ownSave") {
      form.reset(stored, { keepDirtyValues: true });
      return;
    }
    form.reset(stored);
    setVersion(proposal.version);
  }, [proposal.version, proposal.title, proposal.bodyMarkdown, version, form]);

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
      // Only now: the editor stays mounted through the refresh (review b-WR-02), so focus is not
      // taken again from a field the admin has moved to since.
      onFocusHeadingNow();
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
  // Review b-WR-02: from a save until the refreshed server props carry the saved version, the
  // preview HTML and the publish dialog's data are those of the previous version, so Preview and
  // "Approve and publish…" wait for them.
  const awaitingSavedVersion = isAwaitingSavedVersion({
    propsVersion: proposal.version,
    local: version,
  });
  const saveDisabled = !isDirty || saving || saveLocked;
  const publishDisabled = isDirty || saving || awaitingSavedVersion;
  const previewDisabled = bodyDirty || saving || awaitingSavedVersion;

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
                className={cn("text-[13px]", ARIA_DISABLED)}
                aria-pressed={preview}
                // The preview shows the stored body, so it waits for a save while the body has
                // unsaved edits.
                aria-disabled={previewDisabled ? true : undefined}
                aria-describedby={bodyDirty ? unsavedReasonId : undefined}
                onClick={() => {
                  if (previewDisabled) return;
                  setPreview((on) => !on);
                }}
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
            ref={rejectTriggerRef}
            type="button"
            variant="outline"
            size="sm"
            className="text-[13px]"
            disabled={saving}
            onClick={() => setRejectOpen(true)}
          >
            <X className="size-4" aria-hidden="true" />
            {REJECT_TRIGGER}
          </Button>
          <Button
            ref={publishTriggerRef}
            type="button"
            size="sm"
            className={cn("text-[13px]", ARIA_DISABLED)}
            aria-disabled={publishDisabled ? true : undefined}
            aria-describedby={isDirty ? unsavedReasonId : undefined}
            onClick={() => {
              if (publishDisabled) return;
              setPublishOpen(true);
            }}
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

      <PublishDialog
        open={publishOpen}
        onOpenChange={setPublishOpen}
        proposalId={proposal.id}
        expectedVersion={version}
        // The form is clean whenever the dialog can open, so its title is the saved one.
        title={form.getValues("title").trim()}
        // The saved body's targets: publish waits for the props of the saved version (b-WR-02).
        linkTargets={linkTargets}
        returnFocusRef={publishTriggerRef}
        onFocusHeading={onFocusHeading}
        onReload={onReload}
      />
      <RejectDialog
        open={rejectOpen}
        onOpenChange={setRejectOpen}
        proposalId={proposal.id}
        expectedVersion={version}
        returnFocusRef={rejectTriggerRef}
        onFocusHeading={onFocusHeading}
        onReload={onReload}
      />
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
 * AI is off (D-09). The button is not a DialogTrigger, so Radix has no trigger to return focus
 * to: an explicit onCloseAutoFocus sends it back here when the dialog closes without starting
 * (UI-SPEC 3i, review b-WR-05, as 12 UI-WR-03).
 */
function NewProposalAction({ proposal }: { proposal: ProposalReviewData }) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const reasonId = useId();
  const ticketIds = proposal.sources.map((source) => source.ticketId);

  return (
    <ActionBar>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          ref={buttonRef}
          type="button"
          variant="outline"
          size="sm"
          className={cn("text-[13px]", ARIA_DISABLED)}
          aria-disabled={proposal.aiEnabled ? undefined : true}
          aria-describedby={proposal.aiEnabled ? undefined : reasonId}
          onClick={() => {
            if (!proposal.aiEnabled) return;
            setOpen(true);
          }}
        >
          {NEW_PROPOSAL_BUTTON}
        </Button>
      </div>
      {!proposal.aiEnabled && (
        <p id={reasonId} className="mt-1 text-[12px] text-muted-foreground">
          {ENTRY_UNAVAILABLE_AI_OFF}
        </p>
      )}
      <StartProposalDialog
        open={open}
        onOpenChange={setOpen}
        ticketIds={ticketIds}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          buttonRef.current?.focus();
        }}
      />
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
 * The role=alert line under "Restart generation" or "Retry indexing" (UI-SPEC 3i), with "Reload
 * proposal" when the row asks for a reload (an unknown outcome, review b-WR-03).
 */
function OutcomeAlertLine({ view, onReload }: { view: OutcomeView; onReload(): void }) {
  return (
    <div role="alert" className="space-y-2">
      <p className="text-[12px] text-destructive">{view.message}</p>
      {view.offerReload && (
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
  onReload,
}: {
  proposal: ProposalReviewData;
  onFocusHeading(): void;
  onReload(): void;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [locked, setLocked] = useState(false);
  const [alertLine, setAlertLine] = useState<OutcomeView | null>(null);
  // Amendment A3: kept here, outside the stuck notice, until the proposal leaves GENERATING
  // (this view unmounts) or the page reloads.
  const [restartLine, setRestartLine] = useState<StatusLine | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const lineRef = useRef<HTMLParagraphElement>(null);
  const pressed = useRef(false);
  const wasStuck = useRef(proposal.stuck);
  // Review b-WR-06: a restart succeeded; the button stays aria-disabled until the refreshed
  // props say the proposal is no longer stuck, so a second press cannot meet NOT_STUCK.
  const [restarted, setRestarted] = useState(false);

  useEffect(() => {
    if (!proposal.stuck) setRestarted(false);
  }, [proposal.stuck]);

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
    if (pending || locked || restarted) return;
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
      // Review b-WR-06: show the restarted state now rather than at the next poll.
      setRestarted(true);
      router.refresh();
    } else {
      setRestartLine(null);
      setAlertLine(view);
      if (view.disableSubmit) setLocked(true);
    }
    // UI-SPEC 3i: the pressed button keeps focus (it stays focusable while aria-disabled).
    buttonRef.current?.focus();
  }

  const unavailable = pending || locked || restarted;

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
            className={cn("text-[13px]", ARIA_DISABLED)}
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
          {alertLine?.message && <OutcomeAlertLine view={alertLine} onReload={onReload} />}
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
  onReload,
}: {
  proposal: ProposalReviewData;
  previewHtml: string;
  onReload(): void;
}) {
  const router = useRouter();
  const { article } = proposal;
  const [pending, setPending] = useState(false);
  const [locked, setLocked] = useState(false);
  const [alertLine, setAlertLine] = useState<OutcomeView | null>(null);
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
    setAlertLine(view);
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
              className={cn("text-[13px]", ARIA_DISABLED)}
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
            {alertLine?.message && <OutcomeAlertLine view={alertLine} onReload={onReload} />}
          </div>
        )}

        {retryOutcomeLine && <OutcomeStatusLine line={retryOutcomeLine} lineRef={lineRef} />}
      </div>

      <ReadOnlyArticle title={proposal.title} previewHtml={previewHtml} />
    </ReviewGrid>
  );
}
