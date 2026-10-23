import { config as loadDotenv } from "dotenv";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Loads the repo-root .env exactly once. We walk up from this file to find the
 * monorepo root (the directory containing the root package.json / .env).
 */
let loaded = false;
function ensureEnvLoaded(): void {
  if (loaded) return;
  loaded = true;
  const here = dirname(fileURLToPath(import.meta.url));
  let dir = here;
  for (let i = 0; i < 8; i++) {
    const candidate = resolve(dir, ".env");
    if (existsSync(candidate)) {
      loadDotenv({ path: candidate });
      return;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // Fall back to default behavior (process.cwd()/.env) if not found.
  loadDotenv();
}

export type Runtime = "app" | "ingestion";

function req(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === "") {
    throw new Error(
      `Missing required environment variable ${name}. Copy .env.example to .env and fill it in.`,
    );
  }
  return v.trim();
}

function opt(name: string, fallback: string): string {
  const v = process.env[name];
  return v && v.trim() !== "" ? v.trim() : fallback;
}

export interface AppConfig {
  region: string;
  /** Profile for the given runtime (app vs ingestion) resolved by the default credential chain. */
  profile: string;
  s3: {
    sourceBucket: string;
    extractedBucket: string;
    evidenceBucket: string;
  };
  dynamo: {
    controlsTable: string;
    ratesTable: string;
    decisionsTable: string;
  };
  aoss: {
    endpoint: string;
    index: string;
  };
  bedrock: {
    embedModelId: string;
    embedDim: number;
    generationModelId: string;
    evalModelId: string;
    guardrailId: string;
    guardrailVersion: string;
  };
  server: {
    host: string;
    port: number;
  };
}

/**
 * Build typed config for a given runtime. The AWS profile differs for the app
 * vs. the ingestion CLI (separate credentials where practical). Credentials
 * themselves are never read here — only the profile NAME, which the AWS SDK
 * default credential provider chain resolves (e.g. via `aws sso login`).
 */
export function getConfig(runtime: Runtime = "app"): AppConfig {
  ensureEnvLoaded();
  const profile =
    runtime === "ingestion"
      ? opt("AWS_PROFILE_INGEST", req("AWS_PROFILE"))
      : req("AWS_PROFILE");

  return {
    region: opt("AWS_REGION", "us-east-1"),
    profile,
    s3: {
      sourceBucket: req("S3_SOURCE_BUCKET"),
      extractedBucket: req("S3_EXTRACTED_BUCKET"),
      evidenceBucket: req("S3_EVIDENCE_BUCKET"),
    },
    dynamo: {
      controlsTable: req("DDB_CONTROLS_TABLE"),
      ratesTable: req("DDB_RATES_TABLE"),
      decisionsTable: req("DDB_DECISIONS_TABLE"),
    },
    aoss: {
      endpoint: req("AOSS_COLLECTION_ENDPOINT"),
      index: opt("AOSS_INDEX", "compliance-chunks"),
    },
    bedrock: {
      embedModelId: opt("BEDROCK_EMBED_MODEL_ID", "amazon.titan-embed-text-v2:0"),
      embedDim: Number(opt("BEDROCK_EMBED_DIM", "1024")),
      generationModelId: req("BEDROCK_GENERATION_MODEL_ID"),
      evalModelId: opt("BEDROCK_EVAL_MODEL_ID", req("BEDROCK_GENERATION_MODEL_ID")),
      guardrailId: req("BEDROCK_GUARDRAIL_ID"),
      guardrailVersion: opt("BEDROCK_GUARDRAIL_VERSION", "DRAFT"),
    },
    server: {
      host: opt("BACKEND_HOST", "127.0.0.1"),
      port: Number(opt("BACKEND_PORT", "8787")),
    },
  };
}
