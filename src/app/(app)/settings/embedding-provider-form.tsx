"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod/v4";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EMBEDDING_MODEL_CATALOG, type EmbeddingProviderName } from "@/lib/rag/types";
import type { EmbeddingSettingsInput } from "./actions";
import { saveEmbeddingSettings } from "./actions";
import { EmbeddingTestConnectionButton } from "./embedding-test-connection-button";

/** Sentinel Select value for "Custom model ID" — never persisted, resolved away before submit. */
const CUSTOM_MODEL_VALUE = "__custom__";

const PROVIDER_LABELS: Record<EmbeddingProviderName, string> = {
  openai: "OpenAI",
  ollama: "Ollama",
};

const formSchema = z.object({
  provider: z.enum(["openai", "ollama"]),
  // Either an EMBEDDING_MODEL_CATALOG entry for the selected provider, or the
  // CUSTOM_MODEL_VALUE sentinel (in which case `customModel` holds the actual free-text model
  // ID, mirrors llm-provider-form's D-01 pattern).
  modelSelect: z.string().min(1, "Select a model"),
  customModel: z.string().optional(),
  // Optional: blank = keep the existing stored key (server-side "keep existing" contract).
  apiKey: z.string().optional(),
  ollamaBaseUrl: z.string().optional(),
});

type FormValues = z.infer<typeof formSchema>;

interface EmbeddingProviderFormProps {
  /** Never receives the decrypted API key — only provider/model/base-URL round-trip to the client. */
  initial: {
    provider: "" | EmbeddingProviderName;
    model: string;
    ollamaBaseUrl: string;
  };
}

function resolveInitialModelSelect(
  provider: EmbeddingProviderName,
  model: string,
): { modelSelect: string; customModel: string } {
  const catalog: readonly string[] = EMBEDDING_MODEL_CATALOG[provider];
  if (model && catalog.includes(model)) {
    return { modelSelect: model, customModel: "" };
  }
  if (model) {
    return { modelSelect: CUSTOM_MODEL_VALUE, customModel: model };
  }
  return { modelSelect: catalog[0] ?? CUSTOM_MODEL_VALUE, customModel: "" };
}

/** Resolves the form's split modelSelect/customModel fields back into a single model string. */
function resolveModel(values: Pick<FormValues, "modelSelect" | "customModel">): string {
  return values.modelSelect === CUSTOM_MODEL_VALUE
    ? (values.customModel ?? "").trim()
    : values.modelSelect;
}

/**
 * The "Embedding Provider" card on the AI Features settings page — a SEPARATE provider/model/
 * credential config from the chat provider (Decision 5): an Anthropic-for-chat org has no
 * embeddings API, so RAG retrieval requires its own OpenAI/Ollama config here. Mirrors
 * LlmProviderForm's react-hook-form + zod/v4 + shadcn Form shape exactly, including the
 * `key={provider}` stale-options fix (04-07) on the Model Select.
 */
export function EmbeddingProviderForm({ initial }: EmbeddingProviderFormProps) {
  const initialProvider: EmbeddingProviderName = initial.provider || "openai";
  const { modelSelect, customModel } = resolveInitialModelSelect(initialProvider, initial.model);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      provider: initialProvider,
      modelSelect,
      customModel,
      apiKey: "",
      ollamaBaseUrl: initial.ollamaBaseUrl,
    },
  });

  const provider = form.watch("provider");
  const isCustomModel = form.watch("modelSelect") === CUSTOM_MODEL_VALUE;

  function handleProviderChange(next: EmbeddingProviderName) {
    form.setValue("provider", next);
    // Provider changed — the previously selected model almost certainly doesn't belong to the
    // new provider's catalog, so reset the model selection (mirrors D-01's auto-reset behavior).
    const catalog = EMBEDDING_MODEL_CATALOG[next];
    form.setValue("modelSelect", catalog[0] ?? CUSTOM_MODEL_VALUE);
    form.setValue("customModel", "");
  }

  function buildInput(values: FormValues): EmbeddingSettingsInput | null {
    const model = resolveModel(values);
    if (!model) return null;
    return {
      provider: values.provider,
      model,
      apiKey: values.provider === "ollama" ? undefined : values.apiKey,
      ollamaBaseUrl: values.provider === "ollama" ? values.ollamaBaseUrl : undefined,
    };
  }

  async function onSubmit(values: FormValues) {
    const input = buildInput(values);
    if (!input) {
      form.setError("customModel", { message: "Enter a custom model ID" });
      return;
    }

    const result = await saveEmbeddingSettings(input).catch(() => null);
    if (result?.ok) {
      toast.success("Embedding provider settings saved.");
    } else {
      toast.error("Failed to save embedding provider settings. Please try again.");
    }
  }

  async function getTestValues(): Promise<EmbeddingSettingsInput | null> {
    const fieldsToValidate: Array<keyof FormValues> = ["provider", "modelSelect"];
    if (isCustomModel) fieldsToValidate.push("customModel");
    if (provider === "ollama") fieldsToValidate.push("ollamaBaseUrl");
    else fieldsToValidate.push("apiKey");

    const valid = await form.trigger(fieldsToValidate);
    if (!valid) return null;

    return buildInput(form.getValues());
  }

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className="space-y-4 rounded-lg border border-border/70 p-4"
      >
        <div className="space-y-1">
          <p className="text-[12px] font-medium uppercase tracking-wide text-muted-foreground">
            Embedding Provider
          </p>
          <p className="text-[12px] text-muted-foreground">
            Anthropic has no embeddings API — choose OpenAI or Ollama for retrieval.
          </p>
        </div>

        <FormField
          control={form.control}
          name="provider"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-[13px] font-normal text-muted-foreground">
                Provider
              </FormLabel>
              <Select
                value={field.value}
                onValueChange={(v) => handleProviderChange(v as EmbeddingProviderName)}
              >
                <FormControl>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select a provider" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {(Object.keys(PROVIDER_LABELS) as EmbeddingProviderName[]).map((p) => (
                    <SelectItem key={p} value={p}>
                      {PROVIDER_LABELS[p]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="modelSelect"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-[13px] font-normal text-muted-foreground">Model</FormLabel>
              <Select key={provider} value={field.value} onValueChange={field.onChange}>
                <FormControl>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select a model" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {EMBEDDING_MODEL_CATALOG[provider].map((m) => (
                    <SelectItem key={m} value={m}>
                      {m}
                    </SelectItem>
                  ))}
                  <SelectItem value={CUSTOM_MODEL_VALUE}>Custom…</SelectItem>
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />

        {isCustomModel && (
          <FormField
            control={form.control}
            name="customModel"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-[13px] font-normal text-muted-foreground">
                  Custom model ID
                </FormLabel>
                <FormControl>
                  <Input placeholder="e.g. text-embedding-3-large" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        )}

        {provider !== "ollama" && (
          <FormField
            control={form.control}
            name="apiKey"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-[13px] font-normal text-muted-foreground">
                  API key
                </FormLabel>
                <FormControl>
                  <Input type="password" placeholder="••••••••" {...field} />
                </FormControl>
                <p className="text-[12px] text-muted-foreground">
                  Leave blank to keep the currently saved key. Leave blank to reuse your chat
                  provider's key when the same provider.
                </p>
                <FormMessage />
              </FormItem>
            )}
          />
        )}

        {provider === "ollama" && (
          <FormField
            control={form.control}
            name="ollamaBaseUrl"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-[13px] font-normal text-muted-foreground">
                  Base URL
                </FormLabel>
                <FormControl>
                  <Input placeholder="http://localhost:11434" {...field} />
                </FormControl>
                <p className="text-[12px] text-muted-foreground">
                  Leave blank to reuse your chat provider's base URL when the same provider.
                </p>
                <FormMessage />
              </FormItem>
            )}
          />
        )}

        <EmbeddingTestConnectionButton getValues={getTestValues} />

        <Button type="submit" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting && <Loader2 className="mr-2 size-4 animate-spin" />}
          Save embedding provider
        </Button>
      </form>
    </Form>
  );
}
