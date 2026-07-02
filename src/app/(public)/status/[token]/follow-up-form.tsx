"use client";

import { Loader2, Paperclip } from "lucide-react";
import { useRouter } from "next/navigation";
import { type ChangeEvent, type FormEvent, useRef, useState } from "react";
import { HoneypotField } from "@/components/public/honeypot-field";
import { AttachmentChip, formatBytes } from "@/components/tickets/attachment-chip";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ALLOWED_MIME, MAX_BYTES } from "@/lib/attachments/constants";

interface FollowUpFormProps {
  token: string;
}

// Reduced composer for the public status page — no Public/Internal toggle (there is no
// internal-note capability on an unauthenticated route), just a message + attachments +
// honeypot, protected by the same honeypot + rate-limit as the intake form (D-20).
export function FollowUpForm({ token }: FollowUpFormProps) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const [rateLimited, setRateLimited] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (fileError) return;
    if (!body.trim() && files.length === 0) return;

    setIsSending(true);
    setRateLimited(false);
    setSendError(null);

    // The native form already carries the honeypot field (registered by name); add the
    // message body (plain state, not a form-registered input) and any selected files.
    const form = new FormData(event.currentTarget);
    form.set("message", body);
    for (const file of files) form.append("file", file);

    try {
      const res = await fetch(`/api/public/status/${token}/follow-up`, {
        method: "POST",
        body: form,
      });

      if (res.status === 429) {
        setRateLimited(true);
        return;
      }
      if (!res.ok) {
        setSendError("Couldn't send your follow-up. Try again.");
        return;
      }

      setBody("");
      setFiles([]);
      // Refetches the Server Component thread — shows the new inbound message and,
      // if it reopened the ticket, the ThreadSystemEvent row.
      router.refresh();
    } catch {
      setSendError("Couldn't send your follow-up. Try again.");
    } finally {
      setIsSending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <HoneypotField />

      <Textarea
        value={body}
        onChange={(event) => setBody(event.target.value)}
        placeholder="Write a follow-up…"
        className="min-h-[96px]"
      />

      {files.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
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

      {fileError && <p className="text-[12px] text-destructive">{fileError}</p>}

      <div className="flex items-center justify-between">
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

        <Button type="submit" disabled={isSending}>
          {isSending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Send Follow-up
        </Button>
      </div>

      {rateLimited && (
        <p className="text-[13px] text-destructive">
          You've submitted a few requests recently. Please wait a bit before trying again.
        </p>
      )}
      {sendError && <p className="text-[13px] text-destructive">{sendError}</p>}
    </form>
  );
}
