import { getLlmSettings, isProviderConfigured } from "@/lib/llm/settings";
import { getEmbeddingSettings, isEmbeddingConfigured } from "@/lib/rag/settings";
import { getScopedDb } from "@/lib/session";
import { AiToggle } from "./ai-toggle";
import { EmbeddingProviderForm } from "./embedding-provider-form";
import { LlmProviderForm } from "./llm-provider-form";
import { ReembedAllButton } from "./reembed-all-button";

// This page reads DB state (aiEnabled + llm:* settings) at request time — never statically
// prerendered during `next build` (mirrors /setup and /login's `force-dynamic` precedent).
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const { db } = await getScopedDb();

  const setting = await db.setting.findFirst({ where: { key: "aiEnabled" } });
  // Default false (D-18): AI is off until explicitly enabled by the operator
  const aiEnabled = setting?.value === "true";

  const llmSettings = await getLlmSettings(db);
  const providerConfigured = isProviderConfigured(llmSettings);

  const embeddingSettings = await getEmbeddingSettings(db);
  // Computed independently from providerConfigured — the embedding provider is a SEPARATE
  // capability from the chat provider (Decision 5).
  const embeddingConfigured = await isEmbeddingConfigured(db);
  const articleCount = await db.kbArticle.count();

  return (
    <div className="space-y-6">
      <h1 className="text-[18px] font-semibold">AI Features</h1>
      <LlmProviderForm
        initial={{
          provider: llmSettings.provider,
          model: llmSettings.model,
          ollamaBaseUrl: llmSettings.ollamaBaseUrl,
        }}
      />
      <div className="space-y-3">
        <EmbeddingProviderForm
          initial={{
            provider: embeddingSettings.provider,
            model: embeddingSettings.model,
            ollamaBaseUrl: embeddingSettings.ollamaBaseUrl,
          }}
        />
        {embeddingConfigured && <ReembedAllButton articleCount={articleCount} />}
      </div>
      <AiToggle defaultEnabled={aiEnabled} providerConfigured={providerConfigured} />
    </div>
  );
}
