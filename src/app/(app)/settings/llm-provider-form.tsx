"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod/v4";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MODEL_CATALOG } from "@/lib/llm/types";
import type { LlmSettingsInput } from "./actions";
import { saveLlmSettings } from "./actions";
import { LlmTestConnectionButton } from "./llm-test-connection-button";

type ProviderName = "openai" | "anthropic" | "ollama";

/** Sentinel Select value for "Custom model ID" — never persisted, resolved away before submit. */
const CUSTOM_MODEL_VALUE = "__custom__";

const PROVIDER_LABELS: Record<ProviderName, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  ollama: "Ollama",
};

const formSchema = z.object({
  provider: z.enum(["openai", "anthropic", "ollama"]),
  // Either a MODEL_CATALOG entry for the selected provider, or the CUSTOM_MODEL_VALUE sentinel
  // (in which case `customModel` holds the actual free-text model ID, D-01).
  modelSelect: z.string().min(1, "Select a model"),
  customModel: z.string().optional(),
  // Optional: blank = keep the existing stored key (server-side "keep existing" contract).
  apiKey: z.string().optional(),
  ollamaBaseUrl: z.string().optional(),
});

type FormValues = z.infer<typeof formSchema>;

interface LlmProviderFormProps {
  /** Never receives the decrypted API key — only provider/model/base-URL round-trip to the client. */
  initial: {
    provider: "" | ProviderName;
    model: string;
    ollamaBaseUrl: string;
  };
}

function resolveInitialModelSelect(
  provider: ProviderName,
  model: string,
): { modelSelect: string; customModel: string } {
  const catalog: readonly string[] = MODEL_CATALOG[provider];
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
  return values.modelSelect === CUSTOM_MODEL_VALUE ? (values.customModel ?? "").trim() : values.modelSelect;
}

/**
 * The "AI Provider" card on the AI Features settings page — provider dropdown, curated model
 * dropdown + custom-ID free-text fallback (D-01), provider-specific credential field
 * (encrypted API key for OpenAI/Anthropic, base URL only for Ollama per D-03), Test Connection
 * (D-04), and a Save submit. Mirrors EmailSettingsForm's react-hook-form + zod/v4 + shadcn Form
 * shape exactly.
 */
export function LlmProviderForm({ initial }: LlmProviderFormProps) {
  const initialProvider: ProviderName = initial.provider || "openai";
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

  function handleProviderChange(next: ProviderName) {
    form.setValue("provider", next);
    // Provider changed — the previously selected model almost certainly doesn't belong to the
    // new provider's catalog, so reset the model selection (D-01: default back to the new
    // provider's first curated model, letting the operator switch to Custom… again if needed).
    const catalog = MODEL_CATALOG[next];
    form.setValue("modelSelect", catalog[0] ?? CUSTOM_MODEL_VALUE);
    form.setValue("customModel", "");
  }

  function buildInput(values: FormValues): LlmSettingsInput | null {
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

    const result = await saveLlmSettings(input).catch(() => null);
    if (result?.ok) {
      toast.success("AI provider settings saved.");
    } else {
      toast.error("Failed to save AI provider settings. Please try again.");
    }
  }

  async function getTestValues(): Promise<LlmSettingsInput | null> {
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
        <p className="text-[12px] font-medium uppercase tracking-wide text-muted-foreground">
          AI Provider
        </p>

        <FormField
          control={form.control}
          name="provider"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-[13px] font-normal text-muted-foreground">
                Provider
              </FormLabel>
              <Select value={field.value} onValueChange={(v) => handleProviderChange(v as ProviderName)}>
                <FormControl>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select a provider" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {(Object.keys(PROVIDER_LABELS) as ProviderName[]).map((p) => (
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
              <Select value={field.value} onValueChange={field.onChange}>
                <FormControl>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select a model" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {MODEL_CATALOG[provider].map((m) => (
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
                  <Input placeholder="e.g. gpt-5.4-preview" {...field} />
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
                  Leave blank to keep the currently saved key.
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
                <FormMessage />
              </FormItem>
            )}
          />
        )}

        <LlmTestConnectionButton getValues={getTestValues} />

        <Button type="submit" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting && <Loader2 className="mr-2 size-4 animate-spin" />}
          Save AI provider
        </Button>
      </form>
    </Form>
  );
}
