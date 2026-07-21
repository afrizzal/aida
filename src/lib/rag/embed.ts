// The ONE embedding port entrypoint (mirrors src/lib/llm/complete.ts's dispatch shape): resolve
// the active embedding provider -> dispatch -> normalize/validate to EMBEDDING_DIMENSIONS.
// 05-03 (embed job) and 05-04 (retrieval query embedding) both call through here.
//
// Relative imports only (no `@/`) — worker-bundleable via esbuild.
import { embedOllama } from "./providers/ollama-embed";
import { embedOpenAi } from "./providers/openai-embed";
import type { SettingDb } from "./settings";
import { embeddingModelId, resolveEmbeddingProvider } from "./settings";
import { EMBEDDING_DIMENSIONS } from "./types";

export interface EmbedResult {
  embeddings: number[][];
  provider: string;
  model: string;
  embeddingModel: string;
}

export async function embed(db: SettingDb, texts: string[]): Promise<EmbedResult> {
  const r = await resolveEmbeddingProvider(db);

  let embeddings: number[][];
  switch (r.provider) {
    case "openai":
      embeddings = await embedOpenAi({ apiKey: r.apiKey, model: r.model, input: texts });
      break;
    case "ollama":
      embeddings = await embedOllama({ baseUrl: r.ollamaBaseUrl, model: r.model, input: texts });
      break;
    default:
      throw new Error(`Unsupported embedding provider: ${r.provider}`);
  }

  // Loud failure on a wrong-dimension vector rather than a silent bad insert later.
  for (const v of embeddings) {
    if (v.length !== EMBEDDING_DIMENSIONS) {
      throw new Error(
        `Embedding dimension mismatch: got ${v.length}, expected ${EMBEDDING_DIMENSIONS}`,
      );
    }
  }

  return { embeddings, provider: r.provider, model: r.model, embeddingModel: embeddingModelId(r) };
}
