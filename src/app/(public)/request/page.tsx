import { PublicPageShell } from "@/components/public/public-page-shell";
import { RequestForm } from "./request-form";

// Always server-render: no static prerender for a page whose form posts to a
// live Route Handler (avoids a stale export during `next build`).
export const dynamic = "force-dynamic";

export default function RequestPage() {
  return (
    <PublicPageShell maxWidth={640}>
      <RequestForm />
    </PublicPageShell>
  );
}
