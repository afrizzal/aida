// OpenAI embeddings adapter — normalizes to a fixed 768-dim output via the `dimensions` param
// (text-embedding-3-* supports Matryoshka truncation) so every provider writes ONE vector(768)
// column downstream.
import OpenAI from "openai";

export interface EmbedOpenAiParams {
  apiKey: string;
  model: string;
  input: string[];
}

export async function embedOpenAi(params: EmbedOpenAiParams): Promise<number[][]> {
  // timeout/maxRetries: pg-boss owns retry (the caller's job queue), not the SDK.
  const client = new OpenAI({ apiKey: params.apiKey, timeout: 30_000, maxRetries: 0 });
  const res = await client.embeddings.create({
    model: params.model,
    input: params.input,
    dimensions: 768,
  });
  return res.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
}
