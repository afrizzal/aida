import { beforeEach, describe, expect, it, vi } from "vitest";

// --- Task 1 fixtures: hand-built fake SettingDb (no real DB) ---------------------------------

interface FakeRow {
  id: string;
  key: string;
  value: string;
}

function makeFakeSettingDb(initial: Record<string, string>) {
  const rows: FakeRow[] = Object.entries(initial).map(([key, value], i) => ({
    id: `id-${i}`,
    key,
    value,
  }));

  return {
    setting: {
      findMany: vi.fn(async () => rows.map((r) => ({ ...r }))),
      findFirst: vi.fn(async ({ where }: { where: { key: string } }) => {
        const row = rows.find((r) => r.key === where.key);
        return row ? { ...row } : null;
      }),
      create: vi.fn(async ({ data }: { data: { key: string; value: string } }) => {
        const row = { id: `id-${rows.length}`, key: data.key, value: data.value };
        rows.push(row);
        return row;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: { value: string } }) => {
        const row = rows.find((r) => r.id === where.id);
        if (!row) throw new Error("not found");
        row.value = data.value;
        return row;
      }),
    },
  };
}

// APP_ENCRYPTION_KEY must be set before importing anything that touches secret-box at module
// load time indirectly via encrypt/decrypt calls (per 04-03's global-setup precedent, tests here
// set it directly since this is a unit test file, not the integration suite).
beforeEach(() => {
  if (!process.env.APP_ENCRYPTION_KEY) {
    process.env.APP_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  }
});

describe("toVectorLiteral", () => {
  it("formats a number[] as a pgvector literal", async () => {
    const { toVectorLiteral } = await import("../../src/lib/rag/vector-literal");
    expect(toVectorLiteral([0.1, 0.2, 0.3])).toBe("[0.1,0.2,0.3]");
  });
});

describe("isEmbeddingConfigured / resolveEmbeddingProvider", () => {
  it("resolves true when provider=openai, model set, embedding apiKey present", async () => {
    const { encryptSecret } = await import("../../src/lib/crypto/secret-box");
    const { isEmbeddingConfigured } = await import("../../src/lib/rag/settings");
    const db = makeFakeSettingDb({
      "llm:embeddingProvider": "openai",
      "llm:embeddingModel": "text-embedding-3-small",
      "llm:embeddingApiKeyEnc": encryptSecret("embed-key"),
    });
    // biome-ignore lint/suspicious/noExplicitAny: fake db satisfies the structural SettingDb shape
    expect(await isEmbeddingConfigured(db as any)).toBe(true);
  });

  it("resolves true via chat-credential fallback (embed key blank, chat provider matches)", async () => {
    const { encryptSecret } = await import("../../src/lib/crypto/secret-box");
    const { isEmbeddingConfigured } = await import("../../src/lib/rag/settings");
    const db = makeFakeSettingDb({
      "llm:embeddingProvider": "openai",
      "llm:embeddingModel": "text-embedding-3-small",
      "llm:provider": "openai",
      "llm:model": "gpt-4o-mini",
      "llm:apiKeyEnc": encryptSecret("chat-key"),
    });
    // biome-ignore lint/suspicious/noExplicitAny: fake db satisfies the structural SettingDb shape
    expect(await isEmbeddingConfigured(db as any)).toBe(true);
  });

  it("resolves false when provider=ollama, no embedding base URL, chat provider is not ollama", async () => {
    const { isEmbeddingConfigured } = await import("../../src/lib/rag/settings");
    const db = makeFakeSettingDb({
      "llm:embeddingProvider": "ollama",
      "llm:embeddingModel": "nomic-embed-text",
      "llm:provider": "openai",
      "llm:model": "gpt-4o-mini",
    });
    // biome-ignore lint/suspicious/noExplicitAny: fake db satisfies the structural SettingDb shape
    expect(await isEmbeddingConfigured(db as any)).toBe(false);
  });

  it("resolveEmbeddingProvider throws when nothing is configured", async () => {
    const { resolveEmbeddingProvider } = await import("../../src/lib/rag/settings");
    const db = makeFakeSettingDb({});
    // biome-ignore lint/suspicious/noExplicitAny: fake db satisfies the structural SettingDb shape
    await expect(resolveEmbeddingProvider(db as any)).rejects.toThrow(
      "No embedding provider configured",
    );
  });
});

// --- Task 2: embed() dispatch + dimension guard, SDK boundary mocked -------------------------

const openaiEmbeddingsCreate = vi.fn(async () => ({
  data: [
    { index: 1, embedding: Array(768).fill(0.2) },
    { index: 0, embedding: Array(768).fill(0.1) },
  ],
}));

vi.mock("openai", () => {
  return {
    default: vi.fn().mockImplementation(function MockOpenAI() {
      return { embeddings: { create: openaiEmbeddingsCreate } };
    }),
  };
});

vi.mock("ollama", () => {
  return {
    Ollama: vi.fn().mockImplementation(function MockOllama() {
      return { embed: vi.fn(async () => ({ embeddings: [Array(768).fill(0.3)] })) };
    }),
  };
});

describe("embed()", () => {
  it("dispatches to the openai adapter and returns provider-labeled 768-length vectors", async () => {
    const { encryptSecret } = await import("../../src/lib/crypto/secret-box");
    const { embed } = await import("../../src/lib/rag/embed");
    const db = makeFakeSettingDb({
      "llm:embeddingProvider": "openai",
      "llm:embeddingModel": "text-embedding-3-small",
      "llm:embeddingApiKeyEnc": encryptSecret("embed-key"),
    });

    // biome-ignore lint/suspicious/noExplicitAny: fake db satisfies the structural SettingDb shape
    const result = await embed(db as any, ["a", "b"]);
    expect(result.provider).toBe("openai");
    expect(result.embeddingModel).toBe("openai:text-embedding-3-small");
    expect(result.embeddings).toHaveLength(2);
    for (const v of result.embeddings) expect(v).toHaveLength(768);
    // sorted by index — first result should be the index-0 vector (0.1s)
    expect(result.embeddings[0][0]).toBeCloseTo(0.1);
  });

  it("throws the dimension-mismatch error when a mocked provider returns a 512-length vector", async () => {
    const openaiModule = await import("openai");
    // biome-ignore lint/suspicious/noExplicitAny: reconfiguring the shared SDK mock per-test
    const OpenAIMock = (openaiModule as any).default;
    OpenAIMock.mockImplementationOnce(function MockOpenAIBadDims() {
      return {
        embeddings: {
          create: vi.fn(async () => ({
            data: [{ index: 0, embedding: Array(512).fill(0.1) }],
          })),
        },
      };
    });

    const { encryptSecret } = await import("../../src/lib/crypto/secret-box");
    const { embed } = await import("../../src/lib/rag/embed");
    const db = makeFakeSettingDb({
      "llm:embeddingProvider": "openai",
      "llm:embeddingModel": "text-embedding-3-small",
      "llm:embeddingApiKeyEnc": encryptSecret("embed-key"),
    });

    await expect(
      // biome-ignore lint/suspicious/noExplicitAny: fake db satisfies the structural SettingDb shape
      embed(db as any, ["a"]),
    ).rejects.toThrow("Embedding dimension mismatch");
  });
});
