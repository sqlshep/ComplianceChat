import { useRef, useState } from "react";
import { api } from "../api";
import type { Citation } from "../types";
import { Citations } from "./Citations";

interface Turn {
  role: "user" | "assistant";
  content: string;
  citations?: Citation[];
  decisionId?: string;
  blocked?: boolean;
}

const SAMPLES = [
  "What is the per diem in New York City?",
  "What is the lodging and M&IE per diem for ZIP code 20001?",
  "Are lodging taxes included in the CONUS per diem rate?",
  "What percentage of M&IE do I get on the first and last day of travel?",
  "What can I do if no hotels are available at the per diem rate?",
];

export function Chat() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const convId = useRef<string | undefined>(undefined);

  async function send(q: string) {
    if (!q.trim() || loading) return;
    setError(null);
    setLoading(true);
    // History is the thread so far (text only), oldest first.
    const history = turns.map((t) => ({ role: t.role, content: t.content }));
    setTurns((prev) => [...prev, { role: "user", content: q }]);
    setQuestion("");
    try {
      const res = await api.chat({ question: q, history, conversationId: convId.current });
      convId.current = res.conversationId;
      setTurns((prev) => [
        ...prev,
        {
          role: "assistant",
          content: res.answer || (res.blocked ? "(guardrail blocked this response)" : ""),
          citations: res.citations,
          decisionId: res.decisionId,
          blocked: res.blocked,
        },
      ]);
    } catch (e) {
      setError((e as Error).message);
      // Roll back the optimistic user turn marker by leaving it; show error separately.
    } finally {
      setLoading(false);
    }
  }

  function reset() {
    setTurns([]);
    convId.current = undefined;
    setError(null);
  }

  return (
    <div className="panel">
      <div className="thread">
        {turns.length === 0 ? (
          <div className="samples">
            {SAMPLES.map((s) => (
              <button type="button" key={s} className="chip" onClick={() => send(s)}>
                {s}
              </button>
            ))}
          </div>
        ) : null}

        {turns.map((t, i) => (
          <div key={i} className={`bubble ${t.role}`}>
            <div className="bubble-role">{t.role === "user" ? "You" : "ComplianceChat"}</div>
            {t.blocked ? <div className="blocked">Guardrail intervened.</div> : null}
            <div className="bubble-text">{t.content}</div>
            {t.citations && t.citations.length ? <Citations citations={t.citations} /> : null}
            {t.decisionId ? <div className="decision-id">decision: {t.decisionId}</div> : null}
          </div>
        ))}
        {loading ? <div className="bubble assistant"><div className="bubble-text muted">Thinking…</div></div> : null}
      </div>

      {error ? <div className="error">Error: {error}</div> : null}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(question.trim());
        }}
      >
        <textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send(question.trim());
            }
          }}
          placeholder={turns.length ? "Ask a follow-up…" : "Ask a federal travel / per diem compliance question…"}
          rows={2}
        />
        <div className="row">
          <button type="submit" disabled={loading || !question.trim()}>
            {loading ? "Thinking…" : "Send"}
          </button>
          {turns.length ? (
            <button type="button" className="chip" onClick={reset}>
              New conversation
            </button>
          ) : null}
        </div>
      </form>
    </div>
  );
}
