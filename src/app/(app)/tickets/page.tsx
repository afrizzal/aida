import { MessageSquare } from "lucide-react";
import { Suspense } from "react";
import { EmptyState } from "@/components/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { TicketListPanel } from "./ticket-list-panel";
import { TicketListSkeleton } from "./ticket-list-row";

interface TicketsPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function TicketsPage({ searchParams }: TicketsPageProps) {
  const params = await searchParams;

  return (
    <>
      <Suspense fallback={<TicketListPanelSkeleton />}>
        <TicketListPanel searchParams={params} />
      </Suspense>
      <div className="flex flex-1 items-center justify-center overflow-y-auto">
        <EmptyState
          icon={MessageSquare}
          heading="Select a ticket"
          body="Choose a ticket from the list to view the conversation."
        />
      </div>
    </>
  );
}

function TicketListPanelSkeleton() {
  return (
    <aside className="flex h-full w-[360px] shrink-0 flex-col overflow-y-auto border-r border-border">
      <div className="flex h-14 items-center gap-2 border-b border-border px-4">
        <Skeleton className="h-8 w-24 rounded-full" />
        <Skeleton className="h-8 w-24 rounded-full" />
        <Skeleton className="ml-auto h-8 w-[180px]" />
      </div>
      <TicketListSkeleton />
    </aside>
  );
}
