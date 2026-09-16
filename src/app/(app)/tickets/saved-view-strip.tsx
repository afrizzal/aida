"use client";

import { Ellipsis, ListFilter, Pencil, Trash2, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { SavedViewVisibility } from "@/generated/prisma/client";
import { type InboxFiltersInput, parseUrlFilters } from "@/lib/tickets/list-filters";
import { DeleteViewDialog } from "./delete-view-dialog";
import { type SaveViewCustomField, SaveViewDialog, type SaveViewTag } from "./save-view-dialog";

// The saved-view strip above the inbox list (Phase 11, AIDA-47, D-04, D-05, UI-SPEC Surface 2b).
// The server (getSavedViewForPanel) decides the state and whether the viewer may edit; this
// component only renders it. Applied and Changed differ by the second line; a broken reference
// adds the warning notice and keeps the filter (D-05). Copy is verbatim from the UI-SPEC.

export interface SavedViewStripView {
  id: string;
  name: string;
  visibility: SavedViewVisibility;
  canEdit: boolean;
  isOwner: boolean;
  filters: InboxFiltersInput;
  href: string;
}

interface SavedViewStripProps {
  view: SavedViewStripView;
  state: "applied" | "changed";
  missing: { tag: boolean; customField: boolean };
  tags: SaveViewTag[];
  customFieldDefinitions: SaveViewCustomField[];
}

function brokenSentence(missing: { tag: boolean; customField: boolean }): string {
  if (missing.tag && missing.customField) {
    return "This view filters on a tag and a custom field that no longer exist.";
  }
  if (missing.tag) return "This view filters on a tag that no longer exists.";
  return "This view filters on a custom field that no longer exists.";
}

type EditSource = "stored" | "screen";

export function SavedViewStrip({
  view,
  state,
  missing,
  tags,
  customFieldDefinitions,
}: SavedViewStripProps) {
  const searchParams = useSearchParams();
  const [editSource, setEditSource] = useState<EditSource | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const isBroken = missing.tag || missing.customField;

  const editFilters =
    editSource === "screen" ? parseUrlFilters(searchParams).filters : view.filters;

  return (
    <div className="border-b border-border/70">
      <div className="flex items-center gap-2 px-4 py-2">
        <ListFilter aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        <span
          title={view.name}
          className="min-w-0 flex-1 truncate text-[13px] font-semibold text-foreground"
        >
          {view.name}
        </span>
        <Badge variant="secondary" className="text-[12px]">
          {view.visibility === "SHARED" ? "Shared" : "Private"}
        </Badge>
        {view.canEdit && (
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="size-8" aria-label="View options">
                <Ellipsis className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem className="text-[13px]" onSelect={() => setEditSource("stored")}>
                <Pencil className="size-4" />
                Edit view
              </DropdownMenuItem>
              <DropdownMenuItem
                variant="destructive"
                className="text-[13px] text-destructive"
                onSelect={() => setDeleteOpen(true)}
              >
                <Trash2 className="size-4" />
                Delete view
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {state === "changed" && (
        <div className="flex flex-wrap items-center gap-2 px-4 pb-2">
          <span className="text-[12px] text-muted-foreground">Filters changed</span>
          {view.canEdit && (
            <Button
              variant="outline"
              size="sm"
              className="text-[13px]"
              onClick={() => setEditSource("screen")}
            >
              Save changes
            </Button>
          )}
          <Button variant="ghost" size="sm" className="text-[13px]" asChild>
            <Link href={view.href}>Reset</Link>
          </Button>
        </div>
      )}

      {isBroken && (
        <div
          role="status"
          className="mx-4 my-2 flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 p-4 text-[13px] text-warning"
        >
          <TriangleAlert aria-hidden className="size-4 shrink-0" />
          <div className="min-w-0 space-y-2">
            <p>{`${brokenSentence(missing)} Edit the view to remove it.`}</p>
            {view.canEdit ? (
              <Button
                variant="outline"
                size="sm"
                className="text-[13px]"
                onClick={() => setEditSource("stored")}
              >
                Edit view
              </Button>
            ) : (
              <p>Ask the person who created this view, or a workspace admin, to update it.</p>
            )}
          </div>
        </div>
      )}

      {view.canEdit && (
        <>
          <SaveViewDialog
            mode="edit"
            open={editSource !== null}
            onOpenChange={(open) => {
              if (!open) setEditSource(null);
            }}
            view={{
              id: view.id,
              name: view.name,
              visibility: view.visibility,
              isOwner: view.isOwner,
            }}
            filters={editFilters}
            replacing={editSource === "screen"}
            missing={editSource === "stored" ? missing : undefined}
            tags={tags}
            customFieldDefinitions={customFieldDefinitions}
          />
          <DeleteViewDialog
            open={deleteOpen}
            onOpenChange={setDeleteOpen}
            view={{ id: view.id, name: view.name, visibility: view.visibility }}
          />
        </>
      )}
    </div>
  );
}
