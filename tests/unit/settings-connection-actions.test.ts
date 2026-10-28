import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";

// The four Settings connection-test Server Actions (D-25, AIDA-31, F-08): every failure returns a
// fixed category plus a fresh correlation ID, and neither the response nor the server log carries
// the raw failure text (hosts, IPs, URLs, credentials).

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/authz", () => ({ requireOrgAdmin: vi.fn(async () => undefined) }));
vi.mock("@/lib/session", () => ({ getScopedDb: vi.fn(async () => ({ db: {}, orgId: "org1" })) }));
vi.mock("@/lib/llm/settings", () => ({
  getLlmSettings: vi.fn(async () => ({ apiKey: "" })),
  saveLlmSettings: vi.fn(),
}));
vi.mock("@/lib/llm/test-connection", () => ({ testProviderConnection: vi.fn() }));
vi.mock("@/lib/rag/embed-test-connection", () => ({ testEmbeddingConnection: vi.fn() }));
vi.mock("@/lib/rag/settings", () => ({
  getEmbeddingSettings: vi.fn(async () => ({ apiKey: "" })),
  saveEmbeddingSettings: vi.fn(),
}));
vi.mock("@/lib/kb/create-article", () => ({ enqueueReembed: vi.fn() }));

import { testLlmConnection } from "../../src/app/(app)/settings/actions";
import { testProviderConnection } from "../../src/lib/llm/test-connection";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

let errorSpy: MockInstance<typeof console.error>;

beforeEach(() => {
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.clearAllMocks();
  errorSpy.mockRestore();
});

/** Every console.error argument, serialized, must exclude each raw fragment. */
function expectLogExcludes(...fragments: string[]) {
  expect(errorSpy).toHaveBeenCalled();
  for (const call of errorSpy.mock.calls) {
    for (const arg of call) {
      const text = typeof arg === "string" ? arg : JSON.stringify(arg);
      for (const fragment of fragments) expect(text).not.toContain(fragment);
    }
  }
}

describe("testLlmConnection (D-25, F-08)", () => {
  it("returns connection_failed with a correlation ID and never echoes or logs the raw host", async () => {
    vi.mocked(testProviderConnection).mockRejectedValueOnce(
      Object.assign(new Error("connect ECONNREFUSED 10.0.0.5:11434"), { code: "ECONNREFUSED" }),
    );

    const result = await testLlmConnection({
      provider: "ollama",
      model: "llama3",
      ollamaBaseUrl: "http://10.0.0.5:11434",
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error).toBe("connection_failed");
    expect(result.correlationId).toMatch(UUID);
    expect(Object.keys(result).sort()).toEqual(["correlationId", "error", "ok"]);
    expect(JSON.stringify(result)).not.toContain("10.0.0.5");
    expectLogExcludes("10.0.0.5", "ECONNREFUSED");
  });

  it("returns ok: true when the probe resolves", async () => {
    vi.mocked(testProviderConnection).mockResolvedValueOnce(undefined);
    await expect(
      testLlmConnection({ provider: "openai", model: "gpt-4o-mini", apiKey: "sk-test" }),
    ).resolves.toEqual({ ok: true });
  });
});
