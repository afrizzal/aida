// Public upload caps (plan 08-13, D-24, AIDA-30, F-12): byte limits on the bytes actually
// received, the combined cap on follow-up, validate-all-then-store, and cleanup on failure.
// Route handlers are called in-process against real Postgres; every request uses its own
// X-Forwarded-For identity (5 requests per hour per identity; tests/support/client-ip.ts).
import { readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const uploads = await vi.hoisted(async () => {
  const { mkdtemp } = await import("node:fs/promises");
  const os = await import("node:os");
  const nodePath = await import("node:path");
  const dir = await mkdtemp(nodePath.join(os.tmpdir(), "aida-upload-caps-"));
  process.env.UPLOADS_DIR = dir;
  if (!process.env.RATE_LIMIT_PEPPER) process.env.RATE_LIMIT_PEPPER = "upload-caps-test";
  return { dir };
});

const toggles = vi.hoisted(() => ({ ticketThrows: false, renderThrows: false }));

vi.mock("@/lib/tickets/create-ticket", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tickets/create-ticket")>();
  return {
    ...actual,
    createTicket: async (...args: Parameters<typeof actual.createTicket>) => {
      if (toggles.ticketThrows) throw new Error("ticket creation failed (test toggle)");
      return actual.createTicket(...args);
    },
  };
});

vi.mock("@/lib/markdown/render", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/markdown/render")>();
  return {
    ...actual,
    renderMarkdown: (markdown: string) => {
      if (toggles.renderThrows) throw new Error("render failed (test toggle)");
      return actual.renderMarkdown(markdown);
    },
  };
});

import { POST as intakePost } from "@/app/api/public/intake/route";
import { POST as followUpPost } from "@/app/api/public/status/[token]/follow-up/route";
import { MAX_BYTES, MAX_REQUEST_BODY_BYTES } from "@/lib/attachments/constants";
import { prisma } from "@/lib/db";
import { uniqueClientIp } from "../support/client-ip";
import { seedContactTicket, seedOrgWithMembers } from "../support/lifecycle-fixtures";

afterEach(() => {
  toggles.ticketThrows = false;
  toggles.renderThrows = false;
});

afterAll(async () => {
  await rm(uploads.dir, { recursive: true, force: true });
});

/** Counts every file under UPLOADS_DIR, across org directories. */
async function countStored(): Promise<number> {
  const entries = await readdir(uploads.dir, { recursive: true, withFileTypes: true });
  return entries.filter((e) => e.isFile()).length;
}

/** A stream of `total` zero bytes in 1 MiB chunks, framed as multipart but never complete. */
function chunkedBody(total: number): ReadableStream<Uint8Array> {
  const chunk = new Uint8Array(1024 * 1024);
  let sent = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent >= total) {
        controller.close();
        return;
      }
      const n = Math.min(chunk.byteLength, total - sent);
      controller.enqueue(chunk.slice(0, n));
      sent += n;
    },
  });
}

function chunkedRequest(url: string, total: number): Request {
  return new Request(url, {
    method: "POST",
    headers: {
      "content-type": "multipart/form-data; boundary=x",
      "x-forwarded-for": uniqueClientIp(),
    },
    body: chunkedBody(total),
    duplex: "half",
  } as RequestInit);
}

async function samplePng(): Promise<Buffer> {
  return readFile(path.resolve(__dirname, "../e2e/fixtures/sample.png"));
}

describe("intake body limit on received bytes (D-24)", () => {
  it("answers 413 payload_too_large to a chunked body of MAX_REQUEST_BODY_BYTES + 1 and stores nothing", async () => {
    await samplePng();
    const before = await countStored();
    const res = await intakePost(
      chunkedRequest("http://localhost/api/public/intake", MAX_REQUEST_BODY_BYTES + 1),
    );
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: "payload_too_large" });
    expect(await countStored()).toBe(before);
  });
});

const MiB = 1024 * 1024;

/** The sample PNG zero-padded to `size` bytes; it still sniffs as image/png. */
async function pngOfSize(size: number, name = "shot.png"): Promise<File> {
  const png = await samplePng();
  const data = Buffer.alloc(size);
  png.copy(data);
  return new File([data], name, { type: "image/png" });
}

function intakeRequest(files: File[]): Request {
  const form = new FormData();
  form.set("name", "Upload Tester");
  form.set("email", "uploads@example.test");
  form.set("subject", "Upload caps");
  form.set("message", "Files attached");
  for (const f of files) form.append("file", f);
  return new Request("http://localhost/api/public/intake", {
    method: "POST",
    headers: { "x-forwarded-for": uniqueClientIp() },
    body: form,
  });
}

function followUpRequest(token: string, files: File[]): Request {
  const form = new FormData();
  form.set("message", "Follow-up with files");
  for (const f of files) form.append("file", f);
  return new Request(`http://localhost/api/public/status/${token}/follow-up`, {
    method: "POST",
    headers: { "x-forwarded-for": uniqueClientIp() },
    body: form,
  });
}

let ticket: { id: string; token: string };

beforeAll(async () => {
  if ((await prisma.organization.count()) === 0) {
    await seedOrgWithMembers(prisma, ["owner"]);
  }
  const { orgId } = await seedOrgWithMembers(prisma, ["owner"]);
  const seeded = await seedContactTicket(orgId, { contactEmail: "follow-up-caps@example.test" });
  const row = await prisma.ticket.findUniqueOrThrow({
    where: { id: seeded.id },
    select: { statusToken: true },
  });
  ticket = { id: seeded.id, token: row.statusToken };
});

const messageCount = () => prisma.message.count({ where: { ticketId: ticket.id } });

describe("validate every file before storing any (D-24)", () => {
  it("intake: a valid PNG then an unsupported file answers 415 and stores nothing", async () => {
    const before = await countStored();
    const bad = new File([Buffer.alloc(2048)], "blob.bin", { type: "application/octet-stream" });
    const res = await intakePost(intakeRequest([await pngOfSize(4096), bad]));
    expect(res.status).toBe(415);
    expect(await res.json()).toEqual({ error: "unsupported_file_type" });
    expect(await countStored()).toBe(before);
  });

  it("intake: two 10 MiB PNGs (20 MiB) are accepted and both stored", async () => {
    const before = await countStored();
    const res = await intakePost(
      intakeRequest([await pngOfSize(MAX_BYTES, "a.png"), await pngOfSize(MAX_BYTES, "b.png")]),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
    expect(await countStored()).toBe(before + 2);
  });
});

describe("follow-up combined cap and body limit (D-24, F-12)", () => {
  it("answers 413 payload_too_large to 30.5 MiB of files, creates no message, stores nothing", async () => {
    const before = await countStored();
    const messages = await messageCount();
    const files = [
      await pngOfSize(10 * MiB, "1.png"),
      await pngOfSize(10 * MiB, "2.png"),
      await pngOfSize(10 * MiB, "3.png"),
      await pngOfSize(MiB / 2, "4.png"),
    ];
    const req = followUpRequest(ticket.token, files);
    const res = await followUpPost(req, { params: Promise.resolve({ token: ticket.token }) });
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: "payload_too_large" });
    expect(await messageCount()).toBe(messages);
    expect(await countStored()).toBe(before);
  });

  it("answers 413 to a chunked body over MAX_REQUEST_BODY_BYTES", async () => {
    const url = `http://localhost/api/public/status/${ticket.token}/follow-up`;
    const res = await followUpPost(chunkedRequest(url, MAX_REQUEST_BODY_BYTES + 1), {
      params: Promise.resolve({ token: ticket.token }),
    });
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: "payload_too_large" });
  });
});

describe("stored files are removed when a later step fails (D-24)", () => {
  it("intake: ticket creation throws, the request fails and its files are removed", async () => {
    const before = await countStored();
    toggles.ticketThrows = true;
    await expect(
      intakePost(intakeRequest([await pngOfSize(4096, "a.png"), await pngOfSize(4096, "b.png")])),
    ).rejects.toThrow("ticket creation failed");
    expect(await countStored()).toBe(before);
  });

  it("follow-up: the transaction throws, the request fails and its files are removed", async () => {
    const before = await countStored();
    const messages = await messageCount();
    toggles.renderThrows = true;
    const req = followUpRequest(ticket.token, [await pngOfSize(4096, "a.png")]);
    await expect(
      followUpPost(req, { params: Promise.resolve({ token: ticket.token }) }),
    ).rejects.toThrow("render failed");
    expect(await messageCount()).toBe(messages);
    expect(await countStored()).toBe(before);
  });
});
