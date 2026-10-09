// The KB article reads of the KB pages and the settings page, kept out of the server components so
// a test can run the exact query a page runs against a real Postgres (Phase 12.2 D-05, review
// c-WR-04: the reader-isolation test calls these, not a copy of their query).
//
// Each takes the organization-scoped client the page already holds (scopedDb), so the
// organization term comes from scopedDb as before. They read KbArticle only.
import type { scopedDb } from "../scoped-db";

type ScopedDb = ReturnType<typeof scopedDb>;

/** The /kb list: every article of the organization, most recently updated first. */
export function listKbArticles(db: ScopedDb) {
  return db.kbArticle.findMany({
    orderBy: { updatedAt: "desc" },
    select: { id: true, title: true, slug: true, embeddingStatus: true, updatedAt: true },
  });
}

/** The /kb/[id] loader: the article with this id in the organization, or null. */
export function findKbArticle(db: ScopedDb, id: string) {
  return db.kbArticle.findFirst({ where: { id } });
}

/** The settings page's article count (shown by "Re-embed all KB articles"). */
export function countKbArticles(db: ScopedDb) {
  return db.kbArticle.count();
}
