import { getLlmSettings, isProviderConfigured } from "@/lib/llm/settings";
import { getScopedDb } from "@/lib/session";
import { AiToggle } from "./ai-toggle";
import { LlmProviderForm } from "./llm-provider-form";

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
      <AiToggle defaultEnabled={aiEnabled} providerConfigured={providerConfigured} />
    </div>
  );
}
