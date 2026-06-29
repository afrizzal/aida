import { describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/health/route";
import { prisma } from "@/lib/db";

// Mock the DB module so no real Postgres connection is needed
vi.mock("@/lib/db", () => ({
  prisma: {
    systemSetting: {
      findUnique: vi.fn(),
    },
  },
}));

describe("GET /api/health", () => {
  it("returns 200 with db:connected and worker.lastRunAt when DB is healthy", async () => {
    vi.mocked(prisma.systemSetting.findUnique).mockResolvedValueOnce({
      id: "test-id",
      key: "heartbeat:lastRunAt",
      value: "2026-01-01T00:00:00.000Z",
      updatedAt: new Date(),
    });

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.status).toBe("ok");
    expect(body.db).toBe("connected");
    expect(body.worker.lastRunAt).toBe("2026-01-01T00:00:00.000Z");
  });

  it("returns 503 with db:unreachable when DB throws", async () => {
    vi.mocked(prisma.systemSetting.findUnique).mockRejectedValueOnce(
      new Error("DB unreachable"),
    );

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body.status).toBe("error");
    expect(body.db).toBe("unreachable");
  });
});
