import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  ControlSchema,
  getConfig,
  log,
  makeClients,
  putControl,
  putRate,
  type Control,
  type MieBreakdown,
  type PerDiemRate,
} from "@compliancechat/shared";

const seedFile = (name: string) => fileURLToPath(new URL(`../../seed/${name}`, import.meta.url));

interface PerDiemSeed {
  _source: string;
  rates: Array<{
    fiscalYear: number;
    key: string;
    state: string | null;
    location: string;
    lodging: number;
    mie: number;
    isStandard: boolean;
  }>;
}
interface MieSeed {
  _source: string;
  rows: Array<{
    mieTotal: number;
    breakfast: number;
    lunch: number;
    dinner: number;
    incidentals: number;
    firstLastDay: number;
  }>;
}

export interface SeedOptions {
  only?: "controls" | "rates";
}

export async function seedCmd(opts: SeedOptions): Promise<void> {
  const cfg = getConfig("ingestion");
  const clients = makeClients(cfg);
  const now = new Date().toISOString();

  if (opts.only !== "rates") {
    const controls = JSON.parse(await readFile(seedFile("controls.json"), "utf8")) as unknown[];
    let n = 0;
    for (const c of controls) {
      const control: Control = ControlSchema.parse({ ...(c as object), createdAt: now });
      await putControl(clients, cfg, control);
      n++;
    }
    log.info(`Seeded ${n} control(s) into ${cfg.dynamo.controlsTable}`);
  }

  if (opts.only !== "controls") {
    const pd = JSON.parse(await readFile(seedFile("perdiem.json"), "utf8")) as PerDiemSeed;
    let pdN = 0;
    for (const r of pd.rates) {
      const row: PerDiemRate = {
        pk: `PERDIEM#${r.fiscalYear}#${r.key.toUpperCase()}`,
        sk: r.key.toUpperCase(),
        type: "PERDIEM",
        fiscalYear: r.fiscalYear,
        state: r.state,
        location: r.location,
        lodging: r.lodging,
        mie: r.mie,
        isStandard: r.isStandard,
        authority: { docId: "gsa-perdiem", label: "GSA Per Diem Rates", sourceUri: pd._source },
      };
      await putRate(clients, cfg, row);
      pdN++;
    }

    const mie = JSON.parse(await readFile(seedFile("mie.json"), "utf8")) as MieSeed;
    let mieN = 0;
    for (const m of mie.rows) {
      const row: MieBreakdown = {
        pk: "MIE#CONUS",
        sk: String(m.mieTotal),
        type: "MIE",
        mieTotal: m.mieTotal,
        breakfast: m.breakfast,
        lunch: m.lunch,
        dinner: m.dinner,
        incidentals: m.incidentals,
        firstLastDay: m.firstLastDay,
        authority: { docId: "gsa-mie-breakdowns", label: "GSA M&IE Breakdowns", sourceUri: mie._source },
      };
      await putRate(clients, cfg, row);
      mieN++;
    }
    log.info(`Seeded ${pdN} per-diem row(s) and ${mieN} M&IE row(s) into ${cfg.dynamo.ratesTable}`);
  }
}
