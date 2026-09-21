"use client";

// The Link a ticket dialog (AIDA-52, UI-SPEC 2b). The server is the authority: addRelationAction
// checks membership and every rule (self, duplicate pair, one parent, cycle, depth) and each
// refusal code maps to exactly one Copywriting "Link error" row.

import { Loader2 } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { addRelationAction } from "@/app/(app)/tickets/[id]/relation-actions";
import { relationErrorMessage } from "@/components/tickets/linked-tickets-row";
import { type PickerRow, pickerReason, TicketPicker } from "@/components/tickets/ticket-picker";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DEFAULT_LINK_CHOICE, LINK_CHOICES } from "@/lib/tickets/relation-pairs";

const LINK_OUTCOME_UNKNOWN =
  "The result is not known. The link may have been saved. Refresh the page to check before you try again.";

interface LinkTicketDialogProps {
  ticketId: string;
  ticketNumber: number;
  open: boolean;
  onOpenChange(open: boolean): void;
}

export function LinkTicketDialog({
  ticketId,
  ticketNumber,
  open,
  onOpenChange,
}: LinkTicketDialogProps) {
  const [pending, setPending] = useState(false);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!pending) onOpenChange(next);
      }}
    >
      <DialogContent showCloseButton={false} className="sm:max-w-[560px]">
        {open && (
          <LinkTicketForm
            ticketId={ticketId}
            ticketNumber={ticketNumber}
            onPendingChange={setPending}
            onDone={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

interface LinkTicketFormProps {
  ticketId: string;
  ticketNumber: number;
  onPendingChange(pending: boolean): void;
  onDone(): void;
}

/** Mounted per opening, so every opening starts at "is related to" with an empty picker. */
function LinkTicketForm({ ticketId, ticketNumber, onPendingChange, onDone }: LinkTicketFormProps) {
  const [choiceLabel, setChoiceLabel] = useState(DEFAULT_LINK_CHOICE.label);
  const [selected, setSelected] = useState<PickerRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const choice = LINK_CHOICES.find((c) => c.label === choiceLabel) ?? DEFAULT_LINK_CHOICE;
  const canSubmit = selected !== null && pickerReason(selected, "link") === null && !pending;

  function handleSubmit() {
    if (!selected) return;
    const other = selected;
    setError(null);
    onPendingChange(true);
    startTransition(async () => {
      try {
        const result = await addRelationAction(ticketId, other.id, choice.label);
        if (result.ok) {
          toast.success("Link added.");
          onDone();
        } else {
          // PARENT_EXISTS names the child: this ticket for "is a child of", else the other one.
          const childNumber =
            choice.type === "CHILD_OF"
              ? choice.direction === "this-to-other"
                ? ticketNumber
                : other.number
              : undefined;
          setError(relationErrorMessage(result.error, { childNumber }));
        }
      } catch {
        setError(LINK_OUTCOME_UNKNOWN);
      } finally {
        onPendingChange(false);
      }
    });
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle className="text-[15px] font-semibold tracking-tight">
          Link a ticket
        </DialogTitle>
        <DialogDescription className="text-[13px]">
          Links show on both tickets. They don't change status, messages or assignee.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="link-ticket-type" className="text-[13px]">
            This ticket
          </Label>
          <Select
            value={choiceLabel}
            onValueChange={(value) => {
              setChoiceLabel(value);
              setError(null);
            }}
            disabled={pending}
          >
            <SelectTrigger id="link-ticket-type" className="h-8 w-full text-[13px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LINK_CHOICES.map((c) => (
                <SelectItem key={c.label} value={c.label} className="text-[13px]">
                  {c.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <p className="text-[13px] font-semibold">Ticket</p>
          <TicketPicker
            ticketId={ticketId}
            purpose="link"
            selected={selected}
            disabled={pending}
            onSelect={(row) => {
              setSelected(row);
              setError(null);
            }}
          />
        </div>

        {error && (
          <div
            role="alert"
            className="rounded-lg border border-destructive/20 bg-destructive/10 p-4 text-[13px] text-destructive"
          >
            {error}
          </div>
        )}
      </div>

      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="text-[13px]"
          disabled={pending}
          onClick={onDone}
        >
          Close
        </Button>
        <Button
          type="button"
          size="sm"
          className="text-[13px]"
          disabled={!canSubmit}
          onClick={handleSubmit}
        >
          {pending ? (
            <>
              <Loader2 className="mr-2 size-4 animate-spin" />
              Linking…
            </>
          ) : (
            "Link tickets"
          )}
        </Button>
      </DialogFooter>
    </>
  );
}
