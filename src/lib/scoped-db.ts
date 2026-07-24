import { prisma } from "./db";

// Org-scoped DOMAIN models only. Better Auth models (user/session/organization/member/invitation/account/verification)
// and global SystemSetting are intentionally EXCLUDED — they either have no organizationId field or are cross-tenant.
// TicketTag (join table, scoped via parent Ticket nested writes) and RateLimitHit (not tenant-scoped) are
// intentionally EXCLUDED too — see 02-RESEARCH.md.
// Append new org-scoped models here as future phases add them.
//
// KbChunk.embedding is an `Unsupported("vector(768)")` field, invisible to Prisma's
// create/update hooks below — scopedDb still auto-injects organizationId correctly into
// every OTHER field for KbArticle/KbChunk. All vector I/O (insert/read/similarity search)
// is done via raw SQL with an explicit organizationId filter, mirroring the searchTickets
// FTS precedent (scopedDb does not intercept $queryRaw).
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
  "AuditEvent",
  "KbArticle",
  "KbChunk",
  "InsightRun",
  "TicketEmbedding",
  "CsatResponse",
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
const WHERE_SCOPED_OPERATIONS = new Set([
  "findMany",
  "findFirst",
  "count",
  "update",
  "updateMany",
  "upsert",
  "delete",
  "deleteMany",
]);

export function scopedDb(orgId: string) {
  if (!orgId) throw new Error("scopedDb requires a non-empty organizationId");

  return prisma.$extends({
    query: {
      $allModels: {
        // Single $allOperations hook (rather than one handler per operation name) because
        // KbChunk's Unsupported("vector(768)") field makes Prisma drop `create`/`upsert` from
        // $allModels' generated per-model operation union — enumerating those operation names
        // as object literal keys then fails to typecheck. $allOperations sidesteps that; all
        // vector I/O for KbChunk is raw SQL anyway, so this hook only needs to handle the
        // organizationId injection for every OTHER field, same as before.
        async $allOperations({
          model,
          operation,
          args,
          query,
        }: {
          model?: string;
          operation: string;
          // biome-ignore lint/suspicious/noExplicitAny: Prisma's $allOperations args/query types don't narrow to domain model shapes
          args: any;
          // biome-ignore lint/suspicious/noExplicitAny: Prisma's $allOperations args/query types don't narrow to domain model shapes
          query: (args: any) => Promise<any>;
        }) {
          if (isDomain(model)) {
            if (operation === "create") {
              args.data = { ...args.data, organizationId: orgId };
            } else if (operation === "upsert") {
              args.where = { ...args.where, organizationId: orgId };
              args.create = { ...args.create, organizationId: orgId };
            } else if (WHERE_SCOPED_OPERATIONS.has(operation)) {
              args.where = { ...args.where, organizationId: orgId };
            }
          }
          return query(args);
        },
      },
    },
  });
}
