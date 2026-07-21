"use server";

import { revalidatePath } from "next/cache";
import { requireOrgAdmin } from "@/lib/authz";
import { enqueueReembed } from "@/lib/kb/create-article";
import { getLlmSettings, saveLlmSettings as persistLlmSettings } from "@/lib/llm/settings";
import { testProviderConnection } from "@/lib/llm/test-connection";
import { testEmbeddingConnection as probeEmbeddingConnection } from "@/lib/rag/embed-test-connection";
import {
  getEmbeddingSettings,
  saveEmbeddingSettings as persistEmbeddingSettings,
} from "@/lib/rag/settings";
import { getScopedDb } from "@/lib/session";

/**
 * Persists the aiEnabled toggle to the org-scoped Setting table via scopedDb.
 * Uses findFirst + conditional create/update to avoid Prisma upsert where-clause
 * constraints with compound unique indexes — scopedDb injects organizationId on all
 * domain model operations, so the Setting is always tenant-scoped. (D-15, D-18)
 */
export async function setAiEnabled(enabled: boolean): Promise<{ ok: boolean }> {
  const { db, orgId } = await getScopedDb();

  const existing = await db.setting.findFirst({ where: { key: "aiEnabled" } });

  if (existing) {
    await db.setting.update({
      where: { id: existing.id },
      data: { value: String(enabled) },
    });
  } else {
    // Include organizationId explicitly — scopedDb also injects it at runtime,
    // but TypeScript requires it here since the Setting schema mandates the field.
    await db.setting.create({
      data: { organizationId: orgId, key: "aiEnabled", value: String(enabled) },
    });
  }

  revalidatePath("/settings");
  return { ok: true };
}

/** Mirrors the LLM provider form fields (settings/llm-provider-form.tsx). */
export interface LlmSettingsInput {
  provider: "openai" | "anthropic" | "ollama";
  model: string;
  /** Empty/undefined = keep the existing stored key (never round-trips plaintext to the UI). */
  apiKey?: string;
  ollamaBaseUrl?: string;
}

/**
 * Persists the provider/model/key/base-URL config. Admin-gated (SECURITY.md: server-side authz
 * on every mutating Settings Server Action). Blank apiKey is forwarded as-is — lib/llm/settings.ts
 * treats an empty/undefined key as "keep existing stored value" (mirrors saveEmailSettings).
 */
export async function saveLlmSettings(input: LlmSettingsInput): Promise<{ ok: boolean }> {
  await requireOrgAdmin();
  const { db, orgId } = await getScopedDb();

  try {
    await persistLlmSettings(db, orgId, {
      provider: input.provider,
      model: input.model,
      apiKey: input.apiKey,
      ollamaBaseUrl: input.ollamaBaseUrl,
    });
    revalidatePath("/settings");
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

/**
 * Real per-provider connectivity probe (D-04), mirroring testImapConnection/testSmtpConnection's
 * exact contract: 10s timeout (enforced inside testProviderConnection), falls back to the stored
 * decrypted key when the submitted form field is blank so an admin can Test without re-typing an
 * already-saved key, and never echoes the key in the returned error.
 */
export async function testLlmConnection(
  input: LlmSettingsInput,
): Promise<{ ok: boolean; error?: string }> {
  await requireOrgAdmin();
  const { db } = await getScopedDb();

  const apiKey = input.apiKey || (await getLlmSettings(db)).apiKey;

  try {
    await testProviderConnection({
      provider: input.provider,
      model: input.model,
      apiKey,
      ollamaBaseUrl: input.ollamaBaseUrl ?? "",
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String((e as Error).message).slice(0, 200) };
  }
}

/** Mirrors the embedding provider form fields (settings/embedding-provider-form.tsx). */
export interface EmbeddingSettingsInput {
  provider: "openai" | "ollama";
  model: string;
  /** Empty/undefined = keep the existing stored key (never round-trips plaintext to the UI). */
  apiKey?: string;
  ollamaBaseUrl?: string;
}

/**
 * Persists the embedding provider/model/key/base-URL config — an INDEPENDENT capability from the
 * chat provider (Decision 5: an Anthropic-for-chat org has no embeddings API, so RAG requires its
 * own OpenAI/Ollama config here). Admin-gated, mirrors saveLlmSettings' exact security contract.
 * Blank apiKey is forwarded as-is — lib/rag/settings.ts treats an empty/undefined key as "keep
 * existing stored value".
 */
export async function saveEmbeddingSettings(
  input: EmbeddingSettingsInput,
): Promise<{ ok: boolean }> {
  await requireOrgAdmin();
  const { db, orgId } = await getScopedDb();

  try {
    await persistEmbeddingSettings(db, orgId, {
      provider: input.provider,
      model: input.model,
      apiKey: input.apiKey,
      ollamaBaseUrl: input.ollamaBaseUrl,
    });
    revalidatePath("/settings");
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

/**
 * Real embedding-provider connectivity probe, mirroring testLlmConnection's exact contract: falls
 * back to the stored decrypted key when the submitted form field is blank, never echoes the key
 * in the returned error, and slices the error to 200 chars. Surfaces a clear failure for a
 * not-pulled Ollama embedding model or a bad key (Pitfall 8).
 */
export async function testEmbeddingConnection(
  input: EmbeddingSettingsInput,
): Promise<{ ok: boolean; error?: string }> {
  await requireOrgAdmin();
  const { db } = await getScopedDb();

  const apiKey = input.apiKey || (await getEmbeddingSettings(db)).apiKey;

  try {
    await probeEmbeddingConnection({
      provider: input.provider,
      model: input.model,
      apiKey,
      ollamaBaseUrl: input.ollamaBaseUrl ?? "",
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String((e as Error).message).slice(0, 200) };
  }
}

/**
 * Re-enqueues embedding for EVERY KB article in the org — used after changing the embedding
 * provider/model, since vectors from different models are not comparable (Pitfall 5: a partial
 * re-embed would leave the KB with mixed, non-comparable vector spaces). Admin-gated.
 */
export async function reembedAllKb(): Promise<{ ok: boolean; count: number }> {
  await requireOrgAdmin();
  const { db, orgId } = await getScopedDb();

  const articles = await db.kbArticle.findMany({ select: { id: true } });
  for (const article of articles) {
    await enqueueReembed(orgId, article.id);
  }

  revalidatePath("/settings");
  revalidatePath("/kb");

  return { ok: true, count: articles.length };
}
