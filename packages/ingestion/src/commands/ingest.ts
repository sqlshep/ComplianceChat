import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename, extname } from "node:path";
import { v4 as uuid } from "uuid";
import {
  bootstrapIndex,
  chunkPages,
  embedText,
  getConfig,
  indexChunks,
  log,
  makeClients,
  putJson,
  putSource,
  type IndexedChunk,
  type SourceDocumentRef,
} from "@compliancechat/shared";
import { extractPages } from "../pdf";

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!, i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

export interface IngestOptions {
  docId?: string;
  title?: string;
  edition?: string;
  sourceUrl?: string;
  recreate?: boolean;
}

export async function ingestCmd(file: string, opts: IngestOptions): Promise<void> {
  const cfg = getConfig("ingestion");
  const clients = makeClients(cfg);

  const bytes = await readFile(file);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const docId = opts.docId ?? basename(file, extname(file)).toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const title = opts.title ?? basename(file);
  const ingestedAt = new Date().toISOString();

  if (extname(file).toLowerCase() !== ".pdf") {
    throw new Error(`Only PDF ingestion is implemented; got ${extname(file)}`);
  }

  log.info(`Ensuring index exists...`);
  await bootstrapIndex(clients, cfg, { recreate: opts.recreate });

  log.info(`Uploading source to S3 (versioned)...`);
  const key = `sources/${docId}${extname(file)}`;
  const { uri: sourceUri, versionId } = await putSource(clients, cfg, key, bytes, "application/pdf");
  log.info(`  ${sourceUri} (versionId=${versionId})`);

  log.info(`Extracting PDF text...`);
  const pages = await extractPages(bytes);
  log.info(`  ${pages.length} page(s)`);

  const raw = chunkPages(pages);
  log.info(`Chunked into ${raw.length} chunk(s); embedding with ${cfg.bedrock.embedModelId}...`);

  const version = opts.edition ?? versionId;
  const chunks: IndexedChunk[] = await mapLimit(raw, 5, async (c) => {
    const embedding = await embedText(clients, cfg, c.text);
    return {
      chunkId: uuid(),
      docId,
      docTitle: title,
      version,
      s3VersionId: versionId,
      sourceUri,
      page: c.page,
      section: c.section,
      text: c.text,
      createdAt: ingestedAt,
      embedding,
    };
  });

  log.info(`Indexing ${chunks.length} chunk(s) into "${cfg.aoss.index}"...`);
  await indexChunks(clients, cfg, chunks);

  const docRef: SourceDocumentRef = {
    docId,
    title,
    sourceUri,
    s3VersionId: versionId,
    sha256,
    edition: opts.edition,
    ingestedAt,
  };
  const manifestKey = `extracted/${docId}/${versionId}.json`;
  const { uri: manifestUri } = await putJson(clients, cfg.s3.extractedBucket, manifestKey, {
    document: docRef,
    sourceUrl: opts.sourceUrl,
    chunks: chunks.map(({ embedding, ...rest }) => rest),
  });

  log.info(`Done. Extracted manifest: ${manifestUri}`);
  log.info(
    `Ingested docId="${docId}" version="${version}" sha256=${sha256.slice(0, 12)}… chunks=${chunks.length}`,
  );
}
