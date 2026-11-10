"use client";

import { Lock, Paperclip } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  type ChangeEvent,
  type KeyboardEvent,
  type SyntheticEvent,
  useEffect,
  useLayoutEffect,
  useReducer,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { useRegisterCommands } from "@/components/command-provider";
import { AttachmentChip, formatBytes } from "@/components/tickets/attachment-chip";
import { type ComposerMode, ComposerToggle } from "@/components/tickets/composer-toggle";
import { type MentionAria, MentionAutocomplete } from "@/components/tickets/mention-autocomplete";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ALLOWED_MIME, MAX_BYTES } from "@/lib/attachments/constants";
import type { Command } from "@/lib/commands/registry";
import {
  filterMentionCandidates,
  findMentionQuery,
  initialMentionDraft,
  type MentionCandidate,
  mentionDraftReducer,
  reconcileMentionIds,
  shouldOfferMentions,
} from "@/lib/mentions/composer-tokens";
import { cn } from "@/lib/utils";

type MembersState =
  | { status: "loading" }
  | { status: "ready"; list: MentionCandidate[] }
  | { status: "failed" };

interface ComposerProps {
  ticketId: string;
  /** Draft markdown to load into the body (AIDA-16 — set by TicketReplyArea's Insert action). */
  insertedText?: string | null;
  /** Called once insertedText has been consumed (loaded into body) so the parent can clear it. */
  onInsertedConsumed?: () => void;
}

export function Composer({ ticketId, insertedText, onInsertedConsumed }: ComposerProps) {
  const router = useRouter();
  // The whole draft (text, mode, inserted mentions, switch note, draft flag) lives in one reducer
  // (Phase 10, AIDA-45, R2-1, V-12): every text change goes through its `edit` action, so an
  // inserted member name is an atomic token, and every mode change goes through changeMode below.
  // `fromDraft` is true only when the body came from an inserted AI draft (AIDA-16): the send then
  // carries a `fromDraft` flag so the messages route records the DRAFT_APPROVED audit event.
  const [draft, dispatch] = useReducer(mentionDraftReducer, initialMentionDraft);
  const { mode, text: body, fromDraft } = draft;
  const [files, setFiles] = useState<File[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // The textarea caret when nothing is selected, else null: where a mention query is read.
  const [cursor, setCursor] = useState<number | null>(null);
  // The members the composer can mention, fetched once per mount (UI-SPEC Surface 4).
  const [members, setMembers] = useState<MembersState>({ status: "loading" });
  // The trigger "@" whose list the agent closed with Escape or an outside click.
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  // The highlighted option, for the query it was chosen in (a new query highlights the first).
  const [active, setActive] = useState<{ key: string; index: number }>({ key: "", index: 0 });
  const [mentionAria, setMentionAria] = useState<MentionAria>({ listId: null, activeId: null });

  const isInternal = mode === "internal";

  /**
   * The single mode-change path (V-12, C7): the toggle, the r and n keys and the palette commands
   * (focusComposer) all call it. A switch from internal to public replaces the text with the
   * mention strip (every inserted member name removed), clears the recorded ids and turns the
   * switch note on (mentionDraftReducer `setMode`). AI-draft insertion forces public through the
   * reducer's `loadDraft`, which also clears every span and inserted name.
   */
  function changeMode(next: ComposerMode) {
    dispatch({ type: "setMode", mode: next });
  }

  /**
   * The r and n keys and the palette's This ticket items (11-08, UI-SPEC 5c): switch the mode
   * exactly as a ComposerToggle click does, then focus the textarea with the caret at the end.
   * The text already typed is kept (in public mode without the inserted member names).
   */
  function focusComposer(next: ComposerMode) {
    changeMode(next);
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.focus();
    const end = textarea.value.length;
    textarea.setSelectionRange(end, end);
  }

  const composerCommands: Command[] = [
    {
      id: "ticket.reply",
      label: "Reply to the customer",
      group: "this-ticket",
      keywords: ["reply", "respond", "public"],
      order: 3,
      icon: "reply",
      when: (context) => context.ticketId !== null,
      run: () => focusComposer("public"),
    },
    {
      id: "ticket.note",
      label: "Write an internal note",
      group: "this-ticket",
      keywords: ["note", "internal", "private"],
      order: 4,
      icon: "sticky-note",
      when: (context) => context.ticketId !== null,
      run: () => focusComposer("internal"),
    },
  ];
  useRegisterCommands(composerCommands, [ticketId]);

  // A draft is always a customer-facing reply — loading one switches mode to "public" (even if
  // the agent happened to be on the Internal Note toggle), clears every inserted mention and marks
  // the send as draft-originated (mentionDraftReducer `loadDraft`).
  // biome-ignore lint/correctness/useExhaustiveDependencies: only insertedText should re-trigger this effect; onInsertedConsumed is a one-shot ack callback intentionally excluded, not reactive state (05-07 AI draft-insertion human-approval gate — do not add it to the deps array)
  useEffect(() => {
    if (insertedText != null) {
      dispatch({ type: "loadDraft", text: insertedText });
      onInsertedConsumed?.();
    }
  }, [insertedText]);

  // The member list, once per mount (UI-SPEC Surface 4). A failure turns the trigger off: typing @
  // then opens nothing, the @ stays typed text, the note can still be saved and no id is ever
  // recorded (E6 error).
  useEffect(() => {
    let cancelled = false;
    fetch("/api/members/mentionable", { headers: { accept: "application/json" } })
      .then(async (res) => {
        if (!res.ok) throw new Error("members_failed");
        const data = (await res.json()) as { members?: unknown };
        if (!Array.isArray(data.members)) throw new Error("members_failed");
        const list = data.members.filter(
          (m): m is MentionCandidate =>
            typeof m === "object" &&
            m !== null &&
            typeof m.id === "string" &&
            typeof m.name === "string" &&
            m.name !== "" &&
            typeof m.email === "string",
        );
        if (!cancelled) setMembers({ status: "ready", list });
      })
      .catch(() => {
        if (!cancelled) setMembers({ status: "failed" });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // After the reducer moved the caret (a removed mention, an insertion, a mode switch), put the
  // textarea's caret there; only while the textarea has focus, so a toggle click moves nothing.
  useLayoutEffect(() => {
    const { caret, text } = draft;
    const textarea = textareaRef.current;
    if (!textarea || caret === null || caret > text.length) return;
    if (document.activeElement !== textarea) return;
    if (textarea.selectionStart !== caret || textarea.selectionEnd !== caret) {
      textarea.setSelectionRange(caret, caret);
    }
    setCursor(caret);
  }, [draft]);

  // Public mode never opens the list (D-21), and neither does a failed member list.
  const mentionQuery =
    isInternal && members.status !== "failed" && cursor !== null
      ? findMentionQuery(body, cursor, draft.spans)
      : null;
  const membersLoading = members.status === "loading";
  const mentionOptions =
    mentionQuery && members.status === "ready"
      ? filterMentionCandidates(members.list, mentionQuery.query)
      : [];
  const mentionOpen =
    mentionQuery !== null &&
    mentionQuery.start !== dismissedAt &&
    (membersLoading || shouldOfferMentions(mentionQuery, mentionOptions.length));
  const activeKey = mentionQuery ? `${mentionQuery.start}:${mentionQuery.query}` : "";
  const activeIndex =
    active.key === activeKey && active.index < mentionOptions.length ? active.index : 0;
  const activeOption = mentionOpen ? (mentionOptions[activeIndex] ?? null) : null;

  // A closed list stays closed for its own "@" only: once that trigger is gone, the next opens.
  const mentionStart = mentionQuery?.start ?? null;
  useEffect(() => {
    if (dismissedAt !== null && mentionStart !== dismissedAt) setDismissedAt(null);
  }, [mentionStart, dismissedAt]);

  function pickMention(candidate: MentionCandidate) {
    if (!mentionQuery || !isInternal) return;
    dispatch({
      type: "insert",
      query: mentionQuery,
      member: { userId: candidate.id, name: candidate.name },
    });
  }

  function highlight(index: number) {
    setActive({ key: activeKey, index });
  }

  function handleAriaChange(next: MentionAria) {
    setMentionAria((prev) =>
      prev.listId === next.listId && prev.activeId === next.activeId ? prev : next,
    );
  }

  // Keys while the list is open (UI-SPEC Surface 4): ArrowUp and ArrowDown move, Enter or Tab
  // inserts the highlighted member, Escape closes and leaves the typed text. Focus never leaves
  // the textarea; with no option, Enter and Tab keep their usual meaning.
  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (!mentionOpen || !mentionQuery || event.nativeEvent.isComposing) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setDismissedAt(mentionQuery.start);
      return;
    }
    const plain = !event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey;
    const count = mentionOptions.length;
    if (!plain || count === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      highlight((activeIndex + 1) % count);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      highlight((activeIndex - 1 + count) % count);
    } else if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      const option = mentionOptions[activeIndex];
      if (option) pickMention(option);
    }
  }

  function handleTextChange(event: ChangeEvent<HTMLTextAreaElement>) {
    const { value, selectionStart, selectionEnd } = event.target;
    dispatch({ type: "edit", text: value, caret: selectionEnd });
    setCursor(selectionStart === selectionEnd ? selectionEnd : null);
  }

  function handleSelect(event: SyntheticEvent<HTMLTextAreaElement>) {
    const { selectionStart, selectionEnd } = event.currentTarget;
    setCursor(selectionStart === selectionEnd ? selectionEnd : null);
  }

  // Client-side pre-check only (UX convenience) — the server always re-validates size
  // and does real byte-sniffed MIME detection via `file-type` (never trust this).
  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(event.target.files ?? []);
    for (const file of selected) {
      if (file.size > MAX_BYTES) {
        setFileError(`"${file.name}" is larger than 10MB.`);
        return;
      }
      if (file.type && !ALLOWED_MIME.has(file.type)) {
        setFileError(`"${file.name}" is not an allowed file type.`);
        return;
      }
    }
    setFileError(null);
    setFiles((prev) => [...prev, ...selected]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function removeFile(index: number) {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSubmit() {
    if (!body.trim() && files.length === 0) return;
    setIsSending(true);

    const form = new FormData();
    form.set("mode", mode);
    form.set("body", body);
    if (fromDraft && mode === "public") form.set("fromDraft", "true");
    // Mention ids go only with an internal note (D-21): a public reply never carries the field,
    // whatever the text holds. The server re-validates every id (src/lib/mentions/mentions.ts).
    if (mode === "internal") {
      const mentionIds = reconcileMentionIds(body, draft.spans);
      if (mentionIds.length > 0) form.set("mentions", JSON.stringify(mentionIds));
    }
    for (const file of files) form.append("file", file);

    try {
      const res = await fetch(`/api/tickets/${ticketId}/messages`, { method: "POST", body: form });
      if (!res.ok) throw new Error("send_failed");

      dispatch({ type: "sent" });
      setFiles([]);
      router.refresh();
    } catch {
      toast.error(
        isInternal ? "Couldn't save your note. Try again." : "Couldn't send your reply. Try again.",
      );
    } finally {
      setIsSending(false);
    }
  }

  return (
    <div className="border-t border-border p-4">
      <div className="mb-2">
        <ComposerToggle mode={mode} onChange={changeMode} />
      </div>

      <MentionAutocomplete
        open={mentionOpen}
        loading={membersLoading}
        query={mentionQuery?.query ?? ""}
        options={mentionOptions}
        activeId={activeOption?.id ?? null}
        onActiveChange={(id) => {
          const index = mentionOptions.findIndex((option) => option.id === id);
          if (index !== -1 && index !== activeIndex) highlight(index);
        }}
        onPick={pickMention}
        onDismiss={() => {
          if (mentionQuery) setDismissedAt(mentionQuery.start);
        }}
        onAriaChange={handleAriaChange}
        anchorClassName={cn(isInternal && "rounded-lg border border-warning/30 bg-warning/5 p-2")}
      >
        <Textarea
          ref={textareaRef}
          value={body}
          onChange={handleTextChange}
          onSelect={handleSelect}
          onKeyDown={handleKeyDown}
          placeholder={isInternal ? "Write an internal note…" : "Write a reply…"}
          className="min-h-[96px]"
          {...(isInternal
            ? {
                role: "combobox",
                "aria-autocomplete": "list" as const,
                "aria-haspopup": "listbox" as const,
                "aria-expanded": mentionOpen,
                "aria-controls": mentionOpen ? (mentionAria.listId ?? undefined) : undefined,
                "aria-activedescendant":
                  mentionOpen && activeOption ? (mentionAria.activeId ?? undefined) : undefined,
              }
            : {})}
        />
      </MentionAutocomplete>

      {files.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {files.map((file, index) => (
            <AttachmentChip
              // biome-ignore lint/suspicious/noArrayIndexKey: unsent files list only grows/shrinks via append/remove, no reordering
              key={`${index}-${file.name}`}
              filename={file.name}
              sizeLabel={formatBytes(file.size)}
              onRemove={() => removeFile(index)}
            />
          ))}
        </div>
      )}

      {fileError && <p className="mt-1 text-[12px] text-destructive">{fileError}</p>}

      <div className="mt-2 flex items-center justify-between">
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={handleFileChange}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Attach file"
          onClick={() => fileInputRef.current?.click()}
        >
          <Paperclip className="size-4" />
        </Button>

        {isInternal ? (
          <Button
            type="button"
            className="border border-warning/30 bg-warning/10 text-warning hover:bg-warning/20"
            disabled={isSending}
            onClick={handleSubmit}
          >
            <Lock className="size-4" />
            Save Internal Note
          </Button>
        ) : (
          <Button type="button" disabled={isSending} onClick={handleSubmit}>
            Send Reply
          </Button>
        )}
      </div>
    </div>
  );
}
