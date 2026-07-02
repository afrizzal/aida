"use client";

import { ChevronDown, Pencil, Plus, Trash2, X } from "lucide-react";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { CustomFieldType } from "@/generated/prisma/client";
import { createCustomField, deleteCustomField, updateCustomField } from "./actions";

const TYPE_LABELS: Record<CustomFieldType, string> = {
  TEXT: "Text",
  SELECT: "Dropdown",
  NUMBER: "Number",
  CHECKBOX: "Checkbox",
  DATE: "Date",
};

const TYPES: CustomFieldType[] = ["TEXT", "SELECT", "NUMBER", "CHECKBOX", "DATE"];

interface CustomFieldRow {
  id: string;
  label: string;
  type: CustomFieldType;
  options: string[];
}

interface CustomFieldManagerProps {
  fields: CustomFieldRow[];
}

interface FormState {
  id: string | null;
  label: string;
  type: CustomFieldType;
  options: string[];
}

const EMPTY_FORM: FormState = { id: null, label: "", type: "TEXT", options: [""] };

export function CustomFieldManager({ fields }: CustomFieldManagerProps) {
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [isSaving, setIsSaving] = useState(false);
  const [deletingField, setDeletingField] = useState<CustomFieldRow | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  function openCreate() {
    setForm(EMPTY_FORM);
    setFormOpen(true);
  }

  function openEdit(field: CustomFieldRow) {
    setForm({
      id: field.id,
      label: field.label,
      type: field.type,
      options: field.options.length > 0 ? field.options : [""],
    });
    setFormOpen(true);
  }

  async function handleSubmit() {
    setIsSaving(true);
    const input = { label: form.label, type: form.type, options: form.options };
    const result = form.id
      ? await updateCustomField(form.id, input).catch(() => null)
      : await createCustomField(input).catch(() => null);
    setIsSaving(false);

    if (result?.ok) {
      setFormOpen(false);
      toast.success(form.id ? "Custom field updated." : "Custom field created.");
    } else {
      toast.error(result?.error ?? "Failed to save custom field. Please try again.");
    }
  }

  async function confirmDelete() {
    if (!deletingField) return;
    setIsDeleting(true);
    const result = await deleteCustomField(deletingField.id).catch(() => null);
    setIsDeleting(false);
    setDeletingField(null);
    if (!result?.ok) {
      toast.error("Failed to delete custom field. Please try again.");
    }
  }

  return (
    <div className="space-y-4">
      {fields.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">
          No custom fields yet. Add one to start capturing extra ticket details.
        </p>
      ) : (
        <div className="divide-y divide-border rounded-lg border border-border/70">
          {fields.map((f) => (
            <div key={f.id} className="flex items-center gap-3 px-4 py-3">
              <span className="text-[14px] font-medium">{f.label}</span>
              <Badge variant="outline">{TYPE_LABELS[f.type]}</Badge>
              <div className="ml-auto flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Edit field ${f.label}`}
                  onClick={() => openEdit(f)}
                >
                  <Pencil className="size-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="text-muted-foreground hover:text-destructive"
                  aria-label={`Delete field ${f.label}`}
                  onClick={() => setDeletingField(f)}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Button onClick={openCreate}>
        <Plus className="size-4" />
        Add Field
      </Button>

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{form.id ? "Edit field" : "Add field"}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="cf-label">Label</Label>
              <Input
                id="cf-label"
                value={form.label}
                onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
                placeholder="e.g. Order number"
              />
            </div>

            <div className="space-y-2">
              <Label>Type</Label>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" className="w-full justify-between">
                    {TYPE_LABELS[form.type]}
                    <ChevronDown className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-(--radix-dropdown-menu-trigger-width)">
                  <DropdownMenuRadioGroup
                    value={form.type}
                    onValueChange={(value) =>
                      setForm((f) => ({ ...f, type: value as CustomFieldType }))
                    }
                  >
                    {TYPES.map((t) => (
                      <DropdownMenuRadioItem key={t} value={t}>
                        {TYPE_LABELS[t]}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            {form.type === "SELECT" && (
              <div className="space-y-2">
                <Label>Options</Label>
                {form.options.map((opt, index) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: option rows are positional; reordered only by append/remove at either end
                  <div key={index} className="flex items-center gap-2">
                    <Input
                      value={opt}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          options: f.options.map((o, i) => (i === index ? e.target.value : o)),
                        }))
                      }
                      placeholder={`Option ${index + 1}`}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Remove option ${index + 1}`}
                      onClick={() =>
                        setForm((f) => ({ ...f, options: f.options.filter((_, i) => i !== index) }))
                      }
                      disabled={form.options.length <= 1}
                    >
                      <X className="size-4" />
                    </Button>
                  </div>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setForm((f) => ({ ...f, options: [...f.options, ""] }))}
                >
                  <Plus className="size-4" />
                  Add option
                </Button>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setFormOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={isSaving || !form.label.trim()}>
              {form.id ? "Save Field" : "Create Field"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deletingField} onOpenChange={(open) => !open && setDeletingField(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete field &quot;{deletingField?.label}&quot;?</DialogTitle>
            <DialogDescription>
              Existing values on tickets will be permanently removed. This can't be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeletingField(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirmDelete} disabled={isDeleting}>
              Delete field
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
