import { KbArticleForm } from "@/components/kb/kb-article-form";

export const dynamic = "force-dynamic";

/**
 * No page-level admin guard — authorization is enforced inside the createKbArticleAction
 * Server Action (requireOrgAdmin), matching the SLA/Tags/Custom-Fields precedent where
 * authorization is action-gated, not page-gated.
 */
export default function NewKbArticlePage() {
  return (
    <div className="flex flex-col gap-6 px-6 py-6">
      <h1 className="text-[18px] font-semibold tracking-tight text-foreground">New article</h1>
      <KbArticleForm mode="create" />
    </div>
  );
}
