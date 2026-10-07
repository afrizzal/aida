"use client";

// UI-SPEC Surface 2 "Loading" (Assumption 3): the list is server-rendered; while any row is
// GENERATING this calls router.refresh() every PROPOSAL_POLL_INTERVAL_MS and stops when none is.
// When a row that was GENERATING is now DRAFT, a polite live region announces it; a row that
// ended FAILED did not finish drafting and is not announced (review b-IN-05). Focus is never
// moved (UI-SPEC 3i "Generation finished (polling)").

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { PROPOSAL_POLL_INTERVAL_MS } from "@/lib/kb/proposal-contract";
import { GENERATION_FINISHED_ANNOUNCEMENT } from "@/lib/kb/proposal-copy";
import { anyBecameDraft } from "@/lib/kb/proposal-outcome";

/** Delay between clearing and setting the announcement, so a repeat is announced again. */
const ANNOUNCE_DELAY_MS = 100;

export function ProposalListRefresh({
  generatingIds,
  draftIds,
}: {
  /** The ids of the GENERATING rows in this render. */
  generatingIds: readonly string[];
  /** The ids of the DRAFT rows in this render. */
  draftIds: readonly string[];
}) {
  const router = useRouter();
  const previousGenerating = useRef(generatingIds);
  const [announcement, setAnnouncement] = useState("");
  const generatingCount = generatingIds.length;
  const generatingKey = generatingIds.join(",");
  const draftKey = draftIds.join(",");

  useEffect(() => {
    if (generatingCount <= 0) return;
    const timer = setInterval(() => router.refresh(), PROPOSAL_POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [generatingCount, router]);

  useEffect(() => {
    const finished = anyBecameDraft(
      previousGenerating.current,
      draftKey === "" ? [] : draftKey.split(","),
    );
    previousGenerating.current = generatingKey === "" ? [] : generatingKey.split(",");
    if (!finished) return;
    setAnnouncement("");
    const timer = setTimeout(
      () => setAnnouncement(GENERATION_FINISHED_ANNOUNCEMENT),
      ANNOUNCE_DELAY_MS,
    );
    return () => clearTimeout(timer);
  }, [generatingKey, draftKey]);

  return (
    <div aria-live="polite" aria-atomic="true" className="sr-only">
      {announcement}
    </div>
  );
}
