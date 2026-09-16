// What the sidebar and the inbox strip render when a saved-view read fails (Phase 11, AIDA-47,
// UI-SPEC Surfaces 1 and 2b). The two reads of the service, listSavedViewsForViewer and
// getSavedViewForPanel, THROW SavedViewError("MEMBERSHIP_ENDED") (11-03). The (app) layout and
// TicketListPanel pass their read through these wrappers, so a removed member never reaches an
// error boundary:
//   - sidebarViewsOrEmpty: any failure gives empty lists (UI-SPEC E1 error: the sidebar renders
//     the nav and the "Views empty" line) and one log line without view names.
//   - panelOrMembershipEnded: MEMBERSHIP_ENDED gives { status: "membership_ended" }; the strip
//     shows the "membership ended" copy and the list keeps the URL filters. Any other error is
//     rethrown (the list itself cannot load then either).
// Relative imports only and no Next.js import.
import { SavedViewError, type SavedViewListItem, type SavedViewPanel } from "./service";

export interface SidebarViews {
  private: SavedViewListItem[];
  shared: SavedViewListItem[];
}

function reason(err: unknown): string {
  if (err instanceof SavedViewError) return err.code;
  if (err instanceof Error) return err.name;
  return "unknown error";
}

/** Runs the sidebar read; empty lists when it fails. */
export async function sidebarViewsOrEmpty(
  load: () => Promise<SidebarViews>,
): Promise<SidebarViews> {
  try {
    return await load();
  } catch (err) {
    // Never a view name or filter text in a log line.
    console.error(`[saved-views] sidebar views not loaded: ${reason(err)}`);
    return { private: [], shared: [] };
  }
}

export type SavedViewPanelState = SavedViewPanel | { status: "membership_ended" };

/** Runs the strip read; a removed member gets membership_ended instead of a throw. */
export async function panelOrMembershipEnded(
  load: () => Promise<SavedViewPanel>,
): Promise<SavedViewPanelState> {
  try {
    return await load();
  } catch (err) {
    if (err instanceof SavedViewError && err.code === "MEMBERSHIP_ENDED") {
      return { status: "membership_ended" };
    }
    throw err;
  }
}
