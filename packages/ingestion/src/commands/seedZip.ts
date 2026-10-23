import {
  batchPutRates,
  getConfig,
  log,
  makeClients,
  type ZipPerDiemRate,
} from "@compliancechat/shared";
import { parseZipPerDiemXlsx } from "../xlsxZip";

const GSA_PERDIEM_URL = "https://www.gsa.gov/travel/plan-book/per-diem-rates";

export interface SeedZipOptions {
  fiscalYear?: string;
}

/**
 * Load the GSA ZIP-code per-diem flat file (xlsx) into the rates table as
 * ZIP#<FY>#<ZIP> rows (lodging only). M&IE is resolved per destination at query
 * time by joining the destination name to the FY per-diem rows.
 */
export async function seedZipCmd(file: string, opts: SeedZipOptions): Promise<void> {
  const cfg = getConfig("ingestion");
  const clients = makeClients(cfg);

  log.info(`Parsing ${file} (this file is large) ...`);
  const parsed = await parseZipPerDiemXlsx(file);
  const fiscalYear = Number(opts.fiscalYear) || parsed.fiscalYear;
  if (!fiscalYear || !Number.isInteger(fiscalYear)) {
    throw new Error("Could not determine fiscal year; pass --fiscal-year");
  }
  log.info(`Parsed ${parsed.rows.length} ZIP row(s) for FY${fiscalYear}.`);

  const rows: ZipPerDiemRate[] = parsed.rows.map((r) => ({
    pk: `ZIP#${fiscalYear}#${r.zip}`,
    sk: "ZIP",
    type: "ZIPPERDIEM",
    fiscalYear,
    zip: r.zip,
    destinationId: r.destinationId,
    name: r.name,
    state: r.state,
    county: r.county,
    lodging: r.lodging,
    authority: {
      docId: `gsa-perdiem-zip-fy${fiscalYear}`,
      label: `GSA FY${fiscalYear} Per Diem Rates (by ZIP code)`,
      sourceUri: GSA_PERDIEM_URL,
    },
  }));

  log.info(`Writing ${rows.length} ZIP row(s) to ${cfg.dynamo.ratesTable} ...`);
  const written = await batchPutRates(clients, cfg, rows, (n) => {
    if (n % 2500 === 0 || n === rows.length) log.info(`  ${n}/${rows.length} written`);
  });
  log.info(`Seeded ${written} FY${fiscalYear} ZIP per-diem row(s).`);
}
