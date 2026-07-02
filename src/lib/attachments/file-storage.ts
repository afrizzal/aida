// S3-ready storage abstraction. All attachment reads/writes/deletes go through this
// interface — never touch the filesystem (or a future S3 bucket) directly elsewhere.
export interface FileStorage {
  save(params: {
    orgId: string;
    key: string;
    data: Buffer;
  }): Promise<{ key: string; sizeBytes: number }>;
  read(params: { orgId: string; key: string }): Promise<Buffer>;
  delete(params: { orgId: string; key: string }): Promise<void>;
}
