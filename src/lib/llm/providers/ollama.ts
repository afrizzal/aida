// Ollama adapter — native `/api/chat` endpoint with the `format` JSON-Schema parameter
// (constrained decoding). D-03: reached via an operator-supplied base URL only, no bundled
// service in docker-compose.yml.
//
// Deliberately NOT using the OpenAI-compat `/v1` route: Ollama's OpenAI-compatibility shim has
// had a documented gap translating OpenAI's nested `response_format: {type: "json_schema", ...}`
// wire shape to Ollama's own flatter `format` parameter (ollama/ollama#10001), and current status
// is unverified. The native client's `format` option is Ollama's first-party, fully-supported
// structured-output mechanism. A future "collapse to one HTTP client" refactor MUST re-verify
// structured-output compliance against the OpenAI-compat route before relying on it.
import { Ollama } from "ollama";
import { z } from "zod/v4";

export interface CompleteOllamaParams<T> {
  baseUrl: string;
  model: string;
  system: string;
  prompt: string;
  schema: z.ZodType<T>;
}

export async function completeOllama<T>(params: CompleteOllamaParams<T>): Promise<T> {
  const client = new Ollama({ host: params.baseUrl });
  const response = await client.chat({
    model: params.model,
    messages: [
      { role: "system", content: params.system },
      { role: "user", content: params.prompt },
    ],
    format: z.toJSONSchema(params.schema),
    options: { temperature: 0 }, // lower temperature = more reliable schema compliance
  });
  // Defense-in-depth re-validation — the constrained decoder is vendor-claimed compliant, but we
  // never trust an external process's output without re-validating it against our own schema.
  return params.schema.parse(JSON.parse(response.message.content));
}
