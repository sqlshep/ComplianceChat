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

export interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ChunkFull {
  chunkId: string;
  docId: string;
  docTitle: string;
  version: string;
  sourceUri: string;
  page: number | null;
  section: string | null;
  text: string;
  createdAt: string;
}

export interface ChatResult {
  conversationId: string;
  decisionId: string;
  answer: string;
  citations: Citation[];
  guardrailAction?: string;
  blocked: boolean;
  standaloneQuery: string;
}

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
  computed: Record<string, number | string | null>;
  citations: Citation[];
}

export interface DecisionRecord {
  decisionId: string;
  type: "chat" | "validation";
  createdAt: string;
  query: string;
  outcome: string;
  citations: Citation[];
  evidenceUri: string;
}

export interface ZipLookup {
  zip: string;
  fiscalYear: number;
  location: string;
  state: string | null;
  county: string | null;
  lodging: number;
  mie: number | null;
  mieSource: string;
}

export interface PerDiemDestination {
  location: string;
  state: string | null;
  key: string;
  lodging: number;
  mie: number;
}

export interface HealthCheck {
  name: string;
  ok: boolean;
  detail: string;
}
