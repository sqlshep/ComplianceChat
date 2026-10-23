import { basename } from "node:path";
import { readFile } from "node:fs/promises";
import {
  getConfig,
  log,
  makeClients,
  putRate,
  putSource,
  type PerDiemRate,
} from "@compliancechat/shared";
import { parsePerDiemXlsx } from "../xlsx";

const GSA_PERDIEM_URL = "https://www.gsa.gov/travel/plan-book/per-diem-rates";

export interface SeedPerdiemOptions {
  fiscalYear: string;
  upload?: boolean;
}

/**
 * Load a GSA per-diem flat file (xlsx) into the rates table as FY<year>
 * PERDIEM rows. Optionally uploads the source file to the versioned S3 source
 * bucket for provenance.
 */
export async function seedPerdiemCmd(file: string, opts: SeedPerdiemOptions): Promise<void> {
  const fiscalYear = Number(opts.fiscalYear);
  if (!Number.isInteger(fiscalYear)) throw new Error(`--fiscal-year must be an integer`);

  const cfg = getConfig("ingestion");
  const clients = makeClients(cfg);

  log.info(`Parsing ${file} ...`);
  const parsed = await parsePerDiemXlsx(file);
  log.info(`Parsed ${parsed.rows.length} destination(s) (incl. Standard CONUS).`);

  let sourceUri = GSA_PERDIEM_URL;
  if (opts.upload) {
    const bytes = await readFile(file);
    const key = `perdiem/${fiscalYear}/${basename(file)}`;
    const res = await putSource(clients, cfg, key, bytes, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    log.info(`Uploaded source to ${res.uri} (versionId=${res.versionId})`);
  }

  let n = 0;
  for (const r of parsed.rows) {
    const row: PerDiemRate = {
      pk: `PERDIEM#${fiscalYear}#${r.key}`,
      sk: r.key,
      type: "PERDIEM",
      fiscalYear,
      state: r.state,
      location: r.location,
      lodging: r.lodging,
      mie: r.mie,
      isStandard: r.isStandard,
      authority: {
        docId: `gsa-perdiem-fy${fiscalYear}`,
        label: `GSA FY${fiscalYear} Per Diem Rates`,
        sourceUri: GSA_PERDIEM_URL,
      },
    };
    await putRate(clients, cfg, row);
    n++;
  }
  log.info(`Seeded ${n} FY${fiscalYear} per-diem row(s) into ${cfg.dynamo.ratesTable}`);
  void sourceUri;
}
