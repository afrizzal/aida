"use client";

// The keyboard shortcuts help modal (Phase 11, AIDA-50, D-13, UI-SPEC Surface 5e). Opened by `?`
// (the dispatcher) and by the palette's "Show keyboard shortcuts" (help.shortcuts). Every row
// comes from the key table (KEYMAP, through keymapBySection), so the modal can never show a
// partial or stale list; a unit test checks that every entry is in a section. The table is
// bundled with the client, so there is no loading or empty state. Pressing `?` while the modal
// is open does nothing, because the dispatcher ignores keys inside an open dialog.
import { KeyCaps, useApplePlatform } from "@/components/keyboard/key-caps";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { keymapBySection } from "@/lib/keyboard/keymap";

const SECTIONS = keymapBySection();

interface KeyboardHelpDialogProps {
  open: boolean;
  onOpenChange(open: boolean): void;
}

export function KeyboardHelpDialog({ open, onOpenChange }: KeyboardHelpDialogProps) {
  const apple = useApplePlatform();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[640px]">
        <DialogHeader>
          <DialogTitle className="text-[15px] font-semibold tracking-tight">
            Keyboard shortcuts
          </DialogTitle>
          <DialogDescription className="text-[13px] text-muted-foreground">
            Shortcuts work whenever you are not typing in a field.
          </DialogDescription>
        </DialogHeader>
        <div className="grid max-h-[70vh] gap-6 overflow-y-auto sm:grid-cols-2">
          {SECTIONS.map((section) => (
            <section
              key={section.id}
              aria-labelledby={`keyboard-help-${section.id}`}
              className="space-y-2"
            >
              <h3 id={`keyboard-help-${section.id}`} className="text-[13px] font-semibold">
                {section.heading}
              </h3>
              <dl>
                {section.entries.map((entry) => (
                  <div key={entry.id} className="flex items-center justify-between gap-4 py-1">
                    <dt className="text-[13px] text-foreground">{entry.label}</dt>
                    <dd className="flex shrink-0 items-center gap-1">
                      <KeyCaps entry={entry} apple={apple} />
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
