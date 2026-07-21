"use client";

import { Lock, Paperclip } from "lucide-react";
import { useRouter } from "next/navigation";
import { type ChangeEvent, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { AttachmentChip, formatBytes } from "@/components/tickets/attachment-chip";
import { type ComposerMode, ComposerToggle } from "@/components/tickets/composer-toggle";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ALLOWED_MIME, MAX_BYTES } from "@/lib/attachments/constants";
import { cn } from "@/lib/utils";

interface ComposerProps {
  ticketId: string;
  /** Draft markdown to load into the body (AIDA-16 — set by TicketReplyArea's Insert action). */
  insertedText?: string | null;
  /** Called once insertedText has been consumed (loaded into body) so the parent can clear it. */
  onInsertedConsumed?: () => void;
}

export function Composer({ ticketId, insertedText, onInsertedConsumed }: ComposerProps) {
  const router = useRouter();
  const [mode, setMode] = useState<ComposerMode>("public");
  const [body, setBody] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  // True only when the current body originated from an inserted AI draft (AIDA-16) — used to
  // stamp the outgoing send with a `fromDraft` flag so the messages route can record the
  // DRAFT_APPROVED audit event. Never set for a manually-typed reply.
  const [fromDraft, setFromDraft] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isInternal = mode === "internal";

  // A draft is always a customer-facing reply — loading one switches mode to "public" (even if
  // the agent happened to be on the Internal Note toggle) and marks the send as draft-originated.
  useEffect(() => {
    if (insertedText != null) {
      setBody(insertedText);
      setFromDraft(true);
      setMode("public");
      onInsertedConsumed?.();
    }
    // biome-ignore lint/correctness/useExhaustiveDependencies: only insertedText should re-trigger this effect; onInsertedConsumed is a one-shot ack callback, not reactive state
  }, [insertedText]);

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
    for (const file of files) form.append("file", file);

    try {
      const res = await fetch(`/api/tickets/${ticketId}/messages`, { method: "POST", body: form });
      if (!res.ok) throw new Error("send_failed");

      setBody("");
      setFiles([]);
      setFromDraft(false);
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
        <ComposerToggle mode={mode} onChange={setMode} />
      </div>

      <div className={cn(isInternal && "rounded-lg border border-warning/30 bg-warning/5 p-2")}>
        <Textarea
          value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder={isInternal ? "Write an internal note…" : "Write a reply…"}
          className="min-h-[96px]"
        />
      </div>

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
