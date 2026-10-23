export interface PageText {
  page: number;
  text: string;
}

export interface RawChunk {
  page: number | null;
  section: string | null;
  text: string;
}

/** Detects FTR-style section labels like "§ 301-11.16" or "301-11.16". */
const SECTION_RE = /(?:§\s*)?(\d{3}-\d{1,2}\.\d{1,3})/;

function detectSection(text: string): string | null {
  const m = text.match(SECTION_RE);
  return m ? `FTR ${m[1]}` : null;
}

function normalize(s: string): string {
  return s.replace(/\u0000/g, "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Chunk page text into overlapping windows. Paragraph-aware: we accumulate
 * paragraphs up to `maxChars`, then start a new chunk carrying `overlapChars`
 * of trailing context.
 */
export function chunkPages(
  pages: PageText[],
  opts: { maxChars?: number; overlapChars?: number } = {},
): RawChunk[] {
  const maxChars = opts.maxChars ?? 1400;
  const overlapChars = opts.overlapChars ?? 200;
  const out: RawChunk[] = [];

  for (const { page, text } of pages) {
    const clean = normalize(text);
    if (!clean) continue;
    const paras = clean.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);

    let buf = "";
    const flush = () => {
      const body = buf.trim();
      if (body.length < 40) {
        buf = "";
        return;
      }
      out.push({ page, section: detectSection(body), text: body });
      buf = overlapChars > 0 ? body.slice(-overlapChars) : "";
    };

    for (const para of paras) {
      if (buf && buf.length + para.length + 2 > maxChars) flush();
      buf += (buf ? "\n\n" : "") + para;
      while (buf.length > maxChars) {
        const head = buf.slice(0, maxChars);
        out.push({ page, section: detectSection(head), text: head.trim() });
        buf = buf.slice(maxChars - overlapChars);
      }
    }
    if (buf.trim()) flush();
  }

  return out;
}
