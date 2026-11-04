"use client";

import { Button } from "@/components/ui/button";

export default function ContactsError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <>
      {/* AIDA-36 (D-14, UI-SPEC Surface 5): the error state's one h1, sr-only. Also the error
          state of /contacts/[id], which has no error.tsx of its own. */}
      <h1 className="sr-only">Contacts</h1>
      <div className="flex items-center justify-between gap-2 rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-[13px] text-destructive">
        <span>Couldn't load contacts.</span>
        <Button variant="link" onClick={() => reset()} className="h-auto p-0 text-[13px]">
          Retry
        </Button>
      </div>
    </>
  );
}
