import Link from "next/link";

export interface DraftCitationListItem {
  marker: string;
  articleId: string;
  title: string;
  headingPath: string | null;
}

/**
 * Presentational list of the KB articles a grounded draft cited (AIDA-16). Renders nothing
 * when there are no citations — the ungrounded "no relevant sources" state (draft-card.tsx)
 * never reaches this component at all. Pure presentation, no data fetching.
 */
export function DraftCitationList({ citations }: { citations: DraftCitationListItem[] }) {
  if (citations.length === 0) return null;

  return (
    <ul className="mt-2 space-y-1">
      {citations.map((citation) => (
        <li key={`${citation.marker}-${citation.articleId}`} className="text-[12px]">
          <span className="text-muted-foreground">[{citation.marker}]</span>{" "}
          <Link href={`/kb/${citation.articleId}`} className="text-primary hover:underline">
            {citation.title}
          </Link>
          {citation.headingPath && (
            <span className="text-muted-foreground"> · {citation.headingPath}</span>
          )}
        </li>
      ))}
    </ul>
  );
}
