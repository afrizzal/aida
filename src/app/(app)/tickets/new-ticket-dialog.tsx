"use client";

import { ChevronDown, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { PriorityChip } from "@/components/tickets/priority-chip";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { TicketPriority } from "@/generated/prisma/client";
import { createTicketAction } from "./new-ticket-action";

const PRIORITIES: TicketPriority[] = ["LOW", "NORMAL", "HIGH", "URGENT"];

const EMPTY_FORM = {
  subject: "",
  contactEmail: "",
  contactName: "",
  priority: "NORMAL" as TicketPriority,
  body: "",
};

/** Secondary CTA in the shared inbox's list-panel header — a zero-ticket workspace
 * needs a reachable agent-initiated creation path (STATE.md, Wave 4 open todo). */
export function NewTicketDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [isSaving, setIsSaving] = useState(false);

  const isValid =
    form.subject.trim().length > 0 &&
    /\S+@\S+\.\S+/.test(form.contactEmail) &&
    form.body.trim().length > 0;

  function openDialog() {
    setForm(EMPTY_FORM);
    setOpen(true);
  }

  async function handleSubmit() {
    if (!isValid) return;
    setIsSaving(true);

    const result = await createTicketAction({
      subject: form.subject.trim(),
      priority: form.priority,
      body: form.body.trim(),
      contactEmail: form.contactEmail.trim(),
      contactName: form.contactName.trim() || undefined,
    }).catch(() => null);

    setIsSaving(false);

    if (!result?.id) {
      toast.error("Couldn't create the ticket. Try again.");
      return;
    }

    setOpen(false);
    router.push(`/tickets/${result.id}`);
  }

  return (
    <>
      <Button size="sm" onClick={openDialog}>
        <Plus className="size-3.5" />
        New Ticket
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New Ticket</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="new-ticket-subject">Subject</Label>
              <Input
                id="new-ticket-subject"
                value={form.subject}
                onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))}
                placeholder="Brief summary of the request"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="new-ticket-email">Contact email</Label>
                <Input
                  id="new-ticket-email"
                  type="email"
                  value={form.contactEmail}
                  onChange={(e) => setForm((f) => ({ ...f, contactEmail: e.target.value }))}
                  placeholder="customer@example.com"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="new-ticket-name">Contact name (optional)</Label>
                <Input
                  id="new-ticket-name"
                  value={form.contactName}
                  onChange={(e) => setForm((f) => ({ ...f, contactName: e.target.value }))}
                  placeholder="Jane Doe"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Priority</Label>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" className="w-full justify-between">
                    <PriorityChip priority={form.priority} />
                    <ChevronDown className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-(--radix-dropdown-menu-trigger-width)">
                  <DropdownMenuRadioGroup
                    value={form.priority}
                    onValueChange={(value) =>
                      setForm((f) => ({ ...f, priority: value as TicketPriority }))
                    }
                  >
                    {PRIORITIES.map((priority) => (
                      <DropdownMenuRadioItem key={priority} value={priority}>
                        <PriorityChip priority={priority} />
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            <div className="space-y-2">
              <Label htmlFor="new-ticket-body">Message</Label>
              <Textarea
                id="new-ticket-body"
                className="min-h-[120px]"
                value={form.body}
                onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))}
                placeholder="Describe the request…"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={!isValid || isSaving}>
              New Ticket
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
