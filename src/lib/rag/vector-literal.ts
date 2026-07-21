// number[] -> pgvector canonical literal string, e.g. [0.1,0.2,0.3] — used when writing embedding
// columns via raw SQL (pgvector's `vector` type has no Prisma-native binding).
export function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}
