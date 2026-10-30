// Public upload caps (plan 08-13, D-24, AIDA-30, F-12): byte limits on the bytes actually
// received, the combined cap on follow-up, validate-all-then-store, and cleanup on failure.
// Route handlers are called in-process against real Postgres; each case uses its own
// X-Forwarded-For identity (5 requests per hour per identity).
import { readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";

const uploads = await vi.hoisted(async () => {
  const { mkdtemp } = await import("node:fs/promises");
  const os = await import("node:os");
  const nodePath = await import("node:path");
  const dir = await mkdtemp(nodePath.join(os.tmpdir(), "aida-upload-caps-"));
  process.env.UPLOADS_DIR = dir;
  if (!process.env.RATE_LIMIT_PEPPER) process.env.RATE_LIMIT_PEPPER = "upload-caps-test";
  return { dir };
});

import { POST as intakePost } from "@/app/api/public/intake/route";
import { MAX_REQUEST_BODY_BYTES } from "@/lib/attachments/constants";

afterAll(async () => {
  await rm(uploads.dir, { recursive: true, force: true });
});

let ipCounter = 10;
function nextIp(): string {
  ipCounter += 1;
  return `198.51.100.${ipCounter}`;
}

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
      "x-forwarded-for": nextIp(),
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
