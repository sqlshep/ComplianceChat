import type { AppConfig } from "../config";
import type { AwsClients } from "../aws/clients";
import {
  findPerDiemByName,
  getStandardPerDiem,
  getZipPerDiem,
  listPerDiemDestinations,
} from "../aws/dynamo";
import type { Citation } from "../types";

/** Default fiscal year used when the question doesn't name one. */
export const DEFAULT_FISCAL_YEAR = 2027;

/** Only enrich with a rate when the question is actually about rates/allowances. */
const RATE_INTENT =
  /\bper\s*diem\b|\blodging\b|\bm\s*&?\s*ie\b|\bmeals?\b|\bhotel\b|\bdaily rate\b|\breimburs|\ballowance\b|\brate\b/i;

interface DestLite {
  location: string;
  state: string | null;
  key: string;
  lodging: number;
  mie: number;
}

// Cache the destination list per fiscal year for the process lifetime — the
// rates table holds 40k+ ZIP rows, so we avoid scanning on every chat turn.
const destCache = new Map<number, { at: number; rows: DestLite[] }>();
const TTL_MS = 10 * 60 * 1000;

async function cachedDestinations(
  clients: AwsClients,
  cfg: AppConfig,
  fiscalYear: number,
): Promise<DestLite[]> {
  const hit = destCache.get(fiscalYear);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.rows;
  const rows = (await listPerDiemDestinations(clients, cfg, fiscalYear)).map((r) => ({
    location: r.location,
    state: r.state,
    key: r.sk,
    lodging: r.lodging,
    mie: r.mie,
  }));
  destCache.set(fiscalYear, { at: Date.now(), rows });
  return rows;
}

function detectFiscalYear(query: string, fallback: number): number {
  const full = query.match(/\b(20\d{2})\b/);
  if (full) {
    const y = Number(full[1]);
    if (y >= 2020 && y <= 2035) return y;
  }
  const fy = query.match(/\bfy\s?'?(\d{2})\b/i);
  if (fy) return 2000 + Number(fy[1]);
  return fallback;
}

function cityOf(location: string, state: string | null): string {
  if (state && location.endsWith(`, ${state}`)) return location.slice(0, -(state.length + 2));
  return location;
}

// Full state names for disambiguating same-named cities across states.
const STATE_NAMES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California",
  CO: "Colorado", CT: "Connecticut", DE: "Delaware", DC: "District of Columbia",
  FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois",
  IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana",
  ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota",
  MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada",
  NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York",
  NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon",
  PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota",
  TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia",
  WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
};

/**
 * Whether the query names the given state — either the full state name
 * (case-insensitive) or the uppercase abbreviation as a standalone token.
 * The abbreviation check is case-sensitive to avoid matching common words like
 * "in", "or", "me" against state codes IN/OR/ME.
 */
function mentionsState(query: string, state: string | null): boolean {
  if (!state) return false;
  const name = STATE_NAMES[state.toUpperCase()];
  if (name && new RegExp(`\\b${name}\\b`, "i").test(query)) return true;
  return new RegExp(`\\b${state.toUpperCase()}\\b`).test(query);
}

const SOURCE_URI = "https://www.gsa.gov/travel/plan-book/per-diem-rates";

export interface RateContext {
  text: string;
  citation: Citation;
}

function makeContext(args: {
  location: string;
  state: string | null;
  lodging: number;
  mie: number | null;
  fiscalYear: number;
  via: string | null;
}): RateContext {
  const { location, state, lodging, mie, fiscalYear, via } = args;
  const place =
    state && !location.endsWith(`, ${state}`) ? `${location}, ${state}` : location;
  const text =
    `GSA FY${fiscalYear} per-diem rate — ${place}${via ? ` (matched via ${via})` : ""}: ` +
    `maximum lodging $${lodging} per night, M&IE (meals & incidental expenses) $${mie ?? "n/a"} per day. ` +
    `The first and last day of travel are paid at 75% of the M&IE rate. ` +
    `Lodging is a nightly ceiling; M&IE is a flat daily amount.`;
  return {
    text,
    citation: {
      chunkId: `gsa-perdiem-fy${fiscalYear}:${location.toUpperCase()}`,
      docId: `gsa-perdiem-fy${fiscalYear}`,
      docTitle: `GSA FY${fiscalYear} Per Diem Rates`,
      version: `FY${fiscalYear}`,
      sourceUri: SOURCE_URI,
      page: null,
      section: place,
      score: 1,
      snippet: text,
    },
  };
}

/**
 * Detect a per-diem rate question and resolve the real rate from DynamoDB so the
 * chat can answer with exact numbers. Resolution order: explicit ZIP code, then a
 * known destination name mentioned in the question, then Standard CONUS when the
 * question asks about the standard/CONUS rate. Returns null when no rate applies
 * (the question is then answered from retrieved documents only).
 */
export async function lookupRateForQuery(
  clients: AwsClients,
  cfg: AppConfig,
  query: string,
  defaultFiscalYear = DEFAULT_FISCAL_YEAR,
): Promise<RateContext | null> {
  if (!RATE_INTENT.test(query)) return null;
  const fiscalYear = detectFiscalYear(query, defaultFiscalYear);
  const ql = query.toLowerCase();

  // 1) Explicit ZIP code.
  const zipMatch = query.match(/\b(\d{5})\b/);
  if (zipMatch) {
    const zrow = await getZipPerDiem(clients, cfg, fiscalYear, zipMatch[1]);
    if (zrow) {
      const dest = await findPerDiemByName(clients, cfg, fiscalYear, zrow.name, zrow.state);
      const std = dest ? null : await getStandardPerDiem(clients, cfg, fiscalYear);
      return makeContext({
        location: zrow.name,
        state: zrow.state,
        lodging: zrow.lodging,
        mie: dest?.mie ?? std?.mie ?? null,
        fiscalYear,
        via: `ZIP ${zipMatch[1]}`,
      });
    }
  }

  // 2) Known destination name mentioned in the question (longest match wins).
  // GSA groups areas with slashes (e.g. "Atlantic Beach / Morehead City"), so we
  // match on the whole name AND each slash-separated fragment ("wildcard" match),
  // preferring the longest matching fragment for specificity.
  const dests = await cachedDestinations(clients, cfg, fiscalYear);
  let best: DestLite | null = null;
  let bestScore = -1;
  for (const d of dests) {
    const city = cityOf(d.location, d.state);
    const fragments = [city, ...city.split("/")]
      .map((s) => s.trim().toLowerCase())
      .filter((s) => s.length >= 4);
    let fragLen = 0;
    for (const frag of fragments) if (ql.includes(frag)) fragLen = Math.max(fragLen, frag.length);
    if (fragLen === 0) continue;
    // Prefer a destination whose state is also named in the question (so
    // "Dallas TX" wins over "Dallas IA"), then the longest city match.
    const score = (mentionsState(query, d.state) ? 100000 : 0) + fragLen;
    if (score > bestScore) {
      best = d;
      bestScore = score;
    }
  }
  // Common alias: GSA files the capital as "District of Columbia".
  if (!best && /\bwashington\b/.test(ql) && /\bd\.?\s?c\.?\b|district of columbia/.test(ql)) {
    best = dests.find((d) => d.location.toLowerCase().startsWith("district of columbia")) ?? null;
  }
  if (best) {
    return makeContext({
      location: best.location,
      state: best.state,
      lodging: best.lodging,
      mie: best.mie,
      fiscalYear,
      via: null,
    });
  }

  // 3) Standard CONUS when explicitly asked.
  if (/\bstandard\b|\bconus\b/i.test(query)) {
    const std = await getStandardPerDiem(clients, cfg, fiscalYear);
    if (std) {
      return makeContext({
        location: "Standard CONUS",
        state: null,
        lodging: std.lodging,
        mie: std.mie,
        fiscalYear,
        via: null,
      });
    }
  }

  return null;
}
