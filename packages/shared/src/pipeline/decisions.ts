import { v4 as uuid } from "uuid";
import type { AppConfig } from "../config";
import type { AwsClients } from "../aws/clients";
import { putJson } from "../aws/s3";
import { putDecision } from "../aws/dynamo";
import type {
  Citation,
  DecisionEvidence,
  DecisionRecord,
  DecisionType,
} from "../types";

/**
 * Persist a decision record: full evidence JSON goes to the evidence S3 bucket
 * (immutable, versioned), and queryable metadata goes to DynamoDB.
 */
export async function recordDecision(
  clients: AwsClients,
  cfg: AppConfig,
  args: {
    type: DecisionType;
    query: string;
    outcome: string;
    citations: Citation[];
    evidence: Omit<DecisionEvidence, "decisionId" | "createdAt" | "type">;
    guardrailAction?: string;
    conversationId?: string;
  },
): Promise<DecisionRecord> {
  const decisionId = uuid();
  const createdAt = new Date().toISOString();
  const evidenceKey = `decisions/${createdAt.slice(0, 10)}/${decisionId}.json`;

  const evidence: DecisionEvidence = {
    decisionId,
    type: args.type,
    createdAt,
    ...args.evidence,
  };
  const { uri: evidenceUri } = await putJson(
    clients,
    cfg.s3.evidenceBucket,
    evidenceKey,
    evidence,
  );

  const record: DecisionRecord = {
    decisionId,
    entityType: "DECISION",
    type: args.type,
    createdAt,
    conversationId: args.conversationId,
    query: args.query,
    outcome: args.outcome,
    citations: args.citations,
    evidenceUri,
    model: {
      generationModelId: cfg.bedrock.generationModelId,
      embedModelId: cfg.bedrock.embedModelId,
      guardrailId: cfg.bedrock.guardrailId,
      guardrailVersion: cfg.bedrock.guardrailVersion,
      guardrailAction: args.guardrailAction,
    },
  };
  await putDecision(clients, cfg, record);
  return record;
}
