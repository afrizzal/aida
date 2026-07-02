"use client";

import { Pencil, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { deleteTag, renameTag } from "./actions";

interface TagRow {
  id: string;
  name: string;
  count: number;
}

interface TagManagerProps {
  tags: TagRow[];
}

export function TagManager({ tags }: TagManagerProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [deletingTag, setDeletingTag] = useState<TagRow | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  function startEdit(tag: TagRow) {
    setEditingId(tag.id);
    setDraftName(tag.name);
  }

  async function commitRename(id: string, originalName: string) {
    const name = draftName.trim();
    setEditingId(null);
    if (!name || name === originalName) return;

    const result = await renameTag(id, name).catch(() => null);
    if (!result?.ok) {
      toast.error("Failed to rename tag. Please try again.");
    }
  }

  async function confirmDelete() {
    if (!deletingTag) return;
    setIsDeleting(true);
    const result = await deleteTag(deletingTag.id).catch(() => null);
    setIsDeleting(false);
    setDeletingTag(null);
    if (!result?.ok) {
      toast.error("Failed to delete tag. Please try again.");
    }
  }

  if (tags.length === 0) {
    return (
      <p className="text-[13px] text-muted-foreground">
        No tags yet — tags created from the ticket composer will appear here for management.
      </p>
    );
  }

  return (
    <>
      <div className="divide-y divide-border rounded-lg border border-border/70">
        {tags.map((tag) => (
          <div key={tag.id} className="flex items-center gap-3 px-4 py-3">
            {editingId === tag.id ? (
              <Input
                autoFocus
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                onBlur={() => commitRename(tag.id, tag.name)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitRename(tag.id, tag.name);
                  if (e.key === "Escape") setEditingId(null);
                }}
                className="h-7 max-w-[200px]"
              />
            ) : (
              <Badge variant="secondary" className="rounded-full">
                {tag.name}
              </Badge>
            )}

            <span className="text-[12px] text-muted-foreground">
              {tag.count} {tag.count === 1 ? "ticket" : "tickets"}
            </span>

            <div className="ml-auto flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Rename tag ${tag.name}`}
                onClick={() => startEdit(tag)}
              >
                <Pencil className="size-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                className="text-muted-foreground hover:text-destructive"
                aria-label={`Delete tag ${tag.name}`}
                onClick={() => setDeletingTag(tag)}
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          </div>
        ))}
      </div>

      <Dialog open={!!deletingTag} onOpenChange={(open) => !open && setDeletingTag(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete tag &quot;{deletingTag?.name}&quot;?</DialogTitle>
            <DialogDescription>
              This removes it from all tickets. This can't be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeletingTag(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirmDelete} disabled={isDeleting}>
              Delete tag
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
