import { renderMarkdown } from "@/lib/markdown/render";
import { getBoss } from "@/lib/queue/boss-client";
import { scopedDb } from "@/lib/scoped-db";

/** lowercase, non-alphanumeric -> "-", collapse repeats, trim leading/trailing "-". */
function slugify(title: string): string {
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
