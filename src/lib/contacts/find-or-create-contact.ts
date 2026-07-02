import type { scopedDb } from "@/lib/scoped-db";

export type FindOrCreateContactInput = {
  email: string;
  name?: string | null;
  phone?: string | null;
  company?: string | null;
};

// Narrowed to just the delegate this module needs so both a full scopedDb()
// client and an in-flight interactive-$transaction `tx` client (which lacks
// $connect/$disconnect/$extends/$transaction) satisfy this type structurally.
type ContactDb = Pick<ReturnType<typeof scopedDb>, "contact">;

/**
 * Auto-links (or creates) a Contact by normalized (lowercased, trimmed) email (D-07).
 * If an existing Contact is found, currently-null name/phone/company fields are
 * backfilled from the new input — fields are never overwritten once set.
 */
export async function findOrCreateContact(
  db: ContactDb,
  input: FindOrCreateContactInput,
): Promise<{ id: string }> {
  const email = input.email.trim().toLowerCase();

  const existing = await db.contact.findFirst({ where: { email } });
  if (existing) {
    const fill: Record<string, string> = {};
    if (!existing.name && input.name) fill.name = input.name;
    if (!existing.phone && input.phone) fill.phone = input.phone;
    if (!existing.company && input.company) fill.company = input.company;

    if (Object.keys(fill).length > 0) {
      await db.contact.update({ where: { id: existing.id }, data: fill });
    }
    return { id: existing.id };
  }

  // scopedDb's create hook injects organizationId at runtime; Prisma's generated
  // ContactUncheckedCreateInput type requires it statically. Cast narrowly (same
  // pattern established in tests/integration/scoped-tx.test.ts) to intentionally
  // omit it here.
  const created = await (
    db.contact.create as (a: { data: Record<string, unknown> }) => Promise<{ id: string }>
  )({
    data: {
      email,
      name: input.name ?? null,
      phone: input.phone ?? null,
      company: input.company ?? null,
    },
  });
  return { id: created.id };
}
