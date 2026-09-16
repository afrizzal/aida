"use client";

import { Loader2 } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { SavedViewVisibility } from "@/generated/prisma/client";
import { requestListPanelFocus } from "./list-panel-focus";
import { deleteSavedViewAction } from "./saved-view-actions";

// Delete view confirmation (Phase 11, AIDA-47, UI-SPEC Surface 2d), the only destructive action
// of the phase. The server action decides whether the viewer may delete (D-04). Copy is verbatim
// from the 11-UI-SPEC Copywriting Contract.

const DELETE_ERROR = "The view could not be deleted. Wait a moment and try again.";

interface DeleteViewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  view: { id: string; name: string; visibility: SavedViewVisibility };
}

export function DeleteViewDialog({ open, onOpenChange, view }: DeleteViewDialogProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleted, setDeleted] = useState(false);

  function changeOpen(next: boolean) {
    if (pending) return;
    // A closed dialog forgets its error, so the next opening starts clean.
    if (!next) setError(null);
    onOpenChange(next);
  }

  async function handleDelete() {
    setError(null);
    setPending(true);
    const result = await deleteSavedViewAction(view.id).catch(() => null);
    setPending(false);
    if (!result?.ok) {
      setError(DELETE_ERROR);
      return;
    }
    // Focus goes to the list panel once the inbox without the view has rendered (UI-SPEC 2d),
    // not back to the strip's menu trigger, which disappears with the view.
    setDeleted(true);
    requestListPanelFocus();
    onOpenChange(false);
    // Back to the inbox with the same filters, minus the deleted view.
    const params = new URLSearchParams(searchParams.toString());
    params.delete("sv");
    const query = params.toString();
    router.push(query ? `/tickets?${query}` : "/tickets");
    toast.success("View deleted.");
  }

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent
        className="text-[13px]"
        onCloseAutoFocus={(event) => {
          if (deleted) event.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle className="text-[15px] font-semibold tracking-tight wrap-anywhere">
            {`Delete the view "${view.name}"?`}
          </DialogTitle>
          <DialogDescription className="text-[13px]">
            {view.visibility === "SHARED"
              ? "It disappears from the sidebar of everyone in this workspace. No tickets change."
              : "It disappears from your sidebar. No tickets change."}
          </DialogDescription>
        </DialogHeader>

        {error && (
          <p role="alert" className="text-[13px] text-destructive">
            {error}
          </p>
        )}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={() => changeOpen(false)}
          >
            Keep view
          </Button>
          <Button type="button" variant="destructive" disabled={pending} onClick={handleDelete}>
            {pending && <Loader2 className="mr-2 size-4 animate-spin" />}
            {pending ? "Deleting…" : "Delete view"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
