"use server";

import { revalidatePath } from "next/cache";
import type { CustomFieldType } from "@/generated/prisma/client";
import { Prisma } from "@/generated/prisma/client";
import { requireOrgAdminScope } from "@/lib/authz";
import {
  type MembershipEndedNotice,
  type MembershipEndedRefusal,
  membershipEnded,
  membershipEndedNotice,
  nullOnAccessDenied,
} from "@/lib/membership";

interface CustomFieldInput {
  label: string;
  type: CustomFieldType;
  options?: string[];
}

function normalizeOptions(input: CustomFieldInput) {
  if (input.type !== "SELECT") return Prisma.JsonNull;
  const cleaned = (input.options ?? []).map((o) => o.trim()).filter(Boolean);
  return cleaned;
}

/**
 * Creates a custom field definition. SELECT type requires at least one non-empty option.
 * Admin-gated (SECURITY.md: server-side authz on every mutating settings action).
 */
export async function createCustomField(
  input: CustomFieldInput,
): Promise<{ ok: boolean; error?: string } | MembershipEndedNotice> {
  const scope = await requireOrgAdminScope().catch(nullOnAccessDenied);
  if (!scope) return membershipEndedNotice();
  const { db, orgId } = scope;

  const label = input.label.trim();
  if (!label) return { ok: false, error: "Label is required" };

  const options = normalizeOptions(input);
  if (input.type === "SELECT" && (!Array.isArray(options) || options.length === 0)) {
    return { ok: false, error: "Dropdown fields need at least one option" };
  }

  const position = await db.customFieldDefinition.count();

  await db.customFieldDefinition.create({
    data: {
      organizationId: orgId,
      label,
      type: input.type,
      options,
      position,
    },
  });

  revalidatePath("/settings/custom-fields");
  return { ok: true };
}

export async function updateCustomField(
  id: string,
  input: CustomFieldInput,
): Promise<{ ok: boolean; error?: string } | MembershipEndedNotice> {
  const scope = await requireOrgAdminScope().catch(nullOnAccessDenied);
  if (!scope) return membershipEndedNotice();
  const { db } = scope;

  const label = input.label.trim();
  if (!label) return { ok: false, error: "Label is required" };

  const options = normalizeOptions(input);
  if (input.type === "SELECT" && (!Array.isArray(options) || options.length === 0)) {
    return { ok: false, error: "Dropdown fields need at least one option" };
  }

  await db.customFieldDefinition.update({
    where: { id },
    data: { label, type: input.type, options },
  });

  revalidatePath("/settings/custom-fields");
  return { ok: true };
}

/**
 * Deletes a custom field definition. CustomFieldValue rows cascade via schema
 * onDelete: Cascade, permanently removing per-ticket values for this field.
 */
export async function deleteCustomField(
  id: string,
): Promise<{ ok: boolean } | MembershipEndedRefusal> {
  const scope = await requireOrgAdminScope().catch(nullOnAccessDenied);
  if (!scope) return membershipEnded();
  const { db } = scope;

  await db.customFieldDefinition.delete({ where: { id } });

  revalidatePath("/settings/custom-fields");
  return { ok: true };
}
