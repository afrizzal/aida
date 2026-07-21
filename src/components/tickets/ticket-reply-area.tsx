"use client";

import { Sparkles } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { generateDraftReply } from "@/app/(app)/tickets/[id]/actions";
import { Composer } from "@/components/tickets/composer";
import { DraftCard } from "@/components/tickets/draft-card";
import { Button } from "@/components/ui/button";
import type { GenerateDraftResult } from "@/lib/rag/generate-draft";

interface TicketReplyAreaProps {
  ticketId: string;
  /** True when the org has at least one COMPLETED-embedding KB article (Pitfall 9). */
  canDraft: boolean;
}

/**
 * Coordinates on-demand draft generation (AIDA-16) with the existing Composer. Lifts the draft
 * card + inserted-text state above the Composer so "Generate draft" -> DraftCard -> Insert ->
 * Composer body is a pure client-side hand-off — the actual send still goes exclusively through
 * the Composer's existing POST /api/tickets/[id]/messages path. Nothing here can send a message.
 */
export function TicketReplyArea({ ticketId, canDraft }: TicketReplyAreaProps) {
  const [draft, setDraft] = useState<GenerateDraftResult | null>(null);
  const [generating, setGenerating] = useState(false);
  const [insertedText, setInsertedText] = useState<string | null>(null);

  async function handleGenerateDraft() {
    setGenerating(true);
    const res = await generateDraftReply(ticketId).catch(() => null);
    setGenerating(false);

    if (res?.ok && res.draft) {
      setDraft(res.draft);
    } else {
      toast.error("Couldn't generate a draft. Try again.");
    }
  }

  return (
    <div>
      {/* Composer (below) already supplies its own border-t p-4 wrapper — this section only
          needs its own top padding, not a duplicate border. */}
      <div className="space-y-3 px-4 pt-4">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!canDraft || generating}
          onClick={handleGenerateDraft}
        >
          <Sparkles className="size-3.5" />
          {generating ? "Generating…" : "Generate draft"}
        </Button>
        {!canDraft && (
          <p className="text-[12px] text-muted-foreground">Add knowledge base articles first</p>
        )}

        {draft && (
          <DraftCard
            draft={draft}
            onInsert={(markdown) => {
              setInsertedText(markdown);
              setDraft(null);
            }}
            onDiscard={() => setDraft(null)}
          />
        )}
      </div>

      <Composer
        ticketId={ticketId}
        insertedText={insertedText}
        onInsertedConsumed={() => setInsertedText(null)}
      />
    </div>
  );
}
