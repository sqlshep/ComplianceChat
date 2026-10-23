import type { AppConfig } from "../config";
import type { AwsClients } from "../aws/clients";
import { embedText, generatePlain } from "../aws/bedrock";
import { hybridSearch } from "../aws/opensearch";
import type { Citation, ConversationMessage, RetrievedChunk } from "../types";

const CONDENSE_SYSTEM = `Rewrite the user's latest message into a single standalone search query
for a federal travel/per-diem knowledge base, resolving pronouns and references using the prior
conversation. Return ONLY the rewritten query text, with no quotes or preamble.`;

/**
 * Turn a follow-up question into a standalone query using the conversation
 * history, so retrieval works across turns. No-op when there is no history.
 */
export async function condenseQuery(
  clients: AwsClients,
  cfg: AppConfig,
  history: ConversationMessage[],
  question: string,
): Promise<string> {
  if (!history.length) return question;
  const transcript = history.map((m) => `${m.role.toUpperCase()}: ${m.content}`).join("\n");
  try {
    const out = await generatePlain(clients, cfg, {
      system: CONDENSE_SYSTEM,
      user: `Conversation so far:\n${transcript}\n\nLatest user message:\n${question}\n\nStandalone query:`,
      maxTokens: 120,
    });
    const cleaned = out.trim().replace(/^["']|["']$/g, "").trim();
    return cleaned || question;
  } catch {
    return question;
  }
}

export async function retrieve(
  clients: AwsClients,
  cfg: AppConfig,
  query: string,
  k = 6,
): Promise<RetrievedChunk[]> {
  const queryEmbedding = await embedText(clients, cfg, query);
  return hybridSearch(clients, cfg, { query, queryEmbedding, k });
}

export function toCitations(chunks: RetrievedChunk[]): Citation[] {
  return chunks.map((c) => ({
    chunkId: c.chunkId,
    docId: c.docId,
    docTitle: c.docTitle,
    version: c.version,
    sourceUri: c.sourceUri,
    page: c.page,
    section: c.section,
    score: Number(c.score.toFixed(5)),
    snippet: c.text.length > 320 ? `${c.text.slice(0, 317)}...` : c.text,
  }));
}

/**
 * Render retrieved chunks into a numbered grounding block for the model.
 * `offset` shifts the source numbers (used when other sources, e.g. a structured
 * rate row, are prepended ahead of the retrieved chunks).
 */
export function renderContext(chunks: RetrievedChunk[], offset = 0): string {
  return chunks
    .map((c, i) => {
      const loc = [c.docTitle, c.section ?? undefined, c.page ? `p.${c.page}` : undefined]
        .filter(Boolean)
        .join(", ");
      return `[[${i + 1 + offset}]] (${loc}; version ${c.version})\n${c.text}`;
    })
    .join("\n\n");
}
