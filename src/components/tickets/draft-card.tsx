"use client";

import { Sparkles } from "lucide-react";
import type { GenerateDraftResult } from "@/lib/rag/generate-draft";
import { Button } from "@/components/ui/button";
import { DraftCitationList } from "@/components/tickets/draft-citation-list";

interface DraftCardProps {
  draft: GenerateDraftResult;
  onInsert: (markdown: string) => void;
  onDiscard: () => void;
}

/**
 * Presentational AI Draft card (AIDA-16). Renders the grounded draft + inline [N] citations,
 * or an explicit "no relevant sources" state when retrieval found nothing (Success Criterion 4)
 * — never a fabricated citation. Insert/Discard are the ONLY affordances here; nothing is sent
 * to the customer from this component. No data fetching — pure presentation.
 */
export function DraftCard({ draft, onInsert, onDiscard }: DraftCardProps) {
  return (
    <div className="rounded-lg border border-primary/15 bg-primary/5 p-3">
      <div className="flex items-center gap-1.5 text-[13px] font-medium text-primary">
        <Sparkles className="size-3.5" />
        AI Draft
      </div>

      {draft.grounded === false ? (
        <div className="mt-2 rounded-md border border-warning/30 bg-warning/5 p-2 text-[12px] text-foreground">
          <p className="font-medium text-warning">No relevant sources found</p>
          <p className="mt-1 whitespace-pre-wrap">{draft.draftMarkdown}</p>
        </div>
      ) : (
        <>
          <p className="mt-2 whitespace-pre-wrap text-[13px]">{draft.draftMarkdown}</p>
          <DraftCitationList citations={draft.citationsResolved} />
        </>
      )}

      <div className="mt-3 flex items-center gap-2">
        <Button type="button" size="sm" onClick={() => onInsert(draft.draftMarkdown)}>
          Insert into reply
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onDiscard}>
          Discard
        </Button>
      </div>
    </div>
  );
}
