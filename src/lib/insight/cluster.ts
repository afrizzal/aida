// src/lib/insight/cluster.ts — PURE, no I/O. Unit-test this directly.

/** L2-normalizes a vector; guards the zero-vector edge case (returns input unchanged rather than dividing by zero). */
export function l2Normalize(v: number[]): number[] {
  let sumSq = 0;
  for (const x of v) sumSq += x * x;
  const norm = Math.sqrt(sumSq);
  if (norm === 0) return v;
  return v.map((x) => x / norm);
}

/** Dot product. For two unit (L2-normalized) vectors, dot === cosine similarity. */
function dot(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

export interface ClusterItem {
  id: string; // ticketId
  embedding: number[]; // raw (not yet normalized) 768-dim vector
}

export interface LeaderCluster {
  index: number;
  memberIds: string[]; // join order == createdAt ASC, id ASC order of the caller's input
  centroid: number[]; // current normalize(sum) — the vector KNN'd against KbChunk later
}

interface InternalCluster extends LeaderCluster {
  sum: number[]; // running element-wise sum of normalized member vectors (length 768)
}

/**
 * Deterministic greedy leader clustering.
 * PRECONDITION: `items` MUST already be ordered createdAt ASC, id ASC by the caller
 * (ticket-embeddings.ts's SQL guarantees this — do NOT re-sort here or determinism breaks).
 * Assigns each item to the FIRST existing cluster whose centroid similarity >= threshold
 * (not the best-scoring cluster) — the defining property of leader clustering.
 */
export function leaderCluster(items: ClusterItem[], threshold: number): LeaderCluster[] {
  const clusters: InternalCluster[] = [];

  for (const item of items) {
    const v = l2Normalize(item.embedding);

    let joined: InternalCluster | null = null;
    for (const cluster of clusters) {
      if (dot(v, cluster.centroid) >= threshold) {
        joined = cluster;
        break; // FIRST match wins — deterministic, O(k) worst case per item
      }
    }

    if (joined) {
      joined.memberIds.push(item.id);
      for (let i = 0; i < v.length; i++) joined.sum[i] += v[i];
      joined.centroid = l2Normalize(joined.sum);
    } else {
      clusters.push({ index: clusters.length, memberIds: [item.id], sum: [...v], centroid: v });
    }
  }

  return clusters.map(({ sum: _sum, ...rest }) => rest); // drop internal `sum` from the return shape
}
