import type { AppConfig } from "../config";
import type { AwsClients } from "./clients";
import type { Chunk, IndexedChunk, RetrievedChunk } from "../types";

/** Create the vector index with a 1024-dim knn_vector field + text fields. */
export async function bootstrapIndex(
  clients: AwsClients,
  cfg: AppConfig,
  opts: { recreate?: boolean } = {},
): Promise<{ created: boolean }> {
  const index = cfg.aoss.index;
  const exists = await clients.opensearch.indices.exists({ index });
  if (exists.body) {
    if (!opts.recreate) return { created: false };
    await clients.opensearch.indices.delete({ index });
  }

  await clients.opensearch.indices.create({
    index,
    body: {
      settings: { index: { knn: true } },
      mappings: {
        properties: {
          chunkId: { type: "keyword" },
          docId: { type: "keyword" },
          docTitle: { type: "text" },
          version: { type: "keyword" },
          s3VersionId: { type: "keyword" },
          sourceUri: { type: "keyword" },
          page: { type: "integer" },
          section: { type: "text" },
          text: { type: "text" },
          createdAt: { type: "date" },
          embedding: {
            type: "knn_vector",
            dimension: cfg.bedrock.embedDim,
            method: {
              name: "hnsw",
              space_type: "cosinesimil",
              engine: "faiss",
              parameters: { ef_construction: 256, m: 16 },
            },
          },
        },
      },
    },
  });
  return { created: true };
}

export async function indexChunks(
  clients: AwsClients,
  cfg: AppConfig,
  chunks: IndexedChunk[],
): Promise<number> {
  if (chunks.length === 0) return 0;
  const body = chunks.flatMap((c) => [{ index: { _index: cfg.aoss.index } }, c]);
  const res = await clients.opensearch.bulk({ body });
  if (res.body.errors) {
    const firstErr = res.body.items?.find((i: any) => i.index?.error)?.index?.error;
    throw new Error(`Bulk index errors: ${JSON.stringify(firstErr)}`);
  }
  return chunks.length;
}

/**
 * Hybrid retrieval: run a lexical BM25 query and a vector kNN query, then merge
 * with Reciprocal Rank Fusion. Robust across OpenSearch versions and avoids
 * relying on server-side hybrid pipelines.
 */
export async function hybridSearch(
  clients: AwsClients,
  cfg: AppConfig,
  args: { query: string; queryEmbedding: number[]; k?: number },
): Promise<RetrievedChunk[]> {
  const k = args.k ?? 6;
  const pool = Math.max(k * 3, 12);

  const [lexical, vector] = await Promise.all([
    clients.opensearch.search({
      index: cfg.aoss.index,
      body: {
        size: pool,
        query: { multi_match: { query: args.query, fields: ["text^2", "section", "docTitle"] } },
      },
    }),
    clients.opensearch.search({
      index: cfg.aoss.index,
      body: {
        size: pool,
        query: { knn: { embedding: { vector: args.queryEmbedding, k: pool } } },
      },
    }),
  ]);

  const rrf = new Map<string, { chunk: RetrievedChunk; score: number }>();
  const C = 60;
  const consume = (hits: any[], kind: "lexical" | "vector") => {
    hits.forEach((h, i) => {
      const src = h._source as IndexedChunk;
      const id = src.chunkId;
      const contrib = 1 / (C + i + 1);
      const existing = rrf.get(id);
      if (existing) {
        existing.score += contrib;
        if (kind === "lexical") existing.chunk.lexicalRank = i + 1;
        else existing.chunk.vectorRank = i + 1;
      } else {
        const { embedding, ...rest } = src as any;
        rrf.set(id, {
          score: contrib,
          chunk: {
            ...(rest as RetrievedChunk),
            score: 0,
            lexicalRank: kind === "lexical" ? i + 1 : undefined,
            vectorRank: kind === "vector" ? i + 1 : undefined,
          },
        });
      }
    });
  };

  consume(lexical.body.hits?.hits ?? [], "lexical");
  consume(vector.body.hits?.hits ?? [], "vector");

  return [...rrf.values()]
    .map((e) => ({ ...e.chunk, score: e.score }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}

/** Fetch a single chunk (full text + metadata, minus embedding) by its chunkId. */
export async function getChunkById(
  clients: AwsClients,
  cfg: AppConfig,
  chunkId: string,
): Promise<Chunk | null> {
  const res = await clients.opensearch.search({
    index: cfg.aoss.index,
    body: { size: 1, query: { term: { chunkId } } },
  });
  const hit = res.body.hits?.hits?.[0];
  if (!hit) return null;
  const { embedding, ...rest } = hit._source as IndexedChunk;
  return rest as Chunk;
}

export async function ping(clients: AwsClients, cfg: AppConfig): Promise<boolean> {
  const exists = await clients.opensearch.indices.exists({ index: cfg.aoss.index });
  return Boolean(exists.body);
}
