// The contact detail page loader (src/app/(app)/contacts/[id]/page.tsx). Phase 12.1 changed the
// page's ticket select (state name and colour through the composite relation), so under run
// decision K44 (as K31 in Phase 11) the loader is a rewritten path in the sense of D-01.
import type { PrismaClient } from "@/generated/prisma/client";
import { findActiveMembership } from "@/lib/membership";
import { scopedDb } from "@/lib/scoped-db";

export interface ContactDetailActor {
  userId: string;
  orgId: string;
}

async function findContact(orgId: string, contactId: string) {
  return scopedDb(orgId).contact.findFirst({
    where: { id: contactId },
    include: {
      tickets: {
        orderBy: { createdAt: "desc" },
        // Phase 12.1 (D-11 chips row): the state through the composite relation, so it is always
        // a state of the ticket's own organization; only its name and colour key are read.
        select: {
          id: true,
          number: true,
          subject: true,
          state: { select: { name: true, colorToken: true } },
          createdAt: true,
        },
      },
    },
  });
}

export type ContactDetail = NonNullable<Awaited<ReturnType<typeof findContact>>>;

export type ContactDetailData =
  | { status: "membership_ended" }
  | { status: "not_found" }
  | { status: "ok"; contact: ContactDetail };

/**
 * The contact and its tickets in the actor's organization. D-01: nothing is read before the
 * actor's member row is confirmed (getScopedDb does not check membership).
 */
export async function loadContactDetailData(
  client: PrismaClient,
  actor: ContactDetailActor,
  contactId: string,
): Promise<ContactDetailData> {
  if (!(await findActiveMembership(client, actor.userId, actor.orgId))) {
    return { status: "membership_ended" };
  }
  const contact = await findContact(actor.orgId, contactId);
  if (!contact) return { status: "not_found" };
  return { status: "ok", contact };
}
