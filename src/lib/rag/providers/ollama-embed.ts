// Ollama embeddings adapter — uses the native `embed()` client method, NOT the deprecated
// `embeddings()` (single-input, legacy). nomic-embed-text natively outputs 768 dims.
import { Ollama } from "ollama";

export interface EmbedOllamaParams {
  baseUrl: string;
  model: string;
  input: string[];
}

export async function embedOllama(params: EmbedOllamaParams): Promise<number[][]> {
  const client = new Ollama({ host: params.baseUrl });
  const response = await client.embed({ model: params.model, input: params.input });
  return response.embeddings;
}
