import { useEffect, useState } from "react";
import { api } from "../api";
import type { DecisionRecord } from "../types";

export function Decisions() {
  const [items, setItems] = useState<DecisionRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await api.decisions();
      setItems(res.items);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  return (
    <div className="panel">
      <div className="row">
        <button onClick={load} disabled={loading}>
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>
      {error ? <div className="error">Error: {error}</div> : null}
      <table className="decisions">
        <thead>
          <tr>
            <th>When</th>
            <th>Type</th>
            <th>Outcome</th>
            <th>Query</th>
            <th>Cites</th>
          </tr>
        </thead>
        <tbody>
          {items.map((d) => (
            <tr key={d.decisionId}>
              <td title={d.decisionId}>{new Date(d.createdAt).toLocaleString()}</td>
              <td>{d.type}</td>
              <td>{d.outcome}</td>
              <td className="truncate">{d.query}</td>
              <td>{d.citations.length}</td>
            </tr>
          ))}
          {!items.length && !loading ? (
            <tr>
              <td colSpan={5} className="muted">
                No decisions yet. Ask a question or validate a claim.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}
