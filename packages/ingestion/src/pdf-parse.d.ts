declare module "pdf-parse/lib/pdf-parse.js" {
  interface PdfParseResult {
    text: string;
    numpages: number;
    info: unknown;
    metadata: unknown;
    version: string;
  }
  interface PdfParseOptions {
    pagerender?: (pageData: {
      getTextContent: (opts?: unknown) => Promise<{ items: Array<{ str: string }> }>;
    }) => Promise<string> | string;
    max?: number;
  }
  function pdfParse(
    data: Buffer | Uint8Array,
    options?: PdfParseOptions,
  ): Promise<PdfParseResult>;
  export default pdfParse;
}
