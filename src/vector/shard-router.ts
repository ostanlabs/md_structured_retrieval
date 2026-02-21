/**
 * ShardRouter
 *
 * Deterministic shard assignment for documents using FNV-1a hash.
 * Used to distribute documents across FAISS shard indexes.
 */

/**
 * FNV-1a 32-bit hash function.
 * Fast, deterministic, good distribution.
 */
export function fnv1a32(input: string): number {
  let hash = 0x811c9dc5; // FNV offset basis
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193); // FNV prime
  }
  return hash >>> 0; // Convert to unsigned 32-bit
}

/**
 * Routes documents to shards based on their URI.
 */
export class ShardRouter {
  constructor(private shardCount: number = 128) {}

  /**
   * Get the shard ID for a document.
   * @param docUri - Vault-relative POSIX path (e.g., "notes/test.md")
   * @returns Shard ID in range [0, shardCount)
   */
  getShardId(docUri: string): number {
    return fnv1a32(docUri) % this.shardCount;
  }
}

