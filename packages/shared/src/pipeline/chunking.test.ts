import { describe, expect, it } from "vitest";
import { chunkPages } from "./chunking";

describe("chunkPages", () => {
  it("splits long page text into overlapping chunks", () => {
    const para = "This is a sentence about per diem lodging rates. ".repeat(60);
    const chunks = chunkPages([{ page: 1, text: para }], { maxChars: 500, overlapChars: 50 });
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.text.length <= 520)).toBe(true);
    expect(chunks.every((c) => c.page === 1)).toBe(true);
  });

  it("detects FTR section labels", () => {
    const chunks = chunkPages([
      { page: 5, text: "§ 301-11.16 Are lodging taxes included in per diem?\n\nLodging taxes are reimbursable." },
    ]);
    expect(chunks[0]?.section).toBe("FTR 301-11.16");
  });

  it("drops trivially short fragments", () => {
    const chunks = chunkPages([{ page: 1, text: "ok" }]);
    expect(chunks.length).toBe(0);
  });
});
