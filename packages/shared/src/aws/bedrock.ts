import {
  ConverseCommand,
  InvokeModelCommand,
  type ContentBlock,
  type Message,
} from "@aws-sdk/client-bedrock-runtime";
import type { AppConfig } from "../config";
import type { AwsClients } from "./clients";
import type { ConversationMessage } from "../types";

const td = new TextDecoder();
const te = new TextEncoder();

/** Titan Text Embeddings v2 — returns a normalized embedding vector. */
export async function embedText(
  clients: AwsClients,
  cfg: AppConfig,
  text: string,
): Promise<number[]> {
  const body = JSON.stringify({
    inputText: text,
    dimensions: cfg.bedrock.embedDim,
    normalize: true,
  });
  const res = await clients.bedrock.send(
    new InvokeModelCommand({
      modelId: cfg.bedrock.embedModelId,
      contentType: "application/json",
      accept: "application/json",
      body: te.encode(body),
    }),
  );
  const parsed = JSON.parse(td.decode(res.body)) as { embedding: number[] };
  if (!parsed.embedding || parsed.embedding.length !== cfg.bedrock.embedDim) {
    throw new Error(
      `Unexpected embedding dimension from ${cfg.bedrock.embedModelId}: got ${parsed.embedding?.length}`,
    );
  }
  return parsed.embedding;
}

export interface GenerateResult {
  text: string;
  guardrailAction?: string;
  guardrailTrace?: unknown;
  blocked: boolean;
}

/**
 * Generation with the configured guardrail applied. The retrieved context is
 * passed as a `grounding_source` guard-content block and the user question as a
 * `query` block, so the guardrail's contextual-grounding policy actually runs.
 */
export async function generateGrounded(
  clients: AwsClients,
  cfg: AppConfig,
  args: {
    system: string;
    groundingSource: string;
    query: string;
    history?: ConversationMessage[];
    maxTokens?: number;
  },
): Promise<GenerateResult> {
  const content: ContentBlock[] = [
    { guardContent: { text: { text: args.groundingSource, qualifiers: ["grounding_source"] } } },
    { guardContent: { text: { text: args.query, qualifiers: ["query"] } } },
  ];

  // Prior conversation turns become normal messages; the current turn carries the
  // grounded guard-content so the guardrail's grounding policy evaluates it.
  const history: Message[] = (args.history ?? []).map((m) => ({
    role: m.role,
    content: [{ text: m.content }],
  }));

  const res = await clients.bedrock.send(
    new ConverseCommand({
      modelId: cfg.bedrock.generationModelId,
      system: [{ text: args.system }],
      messages: [...history, { role: "user", content }],
      inferenceConfig: { maxTokens: args.maxTokens ?? 900, temperature: 0 },
      guardrailConfig: {
        guardrailIdentifier: cfg.bedrock.guardrailId,
        guardrailVersion: cfg.bedrock.guardrailVersion,
        trace: "enabled",
      },
    }),
  );

  const text =
    res.output?.message?.content?.map((c) => ("text" in c ? c.text : "")).join("") ?? "";
  const blocked = res.stopReason === "guardrail_intervened";
  return {
    text,
    blocked,
    guardrailAction: res.stopReason,
    guardrailTrace: res.trace?.guardrail,
  };
}

/** Plain generation (no guardrail) used by the evaluation judge. */
export async function generatePlain(
  clients: AwsClients,
  cfg: AppConfig,
  args: { system: string; user: string; modelId?: string; maxTokens?: number },
): Promise<string> {
  const res = await clients.bedrock.send(
    new ConverseCommand({
      modelId: args.modelId ?? cfg.bedrock.evalModelId,
      system: [{ text: args.system }],
      messages: [{ role: "user", content: [{ text: args.user }] }],
      inferenceConfig: { maxTokens: args.maxTokens ?? 600, temperature: 0 },
    }),
  );
  return res.output?.message?.content?.map((c) => ("text" in c ? c.text : "")).join("") ?? "";
}
