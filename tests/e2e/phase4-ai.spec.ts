import { type ChildProcess, execSync, spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { baseURL, databaseUrl } from "./support/test-env";
import { prisma } from "./support/db";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "../..");

test.use({ storageState: path.resolve(__dirname, ".auth/admin.json") });

const ts = Date.now();

// ---------------------------------------------------------------------------
// Ollama stub — a local HTTP server implementing the two endpoints the real
// lib/llm ollama adapter + test-connection probe hit (`/api/tags`, `/api/chat`).
// Lets the FULL pipeline run for real (settings UI -> encrypted Setting rows ->
// createTicket post-commit enqueue -> pg-boss worker -> runTriage -> complete()
// -> ollama adapter -> HTTP) with only the model process itself faked.
// ---------------------------------------------------------------------------
const TRIAGE_RESULT = {
  category: "TECHNICAL",
  priority: "HIGH",
  sentiment: "NEGATIVE",
  language: "en",
};

const stub = {
  server: null as http.Server | null,
  url: "",
  mode: "ok" as "ok" | "fail",
  chatCalls: 0,
};

function startStub(): Promise<void> {
  return new Promise((resolve) => {
    stub.server = http.createServer((req, res) => {
      if (req.method === "GET" && req.url?.startsWith("/api/tags")) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ models: [{ name: "llama3.1", model: "llama3.1" }] }));
        return;
      }
      if (req.method === "POST" && req.url?.startsWith("/api/chat")) {
        stub.chatCalls += 1;
        if (stub.mode === "fail") {
          res.writeHead(500, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "stub forced failure" }));
          return;
        }
        // drain body, then answer with the ollama non-streaming chat shape
        req.on("data", () => {});
        req.on("end", () => {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(
            JSON.stringify({
              model: "llama3.1",
              created_at: new Date().toISOString(),
              message: { role: "assistant", content: JSON.stringify(TRIAGE_RESULT) },
              done: true,
            }),
          );
        });
        return;
      }
      res.writeHead(404).end();
    });
    stub.server.listen(0, "127.0.0.1", () => {
      const addr = stub.server?.address();
      if (addr && typeof addr === "object") stub.url = `http://127.0.0.1:${addr.port}`;
      resolve();
    });
  });
}

// ---------------------------------------------------------------------------
// Worker process — the pg-boss worker that owns the ai-triage queue. globalSetup
// only boots `next dev`; triage jobs need the worker alive too.
// ---------------------------------------------------------------------------
let worker: ChildProcess | null = null;
let workerLog = "";

function readEnvVar(name: string): string {
  const envFile = fs.readFileSync(path.join(PROJECT_ROOT, ".env"), "utf-8");
  const match = envFile.match(new RegExp(`^${name}=(.*)$`, "m"));
  return match?.[1]?.trim() ?? "";
}

function startWorker(): Promise<void> {
  return new Promise((resolve, reject) => {
    const tsxCli = path.join(PROJECT_ROOT, "node_modules", "tsx", "dist", "cli.mjs");
    worker = spawn(
      process.execPath,
      [tsxCli, path.join("src", "lib", "worker", "index.ts")],
      {
        cwd: PROJECT_ROOT,
        env: {
          ...process.env,
          DATABASE_URL: databaseUrl,
          APP_ENCRYPTION_KEY: readEnvVar("APP_ENCRYPTION_KEY"),
        },
        stdio: "pipe",
      },
    );
    const timer = setTimeout(
      () => reject(new Error(`worker did not start; log so far:\n${workerLog}`)),
      120_000,
    );
    worker.stdout?.on("data", (chunk: Buffer) => {
      workerLog += chunk.toString();
      if (workerLog.includes("[worker] started")) {
        clearTimeout(timer);
        resolve();
      }
    });
    worker.stderr?.on("data", (chunk: Buffer) => {
      workerLog += chunk.toString();
    });
    // "close" (not "exit") — fires after the stdio streams have flushed, so workerLog
    // actually contains the crash output when the process dies early.
    worker.on("close", (code) => {
      if (!workerLog.includes("[worker] started")) {
        clearTimeout(timer);
        reject(new Error(`worker exited early (code ${code}):\n${workerLog}`));
      }
    });
  });
}

test.beforeAll(async () => {
  test.setTimeout(180_000); // worker cold start (tsx + pg-boss schema install) can be slow
  await startStub();
  await startWorker();
});

test.afterAll(async () => {
  if (worker?.pid) {
    try {
      execSync(`taskkill /pid ${worker.pid} /t /f`);
    } catch {
      // already gone
    }
  }
  stub.server?.close();
});

// ---------------------------------------------------------------------------
// UAT Test 1 — Cold Start Smoke Test
// (fresh DB container + `migrate deploy` + next dev boot happened in globalSetup;
// here we assert the observable outcomes)
// ---------------------------------------------------------------------------
test("T1 cold start: migrations applied, health live, worker registered ai-triage queue", async () => {
  const res = await fetch(`${baseURL}/api/health`);
  expect(res.status).toBe(200);

  const migrations = await prisma.$queryRawUnsafe<{ count: bigint }[]>(
    'SELECT COUNT(*)::bigint AS count FROM "_prisma_migrations" WHERE finished_at IS NOT NULL',
  );
  expect(Number(migrations[0]?.count ?? 0)).toBeGreaterThanOrEqual(5);

  expect(workerLog).toContain("[worker] started");

  const queues = await prisma.$queryRawUnsafe<{ name: string }[]>(
    "SELECT name FROM pgboss.queue",
  );
  expect(queues.map((q) => q.name)).toContain("ai-triage");
});

// ---------------------------------------------------------------------------
// UAT Test 4 (first half) — Enable AI switch is gated before any provider exists
// ---------------------------------------------------------------------------
test("T4a AI toggle disabled with hint before a provider is configured", async ({ page }) => {
  await page.goto("/settings");
  const toggle = page.getByRole("switch", { name: "Enable AI" });
  await expect(toggle).toBeVisible();
  await expect(toggle).toBeDisabled();
  await expect(page.getByText("Configure a provider first.")).toBeVisible();
});

// ---------------------------------------------------------------------------
// UAT Test 2 — Configure LLM provider in Settings
// ---------------------------------------------------------------------------
test("T2 provider form: dropdowns, provider-specific fields, reset-on-switch, save persists", async ({
  page,
}) => {
  await page.goto("/settings");

  // Provider dropdown lists all three providers
  const providerSelect = page.getByLabel("Provider");
  await providerSelect.click();
  for (const name of ["OpenAI", "Anthropic", "Ollama"]) {
    await expect(page.getByRole("option", { name })).toBeVisible();
  }
  await page.getByRole("option", { name: "OpenAI" }).click();

  // OpenAI: curated model catalog + Custom… + API key field, no base URL
  const modelSelect = page.getByLabel("Model");
  await expect(modelSelect).toContainText("gpt-5.4-mini");
  await expect(page.getByLabel("API key")).toBeVisible();
  await expect(page.getByLabel("Base URL")).toHaveCount(0);

  await modelSelect.click();
  await expect(page.getByRole("option", { name: "gpt-5.5" })).toBeVisible();
  await page.getByRole("option", { name: "Custom…" }).click();
  await expect(page.getByLabel("Custom model ID")).toBeVisible();

  // Switching provider swaps the catalog + provider-specific fields.
  // KNOWN ISSUE (UAT test 2, minor): the form STATE resets to the new provider's first
  // catalog entry, but the Radix Select trigger keeps showing the "Select a model"
  // placeholder because the new catalog's items were never registered while closed.
  // We drive it like a real operator instead: open the dropdown and pick the model.
  await providerSelect.click();
  await page.getByRole("option", { name: "Ollama" }).click();
  await expect(page.getByLabel("Custom model ID")).toHaveCount(0);
  await expect(page.getByLabel("API key")).toHaveCount(0);
  await expect(page.getByLabel("Base URL")).toBeVisible();

  // Model dropdown now lists the Ollama catalog (proves the per-provider catalog swap)
  await modelSelect.click();
  for (const m of ["llama3.1", "qwen2.5", "mistral"]) {
    await expect(page.getByRole("option", { name: m })).toBeVisible();
  }
  await page.getByRole("option", { name: "llama3.1" }).click();
  await expect(modelSelect).toContainText("llama3.1");

  // Save Ollama pointed at the stub
  await page.getByLabel("Base URL").fill(stub.url);
  await page.getByRole("button", { name: "Save AI provider" }).click();
  await expect(page.getByText("AI provider settings saved.")).toBeVisible();

  // Persisted server-side
  await expect
    .poll(async () => {
      const row = await prisma.setting.findFirst({ where: { key: "llm:provider" } });
      return row?.value ?? null;
    })
    .toBe("ollama");

  // Round-trips on reload
  await page.reload();
  await expect(page.getByLabel("Provider")).toContainText("Ollama");
  await expect(page.getByLabel("Model")).toContainText("llama3.1");
  await expect(page.getByLabel("Base URL")).toHaveValue(stub.url);
});

// ---------------------------------------------------------------------------
// UAT Test 3 — Test Connection button (success + failure states)
// ---------------------------------------------------------------------------
test("T3 test connection: success against stub, failure against dead port", async ({ page }) => {
  await page.goto("/settings");

  await page.getByRole("button", { name: "Test connection" }).click();
  await expect(page.getByText("Connected successfully")).toBeVisible({ timeout: 15_000 });

  // Point at a dead port — must surface a failure state with a short error
  await page.getByLabel("Base URL").fill("http://127.0.0.1:1");
  await page.getByRole("button", { name: "Test connection" }).click();
  await expect(page.getByText(/Connection failed:/)).toBeVisible({ timeout: 15_000 });
});

// ---------------------------------------------------------------------------
// UAT Test 4 (second half) — toggle enabled once provider saved; turn AI on
// ---------------------------------------------------------------------------
test("T4b AI toggle enabled after provider saved; turning it on persists", async ({ page }) => {
  await page.goto("/settings");
  const toggle = page.getByRole("switch", { name: "Enable AI" });
  await expect(toggle).toBeEnabled();
  await expect(page.getByText("Allow AIDA to triage tickets and draft replies.")).toBeVisible();

  await toggle.click();
  await expect(toggle).toBeChecked();

  await expect
    .poll(async () => {
      const row = await prisma.setting.findFirst({ where: { key: "aiEnabled" } });
      return row?.value ?? null;
    })
    .toBe("true");
});

// ---------------------------------------------------------------------------
// UAT Test 5 — Auto-triage on new ticket (full pipeline through the worker)
// ---------------------------------------------------------------------------
let triagedTicketId = "";

test("T5 creating a ticket auto-triages it: chips + AI priority + SLA recompute", async ({
  page,
}) => {
  test.setTimeout(120_000);

  await page.goto("/tickets");
  await page.getByRole("button", { name: "New Ticket" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Subject").fill(`E2E Phase4 triage ${ts}`);
  await dialog.getByLabel("Contact email").fill(`phase4-triage-${ts}@example.com`);
  await dialog
    .getByLabel("Message")
    .fill("The app crashes every time I open the dashboard. Please help, this is really frustrating.");
  await dialog.getByRole("button", { name: "New Ticket" }).click();

  await page.waitForURL(/\/tickets\/[a-z0-9]+/);
  triagedTicketId = page.url().split("/tickets/")[1] ?? "";
  expect(triagedTicketId).not.toBe("");

  // Worker picks the job up and the stub answers instantly
  await expect
    .poll(
      async () => {
        const t = await prisma.ticket.findUniqueOrThrow({ where: { id: triagedTicketId } });
        return t.triageStatus;
      },
      { timeout: 60_000 },
    )
    .toBe("COMPLETED");

  const t = await prisma.ticket.findUniqueOrThrow({ where: { id: triagedTicketId } });
  expect(t.triageCategory).toBe("TECHNICAL");
  expect(t.triageSentiment).toBe("NEGATIVE");
  expect(t.triageLanguage).toBe("en");
  expect(t.priority).toBe("HIGH"); // AI classification, ticket was created NORMAL
  expect(t.firstResponseTargetMinutes).toBe(240); // HIGH SLA defaults recomputed

  await page.reload();
  await expect(page.getByRole("button", { name: "Change category" })).toContainText("Technical");
  await expect(page.getByRole("button", { name: "Change sentiment" })).toContainText("Negative");
  await expect(page.getByRole("button", { name: "Change language" })).toContainText("EN");
  await expect(page.getByRole("button", { name: "Change priority" })).toContainText("High");
});

// ---------------------------------------------------------------------------
// UAT Test 6 — Agent overrides triage (no SLA recompute)
// ---------------------------------------------------------------------------
test("T6 overrides: category/sentiment dropdowns + language popover, SLA untouched", async ({
  page,
}) => {
  expect(triagedTicketId).not.toBe("");
  const before = await prisma.ticket.findUniqueOrThrow({ where: { id: triagedTicketId } });

  await page.goto(`/tickets/${triagedTicketId}`);

  await page.getByRole("button", { name: "Change category" }).click();
  await page.getByRole("menuitemradio", { name: "Billing" }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Change category" })).toContainText("Billing");

  await page.getByRole("button", { name: "Change sentiment" }).click();
  await page.getByRole("menuitemradio", { name: "Positive" }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Change sentiment" })).toContainText("Positive");

  await page.getByRole("button", { name: "Change language" }).click();
  await page.getByPlaceholder("en").fill("id");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Change language" })).toContainText("ID");

  await expect
    .poll(async () => {
      const t = await prisma.ticket.findUniqueOrThrow({ where: { id: triagedTicketId } });
      return `${t.triageCategory}|${t.triageSentiment}|${t.triageLanguage}`;
    })
    .toBe("BILLING|POSITIVE|id");

  // Overrides never touch SLA — only changePriority does
  const after = await prisma.ticket.findUniqueOrThrow({ where: { id: triagedTicketId } });
  expect(after.firstResponseDueAt.toISOString()).toBe(before.firstResponseDueAt.toISOString());
  expect(after.resolutionDueAt.toISOString()).toBe(before.resolutionDueAt.toISOString());
  expect(after.priority).toBe(before.priority);
});

// ---------------------------------------------------------------------------
// UAT Test 7 — Re-run control: failure badge + successful re-run
// ---------------------------------------------------------------------------
test("T7 re-run triage: failure shows Triage failed + Re-run; retry succeeds", async ({
  page,
}) => {
  test.setTimeout(180_000);
  expect(triagedTicketId).not.toBe("");

  await page.goto(`/tickets/${triagedTicketId}`);
  await expect(page.getByRole("button", { name: "Re-run AI triage" })).toBeVisible();

  stub.mode = "fail";
  await page.getByRole("button", { name: "Re-run AI triage" }).click();

  await expect
    .poll(
      async () => {
        const t = await prisma.ticket.findUniqueOrThrow({ where: { id: triagedTicketId } });
        return t.triageStatus;
      },
      { timeout: 60_000 },
    )
    .toBe("FAILED");

  await page.goto(`/tickets/${triagedTicketId}`);
  await expect(page.getByText("Triage failed")).toBeVisible();
  const rerunLink = page.getByRole("button", { name: "Re-run", exact: true });
  await expect(rerunLink).toBeVisible();

  stub.mode = "ok";
  await rerunLink.click();

  await expect
    .poll(
      async () => {
        const t = await prisma.ticket.findUniqueOrThrow({ where: { id: triagedTicketId } });
        return t.triageStatus;
      },
      { timeout: 120_000 },
    )
    .toBe("COMPLETED");

  await page.goto(`/tickets/${triagedTicketId}`);
  await expect(page.getByText("Triage failed")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Re-run AI triage" })).toBeVisible();
});

// ---------------------------------------------------------------------------
// UAT Test 8 — AI Activity section (read-only, never leaks the prompt)
// ---------------------------------------------------------------------------
test("T8 AI Activity lists triage runs with provider/model/result, never the prompt", async ({
  page,
}) => {
  expect(triagedTicketId).not.toBe("");
  await page.goto(`/tickets/${triagedTicketId}`);

  const summary = page.getByText("AI Activity");
  await expect(summary).toBeVisible();
  await summary.click();

  // ≥2 successful runs (initial + re-run) recorded, each with provider/model + parsed result
  await expect(page.getByText("ollama · llama3.1").first()).toBeVisible();
  await expect(page.getByText("TECHNICAL · HIGH · NEGATIVE · en").first()).toBeVisible();

  const auditCount = await prisma.auditEvent.count({ where: { ticketId: triagedTicketId } });
  expect(auditCount).toBeGreaterThanOrEqual(2);

  // D-13: the audit input (fenced prompt) must never render — the fence tag is a reliable marker
  const html = await page.content();
  expect(html).not.toContain("ticket_content");
});

// ---------------------------------------------------------------------------
// UAT Test 9 — AI off: ticket creation unchanged, zero triage chrome
// ---------------------------------------------------------------------------
test("T9 with AI disabled a new ticket gets no triage and shows zero AI chrome", async ({
  page,
}) => {
  test.setTimeout(120_000);

  // Turn AI off through the real UI
  await page.goto("/settings");
  const toggle = page.getByRole("switch", { name: "Enable AI" });
  await toggle.click();
  await expect(toggle).not.toBeChecked();
  await expect
    .poll(async () => {
      const row = await prisma.setting.findFirst({ where: { key: "aiEnabled" } });
      return row?.value ?? null;
    })
    .toBe("false");

  const chatCallsBefore = stub.chatCalls;

  await page.goto("/tickets");
  await page.getByRole("button", { name: "New Ticket" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Subject").fill(`E2E Phase4 ai-off ${ts}`);
  await dialog.getByLabel("Contact email").fill(`phase4-aioff-${ts}@example.com`);
  await dialog.getByLabel("Message").fill("Just a normal question, no AI expected.");
  await dialog.getByRole("button", { name: "New Ticket" }).click();

  await page.waitForURL(/\/tickets\/[a-z0-9]+/);
  const ticketId = page.url().split("/tickets/")[1] ?? "";
  expect(ticketId).not.toBe("");

  // Give the worker ample time to (wrongly) pick anything up
  await page.waitForTimeout(8_000);

  const t = await prisma.ticket.findUniqueOrThrow({ where: { id: ticketId } });
  expect(t.triageStatus).toBeNull();
  expect(t.triageCategory).toBeNull();
  expect(stub.chatCalls).toBe(chatCallsBefore); // the LLM was never called

  await page.reload();
  await expect(page.getByText("Triaging…")).toHaveCount(0);
  await expect(page.getByText("AI Activity")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Change category" })).toHaveCount(0);

  // Ticket still lands in the inbox normally
  await page.goto("/tickets");
  await expect(page.getByText(`E2E Phase4 ai-off ${ts}`)).toBeVisible();
});

// ---------------------------------------------------------------------------
// UAT Test 10 — Blank API key keeps the stored key (never echoed)
// ---------------------------------------------------------------------------
test("T10 blank API key on re-save keeps the stored encrypted key; key never echoed", async ({
  page,
}) => {
  await page.goto("/settings");

  await page.getByLabel("Provider").click();
  await page.getByRole("option", { name: "OpenAI" }).click();
  // KNOWN ISSUE (UAT test 2, major): the provider switch leaves modelSelect empty and Save
  // would be blocked by validation — pick the model explicitly like a real operator must.
  await page.getByLabel("Model").click();
  await page.getByRole("option", { name: "gpt-5.4-mini" }).click();
  await page.getByLabel("API key").fill(`sk-test-e2e-phase4-${ts}`);
  await page.getByRole("button", { name: "Save AI provider" }).click();
  await expect(page.getByText("AI provider settings saved.").first()).toBeVisible();

  let blob1 = "";
  await expect
    .poll(async () => {
      const row = await prisma.setting.findFirst({ where: { key: "llm:apiKeyEnc" } });
      blob1 = row?.value ?? "";
      return blob1.length > 0;
    })
    .toBe(true);

  // Reload: the stored key is never round-tripped to the client
  await page.reload();
  await expect(page.getByLabel("Provider")).toContainText("OpenAI");
  await expect(page.getByLabel("API key")).toHaveValue("");

  // Re-save with the key field left blank — stored encrypted blob must stay identical
  await page.getByRole("button", { name: "Save AI provider" }).click();
  await expect(page.getByText("AI provider settings saved.").first()).toBeVisible();

  // Deterministic wait: the save round-trip completed (toast), now compare
  await page.waitForTimeout(1_000);
  const row = await prisma.setting.findFirst({ where: { key: "llm:apiKeyEnc" } });
  expect(row?.value).toBe(blob1);
});
