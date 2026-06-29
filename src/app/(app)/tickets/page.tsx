import { Inbox } from "lucide-react";
import { EmptyState } from "@/components/empty-state";

export default function TicketsPage() {
  return (
    <EmptyState
      icon={Inbox}
      heading="Your inbox is empty"
      body="New tickets from customers will appear here. Set up an email channel or embed a web form to start receiving requests."
    />
  );
}
