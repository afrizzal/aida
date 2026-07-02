import { prisma } from "@/lib/db";
import { getScopedDb } from "@/lib/session";
import { TagManager } from "./tag-manager";

export default async function TagsPage() {
  const { db, orgId } = await getScopedDb();

  const tags = await db.tag.findMany({ orderBy: { name: "asc" } });

  // TicketTag is a join table, intentionally excluded from scopedDb's DOMAIN_MODELS
  // allowlist (src/lib/scoped-db.ts) — it has no organizationId column, so counts are
  // queried via bare `prisma`, scoped through the `tag` relation instead.
  const counts = await prisma.ticketTag.groupBy({
    by: ["tagId"],
    _count: true,
    where: { tag: { organizationId: orgId } },
  });
  const countByTagId = new Map(counts.map((c) => [c.tagId, c._count]));

  const rows = tags.map((tag) => ({
    id: tag.id,
    name: tag.name,
    count: countByTagId.get(tag.id) ?? 0,
  }));

  return (
    <div className="space-y-6">
      <h1 className="text-[18px] font-semibold">Tags</h1>
      <TagManager tags={rows} />
    </div>
  );
}
