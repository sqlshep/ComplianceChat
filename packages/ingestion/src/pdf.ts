import pdfParse from "pdf-parse/lib/pdf-parse.js";
import type { PageText } from "@compliancechat/shared";

/** Extract per-page text from a PDF buffer, preserving page numbers for citations. */
export async function extractPages(buffer: Buffer): Promise<PageText[]> {
  const pages: PageText[] = [];
  await pdfParse(buffer, {
    pagerender: async (pageData) => {
      const content = await pageData.getTextContent();
      const text = content.items.map((i) => i.str).join(" ");
      pages.push({ page: pages.length + 1, text });
      return text;
    },
  });
  return pages;
}
