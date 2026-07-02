"use server";

import { revalidatePath } from "next/cache";
import { getScopedDb } from "@/lib/session";

/**
 * Persists a contact's free-form Notes field. Autosaved on blur from the
 * contact detail page's NotesForm client component.
 */
export async function saveContactNotes(
  contactId: string,
  notes: string,
): Promise<{ ok: boolean }> {
  const { db } = await getScopedDb();

  await db.contact.update({
    where: { id: contactId },
    data: { notes },
  });

  revalidatePath(`/contacts/${contactId}`);
  return { ok: true };
}
