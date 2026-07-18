import { execSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type FullConfig } from "@playwright/test";
import { PrismaPg } from "@prisma/adapter-pg";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import pg from "pg";
import { PrismaClient } from "../../src/generated/prisma/client";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Project root: tests/e2e/ is 2 levels deep
const PROJECT_ROOT = path.resolve(__dirname, "../..");
const AUTH_DIR = path.resolve(__dirname, ".auth");

const PORT = 3100;
export const BASE_URL = `http://localhost:${PORT}`;

export const ADMIN_EMAIL = "owner@e2e.aida.test";
const ADMIN_PASSWORD = "E2E-test-password-1!";
const ADMIN_NAME = "E2E Owner";
const ORG_NAME = "AIDA E2E";
const ORG_SLUG = "aida-e2e";

export const MEMBER_EMAIL = "member@e2e.aida.test";
const MEMBER_PASSWORD = "E2E-test-password-2!";
const MEMBER_NAME = "E2E Member";

function killTree(pid: number) {
  if (process.platform === "win32") {
    try {
      execSync(`taskkill /pid ${pid} /t /f`);
    } catch {
      // process already gone
    }
    return;
  }
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    // process already gone
  }
}

async function waitForServer(url: string, timeoutMs = 120_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // server not accepting connections yet
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Server at ${url} did not become ready within ${timeoutMs}ms`);
}

export default async function globalSetup(_config: FullConfig) {
  fs.rmSync(AUTH_DIR, { recursive: true, force: true });
  fs.mkdirSync(AUTH_DIR, { recursive: true });

  const container = await new PostgreSqlContainer("pgvector/pgvector:pg16")
    .withDatabase("aida_e2e")
    .withUsername("e2e")
    .withPassword("e2e")
    .start();
  const databaseUrl = container.getConnectionUri();

  execSync("pnpm prisma migrate deploy && pnpm prisma generate", {
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: "inherit",
    cwd: PROJECT_ROOT,
  });

  const uploadsDir = fs.mkdtempSync(path.join(os.tmpdir(), "aida-e2e-uploads-"));

  const serverEnv = {
    ...process.env,
    DATABASE_URL: databaseUrl,
    PORT: String(PORT),
    BETTER_AUTH_URL: BASE_URL,
    BETTER_AUTH_TRUSTED_ORIGINS: BASE_URL,
    NEXT_PUBLIC_APP_URL: BASE_URL,
    BETTER_AUTH_SECRET: `${randomUUID()}${randomUUID()}`,
    RATE_LIMIT_PEPPER: randomUUID(),
    UPLOADS_DIR: uploadsDir,
    ADMIN_EMAIL: "",
    ADMIN_PASSWORD: "",
    ADMIN_NAME: "",
  };

  const server = spawn("pnpm", ["exec", "next", "dev", "-p", String(PORT)], {
    cwd: PROJECT_ROOT,
    env: serverEnv,
    stdio: "pipe",
    shell: true,
    detached: process.platform !== "win32",
  });
  server.stdout?.on("data", (chunk: Buffer) => process.stdout.write(`[e2e-server] ${chunk}`));
  server.stderr?.on("data", (chunk: Buffer) => process.stderr.write(`[e2e-server] ${chunk}`));

  const teardown = async () => {
    if (server.pid) killTree(server.pid);
    await container.stop();
    fs.rmSync(uploadsDir, { recursive: true, force: true });
  };

  // Anything below can throw after the server/container are already live — without this
  // try/catch a thrown error here would abort globalSetup before it returns teardown,
  // leaking the child process and container (Playwright never calls a teardown that was
  // never registered).
  try {
    await waitForServer(`${BASE_URL}/api/health`);

    // next dev compiles route files on demand; under load the router can answer a
    // transient 404 BEFORE a route's first compile finishes (observed twice today:
    // the auth sign-in POST right below, and the public-attachment route inside
    // attachments.spec — both 404 in ~200ms with no compile time vs the normal
    // multi-second first hit). Warm every unauthenticated-reachable API route the
    // suite touches until it answers something other than the router's HTML 404:
    // a compiled handler returns 200/405/or a JSON 404 — never a bare HTML 404.
    // (Authenticated routes can't be warmed here: middleware 401s them before the
    // route compiles. attachments.spec keeps its own expect.poll for that reason.)
    const WARM_ROUTES = [
      "/api/auth/get-session",
      "/api/public/intake",
      "/api/public/status/warmup/follow-up",
      "/api/public/status/warmup/attachments/warmup",
    ];
    for (const route of WARM_ROUTES) {
      const deadline = Date.now() + 15_000;
      while (Date.now() < deadline) {
        try {
          const res = await fetch(`${BASE_URL}${route}`);
          const contentType = res.headers.get("content-type") ?? "";
          if (res.status !== 404 || contentType.includes("json")) break;
        } catch {
          // server hiccup — keep polling until the deadline
        }
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
    }

    const pool = new pg.Pool({ connectionString: databaseUrl, max: 5 });
    const adapter = new PrismaPg(pool);
    const prisma = new PrismaClient({ adapter });

    const browser = await chromium.launch();

    const setupPage = await browser.newPage();
    await setupPage.goto(`${BASE_URL}/setup`);
    await setupPage.getByLabel("Workspace name").fill(ORG_NAME);
    await setupPage.getByLabel("URL slug").fill(ORG_SLUG);
    await setupPage.getByLabel("Your name").fill(ADMIN_NAME);
    await setupPage.getByLabel("Email address").fill(ADMIN_EMAIL);
    await setupPage.getByLabel("Password", { exact: true }).fill(ADMIN_PASSWORD);
    await setupPage.getByLabel("Confirm password").fill(ADMIN_PASSWORD);
    await setupPage.getByRole("button", { name: "Create workspace" }).click();
    await setupPage.waitForURL(/\/login/);

    await setupPage.getByLabel("Email address").fill(ADMIN_EMAIL);
    await setupPage.getByLabel("Password", { exact: true }).fill(ADMIN_PASSWORD);
    await setupPage.getByRole("button", { name: "Sign in" }).click();
    await setupPage.waitForURL(/\/tickets/);
    await setupPage.context().storageState({ path: path.join(AUTH_DIR, "admin.json") });
    await setupPage.close();

    const org = await prisma.organization.findFirstOrThrow();

    const signUpRes = await fetch(`${BASE_URL}/api/auth/sign-up/email`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: BASE_URL },
      body: JSON.stringify({ name: MEMBER_NAME, email: MEMBER_EMAIL, password: MEMBER_PASSWORD }),
    });
    if (!signUpRes.ok) {
      throw new Error(
        `Failed to sign up e2e member user: ${signUpRes.status} ${await signUpRes.text()}`,
      );
    }
    const signUpBody = (await signUpRes.json()) as { user?: { id?: string } };
    const memberUserId = signUpBody.user?.id;
    if (!memberUserId) throw new Error("Sign-up response missing user id for e2e member");

    await prisma.member.create({
      data: {
        id: randomUUID(),
        organizationId: org.id,
        userId: memberUserId,
        role: "member",
        createdAt: new Date(),
      },
    });

    const memberPage = await browser.newPage();
    await memberPage.goto(`${BASE_URL}/login`);
    await memberPage.getByLabel("Email address").fill(MEMBER_EMAIL);
    await memberPage.getByLabel("Password", { exact: true }).fill(MEMBER_PASSWORD);
    await memberPage.getByRole("button", { name: "Sign in" }).click();
    await memberPage.waitForURL(/\/tickets/);
    await memberPage.context().storageState({ path: path.join(AUTH_DIR, "member.json") });
    await memberPage.close();

    await browser.close();

    fs.writeFileSync(
      path.join(AUTH_DIR, "env.json"),
      JSON.stringify({ databaseUrl, orgId: org.id, baseURL: BASE_URL }, null, 2),
    );

    await prisma.$disconnect();
    await pool.end();
  } catch (err) {
    await teardown();
    throw err;
  }

  return teardown;
}
