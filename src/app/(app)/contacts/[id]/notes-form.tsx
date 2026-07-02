"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { saveContactNotes } from "./actions";

interface NotesFormProps {
  contactId: string;
  defaultValue: string;
}

export function NotesForm({ contactId, defaultValue }: NotesFormProps) {
  const [value, setValue] = useState(defaultValue);
  const [saved, setSaved] = useState(false);
  const lastSavedRef = useRef(defaultValue);

  async function handleBlur() {
    if (value === lastSavedRef.current) return;

    const result = await saveContactNotes(contactId, value).catch(() => null);

    if (!result?.ok) {
      toast.error("Failed to save notes. Please try again.");
      return;
    }

    lastSavedRef.current = value;
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div className="space-y-1.5">
      <Label htmlFor="contact-notes">Notes</Label>
      <Textarea
        id="contact-notes"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={handleBlur}
        placeholder="Add free-form notes about this contact…"
        className="min-h-20"
      />
      {saved ? <p className="text-[12px] text-muted-foreground">Saved</p> : null}
    </div>
  );
}
