import { v4 as uuid } from "uuid";
import type { AppConfig } from "../config";
import type { AwsClients } from "../aws/clients";
import { generateGrounded } from "../aws/bedrock";
import { condenseQuery, retrieve, toCitations, renderContext } from "./retrieval";
import { lookupRateForQuery } from "./rateLookup";
import { recordDecision } from "./decisions";
import type { ChatResult, Citation, ConversationMessage } from "../types";

const SYSTEM = `You are ComplianceChat, an assistant for U.S. federal travel (per diem) compliance.
Rules:
- Answer ONLY using the numbered sources provided in the grounding context for THIS turn.
  Treat those sources as the complete universe of allowed facts.
- Every factual claim, number, condition, or example MUST appear in a cited source. Do NOT add
  examples, categories, scenarios, causes, or qualifiers (e.g. "such as college dormitories",
  "due to special events") unless those exact items appear in a cited source.
- Prefer the regulation's own wording. Quote exact rates, dollar amounts, percentages, time
  limits, and FTR/FAQ section numbers verbatim from the sources rather than paraphrasing them.
- You may use earlier conversation turns only to understand what is being asked; every factual
  claim must still be supported by THIS turn's cited sources, not by memory of past turns.
- Cite every factual claim with bracketed source numbers like [1] or [2][3]. Cite the specific
  source that supports each statement; do not cite a source that does not contain the claim.
- If the sources do not fully answer the question, say exactly what is and is not covered in the
  cited material and stop. Do not guess, infer beyond the text, or fill gaps from general knowledge.
- Do not restate a source's example as if it were an exhaustive or general rule.
- Be concise and specific. This is reference information, not individualized legal or financial advice.`;

/**
 * Multi-turn conversational answer. `history` is the prior turns (oldest first);
 * `question` is the new user message. The question is condensed into a standalone
 * query using history, retrieval runs on that, and prior turns are passed to the
 * model. Each turn is persisted as its own decision record under one conversationId.
 */
export async function answerConversation(
  clients: AwsClients,
  cfg: AppConfig,
  args: {
    question: string;
    history?: ConversationMessage[];
    conversationId?: string;
    k?: number;
  },
): Promise<ChatResult> {
  const history = args.history ?? [];
  const conversationId = args.conversationId ?? uuid();
  const k = args.k ?? 6;

  const standaloneQuery = await condenseQuery(clients, cfg, history, args.question);

  // Enrich with the real structured per-diem rate when the question is about a
  // specific location/ZIP, so the model answers with exact numbers (not just FTR
  // prose). The rate becomes source [1], ahead of the retrieved document chunks.
  const rateCtx = await lookupRateForQuery(clients, cfg, standaloneQuery).catch(() => null);

  const chunks = await retrieve(clients, cfg, standaloneQuery, k);
  const citations: Citation[] = rateCtx
    ? [rateCtx.citation, ...toCitations(chunks)]
    : toCitations(chunks);
  const context = [
    rateCtx ? `[[1]] (${rateCtx.citation.docTitle}; ${rateCtx.citation.section})\n${rateCtx.text}` : null,
    renderContext(chunks, rateCtx ? 1 : 0),
  ]
    .filter(Boolean)
    .join("\n\n");

  const gen = await generateGrounded(clients, cfg, {
    system: SYSTEM,
    groundingSource: context,
    query: args.question,
    history,
  });

  const record = await recordDecision(clients, cfg, {
    type: "chat",
    conversationId,
    query: args.question,
    outcome: gen.blocked ? "BLOCKED" : "ANSWERED",
    citations,
    guardrailAction: gen.guardrailAction,
    evidence: {
      input: { question: args.question, standaloneQuery, history, conversationId, k },
      retrieval: chunks,
      prompt: { system: SYSTEM, groundingSource: context, query: args.question },
      rawModelOutput: gen.text,
      guardrail: gen.guardrailTrace,
      result: { answer: gen.text, blocked: gen.blocked },
    },
  });

  return {
    conversationId,
    decisionId: record.decisionId,
    answer: gen.text,
    citations,
    guardrailAction: gen.guardrailAction,
    blocked: gen.blocked,
    standaloneQuery,
  };
}

/** Single-turn convenience wrapper (CLI `ask`, evaluation). */
export async function answerQuestion(
  clients: AwsClients,
  cfg: AppConfig,
  query: string,
  k = 6,
): Promise<ChatResult> {
  return answerConversation(clients, cfg, { question: query, k });
}
