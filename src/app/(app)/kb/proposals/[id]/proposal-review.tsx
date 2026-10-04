"use client";

// The review page's client part (UI-SPEC Surface 3, AIDA-18, D-06, D-15). The server page has
// already checked the member row and the owner or admin role (D-01) and rendered the header and
// notices; this component renders the status-specific content, the Sources card and the action
// bar.
//
// Every action outcome (save here) goes through resolveActionOutcome of plan 12.2-06: the
// component applies the message, the disabled state and the focus target it returns and never
// compares a result code itself (UI-SPEC amendment A4, review C6). A rejected call is caught as
// { rejected: true } and resolves to the same view as an unexpected server error.
//
// The preview is the stored body rendered by renderMarkdown on the server (T-12.2-40); the raw
// body is only ever shown inside the Textarea. The client check validateDraftFields renders the
// body only to read its URL attribute values and never inserts that HTML (review P8).

import { Loader2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { saveProposalAction } from "@/app/(app)/kb/proposals/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  APPROVE_AND_PUBLISH_CTA,
  BODY_HELP,
  BODY_LABEL,
  fieldRefusalCopy,
  PREVIEW_TOGGLE,
  PUBLISH_UNAVAILABLE_UNSAVED,
  REJECT_TRIGGER,
  RELOAD_BUTTON,
  SAVE_DRAFT_CTA,
  SAVE_PENDING,
  TITLE_HELP,
  TITLE_LABEL,
} from "@/lib/kb/proposal-copy";
import {
  type ActionOutcome,
  type OutcomeView,
  resolveActionOutcome,
} from "@/lib/kb/proposal-outcome";
import type { ProposalReviewData } from "@/lib/kb/proposal-queries";
import { type DraftField, validateDraftFields } from "@/lib/kb/proposal-schema";
import { cn } from "@/lib/utils";

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

  if (proposal.status === "DRAFT") {
    return (
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
  }

  return (
    <div className="min-w-0 space-y-4">
      {proposal.title && (
        <h2 className="text-[15px] font-semibold tracking-tight text-foreground">
          {proposal.title}
        </h2>
      )}
      {previewHtml && <RenderedBody html={previewHtml} />}
    </div>
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
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
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
      </div>

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

      <div className="sticky bottom-0 -mx-6 -mb-6 border-t border-border/70 bg-background/80 px-6 py-4 backdrop-blur-sm">
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
      </div>
    </>
  );
}
