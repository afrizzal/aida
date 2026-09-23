"use client";

import { AlarmClock, Loader2, Sunrise } from "lucide-react";
import { useId, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { snoozeTicketAction, wakeTicketAction } from "@/app/(app)/tickets/[id]/snooze-actions";
import {
  formatLocalDateTime,
  LocalDateTime,
  useLocalDateTimeText,
} from "@/components/tickets/local-date-time";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { TicketStatus } from "@/generated/prisma/client";
import type { SnoozeErrorCode } from "@/lib/tickets/snooze";

// UI-SPEC 4b to 4d (AIDA-54, D-12). Every time is chosen and shown in the browser's zone and
// sent as a UTC instant; the server checks every bound again (12-05), so the client checks
// below are a convenience only (T-12-32).

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const MIN_AHEAD = 5 * MINUTE;
const MAX_AHEAD = 365 * DAY;

const CLOSED_REASON = "Closed tickets can't be snoozed. Reopen the ticket first.";
const MERGED_REASON = "This ticket was merged, so it can't be snoozed.";

const CHIP_CLASSES =
  "h-5 gap-1 border border-border bg-muted px-2 py-0 font-normal text-[12px] text-muted-foreground";

/** UI-SPEC Copywriting "Snooze error: …" rows; one row per server code, never raw text. */
function snoozeErrorCopy(code: SnoozeErrorCode): string {
  switch (code) {
    case "TICKET_CLOSED":
      return CLOSED_REASON;
    case "MERGED_SOURCE":
      return MERGED_REASON;
    case "NOT_SNOOZED":
      return "This ticket is no longer snoozed. Refresh the page to see its current state.";
    case "TICKET_UNAVAILABLE":
      return "This ticket is no longer available. Refresh the page.";
    case "MEMBERSHIP_ENDED":
      return "Your access to this workspace has ended. Sign out, then sign in again.";
    case "TOO_SOON":
      return "Pick a time at least 5 minutes from now.";
    case "TOO_FAR":
      return "Pick a time within the next 365 days.";
    default:
      return "The snooze could not be saved. Wait a moment and try again.";
  }
}

const OUTCOME_UNKNOWN =
  "The result is not known. The change may have been saved. Refresh the page to check before you try again.";

function roundUpToFiveMinutes(ms: number): Date {
  const step = 5 * MINUTE;
  return new Date(Math.ceil(ms / step) * step);
}

function atNineLocal(base: Date, addDays: number): Date {
  return new Date(base.getFullYear(), base.getMonth(), base.getDate() + addDays, 9, 0, 0, 0);
}

interface Preset {
  label: string;
  at: Date;
}

/** The four presets of UI-SPEC 4c, computed in the browser's zone. */
function computePresets(now: Date): Preset[] {
  const day = now.getDay(); // 0 = Sunday, 1 = Monday
  const daysToMonday = (1 - day + 7) % 7 || 7;
  return [
    { label: "In 3 hours", at: roundUpToFiveMinutes(now.getTime() + 3 * 60 * MINUTE) },
    { label: "Tomorrow, 09:00", at: atNineLocal(now, 1) },
    { label: "Next Monday, 09:00", at: atNineLocal(now, daysToMonday) },
    { label: "In 1 week", at: roundUpToFiveMinutes(now.getTime() + 7 * DAY) },
  ];
}

function localDateValue(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** The non-interactive snoozed chip (UI-SPEC 4d), used in inbox rows. */
export function SnoozedChip({ until }: { until: Date | string }) {
  return (
    <Badge className={CHIP_CLASSES}>
      <AlarmClock aria-hidden className="size-3" />
      <span>
        Snoozed until <LocalDateTime value={until} />
      </span>
    </Badge>
  );
}

export interface SnoozeControlProps {
  ticketId: string;
  status: TicketStatus;
  snoozedUntil: string | null;
  mergedSource: boolean;
}

export function SnoozeControl({
  ticketId,
  status,
  snoozedUntil,
  mergedSource,
}: SnoozeControlProps) {
  const isSnoozed = snoozedUntil !== null;
  const isClosed = status === "CLOSED";
  // The chip's aria-label, from the same hydration-safe text as the chip (review UI-WR-01).
  const snoozedText = useLocalDateTimeText(snoozedUntil);
  const [open, setOpen] = useState(false);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [zone, setZone] = useState("");
  const [dateValue, setDateValue] = useState("");
  const [timeValue, setTimeValue] = useState("");
  const [bounds, setBounds] = useState({ min: "", max: "" });
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [callout, setCallout] = useState<string | null>(null);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const firstPresetRef = useRef<HTMLButtonElement>(null);
  const wakeRef = useRef<HTMLButtonElement>(null);
  const headingId = useId();
  const zoneLineId = useId();
  const dateId = useId();
  const timeId = useId();

  // Disabled trigger only for a merged source, or a CLOSED ticket that is not snoozed (review C9:
  // a CLOSED ticket that is still snoozed keeps its chip as an enabled trigger so it can be woken).
  const disabledReason = mergedSource
    ? MERGED_REASON
    : isClosed && !isSnoozed
      ? CLOSED_REASON
      : null;
  const snoozeBlocked = isClosed || mergedSource;
  const busy = isPending || pendingKey !== null;

  function handleOpenChange(next: boolean) {
    if (busy && !next) return;
    if (next) {
      const now = new Date();
      setPresets(computePresets(now));
      setZone(Intl.DateTimeFormat().resolvedOptions().timeZone);
      setBounds({
        min: localDateValue(now),
        max: localDateValue(new Date(now.getTime() + MAX_AHEAD)),
      });
      setDateValue("");
      setTimeValue("");
      setFieldError(null);
      setCallout(null);
    }
    setOpen(next);
  }

  function submitSnooze(key: string, at: Date) {
    setCallout(null);
    setPendingKey(key);
    startTransition(async () => {
      try {
        const result = await snoozeTicketAction(ticketId, at.toISOString());
        if (result.ok) {
          setOpen(false);
          toast.success(
            `Snoozed until ${formatLocalDateTime(at)}. It is hidden from the inbox until then.`,
          );
        } else {
          setCallout(snoozeErrorCopy(result.error));
        }
      } catch {
        setCallout(OUTCOME_UNKNOWN);
      } finally {
        setPendingKey(null);
      }
    });
  }

  function submitWake() {
    setCallout(null);
    setPendingKey("wake");
    startTransition(async () => {
      try {
        const result = await wakeTicketAction(ticketId);
        if (result.ok) {
          setOpen(false);
          toast.success("Ticket woken.");
        } else {
          setCallout(snoozeErrorCopy(result.error));
        }
      } catch {
        setCallout(OUTCOME_UNKNOWN);
      } finally {
        setPendingKey(null);
      }
    });
  }

  function submitCustom() {
    if (!dateValue || !timeValue) {
      setFieldError("Enter both a date and a time.");
      return;
    }
    const [y, m, d] = dateValue.split("-").map(Number);
    const [hh, mm] = timeValue.split(":").map(Number);
    const at = new Date(y, m - 1, d, hh, mm, 0, 0);
    const delta = at.getTime() - Date.now();
    if (Number.isNaN(delta) || delta < MIN_AHEAD) {
      setFieldError("Pick a time at least 5 minutes from now.");
      return;
    }
    if (delta > MAX_AHEAD) {
      setFieldError("Pick a time within the next 365 days.");
      return;
    }
    setFieldError(null);
    submitSnooze("custom", at);
  }

  if (disabledReason) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-disabled="true"
              aria-label={`Snooze. ${disabledReason}`}
              className="gap-2 text-[13px] text-muted-foreground aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
              onClick={(event) => event.preventDefault()}
            >
              <AlarmClock aria-hidden className="size-4" />
              Snooze
            </Button>
          </TooltipTrigger>
          <TooltipContent className="max-w-[240px] text-[12px]">{disabledReason}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  const spinner = <Loader2 aria-hidden className="size-4 animate-spin" />;

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        {isSnoozed ? (
          <button
            type="button"
            aria-label={`Snoozed until ${snoozedText}. Change or wake.`}
            className="rounded-4xl outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <SnoozedChip until={snoozedUntil} />
          </button>
        ) : (
          <Button type="button" variant="ghost" size="sm" className="gap-2 text-[13px]">
            <AlarmClock aria-hidden className="size-4" />
            Snooze
          </Button>
        )}
      </PopoverTrigger>
      <PopoverContent
        align="end"
        aria-labelledby={headingId}
        className="w-[320px] max-w-[calc(100vw-16px)] space-y-4 p-4"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          (snoozeBlocked ? wakeRef.current : firstPresetRef.current)?.focus();
        }}
        onEscapeKeyDown={(event) => {
          if (busy) event.preventDefault();
        }}
        onInteractOutside={(event) => {
          if (busy) event.preventDefault();
        }}
      >
        {callout && (
          <div
            role="alert"
            className="rounded-lg border border-destructive/20 bg-destructive/10 p-4 text-[13px] text-destructive"
          >
            {callout}
          </div>
        )}

        <div className="space-y-1">
          <h2 id={headingId} className="font-semibold text-[15px] leading-tight">
            {isSnoozed ? "Change snooze" : "Snooze until"}
          </h2>
          <p className="text-[12px] text-muted-foreground">
            The ticket leaves the inbox until then. A reply from the customer brings it back sooner.
          </p>
        </div>

        {snoozeBlocked && <p className="text-[12px] text-muted-foreground">{CLOSED_REASON}</p>}

        <ul className="space-y-1">
          {presets.map((preset, index) => (
            <li key={preset.label}>
              <Button
                ref={index === 0 ? firstPresetRef : undefined}
                type="button"
                variant="ghost"
                disabled={busy || snoozeBlocked}
                onClick={() => submitSnooze(preset.label, preset.at)}
                className="flex h-8 w-full items-center justify-between gap-2 px-2 font-normal text-[13px]"
              >
                <span className="flex items-center gap-2">
                  {pendingKey === preset.label && spinner}
                  {pendingKey === preset.label ? "Saving…" : preset.label}
                </span>
                <span className="text-[12px] text-muted-foreground tabular-nums">
                  {formatLocalDateTime(preset.at)}
                </span>
              </Button>
            </li>
          ))}
        </ul>

        <div className="space-y-2">
          <p className="font-semibold text-[13px]">Pick a date and time</p>
          <div className="flex gap-2">
            <Label htmlFor={dateId} className="sr-only">
              Date
            </Label>
            <Input
              id={dateId}
              type="date"
              min={bounds.min}
              max={bounds.max}
              value={dateValue}
              onChange={(event) => setDateValue(event.target.value)}
              disabled={busy || snoozeBlocked}
              aria-describedby={zoneLineId}
              className="h-8 text-[13px]"
            />
            <Label htmlFor={timeId} className="sr-only">
              Time
            </Label>
            <Input
              id={timeId}
              type="time"
              step={300}
              value={timeValue}
              onChange={(event) => setTimeValue(event.target.value)}
              disabled={busy || snoozeBlocked}
              aria-describedby={zoneLineId}
              className="h-8 text-[13px]"
            />
          </div>
          <p id={zoneLineId} className="break-words text-[12px] text-muted-foreground">
            Times are in your time zone: {zone}.
          </p>
          {fieldError && <p className="text-[12px] text-destructive">{fieldError}</p>}
          <Button
            type="button"
            size="sm"
            disabled={busy || snoozeBlocked || !dateValue || !timeValue}
            onClick={submitCustom}
            className="gap-2 text-[13px]"
          >
            {pendingKey === "custom" && spinner}
            {pendingKey === "custom" ? "Saving…" : "Snooze ticket"}
          </Button>
        </div>

        {isSnoozed && (
          <div className="space-y-2 border-border/70 border-t pt-4">
            <p className="text-[13px]">
              Snoozed until <LocalDateTime value={snoozedUntil} />.
            </p>
            <Button
              ref={wakeRef}
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={submitWake}
              className="gap-2 text-[13px]"
            >
              {pendingKey === "wake" ? spinner : <Sunrise aria-hidden className="size-4" />}
              {pendingKey === "wake" ? "Saving…" : "Wake now"}
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
