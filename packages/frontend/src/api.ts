import type {
  ChatResult,
  ChunkFull,
  ConversationMessage,
  DecisionRecord,
  HealthCheck,
  PerDiemDestination,
  ValidationResult,
  ZipLookup,
} from "./types";

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

async function get<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

export const api = {
  chat: (args: {
    question: string;
    history?: ConversationMessage[];
    conversationId?: string;
  }) => post<ChatResult>("/api/chat", args),
  validate: (claim: unknown) => post<ValidationResult>("/api/validate", claim),
  decisions: () => get<{ items: DecisionRecord[] }>("/api/decisions"),
  health: () => get<{ ok: boolean; results: HealthCheck[] }>("/api/health/aws"),
  chunk: (id: string) => get<{ chunk: ChunkFull }>(`/api/chunks/${encodeURIComponent(id)}`),
  destinations: (fiscalYear: number) =>
    get<{ fiscalYear: number; items: PerDiemDestination[] }>(
      `/api/rates/destinations?fiscalYear=${fiscalYear}`,
    ),
  zipLookup: (fiscalYear: number, zip: string) =>
    get<ZipLookup>(`/api/rates/zip?fiscalYear=${fiscalYear}&zip=${encodeURIComponent(zip)}`),
};
