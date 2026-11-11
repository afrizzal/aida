"use server";

import { revalidatePath } from "next/cache";
import { type MembershipEndedRefusal, membershipEnded, nullOnAccessDenied } from "@/lib/membership";
import { getScopedDb } from "@/lib/session";

/**
 * Persists a contact's free-form Notes field. Autosaved on blur from the
 * contact detail page's NotesForm client component.
 */
export async function saveContactNotes(
  contactId: string,
  notes: string,
): Promise<{ ok: boolean } | MembershipEndedRefusal> {
  const scope = await getScopedDb().catch(nullOnAccessDenied);
  if (!scope) return membershipEnded();
  const { db } = scope;

  await db.contact.update({
    where: { id: contactId },
    data: { notes },
  });

  revalidatePath(`/contacts/${contactId}`);
  return { ok: true };
}
