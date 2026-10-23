import ExcelJS from "exceljs";

export interface ParsedZipRow {
  zip: string;
  destinationId: number | null;
  name: string;
  state: string | null;
  county: string | null;
  lodging: number; // max monthly lodging across the fiscal year
}

export interface ParsedZipPerDiem {
  rows: ParsedZipRow[];
  fiscalYear: number | null;
}

function cellText(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "object" && v !== null && "text" in (v as any)) return String((v as any).text);
  if (typeof v === "object" && v !== null && "result" in (v as any)) return String((v as any).result);
  return String(v).trim();
}

function toNum(v: unknown): number | null {
  const n = Number(cellText(v).replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Parse the GSA ZIP-code per-diem flat file:
 *   DestinationID | Name | County | LocationDefined | State | ZIP | FiscalYear | Oct..Sep (12)
 * Each row is one ZIP; the 12 monthly columns are seasonal lodging rates. We
 * collapse to a single lodging value per ZIP using the MAX across months, which
 * matches how the destination flat file reports a single seasonal-max rate.
 */
export async function parseZipPerDiemXlsx(path: string): Promise<ParsedZipPerDiem> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path);
  const ws = wb.worksheets[0];
  if (!ws) throw new Error("No worksheet found in workbook");

  const byZip = new Map<string, ParsedZipRow>();
  let fiscalYear: number | null = null;
  let headerSeen = false;

  ws.eachRow((row) => {
    const c1 = cellText(row.getCell(1).value);
    if (!headerSeen) {
      if (c1.toLowerCase() === "destinationid") headerSeen = true;
      return;
    }

    const zip = cellText(row.getCell(6).value).padStart(5, "0");
    if (!/^\d{5}$/.test(zip)) return;
    const destinationId = toNum(row.getCell(1).value);
    const name = cellText(row.getCell(2).value);
    const county = cellText(row.getCell(3).value);
    const state = cellText(row.getCell(5).value);
    const fy = toNum(row.getCell(7).value);
    if (fy && !fiscalYear) fiscalYear = fy;

    // Columns 8..19 are the 12 monthly lodging rates.
    let lodging = 0;
    for (let col = 8; col <= 19; col++) {
      const m = toNum(row.getCell(col).value);
      if (m && m > lodging) lodging = m;
    }
    if (lodging <= 0) return;

    const existing = byZip.get(zip);
    if (!existing || lodging > existing.lodging) {
      byZip.set(zip, {
        zip,
        destinationId,
        name,
        state: state || null,
        county: county || null,
        lodging,
      });
    }
  });

  return { rows: [...byZip.values()], fiscalYear };
}
