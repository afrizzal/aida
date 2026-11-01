// Public upload caps (plan 08-13, D-24, AIDA-30, F-12): byte limits on the bytes actually
// received, the combined cap on follow-up, validate-all-then-store, and cleanup on failure.
// Route handlers are called in-process against real Postgres; every request uses its own
// X-Forwarded-For identity (5 requests per hour per identity; tests/support/client-ip.ts).
import { readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  type MockInstance,
  vi,
} from "vitest";

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
import { POST as csatPost } from "@/app/api/public/status/[token]/csat/route";
import { POST as followUpPost } from "@/app/api/public/status/[token]/follow-up/route";
import * as uploadConstants from "@/lib/attachments/constants";
import { MAX_BYTES, MAX_REQUEST_BODY_BYTES } from "@/lib/attachments/constants";
import { localFileStorage } from "@/lib/attachments/local-file-storage";
import { prisma } from "@/lib/db";
import { uniqueClientIp } from "../support/client-ip";
import { seedContactTicket, seedOrgWithMembers, stateIdFor } from "../support/lifecycle-fixtures";

// Every storage write goes through localFileStorage.save (validate-uploads.ts, staged-files.ts).
// Counting the calls tells "validate every file, then store" from "store, then remove on
// failure", which leave the same files on disk afterwards (review d-WR-d8).
let saveSpy: MockInstance<typeof localFileStorage.save>;

beforeEach(() => {
  saveSpy = vi.spyOn(localFileStorage, "save");
});

afterEach(() => {
  toggles.ticketThrows = false;
  toggles.renderThrows = false;
  saveSpy.mockRestore();
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
    expect(saveSpy).not.toHaveBeenCalled();
  });

  it("intake: two 10 MiB PNGs (20 MiB) are accepted and both stored", async () => {
    const before = await countStored();
    const res = await intakePost(
      intakeRequest([await pngOfSize(MAX_BYTES, "a.png"), await pngOfSize(MAX_BYTES, "b.png")]),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
    expect(await countStored()).toBe(before + 2);
    expect(saveSpy).toHaveBeenCalledTimes(2);
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
    expect(saveSpy).not.toHaveBeenCalled();
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

// K128 (review b-WR-b2): a count cap, checked before any file is read. Neither shipped public
// form sets a count, so the cap is K128's default of 10. Read through the module namespace so
// the red run (before the constant existed) fails on the assertion, not on an import error.
const FILE_CAP = 10;

/** `n` one-byte parts that claim to be GIFs; each would answer 415 if it were read. */
function oneByteGifs(n: number): File[] {
  return Array.from({ length: n }, (_, i) => new File(["G"], `g${i}.gif`, { type: "image/gif" }));
}

describe("file count cap (K128, b-WR-b2)", () => {
  it("the cap is 10 files per request", () => {
    expect((uploadConstants as Record<string, unknown>).MAX_FILES_PER_REQUEST).toBe(FILE_CAP);
  });

  it("intake: cap + 1 one-byte GIF parts answer 413 too_many_files before any file is read or stored", async () => {
    const before = await countStored();
    const res = await intakePost(intakeRequest(oneByteGifs(FILE_CAP + 1)));
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: "too_many_files" });
    expect(await countStored()).toBe(before);
    expect(saveSpy).not.toHaveBeenCalled();
  });

  it("intake: exactly cap parts pass the count check and are read (each one-byte part then fails the sniff)", async () => {
    const res = await intakePost(intakeRequest(oneByteGifs(FILE_CAP)));
    expect(res.status).toBe(415);
    expect(await res.json()).toEqual({ error: "unsupported_file_type" });
    expect(saveSpy).not.toHaveBeenCalled();
  });

  it("follow-up: cap + 1 one-byte GIF parts answer 413 too_many_files, create no message, store nothing", async () => {
    const before = await countStored();
    const messages = await messageCount();
    const res = await followUpPost(followUpRequest(ticket.token, oneByteGifs(FILE_CAP + 1)), {
      params: Promise.resolve({ token: ticket.token }),
    });
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: "too_many_files" });
    expect(await messageCount()).toBe(messages);
    expect(await countStored()).toBe(before);
    expect(saveSpy).not.toHaveBeenCalled();
  });
});

// K129 (review b-WR-b3): length caps on the public text fields, answered 400 with a field error.
// No existing input limit covers these fields (see PUBLIC_TEXT_LIMITS), so the values are
// K129's defaults. zod counts string length in UTF-16 code units, as the browser does.
const TEXT_CAPS = { name: 200, email: 320, subject: 500, message: 50_000 } as const;

/** An address of exactly `length` characters that zod's email check accepts. */
function emailOfLength(length: number): string {
  const domain = `${"b".repeat(63)}.${"c".repeat(63)}.example`;
  return `${"a".repeat(length - domain.length - 1)}@${domain}`;
}

function textIntakeRequest(fields: Record<keyof typeof TEXT_CAPS, string>): Request {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  return new Request("http://localhost/api/public/intake", {
    method: "POST",
    headers: { "x-forwarded-for": uniqueClientIp() },
    body: form,
  });
}

const atCaps = () => ({
  name: "n".repeat(TEXT_CAPS.name),
  email: emailOfLength(TEXT_CAPS.email),
  subject: "s".repeat(TEXT_CAPS.subject),
  message: "m".repeat(TEXT_CAPS.message),
});

type Issue = { path: (string | number)[]; message: string };

describe("public text field caps (K129, b-WR-b3)", () => {
  it("the caps are name 200, email 320, subject 500, message 50 000", () => {
    expect((uploadConstants as Record<string, unknown>).PUBLIC_TEXT_LIMITS).toEqual(TEXT_CAPS);
    expect(emailOfLength(TEXT_CAPS.email)).toHaveLength(TEXT_CAPS.email);
  });

  it("intake: every field at its cap is accepted", async () => {
    const res = await intakePost(textIntakeRequest(atCaps()));
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });

  for (const field of Object.keys(TEXT_CAPS) as (keyof typeof TEXT_CAPS)[]) {
    it(`intake: ${field} at cap + 1 answers 400 with one field error on ${field}`, async () => {
      const fields = atCaps();
      fields[field] = field === "email" ? emailOfLength(TEXT_CAPS.email + 1) : `${fields[field]}x`;
      expect(fields[field]).toHaveLength(TEXT_CAPS[field] + 1);
      const res = await intakePost(textIntakeRequest(fields));
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string; issues: Issue[] };
      expect(body.error).toBe("validation_failed");
      expect(body.issues.map((i) => i.path)).toEqual([[field]]);
      expect(body.issues[0].message).toMatch(/at most/);
    });
  }

  it("follow-up: a message at the cap is accepted, at cap + 1 answers 400 with a field error on message", async () => {
    const send = (message: string) => {
      const form = new FormData();
      form.set("message", message);
      return followUpPost(
        new Request(`http://localhost/api/public/status/${ticket.token}/follow-up`, {
          method: "POST",
          headers: { "x-forwarded-for": uniqueClientIp() },
          body: form,
        }),
        { params: Promise.resolve({ token: ticket.token }) },
      );
    };
    const messages = await messageCount();
    const ok = await send("m".repeat(TEXT_CAPS.message));
    expect(ok.status).toBe(200);
    expect(await messageCount()).toBe(messages + 1);

    const over = await send("m".repeat(TEXT_CAPS.message + 1));
    expect(over.status).toBe(400);
    const body = (await over.json()) as { error: string; issues: Issue[] };
    expect(body.error).toBe("validation_failed");
    expect(body.issues.map((i) => i.path)).toEqual([["message"]]);
    expect(await messageCount()).toBe(messages + 1);
  });
});

// Review b-IN-b3: CSAT carries a score and a comment of at most 2 000 characters, so its body is
// read through the same bounded reader with a small fixed cap instead of an unbounded parse.
describe("csat body limit (b-IN-b3)", () => {
  it("answers 413 payload_too_large to a body over the CSAT cap and records nothing; a normal rating is accepted", async () => {
    const { orgId } = await seedOrgWithMembers(prisma, ["owner"]);
    const seeded = await seedContactTicket(orgId, { contactEmail: "csat-cap@example.test" });
    await prisma.ticket.update({
      where: { id: seeded.id },
      data: { stateId: await stateIdFor(orgId, "RESOLVED"), resolvedAt: new Date() },
    });
    const { statusToken: token } = await prisma.ticket.findUniqueOrThrow({
      where: { id: seeded.id },
      select: { statusToken: true },
    });
    const send = (form: FormData) =>
      csatPost(
        new Request(`http://localhost/api/public/status/${token}/csat`, {
          method: "POST",
          headers: { "x-forwarded-for": uniqueClientIp() },
          body: form,
        }),
        { params: Promise.resolve({ token }) },
      );
    const rows = () => prisma.csatResponse.count({ where: { ticketId: seeded.id } });

    // A valid rating plus 64 KiB in a field the route ignores: before the cap it parsed whole.
    const oversized = new FormData();
    oversized.set("score", "5");
    oversized.set("padding", "x".repeat(64 * 1024));
    const refused = await send(oversized);
    expect(refused.status).toBe(413);
    expect(await refused.json()).toEqual({ error: "payload_too_large" });
    expect(await rows()).toBe(0);

    // The largest real form (score plus a 2 000-character comment of 3-byte characters) fits.
    const normal = new FormData();
    normal.set("score", "4");
    normal.set("comment", "\u20ac".repeat(2000));
    const accepted = await send(normal);
    expect(accepted.status).toBe(200);
    expect(await rows()).toBe(1);
  });
});
