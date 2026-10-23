import ExcelJS from "exceljs";

export interface ParsedPerDiemRow {
  key: string; // uppercased destination (or STANDARD)
  state: string | null;
  location: string;
  county: string | null;
  lodging: number;
  mie: number;
  isStandard: boolean;
}

export interface ParsedPerDiem {
  rows: ParsedPerDiemRow[];
  sourceTitle: string;
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
 * Parse a GSA per-diem flat file (STATE, DESTINATION, COUNTY, SEASON BEGIN/END,
 * Lodging, M&IE). Destinations with multiple seasonal rows are collapsed to one
 * row using the MAX lodging across seasons (M&IE is constant per destination).
 */
export async function parsePerDiemXlsx(path: string): Promise<ParsedPerDiem> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path);
  const ws = wb.worksheets[0];
  if (!ws) throw new Error("No worksheet found in workbook");

  let sourceTitle = "GSA Per Diem Rates";
  const collapsed = new Map<string, ParsedPerDiemRow>();
  let headerSeen = false;

  ws.eachRow((row) => {
    const c1 = cellText(row.getCell(1).value);
    const dest = cellText(row.getCell(2).value);
    const county = cellText(row.getCell(3).value);
    const lodging = toNum(row.getCell(6).value);
    const mie = toNum(row.getCell(7).value);

    if (!headerSeen) {
      if (/per\s*diem/i.test(c1) && !/standard/i.test(c1)) sourceTitle = c1 || sourceTitle;
      if (c1.toUpperCase() === "STATE") headerSeen = true;
      return;
    }

    // Standard CONUS row: the note text can land in column 1 or the destination
    // column depending on the file; match either.
    if (/standard conus/i.test(c1) || /standard conus/i.test(dest)) {
      if (lodging && mie) {
        collapsed.set("STANDARD", {
          key: "STANDARD",
          state: null,
          location: "Standard CONUS",
          county: null,
          lodging,
          mie,
          isStandard: true,
        });
      }
      return;
    }

    const state = c1;
    if (!dest || !lodging || !mie) return; // skip blanks/footnotes
    // Key by destination AND state: the same city name recurs across states
    // (e.g. Dallas TX vs Dallas IA), so a name-only key would merge them.
    const location = state ? `${dest}, ${state}` : dest;
    const key = location.toUpperCase();
    const existing = collapsed.get(key);
    if (existing && !existing.isStandard) {
      existing.lodging = Math.max(existing.lodging, lodging);
    } else {
      collapsed.set(key, {
        key,
        state: state || null,
        location,
        county: county || null,
        lodging,
        mie,
        isStandard: false,
      });
    }
  });

  return { rows: [...collapsed.values()], sourceTitle };
}
