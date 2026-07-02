// ONLY raw-SQL call site against Ticket/Message. organizationId filter is mandatory —
// scopedDb does NOT intercept $queryRaw (cross-tenant leak otherwise).
import { prisma } from "@/lib/db";

export interface TicketSearchRow {
  id: string;
  number: number;
  subject: string;
  status: string;
  priority: string;
}

export async function searchTickets(
  orgId: string,
  queryText: string,
  limit = 25,
): Promise<TicketSearchRow[]> {
  return prisma.$queryRaw<TicketSearchRow[]>`
    SELECT t.id, t.number, t.subject, t.status, t.priority
    FROM "Ticket" t
    WHERE t."organizationId" = ${orgId}
      AND (
        t."searchVector" @@ websearch_to_tsquery('english', ${queryText})
        OR EXISTS (
          SELECT 1 FROM "Message" m
          WHERE m."ticketId" = t.id
            AND m."searchVector" @@ websearch_to_tsquery('english', ${queryText})
        )
      )
    ORDER BY ts_rank(t."searchVector", websearch_to_tsquery('english', ${queryText})) DESC
    LIMIT ${limit};
  `;
}
