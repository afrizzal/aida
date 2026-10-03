import { renderMarkdown } from "@/lib/markdown/render";
import { getBoss } from "@/lib/queue/boss-client";
import { scopedDb } from "@/lib/scoped-db";

/**
 * lowercase, non-alphanumeric -> "-", collapse repeats, trim leading/trailing "-". Shared by the
 * manual KB path and the proposal publish path (Phase 12.2, D-06).
 */
export function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Appends -2, -3, ... on a `[organizationId, slug]` collision (findFirst loop — scopedDb's
 * upsert hook can't inject organizationId into a compound-unique `where`, same reasoning as the
 * findOrCreateContact/scoped-tx precedent, so a plain findFirst + conditional suffix is used
 * instead of a unique-constraint retry).
 *
 * Phase 12.2 note (D-06, pattern finding C3): the proposal publish path deliberately differs. It
 * computes the slug with the same findFirst loop inside its transaction (createKbArticleInTx, with
 * an explicit organizationId term), and a unique violation of KbArticle (organizationId, slug)
 * raised by a concurrent publish rolls that whole transaction back and is retried with a fresh slug
 * (isSlugUniqueViolation, at most 3 attempts in proposal-review.ts). The retry is safe there
 * because the proposal's conditional claim update is part of the same transaction. This path
 * (createKbArticle) is unchanged.
 */
async function uniqueSlug(db: ReturnType<typeof scopedDb>, base: string): Promise<string> {
  const root = base || "article";
  let candidate = root;
  let n = 2;
  while (await db.kbArticle.findFirst({ where: { slug: candidate } })) {
    candidate = `${root}-${n}`;
    n += 1;
  }
  return candidate;
}

export interface CreateKbArticleInput {
  title: string;
  bodyMarkdown: string;
}

export interface CreateKbArticleResult {
  id: string;
}

/**
 * The ONE KB write path (mirrors createTicket's single-entrypoint discipline). Renders sanitized
 * HTML via the app's one Markdown authority, then enqueues the kb-embed-article job AFTER the
 * article row is committed — never inside a transaction (mirrors createTicket's post-commit
 * ai-triage enqueue).
 */
export async function createKbArticle(
  orgId: string,
  input: CreateKbArticleInput,
): Promise<CreateKbArticleResult> {
  const db = scopedDb(orgId);
  const slug = await uniqueSlug(db, slugify(input.title));

  // scopedDb's create hook injects organizationId at runtime; Prisma's generated
  // *UncheckedCreateInput type still requires it statically (same cast idiom as
  // create-ticket.ts's ticket.create/message.create).
  const article = await (
    db.kbArticle.create as (a: { data: Record<string, unknown> }) => Promise<{ id: string }>
  )({
    data: {
      title: input.title,
      slug,
      bodyMarkdown: input.bodyMarkdown,
      bodyHtml: renderMarkdown(input.bodyMarkdown),
      embeddingStatus: "PENDING",
    },
  });

  const boss = await getBoss();
  await boss.send("kb-embed-article", { articleId: article.id });

  return { id: article.id };
}

/** The transaction client createKbArticleInTx needs (global, scoped or interactive tx client). */
export interface KbArticleTxClient {
  kbArticle: {
    findFirst(args: {
      where: { organizationId: string; slug: string };
      select: { id: true };
    }): PromiseLike<{ id: string } | null>;
    create(args: {
      data: {
        organizationId: string;
        title: string;
        slug: string;
        bodyMarkdown: string;
        bodyHtml: string;
        embeddingStatus: "PENDING";
      };
      select: { id: true; slug: true };
    }): PromiseLike<{ id: string; slug: string }>;
  };
}

/** The same loop as uniqueSlug, on a transaction client with an explicit organizationId term. */
async function uniqueSlugInTx(tx: KbArticleTxClient, orgId: string, base: string): Promise<string> {
  const root = base || "article";
  let candidate = root;
  let n = 2;
  while (
    await tx.kbArticle.findFirst({
      where: { organizationId: orgId, slug: candidate },
      select: { id: true },
    })
  ) {
    candidate = `${root}-${n}`;
    n += 1;
  }
  return candidate;
}

/**
 * The transactional variant of createKbArticle for the proposal publish path (Phase 12.2, D-06):
 * computes the slug inside the caller's transaction and inserts the article with organizationId,
 * bodyHtml from renderMarkdown and embeddingStatus PENDING. It enqueues nothing: the caller sends
 * kb-embed-article after its transaction committed. A concurrent publish of the same slug makes
 * the insert fail with a unique violation (isSlugUniqueViolation); the caller retries its whole
 * transaction.
 */
export async function createKbArticleInTx(
  tx: KbArticleTxClient,
  orgId: string,
  input: CreateKbArticleInput,
): Promise<{ id: string; slug: string }> {
  const slug = await uniqueSlugInTx(tx, orgId, slugify(input.title));
  return tx.kbArticle.create({
    data: {
      organizationId: orgId,
      title: input.title,
      slug,
      bodyMarkdown: input.bodyMarkdown,
      bodyHtml: renderMarkdown(input.bodyMarkdown),
      embeddingStatus: "PENDING",
    },
    select: { id: true, slug: true },
  });
}

const SLUG_UNIQUE_INDEX = "KbArticle_organizationId_slug_key";

/**
 * True for a unique violation of KbArticle (organizationId, slug): Prisma P2002 naming the slug
 * target (with or without the pg driver adapter), or Postgres 23505 on
 * KbArticle_organizationId_slug_key. Any other error, including a unique violation of another
 * index, is false.
 */
export function isSlugUniqueViolation(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: unknown; meta?: unknown; message?: unknown; constraint?: unknown };
  const text = `${String(e.message ?? "")} ${JSON.stringify(e.meta ?? {})} ${String(e.constraint ?? "")}`;
  if (text.includes(SLUG_UNIQUE_INDEX)) return true;
  if (e.code === "23505") return false;
  if (e.code !== "P2002") return false;
  const meta = (e.meta ?? {}) as { target?: unknown; modelName?: unknown };
  const target = meta.target;
  if (Array.isArray(target)) return target.some((t) => String(t).includes("slug"));
  if (typeof target === "string") return target.includes("slug");
  if (meta.modelName !== undefined && meta.modelName !== "KbArticle") return false;
  return /"fields":\[[^\]]*slug/.test(JSON.stringify(e.meta ?? {}));
}

export interface UpdateKbArticleInput {
  title: string;
  bodyMarkdown: string;
}

export interface UpdateKbArticleResult {
  ok: boolean;
}

/**
 * Updates title/body, re-renders bodyHtml, and flips embeddingStatus back to PENDING (content
 * changed -> the existing chunks/embeddings are stale) before enqueuing a fresh
 * kb-embed-article job post-commit.
 */
export async function updateKbArticle(
  orgId: string,
  articleId: string,
  input: UpdateKbArticleInput,
): Promise<UpdateKbArticleResult> {
  const db = scopedDb(orgId);

  await db.kbArticle.update({
    where: { id: articleId },
    data: {
      title: input.title,
      bodyMarkdown: input.bodyMarkdown,
      bodyHtml: renderMarkdown(input.bodyMarkdown),
      embeddingStatus: "PENDING",
    },
  });

  const boss = await getBoss();
  await boss.send("kb-embed-article", { articleId });

  return { ok: true };
}

/**
 * Sets embeddingStatus back to PENDING and (re-)enqueues the kb-embed-article job without
 * touching title/body — reused by 05-05's "Re-embed all KB articles" admin action so that flow
 * never has to duplicate this enqueue logic.
 */
export async function enqueueReembed(orgId: string, articleId: string): Promise<void> {
  const db = scopedDb(orgId);
  await db.kbArticle.update({ where: { id: articleId }, data: { embeddingStatus: "PENDING" } });

  const boss = await getBoss();
  await boss.send("kb-embed-article", { articleId });
}
