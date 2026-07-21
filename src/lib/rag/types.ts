// Embedding-port types — mirrors src/lib/llm/types.ts structurally but scoped to embeddings
// only. Anthropic is deliberately excluded: it has no embeddings API (Pitfall 1).
export type EmbeddingProviderName = "openai" | "ollama";

export const EMBEDDING_DIMENSIONS = 768 as const;

export const EMBEDDING_MODEL_CATALOG: Record<EmbeddingProviderName, readonly string[]> = {
  openai: ["text-embedding-3-small", "text-embedding-3-large"],
  ollama: ["nomic-embed-text"],
} as const;
