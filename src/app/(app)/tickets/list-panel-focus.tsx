"use client";

import { useSearchParams } from "next/navigation";
import { useEffect } from "react";

// Focus hand-off after a saved view is deleted (Phase 11, AIDA-47, UI-SPEC Surface 2d: "after a
// delete, focus moves to the list panel's first focusable element"). The delete dialog lives in
// the saved-view strip, which unmounts once `sv` leaves the URL, so it cannot move focus itself.
// It raises a request; this component, rendered inside the list panel, honours it after the
// navigation has committed (the URL no longer carries `sv`).

export const LIST_PANEL_ID = "ticket-list-panel";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

let focusRequested = false;

/** Called by the delete dialog right before it navigates away from the deleted view. */
export function requestListPanelFocus() {
  focusRequested = true;
}

export function ListPanelFocus() {
  const sv = useSearchParams().get("sv");

  useEffect(() => {
    if (!focusRequested || sv) return;
    focusRequested = false;
    document.getElementById(LIST_PANEL_ID)?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
  }, [sv]);

  return null;
}
