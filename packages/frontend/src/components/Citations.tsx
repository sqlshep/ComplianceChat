import { useState } from "react";
import { api } from "../api";
import type { Citation } from "../types";

function httpLink(uri: string): string | null {
  return uri && /^https?:\/\//.test(uri) ? uri : null;
}

function CitationItem({ c, index }: { c: Citation; index: number }) {
  const [open, setOpen] = useState(false);
  const [fullText, setFullText] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const label = [c.docTitle, c.section ?? undefined, c.page ? `p.${c.page}` : undefined]
    .filter(Boolean)
    .join(" · ");
  const link = httpLink(c.sourceUri);

  async function toggle() {
    const next = !open;
    setOpen(next);
    // Fetch the full passage from the index on first expand (indexed chunks only).
    if (next && fullText === null && !loading && c.chunkId && !c.chunkId.includes(":")) {
      setLoading(true);
      setError(null);
      try {
        const { chunk } = await api.chunk(c.chunkId);
        setFullText(chunk.text);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    }
  }

  return (
    <li className="cite-item">
      <button type="button" className="cite-link" onClick={toggle} aria-expanded={open}>
        <span className="cite-num">[{index + 1}]</span>
        <span className="cite-doc">{label}</span>
        <span className="cite-ver"> · v {c.version}</span>
        <span className="cite-caret">{open ? "▾" : "▸"}</span>
      </button>
      {open ? (
        <div className="cite-body">
          <div className="cite-full">{fullText ?? c.snippet}</div>
          {loading ? <div className="muted">Loading full passage…</div> : null}
          {error ? <div className="muted">Showing preview (full passage unavailable).</div> : null}
          {link ? (
            <a className="cite-src" href={link} target="_blank" rel="noreferrer">
              Open source ↗
            </a>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

export function Citations({ citations }: { citations: Citation[] }) {
  if (!citations.length) return null;
  return (
    <div className="citations">
      <div className="citations-title">Citations — click to read more</div>
      <ol className="cite-list">
        {citations.map((c, i) => (
          <CitationItem key={c.chunkId + i} c={c} index={i} />
        ))}
      </ol>
    </div>
  );
}
