import { z } from "zod";

/* ----------------------------- Documents & chunks ----------------------------- */

/** A versioned source document stored in S3 (versioning enabled on the bucket). */
export interface SourceDocumentRef {
  docId: string;
  title: string;
  /** S3 URI of the source object, e.g. s3://bucket/sources/ftr-2021.pdf */
  sourceUri: string;
  /** S3 object versionId captured at ingest time — the authoritative document version. */
  s3VersionId: string;
  /** SHA-256 of the source bytes, for integrity / dedupe. */
  sha256: string;
  /** Human-facing edition label, e.g. "July 1, 2021 annual edition". */
  edition?: string;
  /** Effective date (ISO) if known. */
  effectiveDate?: string;
  ingestedAt: string;
}

/** A retrievable chunk indexed in OpenSearch Serverless. */
export interface Chunk {
  chunkId: string;
  docId: string;
  docTitle: string;
  version: string; // s3VersionId or edition label used for citation
  s3VersionId: string;
  sourceUri: string;
  page: number | null;
  section: string | null;
  text: string;
  createdAt: string;
}

export interface IndexedChunk extends Chunk {
  embedding: number[];
}

/** A chunk returned from retrieval, with fused score. */
export interface RetrievedChunk extends Chunk {
  score: number;
  lexicalRank?: number;
  vectorRank?: number;
}

/* --------------------------------- Citations --------------------------------- */

export interface Citation {
  chunkId: string;
  docId: string;
  docTitle: string;
  version: string;
  sourceUri: string;
  page: number | null;
  section: string | null;
  score: number;
  snippet: string;
}

/* ---------------------------------- Controls ---------------------------------- */

export const ControlSchema = z.object({
  controlId: z.string(),
  version: z.string(),
  status: z.enum(["active", "deprecated", "draft"]),
  title: z.string(),
  description: z.string(),
  /** Machine rule key the compliance engine understands. */
  ruleKey: z.string(),
  /** Free-form parameters used by the rule. */
  params: z.record(z.unknown()).default({}),
  /** Citations back to source authority (FTR section / FAQ). */
  authority: z.array(
    z.object({
      docId: z.string(),
      label: z.string(), // e.g. "FTR 301-11.16"
      sourceUri: z.string().optional(),
    }),
  ),
  effectiveDate: z.string().optional(),
  createdAt: z.string(),
});
export type Control = z.infer<typeof ControlSchema>;

/* ----------------------------------- Rates ----------------------------------- */

/** Per-diem rate row (lodging + M&IE) for a location & fiscal year. */
export interface PerDiemRate {
  pk: string; // e.g. PERDIEM#2025#STANDARD or PERDIEM#2025#DC
  sk: string; // e.g. STANDARD or WASHINGTON
  type: "PERDIEM";
  fiscalYear: number;
  state: string | null;
  location: string; // "Standard CONUS" | city/area name
  lodging: number;
  mie: number;
  isStandard: boolean;
  authority: { docId: string; label: string; sourceUri?: string };
}

/** M&IE breakdown row (how much to deduct per provided meal). */
export interface MieBreakdown {
  pk: string; // MIE#CONUS
  sk: string; // the M&IE total, e.g. "68"
  type: "MIE";
  mieTotal: number;
  breakfast: number;
  lunch: number;
  dinner: number;
  incidentals: number;
  firstLastDay: number; // 75% of total
  authority: { docId: string; label: string; sourceUri?: string };
}

/** GSA ZIP-code -> per-diem lodging crosswalk row (lodging only; M&IE is per destination). */
export interface ZipPerDiemRate {
  pk: string; // ZIP#2027#00501
  sk: string; // "ZIP"
  type: "ZIPPERDIEM";
  fiscalYear: number;
  zip: string;
  destinationId: number | null;
  name: string; // destination name
  state: string | null;
  county: string | null;
  lodging: number; // max monthly lodging rate across the fiscal year
  authority: { docId: string; label: string; sourceUri?: string };
}

export type RateRow = PerDiemRate | MieBreakdown | ZipPerDiemRate;

/* --------------------------------- Decisions --------------------------------- */

export type DecisionType = "chat" | "validation";

export interface DecisionRecord {
  decisionId: string;
  entityType: "DECISION"; // partition constant for the created-index GSI
  type: DecisionType;
  createdAt: string;
  /** Present for chat decisions — groups turns of one conversation. */
  conversationId?: string;
  query: string;
  outcome: string; // short summary / PASS|FAIL|ANSWERED
  citations: Citation[];
  /** S3 key (in the evidence bucket) of the full evidence JSON. */
  evidenceUri: string;
  model: {
    generationModelId: string;
    embedModelId: string;
    guardrailId: string;
    guardrailVersion: string;
    guardrailAction?: string;
  };
}

/** Full evidence payload persisted to the evidence bucket (never truncated). */
export interface DecisionEvidence {
  decisionId: string;
  type: DecisionType;
  createdAt: string;
  input: unknown;
  retrieval: RetrievedChunk[];
  prompt: { system: string; groundingSource: string; query: string };
  rawModelOutput: string;
  guardrail?: unknown;
  result: unknown;
}

/* ------------------------------ Chat / Validate ------------------------------ */

export interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ChatResult {
  conversationId: string;
  decisionId: string;
  answer: string;
  citations: Citation[];
  guardrailAction?: string;
  blocked: boolean;
  /** The standalone question used for retrieval (after condensing history). */
  standaloneQuery: string;
}

export const ClaimSchema = z.object({
  location: z.string().min(1), // city or "Standard CONUS"
  state: z.string().optional(),
  fiscalYear: z.number().int(),
  nights: z.number().int().nonnegative(),
  lodgingCostPerNight: z.number().nonnegative(),
  /** Total travel days (for M&IE first/last-day 75% handling). */
  travelDays: z.number().int().positive(),
  /** Meals provided by government/registration across the whole trip. */
  providedMeals: z
    .object({
      breakfast: z.number().int().nonnegative().default(0),
      lunch: z.number().int().nonnegative().default(0),
      dinner: z.number().int().nonnegative().default(0),
    })
    .default({ breakfast: 0, lunch: 0, dinner: 0 }),
  /** Whether the agency authorized actual-expense (up to 300% of per diem). */
  actualExpenseAuthorized: z.boolean().default(false),
});
export type Claim = z.infer<typeof ClaimSchema>;

export interface RuleFinding {
  controlId: string;
  title: string;
  status: "pass" | "fail" | "info";
  message: string;
  authority: { docId: string; label: string; sourceUri?: string }[];
}

export interface ValidationResult {
  decisionId: string;
  outcome: "PASS" | "FAIL";
  findings: RuleFinding[];
  computed: {
    lodgingRate: number | null;
    mieRate: number | null;
    maxLodgingReimbursable: number;
    claimedLodging: number;
    mieFirstLastDay: number;
    mieFullDays: number;
    mieDeductions: number;
    mieTotalAllowance: number;
    rateSource: string;
  };
  citations: Citation[];
}
