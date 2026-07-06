import { prisma } from "./db";

// Org-scoped DOMAIN models only. Better Auth models (user/session/organization/member/invitation/account/verification)
// and global SystemSetting are intentionally EXCLUDED — they either have no organizationId field or are cross-tenant.
// TicketTag (join table, scoped via parent Ticket nested writes) and RateLimitHit (not tenant-scoped) are
// intentionally EXCLUDED too — see 02-RESEARCH.md.
// Append new org-scoped models here as future phases add them.
export const DOMAIN_MODELS = [
  "Setting",
  "Ticket",
  "Contact",
  "Message",
  "Tag",
  "SlaPolicy",
  "CustomFieldDefinition",
  "CustomFieldValue",
  "Attachment",
  "TicketCounter",
  "EmailIngestFailure",
] as const;

const isDomain = (model?: string): boolean =>
  !!model && (DOMAIN_MODELS as readonly string[]).includes(model);

/**
 * Returns a Prisma client that automatically injects `organizationId: orgId` into every
 * DOMAIN_MODELS query, preventing accidental cross-tenant data access.
 *
 * Usage:
 *   const db = scopedDb(orgId);
 *   await db.setting.findMany();  // auto-filtered to this org
 *   await db.setting.create({ data: { key: "k", value: "v" } });  // orgId auto-injected
 *
 * @param orgId - Non-empty organization ID string (from session.activeOrganizationId)
 */
export function scopedDb(orgId: string) {
  if (!orgId) throw new Error("scopedDb requires a non-empty organizationId");

  return prisma.$extends({
    query: {
      $allModels: {
        async findMany({ model, args, query }) {
          if (isDomain(model)) {
            // biome-ignore lint/suspicious/noExplicitAny: $allModels args union doesn't narrow to domain model types
            (args as any).where = { ...(args as any).where, organizationId: orgId };
          }
          return query(args);
        },
        async findFirst({ model, args, query }) {
          if (isDomain(model)) {
            // biome-ignore lint/suspicious/noExplicitAny: $allModels args union doesn't narrow to domain model types
            (args as any).where = { ...(args as any).where, organizationId: orgId };
          }
          return query(args);
        },
        async count({ model, args, query }) {
          if (isDomain(model)) {
            // biome-ignore lint/suspicious/noExplicitAny: $allModels args union doesn't narrow to domain model types
            (args as any).where = { ...(args as any).where, organizationId: orgId };
          }
          return query(args);
        },
        async create({ model, args, query }) {
          if (isDomain(model)) {
            // biome-ignore lint/suspicious/noExplicitAny: $allModels args union doesn't narrow to domain model types
            (args as any).data = { ...(args as any).data, organizationId: orgId };
          }
          return query(args);
        },
        async update({ model, args, query }) {
          if (isDomain(model)) {
            // biome-ignore lint/suspicious/noExplicitAny: $allModels args union doesn't narrow to domain model types
            (args as any).where = { ...(args as any).where, organizationId: orgId };
          }
          return query(args);
        },
        async updateMany({ model, args, query }) {
          if (isDomain(model)) {
            // biome-ignore lint/suspicious/noExplicitAny: $allModels args union doesn't narrow to domain model types
            (args as any).where = { ...(args as any).where, organizationId: orgId };
          }
          return query(args);
        },
        async upsert({ model, args, query }) {
          if (isDomain(model)) {
            // biome-ignore lint/suspicious/noExplicitAny: $allModels args union doesn't narrow to domain model types
            (args as any).where = { ...(args as any).where, organizationId: orgId };
            (args as any).create = { ...(args as any).create, organizationId: orgId };
          }
          return query(args);
        },
        async delete({ model, args, query }) {
          if (isDomain(model)) {
            // biome-ignore lint/suspicious/noExplicitAny: $allModels args union doesn't narrow to domain model types
            (args as any).where = { ...(args as any).where, organizationId: orgId };
          }
          return query(args);
        },
        async deleteMany({ model, args, query }) {
          if (isDomain(model)) {
            // biome-ignore lint/suspicious/noExplicitAny: $allModels args union doesn't narrow to domain model types
            (args as any).where = { ...(args as any).where, organizationId: orgId };
          }
          return query(args);
        },
      },
    },
  });
}
