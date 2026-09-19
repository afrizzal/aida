// Phase 12, plan 12-03 (reviews C7, R2-3, R3-2): staged attachment saving cleans up after a
// failed or abandoned request, best-effort.
import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { FileStorage } from "../../src/lib/attachments/file-storage";
import { saveStagedFiles } from "../../src/lib/attachments/staged-files";

const ORG = "org-staged";

function errno(code: string): Error {
  return Object.assign(new Error(`fake ${code}`), { code });
}

/** An in-memory FileStorage. failSaveAt: the index of the save that writes half and throws. */
function fakeStorage(options: { failSaveAt?: number; refuseDeleteOf?: string } = {}) {
  const store = new Map<string, Buffer>();
  let saves = 0;
  const saveError = new Error("fake save failure");
  const deleted: string[] = [];
  const storage: FileStorage = {
    async save({ key, data }) {
      const index = saves++;
      if (index === options.failSaveAt) {
        store.set(key, data.subarray(0, Math.floor(data.length / 2)));
        throw saveError;
      }
      store.set(key, data);
      return { key, sizeBytes: data.length };
    },
    async read({ key }) {
      const data = store.get(key);
      if (!data) throw errno("ENOENT");
      return data;
    },
    async delete({ key }) {
      if (key === options.refuseDeleteOf) throw errno("EACCES");
      if (!store.has(key)) throw errno("ENOENT");
      store.delete(key);
      deleted.push(key);
    },
  };
  return { storage, store, saveError, deleted };
}

const files = (n: number, marker = "content") =>
  Array.from({ length: n }, (_, i) => ({
    key: `k${i}abc.txt`,
    data: Buffer.from(`${marker}-${i}-${"x".repeat(32)}`),
  }));

afterEach(() => {
  vi.restoreAllMocks();
});

describe("saveStagedFiles", () => {
  it("saves every file in order and returns the saved keys", async () => {
    const { storage, store } = fakeStorage();
    const staged = await saveStagedFiles(storage, ORG, files(3));
    expect(staged.saved).toEqual(["k0abc.txt", "k1abc.txt", "k2abc.txt"]);
    expect([...store.keys()]).toEqual(staged.saved);
  });

  it("a save that writes part of a file and throws leaves the store empty and rethrows that error", async () => {
    const { storage, store, saveError } = fakeStorage({ failSaveAt: 1 });
    await expect(saveStagedFiles(storage, ORG, files(3))).rejects.toBe(saveError);
    expect(store.size).toBe(0);
  });

  it("a refused delete during the save cleanup still deletes the others and keeps the save error", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { storage, store, saveError } = fakeStorage({
      failSaveAt: 2,
      refuseDeleteOf: "k0abc.txt",
    });
    await expect(saveStagedFiles(storage, ORG, files(3))).rejects.toBe(saveError);
    expect([...store.keys()]).toEqual(["k0abc.txt"]);
    const logged = errorSpy.mock.calls.map((args) => args.map(String).join(" "));
    expect(logged.some((line) => line.includes("k0abc.txt") && line.includes("EACCES"))).toBe(true);
  });

  it("discard() deletes every saved key, ignores a key already gone, and a second discard deletes nothing", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { storage, store, deleted } = fakeStorage();
    const staged = await saveStagedFiles(storage, ORG, files(3));
    store.delete("k1abc.txt");
    await staged.discard();
    expect(store.size).toBe(0);
    expect(deleted).toEqual(["k0abc.txt", "k2abc.txt"]);
    await staged.discard();
    expect(deleted).toEqual(["k0abc.txt", "k2abc.txt"]);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("discard() with an EACCES delete resolves, deletes the others, keeps that file and logs key and code only", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const marker = "SECRET-BYTES-MARKER";
    const { storage, store } = fakeStorage({ refuseDeleteOf: "k1abc.txt" });
    const staged = await saveStagedFiles(storage, ORG, files(3, marker));
    await expect(staged.discard()).resolves.toBeUndefined();
    expect([...store.keys()]).toEqual(["k1abc.txt"]);
    const logged = errorSpy.mock.calls.map((args) => args.map(String).join(" "));
    expect(logged.some((line) => line.includes("k1abc.txt") && line.includes("EACCES"))).toBe(true);
    for (const line of logged) expect(line).not.toContain(marker);
  });
});

describe("saveStagedFiles with the real localFileStorage under a temporary UPLOADS_DIR", () => {
  let dir = "";
  let previous: string | undefined;

  beforeAll(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "aida-staged-"));
    previous = process.env.UPLOADS_DIR;
    process.env.UPLOADS_DIR = dir;
  });

  afterAll(async () => {
    if (previous === undefined) delete process.env.UPLOADS_DIR;
    else process.env.UPLOADS_DIR = previous;
    await rm(dir, { recursive: true, force: true });
  });

  async function countFiles(root: string): Promise<number> {
    const entries = await readdir(root, { withFileTypes: true, recursive: true });
    return entries.filter((e) => e.isFile()).length;
  }

  it("a second save that writes a truncated file and throws leaves zero files", async () => {
    vi.resetModules();
    const { localFileStorage } = await import("../../src/lib/attachments/local-file-storage");
    const failure = new Error("disk full mid-write");
    let saves = 0;
    const storage: FileStorage = {
      async save(params) {
        saves += 1;
        if (saves === 2) {
          await localFileStorage.save({ ...params, data: params.data.subarray(0, 4) });
          throw failure;
        }
        return localFileStorage.save(params);
      },
      read: (params) => localFileStorage.read(params),
      delete: (params) => localFileStorage.delete(params),
    };
    await expect(saveStagedFiles(storage, ORG, files(3))).rejects.toBe(failure);
    expect(saves).toBe(2);
    expect(await countFiles(dir)).toBe(0);
  });

  it("files saved under the temporary directory are removed by discard()", async () => {
    vi.resetModules();
    const { localFileStorage } = await import("../../src/lib/attachments/local-file-storage");
    const staged = await saveStagedFiles(localFileStorage, ORG, files(2));
    expect(await countFiles(dir)).toBe(2);
    await staged.discard();
    expect(await countFiles(dir)).toBe(0);
  });
});
