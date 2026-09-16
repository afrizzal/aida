"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod/v4";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { MAX_AUTO_CLOSE_DAYS, parseAutoCloseDays } from "@/lib/tickets/auto-close-days";
import { saveAutoCloseSetting } from "./actions";

// Auto-close card on the SLA page (Phase 11, AIDA-51, UI-SPEC Surface 6; D-15, D-16 as amended,
// D-19). Copy is verbatim from the 11-UI-SPEC Copywriting Contract. There is no customer-notice
// control and no preview count (D-19, owner item O-2).

const INVALID_MESSAGE = "Enter a whole number from 0 to 365.";

const COPY = {
  description:
    "Close tickets that stay resolved for a set number of days. Customers are not notified when a ticket closes this way.",
  fieldHelp: "Enter 0 to turn auto-close off. The maximum is 365.",
  enablingNote:
    "Tickets that are already resolved when you turn this on start counting from that moment, so they do not all close at once.",
  quietRule:
    "The count starts when a ticket is resolved. Replies from your team, internal notes and automatic emails such as out-of-office replies do not restart it. A customer reply reopens the ticket as before.",
  dailyRun:
    "Tickets are checked once a day, so a ticket can close up to a day after the set number of days has passed.",
  membersNote: "Only workspace owners and admins can change this.",
} as const;

const ERROR_COPY = {
  NOT_ALLOWED: COPY.membersNote,
  MEMBERSHIP_ENDED: "Your access to this workspace has ended. Sign out, then sign in again.",
  UNKNOWN: "The setting could not be saved. Wait a moment and try again.",
} as const;

const formSchema = z.object({
  days: z.string().refine((value) => parseAutoCloseDays(value).ok, INVALID_MESSAGE),
});

type FormValues = z.infer<typeof formSchema>;

const dayWord = (n: number) => (n === 1 ? "day" : "days");

function statusLine(days: number): string {
  return days > 0
    ? `Auto-close is on: resolved tickets close after ${days} ${dayWord(days)}.`
    : "Auto-close is off.";
}

interface AutoCloseFormProps {
  /** The stored days value (0 when off, absent or not valid). */
  initialDays: number;
  canEdit: boolean;
}

export function AutoCloseForm({ initialDays, canEdit }: AutoCloseFormProps) {
  const [storedDays, setStoredDays] = useState(initialDays);
  const [serverError, setServerError] = useState<string | null>(null);
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { days: String(initialDays) },
  });
  const pending = form.formState.isSubmitting;

  async function onSubmit(values: FormValues) {
    setServerError(null);
    const result = await saveAutoCloseSetting(values.days).catch(() => null);
    if (!result) {
      setServerError(ERROR_COPY.UNKNOWN);
      return;
    }
    if (!result.ok) {
      if (result.error === "INVALID") {
        form.setError("days", { message: INVALID_MESSAGE });
      } else {
        setServerError(ERROR_COPY[result.error] ?? ERROR_COPY.UNKNOWN);
      }
      return;
    }
    setStoredDays(result.days);
    form.reset({ days: String(result.days) });
    toast.success(
      result.days > 0
        ? `Auto-close set to ${result.days} ${dayWord(result.days)}.`
        : "Auto-close turned off.",
    );
  }

  return (
    <Card className="border-border/70 p-4 shadow-sm">
      <section aria-labelledby="auto-close-heading" className="space-y-4">
        <div className="space-y-1">
          <h2 id="auto-close-heading" className="text-[15px] font-semibold tracking-tight">
            Auto-close resolved tickets
          </h2>
          <p className="text-[13px] text-muted-foreground">{COPY.description}</p>
        </div>

        <p role="status" className="text-[13px] text-foreground">
          {statusLine(storedDays)}
        </p>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
            <FormField
              control={form.control}
              name="days"
              render={({ field }) => (
                <FormItem className="gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <FormLabel className="text-[13px] font-normal text-muted-foreground">
                      Close after (days)
                    </FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        inputMode="numeric"
                        min={0}
                        max={MAX_AUTO_CLOSE_DAYS}
                        step={1}
                        className="w-24"
                        disabled={!canEdit || pending}
                        {...field}
                      />
                    </FormControl>
                  </div>
                  <FormDescription className="text-[12px]">{COPY.fieldHelp}</FormDescription>
                  <FormMessage className="text-[12px] font-normal" />
                </FormItem>
              )}
            />

            <div className="space-y-1 text-[12px] text-muted-foreground">
              <p>{COPY.enablingNote}</p>
              <p>{COPY.quietRule}</p>
              <p>{COPY.dailyRun}</p>
            </div>

            {serverError && (
              <div
                role="alert"
                className="rounded-lg border border-destructive/20 bg-destructive/10 p-4 text-[13px] text-destructive"
              >
                {serverError}
              </div>
            )}

            {canEdit ? (
              <Button type="submit" disabled={pending}>
                {pending && <Loader2 className="mr-2 size-4 animate-spin" />}
                {pending ? "Saving…" : "Save auto-close setting"}
              </Button>
            ) : (
              <p className="text-[13px] text-muted-foreground">{COPY.membersNote}</p>
            )}
          </form>
        </Form>
      </section>
    </Card>
  );
}
