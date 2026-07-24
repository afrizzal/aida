"use client";

import { Loader2, Star } from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { HoneypotField } from "@/components/public/honeypot-field";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

interface CsatFormProps {
  token: string;
  existingScore: number | null;
  existingComment: string | null;
}

const RATING_VALUES = [1, 2, 3, 4, 5];

// "How did we do?" — the only CSAT capture surface (no email campaigns, LOCKED). Mirrors
// FollowUpForm's shape (state/fetch/router.refresh) but posts a 1-5 score + optional
// comment and upserts one CsatResponse per ticket; prefilled so a re-submit shows the
// requester's current rating instead of a blank form.
export function CsatForm({ token, existingScore, existingComment }: CsatFormProps) {
  const router = useRouter();
  const [score, setScore] = useState<number | null>(existingScore ?? null);
  const [comment, setComment] = useState(existingComment ?? "");
  const [rateLimited, setRateLimited] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (score === null) return;

    setIsSending(true);
    setRateLimited(false);
    setSendError(null);

    // The native form already carries the honeypot field (registered by name); add the
    // rating + comment (plain state, not form-registered inputs).
    const form = new FormData(event.currentTarget);
    form.set("score", String(score));
    form.set("comment", comment);

    try {
      const res = await fetch(`/api/public/status/${token}/csat`, {
        method: "POST",
        body: form,
      });

      if (res.status === 429) {
        setRateLimited(true);
        return;
      }
      if (!res.ok) {
        setSendError("Couldn't submit your feedback. Try again.");
        return;
      }

      setSubmitted(true);
      router.refresh();
    } catch {
      setSendError("Couldn't submit your feedback. Try again.");
    } finally {
      setIsSending(false);
    }
  }

  if (submitted) {
    return <p className="text-[14px] text-muted-foreground">Thanks for your feedback!</p>;
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <HoneypotField />

      <div className="flex items-center gap-1">
        {RATING_VALUES.map((value) => (
          <button
            key={value}
            type="button"
            aria-label={`Rate ${value} out of 5`}
            aria-pressed={score === value}
            onClick={() => setScore(value)}
            className="p-0.5"
          >
            <Star
              className={cn(
                "size-5",
                score !== null && value <= score
                  ? "fill-primary text-primary"
                  : "text-muted-foreground",
              )}
            />
          </button>
        ))}
      </div>

      <Textarea
        value={comment}
        onChange={(event) => setComment(event.target.value)}
        placeholder="Anything you'd like to add? (optional)"
        className="min-h-[72px]"
      />

      <div className="flex items-center justify-end">
        <Button type="submit" disabled={isSending || score === null}>
          {isSending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Submit
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
