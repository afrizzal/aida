"use server";

import { revalidatePath } from "next/cache";
import { requireOrgAdmin } from "@/lib/authz";
import {
  getLlmSettings,
  saveLlmSettings as persistLlmSettings,
} from "@/lib/llm/settings";
import { testProviderConnection } from "@/lib/llm/test-connection";
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
