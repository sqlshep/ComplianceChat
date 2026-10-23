import type { AppConfig, Runtime } from "./config";
import { getConfig } from "./config";
import { makeClients } from "./aws/clients";
import { bucketReachable } from "./aws/s3";
import { countTableItems } from "./aws/dynamo";
import { embedText } from "./aws/bedrock";
import { ping } from "./aws/opensearch";

export interface CheckResult {
  name: string;
  ok: boolean;
  detail: string;
}

/**
 * Verifies real AWS connectivity + permissions for every dependency. This makes
 * live calls on purpose — it must surface genuine failures, never mask them.
 */
export async function runConnectivityChecks(
  runtime: Runtime = "app",
  cfgOverride?: AppConfig,
): Promise<{ results: CheckResult[]; ok: boolean }> {
  const cfg = cfgOverride ?? getConfig(runtime);
  const clients = makeClients(cfg);
  const results: CheckResult[] = [];

  const run = async (name: string, fn: () => Promise<string>) => {
    try {
      const detail = await fn();
      results.push({ name, ok: true, detail });
    } catch (err) {
      results.push({ name, ok: false, detail: (err as Error).message });
    }
  };

  await run(`S3 source bucket (${cfg.s3.sourceBucket})`, async () => {
    await bucketReachable(clients, cfg.s3.sourceBucket);
    return "reachable";
  });
  await run(`S3 extracted bucket (${cfg.s3.extractedBucket})`, async () => {
    await bucketReachable(clients, cfg.s3.extractedBucket);
    return "reachable";
  });
  await run(`S3 evidence bucket (${cfg.s3.evidenceBucket})`, async () => {
    await bucketReachable(clients, cfg.s3.evidenceBucket);
    return "reachable";
  });

  await run(`DynamoDB controls (${cfg.dynamo.controlsTable})`, async () => {
    const n = await countTableItems(clients, cfg.dynamo.controlsTable);
    return `${n} items`;
  });
  await run(`DynamoDB rates (${cfg.dynamo.ratesTable})`, async () => {
    const n = await countTableItems(clients, cfg.dynamo.ratesTable);
    return `${n} items`;
  });
  await run(`DynamoDB decisions (${cfg.dynamo.decisionsTable})`, async () => {
    const n = await countTableItems(clients, cfg.dynamo.decisionsTable);
    return `${n} items`;
  });

  await run(`Bedrock embeddings (${cfg.bedrock.embedModelId})`, async () => {
    const v = await embedText(clients, cfg, "connectivity check");
    return `embedding dim ${v.length}`;
  });

  await run(`OpenSearch Serverless index (${cfg.aoss.index})`, async () => {
    const exists = await ping(clients, cfg);
    return exists ? "index exists" : "reachable, index missing (run bootstrap)";
  });

  const ok = results.every((r) => r.ok);
  return { results, ok };
}
