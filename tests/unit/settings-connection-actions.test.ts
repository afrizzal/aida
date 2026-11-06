import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";
import {
  type ConsoleSpies,
  loggedTexts,
  restoreConsole,
  spyOnConsole,
} from "../support/console-capture";

// The four Settings connection-test Server Actions (D-25, AIDA-31, F-08): every failure returns a
// fixed category plus a fresh correlation ID, and neither the response nor the server log carries
// the raw failure text (hosts, IPs, URLs, credentials).

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/authz", () => ({
  requireOrgAdminScope: vi.fn(async () => ({ db: {}, orgId: "org1", role: "admin" })),
}));
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
vi.mock("@/lib/channels/email/imap-client", () => ({ createImapClient: vi.fn() }));
vi.mock("@/lib/channels/email/smtp-client", () => ({ createSmtpTransport: vi.fn() }));
vi.mock("@/lib/channels/email/settings", () => ({
  getEmailSettings: vi.fn(async () => ({ imapPassword: "", smtpPassword: "" })),
  saveEmailSettings: vi.fn(),
}));

import { testEmbeddingConnection, testLlmConnection } from "../../src/app/(app)/settings/actions";
import { testImapConnection, testSmtpConnection } from "../../src/app/(app)/settings/email/actions";
import { createImapClient } from "../../src/lib/channels/email/imap-client";
import { createSmtpTransport } from "../../src/lib/channels/email/smtp-client";
import { testProviderConnection } from "../../src/lib/llm/test-connection";
import { testEmbeddingConnection as probeEmbeddingConnection } from "../../src/lib/rag/embed-test-connection";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

let consoleSpies: ConsoleSpies;
let errorSpy: MockInstance<(...args: unknown[]) => void>;

beforeEach(() => {
  consoleSpies = spyOnConsole();
  errorSpy = consoleSpies.error;
});

afterEach(() => {
  vi.clearAllMocks();
  restoreConsole(consoleSpies);
});

/**
 * The failure was logged, and no argument of any console call (log, info, warn, error, debug),
 * serialized deeply with an Error's message, stack and cause, contains any raw fragment (d-WR-d2).
 */
function expectLogExcludes(...fragments: string[]) {
  expect(errorSpy).toHaveBeenCalled();
  for (const text of loggedTexts(consoleSpies)) {
    for (const fragment of fragments) expect(text).not.toContain(fragment);
  }
}

describe("expectLogExcludes negative controls (d-WR-d2)", () => {
  const cleanLine = () =>
    console.error("[settings] connection test failed", { probe: "llm", category: "unknown" });

  it("rejects a raw Error nested in the logged object", () => {
    cleanLine();
    console.error("[settings] connection test failed", {
      err: new Error("401 Incorrect API key sk-live-NESTED at https://llm.corp.example"),
    });
    expect(() => expectLogExcludes("sk-live-NESTED")).toThrow();
    expect(() => expectLogExcludes("llm.corp.example")).toThrow();
  });

  it("rejects a secret that only appears in an Error's cause", () => {
    cleanLine();
    console.error({ err: new Error("fetch failed", { cause: new Error("sk-live-CAUSE") }) });
    expect(() => expectLogExcludes("sk-live-CAUSE")).toThrow();
  });

  it.each(["log", "info", "warn", "debug"] as const)("watches console.%s too", (method) => {
    cleanLine();
    console[method](new Error(`raw ${method} sk-live-METHOD`));
    expect(() => expectLogExcludes("sk-live-METHOD")).toThrow();
  });

  it("rejects a value nested several objects deep", () => {
    cleanLine();
    console.error({ a: { b: { c: { d: { e: { f: "sk-live-DEEP" } } } } } });
    expect(() => expectLogExcludes("sk-live-DEEP")).toThrow();
  });

  it("passes when only the clean line was logged", () => {
    cleanLine();
    expectLogExcludes("sk-live", "llm.corp.example");
  });
});

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
    // K127 logs the allowlisted code (ECONNREFUSED) by design; the raw message, host and port
    // still never reach the log.
    expectLogExcludes("10.0.0.5", "11434", "connect ECONNREFUSED");
  });

  it("returns ok: true when the probe resolves", async () => {
    vi.mocked(testProviderConnection).mockResolvedValueOnce(undefined);
    await expect(
      testLlmConnection({ provider: "openai", model: "gpt-4o-mini", apiKey: "sk-test" }),
    ).resolves.toEqual({ ok: true });
  });
});

const EMAIL_INPUT = {
  fromAddress: "help@example.test",
  imapHost: "mail.internal.example",
  imapPort: "993",
  imapSecure: true,
  imapUser: "support",
  imapPassword: "imap-secret-pw",
  smtpHost: "smtp.internal.example",
  smtpPort: "587",
  smtpSecure: false,
  smtpUser: "support",
  smtpPassword: "smtp-secret-pw",
};

/** Narrows to the failure branch and checks its exact shape. */
function expectFailure(result: unknown, category: string) {
  const r = result as { ok: boolean; error?: string; correlationId?: string };
  expect(r.ok).toBe(false);
  expect(r.error).toBe(category);
  expect(r.correlationId).toMatch(UUID);
  expect(Object.keys(r).sort()).toEqual(["correlationId", "error", "ok"]);
}

describe("testEmbeddingConnection (D-25, F-08)", () => {
  it("returns authentication_failed for an HTTP 401 and never echoes or logs the raw text", async () => {
    vi.mocked(probeEmbeddingConnection).mockRejectedValueOnce(
      Object.assign(new Error("401 Incorrect API key sk-live-ABCDEF at https://llm.corp.example"), {
        status: 401,
      }),
    );

    const result = await testEmbeddingConnection({
      provider: "openai",
      model: "text-embedding-3-small",
      apiKey: "sk-live-ABCDEF",
    });

    expectFailure(result, "authentication_failed");
    expect(JSON.stringify(result)).not.toContain("sk-live");
    expect(JSON.stringify(result)).not.toContain("llm.corp.example");
    expectLogExcludes("sk-live", "llm.corp.example", "Incorrect API key");
  });
});

describe("testImapConnection (D-25, F-08)", () => {
  it("classifies a client constructor error as invalid_configuration (construction is inside the try)", async () => {
    vi.mocked(createImapClient).mockImplementationOnce(() => {
      throw new RangeError("port out of range for mail.internal.example");
    });

    const result = await testImapConnection(EMAIL_INPUT);

    expectFailure(result, "invalid_configuration");
    expect(JSON.stringify(result)).not.toContain("mail.internal.example");
    expectLogExcludes("mail.internal.example", "out of range");
  });

  it.each([
    ["abc"],
    ["70000"],
    ["0"],
    [""],
  ])("rejects imapPort %j as invalid_configuration before constructing a client", async (imapPort) => {
    const result = await testImapConnection({ ...EMAIL_INPUT, imapPort });

    expectFailure(result, "invalid_configuration");
    expect(createImapClient).not.toHaveBeenCalled();
    expectLogExcludes("mail.internal.example");
  });

  it("rejects an empty host as invalid_configuration before constructing a client", async () => {
    const result = await testImapConnection({ ...EMAIL_INPUT, imapHost: "   " });

    expectFailure(result, "invalid_configuration");
    expect(createImapClient).not.toHaveBeenCalled();
  });

  it("returns ok: true when connect and logout resolve", async () => {
    const client = { connect: vi.fn(async () => {}), logout: vi.fn(async () => {}) };
    vi.mocked(createImapClient).mockReturnValueOnce(
      client as unknown as ReturnType<typeof createImapClient>,
    );

    await expect(testImapConnection(EMAIL_INPUT)).resolves.toEqual({ ok: true });
    expect(client.logout).toHaveBeenCalledOnce();
    // The action's own budget: about 10 s per phase, connect phase included (K127).
    expect(createImapClient).toHaveBeenCalledWith(expect.anything(), { timeoutMs: 10_000 });
  });

  it("returns connection_failed for an imapflow GREETING_TIMEOUT (K127, c-CR-01)", async () => {
    vi.mocked(createImapClient).mockReturnValueOnce({
      connect: vi.fn(async () => {
        throw Object.assign(
          new Error("Failed to receive greeting from mail.internal.example. Maybe should use TLS?"),
          { code: "GREETING_TIMEOUT" },
        );
      }),
      logout: vi.fn(),
    } as unknown as ReturnType<typeof createImapClient>);

    const result = await testImapConnection(EMAIL_INPUT);

    expectFailure(result, "connection_failed");
    expectLogExcludes("mail.internal.example", "greeting");
  });
});

describe("testSmtpConnection (D-25, F-08)", () => {
  function smtpVerifyRejects(error: unknown) {
    vi.mocked(createSmtpTransport).mockReturnValueOnce({
      verify: vi.fn(async () => {
        throw error;
      }),
    } as unknown as ReturnType<typeof createSmtpTransport>);
  }

  it("returns connection_failed for ETIMEDOUT and never echoes or logs the raw text", async () => {
    smtpVerifyRejects(
      Object.assign(new Error("Connection timeout to smtp.internal.example:587"), {
        code: "ETIMEDOUT",
      }),
    );

    const result = await testSmtpConnection(EMAIL_INPUT);

    expectFailure(result, "connection_failed");
    expect(JSON.stringify(result)).not.toContain("smtp.internal.example");
    expectLogExcludes("smtp.internal.example", "Connection timeout");
  });

  it("returns connection_failed for a non-SMTP greeting (EPROTOCOL, K127)", async () => {
    smtpVerifyRejects(
      Object.assign(
        new Error("Invalid greeting. response=SSH-2.0-OpenSSH_9.6 smtp.internal.example"),
        {
          code: "EPROTOCOL",
        },
      ),
    );

    const result = await testSmtpConnection(EMAIL_INPUT);

    expectFailure(result, "connection_failed");
    expectLogExcludes("smtp.internal.example", "SSH-2.0", "Invalid greeting");
  });

  it("returns authentication_failed for EAUTH with SMTP 535", async () => {
    smtpVerifyRejects(
      Object.assign(new Error("Invalid login: 535 5.7.8 user support pass smtp-secret-pw"), {
        code: "EAUTH",
        responseCode: 535,
      }),
    );

    const result = await testSmtpConnection(EMAIL_INPUT);

    expectFailure(result, "authentication_failed");
    expect(JSON.stringify(result)).not.toContain("smtp-secret-pw");
    expectLogExcludes("smtp-secret-pw", "Invalid login", "smtp.internal.example");
  });

  it("rejects a bad smtpPort as invalid_configuration before constructing a transport", async () => {
    const result = await testSmtpConnection({ ...EMAIL_INPUT, smtpPort: "65536" });

    expectFailure(result, "invalid_configuration");
    expect(createSmtpTransport).not.toHaveBeenCalled();
  });
});

describe("server log line (K127, c-WR-02)", () => {
  it("carries the probe, category, correlation ID and an allowlisted error shape only", async () => {
    vi.mocked(probeEmbeddingConnection).mockRejectedValueOnce(
      Object.assign(new Error("model 'nomic' not found at http://10.0.0.5:11434 key sk-live-LOG"), {
        name: "ResponseError",
        status_code: 404,
      }),
    );

    const result = await testEmbeddingConnection({
      provider: "ollama",
      model: "nomic",
      ollamaBaseUrl: "http://10.0.0.5:11434",
    });

    expectFailure(result, "connection_failed");
    const correlationId = (result as { correlationId: string }).correlationId;
    expect(errorSpy.mock.calls).toEqual([
      [
        "[settings] connection test failed",
        {
          probe: "embedding",
          category: "connection_failed",
          correlationId,
          error: { name: "ResponseError", code: "none", status: 404 },
        },
      ],
    ]);
    expectLogExcludes("10.0.0.5", "11434", "sk-live", "not found", "nomic");
  });

  it.each([
    [
      "llm",
      () =>
        testLlmConnection({ provider: "ollama", model: "m", ollamaBaseUrl: "http://10.0.0.5:1" }),
    ],
    ["imap", () => testImapConnection(EMAIL_INPUT)],
    ["smtp", () => testSmtpConnection(EMAIL_INPUT)],
  ])("logs the same shape for the %s probe", async (probe, run) => {
    const refused = new TypeError("fetch failed", {
      cause: Object.assign(new Error("connect ECONNREFUSED 10.0.0.5:1"), { code: "ECONNREFUSED" }),
    });
    vi.mocked(testProviderConnection).mockRejectedValueOnce(refused);
    vi.mocked(createImapClient).mockImplementationOnce(() => {
      throw refused;
    });
    vi.mocked(createSmtpTransport).mockImplementationOnce(() => {
      throw refused;
    });

    const result = await run();

    expectFailure(result, "connection_failed");
    expect(errorSpy.mock.calls).toEqual([
      [
        "[settings] connection test failed",
        {
          probe,
          category: "connection_failed",
          correlationId: (result as { correlationId: string }).correlationId,
          error: { name: "TypeError", code: "ECONNREFUSED", status: "none" },
        },
      ],
    ]);
    expectLogExcludes("10.0.0.5", "connect ECONNREFUSED");
  });
});

describe("correlation IDs (D-25, AIDA-31 concurrency edge)", () => {
  it("gives two concurrent failures different correlation IDs", async () => {
    const refused = () =>
      Object.assign(new Error("connect ECONNREFUSED 10.0.0.5:11434"), { code: "ECONNREFUSED" });
    vi.mocked(testProviderConnection)
      .mockRejectedValueOnce(refused())
      .mockRejectedValueOnce(refused());

    const [a, b] = await Promise.all([
      testLlmConnection({ provider: "ollama", model: "m", ollamaBaseUrl: "http://10.0.0.5:11434" }),
      testLlmConnection({ provider: "ollama", model: "m", ollamaBaseUrl: "http://10.0.0.5:11434" }),
    ]);

    expectFailure(a, "connection_failed");
    expectFailure(b, "connection_failed");
    const idA = (a as { correlationId: string }).correlationId;
    const idB = (b as { correlationId: string }).correlationId;
    expect(idA).not.toBe(idB);
    // Each log line carries its own call's correlation ID.
    const loggedIds = errorSpy.mock.calls.map(
      (call) => (call[1] as { correlationId: string }).correlationId,
    );
    expect(loggedIds.sort()).toEqual([idA, idB].sort());
  });
});
