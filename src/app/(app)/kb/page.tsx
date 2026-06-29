import { BookOpen } from "lucide-react";
import { EmptyState } from "@/components/empty-state";

export default function KbPage() {
  return (
    <EmptyState
      icon={BookOpen}
      heading="No articles yet"
      body="Create knowledge base articles to help your team answer customer questions consistently."
    />
  );
}
