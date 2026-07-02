// The (app) shell's <main> applies `p-6` uniformly (src/app/(app)/layout.tsx) so every
// other route gets consistent page padding. The shared inbox is the one route that needs
// an edge-to-edge 2-pane view instead — `-m-6` cancels that inherited padding exactly
// (canceling padding on all sides re-expands this box back to main's full border-box),
// and the explicit height accounts for the app TopBar (h-14 / 3.5rem) sitting above it.
//
// This is just the flex-row wrapper: the fixed-width `w-[360px]` list column itself is
// rendered by each route's own children (TicketListPanel, shared by page.tsx and the
// future tickets/[id]/page.tsx — see 02-08-PLAN.md Task 1), because Next.js layouts don't
// receive per-route searchParams needed to fetch the list.
export default function TicketsLayout({ children }: { children: React.ReactNode }) {
  return <div className="-m-6 flex h-[calc(100vh-3.5rem)] overflow-hidden">{children}</div>;
}
