"use client";

// UI-SPEC Surface 2 "Loading" (Assumption 3): the list is server-rendered; while any row is
// GENERATING this calls router.refresh() every PROPOSAL_POLL_INTERVAL_MS and stops when none is.
// When the count of GENERATING rows goes down, a polite live region announces it. Focus is never
// moved (UI-SPEC 3i "Generation finished (polling)").

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { PROPOSAL_POLL_INTERVAL_MS } from "@/lib/kb/proposal-contract";
import { GENERATION_FINISHED_ANNOUNCEMENT } from "@/lib/kb/proposal-copy";

/** Delay between clearing and setting the announcement, so a repeat is announced again. */
const ANNOUNCE_DELAY_MS = 100;

export function ProposalListRefresh({ generatingCount }: { generatingCount: number }) {
  const router = useRouter();
  const previousCount = useRef(generatingCount);
  const [announcement, setAnnouncement] = useState("");

  useEffect(() => {
    if (generatingCount <= 0) return;
    const timer = setInterval(() => router.refresh(), PROPOSAL_POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [generatingCount, router]);

  useEffect(() => {
    const finished = generatingCount < previousCount.current;
    previousCount.current = generatingCount;
    if (!finished) return;
    setAnnouncement("");
    const timer = setTimeout(
      () => setAnnouncement(GENERATION_FINISHED_ANNOUNCEMENT),
      ANNOUNCE_DELAY_MS,
    );
    return () => clearTimeout(timer);
  }, [generatingCount]);

  return (
    <div aria-live="polite" aria-atomic="true" className="sr-only">
      {announcement}
    </div>
  );
}
