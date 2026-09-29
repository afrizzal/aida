// ONLY raw-SQL call site against Ticket/Message. organizationId filter is mandatory —
// scopedDb does NOT intercept $queryRaw (cross-tenant leak otherwise).
// Phase 12.1 (D-04, D-11): the ticket's state is read through a join that carries the
// organization term too (s."organizationId" = t."organizationId"), so a row never takes the name
// or colour of another organization's state; only stateName and colorToken leave the state.
import { prisma } from "@/lib/db";

export interface TicketSearchRow {
  id: string;
  number: number;
  subject: string;
  stateName: string;
  colorToken: string;
  priority: string;
}

export async function searchTickets(
  orgId: string,
  queryText: string,
  limit = 25,
): Promise<TicketSearchRow[]> {
  return prisma.$queryRaw<TicketSearchRow[]>`
    SELECT t.id, t.number, t.subject, s.name AS "stateName", s."colorToken", t.priority
    FROM "Ticket" t
    JOIN "TicketState" s
      ON s.id = t."stateId" AND s."organizationId" = t."organizationId"
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
